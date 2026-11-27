/* StoryNest picture-recognition service — server-side only.
 *
 * What this is: the ONLY place in this project that looks at a picture
 * a user drops in as a story idea. It runs as a serverless function
 * (Vercel), never in a browser. The public site calls ONLY this
 * endpoint (POST /api/describe-image) and gets back a short plain
 * description — characters, setting, mood — which becomes the story
 * idea. The browser never sees a provider name, a model name, or
 * any key.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable OPENROUTER_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back to using
 * the picture as inspiration without recognition.
 *
 * Model: a free vision model on the provider. Primary is
 * google/gemma-4-26b-a4b-it:free, fallback is
 * nvidia/nemotron-3.5-super-vl:free (both verified as free
 * text+image models on the provider's public model list, Nov 2026).
 * If the primary is retired, update the constant here — never in
 * client code.
 *
 * Limits (free tier is rate-limited, not unlimited):
 *  - global: 40 descriptions/day
 *  - per IP: 10 descriptions/day + 3s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} — no provider details — and the site still
 * generates the story from its built-in engine.
 * Counters are in-memory (best-effort on serverless: a cold start
 * resets them). For strict accounting, add a small KV/Redis store.
 *
 * NOTE: this file lives in the public repo (Vercel deploys it from
 * here), so anyone browsing the repo can read that the service calls
 * a vision provider. The SITE itself — its client code, UI, and
 * browser-visible network traffic — reveals nothing.
 */
'use strict';

const PROVIDER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PRIMARY_MODEL = 'google/gemma-4-26b-a4b-it:free';
const FALLBACK_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const KEY_ENV = 'OPENROUTER_API_KEY';
const GLOBAL_DAY_LIMIT = 40;
const PER_IP_DAY_LIMIT = 10;
const PER_IP_MIN_GAP_MS = 3000;
const MAX_IMAGE_CHARS = 3000000; // ~2.2 MB of base64

function todayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date
}

// In-memory counters (best-effort on serverless — see header).
let day = todayKey();
let globalCount = 0;
const perIp = new Map(); // ip -> { count, lastAt }
function resetIfNewDay() {
  const t = todayKey();
  if (t !== day) {
    day = t;
    globalCount = 0;
    perIp.clear();
  }
}
function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function send(res, status, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(obj);
}

function parseDescription(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.description === 'string' && parsed.description.trim()) {
      return {
        description: parsed.description.trim().slice(0, 600),
        character: typeof parsed.character === 'string' ? parsed.character.trim().slice(0, 200) : '',
        setting: typeof parsed.setting === 'string' ? parsed.setting.trim().slice(0, 200) : '',
        mood: typeof parsed.mood === 'string' ? parsed.mood.trim().slice(0, 100) : '',
      };
    }
  } catch (e) {
    // Not JSON — fall through and use the raw text as the description.
  }
  const flat = cleaned.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return { description: flat.slice(0, 600), character: '', setting: '', mood: '' };
}

async function callVision(key, model, imageDataUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const upstream = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        'HTTP-Referer': 'https://ekiddy.com/',
        'X-Title': 'ekiddy',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content:
              'You describe pictures for a children\'s picture-book app. Answer with JSON only, no other text: {"description": "2-3 sentences: who is in the picture, what they look like, where they are, what is happening, the mood and colours", "character": "the main character in a few words", "setting": "where the picture takes place", "mood": "the feeling of the picture in a few words"}. Keep everything kind and child-friendly.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this picture for a children\'s story. Who is in it, where are they, what is happening?' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: 400,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.error('describe service upstream HTTP', upstream.status, 'model', model);
      return { error: upstream.status === 402 || upstream.status === 429 ? 'limit' : 'unavailable' };
    }
    const data = await upstream.json();
    const text =
      data && Array.isArray(data.choices) && data.choices[0] &&
      data.choices[0].message && typeof data.choices[0].message.content === 'string'
        ? data.choices[0].message.content
        : '';
    const parsed = parseDescription(text);
    if (!parsed) return { error: 'unavailable' };
    return { result: parsed };
  } catch (e) {
    console.error('describe service error', e && e.name ? e.name : 'unknown');
    return { error: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { error: 'bad-request' });

  const key = process.env[KEY_ENV];
  if (!key) return send(res, 503, { error: 'not-configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad-request' }); }
  }
  const image = body && typeof body.image === 'string' ? body.image.trim() : '';
  if (!image || image.length > MAX_IMAGE_CHARS || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return send(res, 400, { error: 'bad-request' });
  }

  resetIfNewDay();
  if (globalCount >= GLOBAL_DAY_LIMIT) return send(res, 429, { error: 'limit' });
  const ip = clientIp(req);
  const entry = perIp.get(ip) || { count: 0, lastAt: 0 };
  if (entry.count >= PER_IP_DAY_LIMIT) return send(res, 429, { error: 'limit' });
  if (Date.now() - entry.lastAt < PER_IP_MIN_GAP_MS) {
    return send(res, 429, { error: 'limit', retry_after_ms: PER_IP_MIN_GAP_MS - (Date.now() - entry.lastAt) });
  }
  entry.count += 1;
  entry.lastAt = Date.now();
  perIp.set(ip, entry);

  const primary = await callVision(key, PRIMARY_MODEL, image, 60000);
  if (primary.result) {
    globalCount += 1;
    return send(res, 200, primary.result);
  }
  // Primary failed (retired model, outage, rate limit) — one try on the fallback.
  const fallback = await callVision(key, FALLBACK_MODEL, image, 60000);
  if (fallback.result) {
    globalCount += 1;
    return send(res, 200, fallback.result);
  }
  if (fallback.error === 'limit' || primary.error === 'limit') {
    return send(res, 429, { error: 'limit' });
  }
  return send(res, 502, { error: 'unavailable' });
};
