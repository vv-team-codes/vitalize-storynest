/* StoryNest image service — server-side only.
 *
 * What this is: the ONLY place in this project that talks to an image
 * provider. It runs as a serverless function (Vercel), never in a
 * browser. The public site calls ONLY this endpoint
 * (POST /api/generate-image) and gets back a finished picture —
 * the browser never sees a provider name, a model name, or any key.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable OPENROUTER_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back to its
 * built-in illustrations.
 *
 * Limits (the free tier allows 50 images/day TOTAL on the key):
 *  - global: 48 successful images/day (headroom below 50)
 *  - per IP: 12 images/day (two 6-page books) + 3s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} — no provider details — and the site silently
 * uses the built-in picture for that page.
 * Counters are in-memory (best-effort on serverless: a cold start
 * resets them). For strict accounting, add a small KV/Redis store.
 *
 * Prompt rule learned from a real test: the image model sometimes
 * renders garbled title text on top of the picture, so every prompt
 * gets "no text, no words, no letters, no title" appended HERE,
 * server-side, so no client can forget it.
 *
 * NOTE: this file lives in the public repo (Vercel deploys it from
 * here), so anyone browsing the repo can read that the service calls
 * an image provider. The SITE itself — its client code, UI, and
 * browser-visible network traffic — reveals nothing. If even the
 * repo must not name the provider, move this file to a separate
 * private repo and deploy the function from there.
 */
'use strict';

const PROVIDER_URL = 'https://openrouter.ai/api/v1/images';
const MODEL = 'recraft/recraft-v4.1-flash-v2:free';
const KEY_ENV = 'OPENROUTER_API_KEY';
const GLOBAL_DAY_LIMIT = 48; // free tier is 50/day total — keep headroom
const PER_IP_DAY_LIMIT = 12; // two 6-page books per IP per day
const PER_IP_MIN_GAP_MS = 3000;
const NO_TEXT_SUFFIX = ', no text, no words, no letters, no title';

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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  if (req.method !== 'POST') return send(res, 405, { error: 'bad-request' });

  const key = process.env[KEY_ENV];
  if (!key) return send(res, 503, { error: 'not-configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'bad-request' }); }
  }
  const prompt = body && typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 1200) return send(res, 400, { error: 'bad-request' });
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed) : Math.floor(Math.random() * 1000000);

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

  const fullPrompt = prompt + NO_TEXT_SUFFIX;
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 120000);
    let upstream;
    try {
      upstream = await fetch(PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: fullPrompt,
          n: 1,
          size: '1024x1024',
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      // Upstream quota / auth / outage: clean error only, never the
      // upstream body (it can name providers/models).
      console.error('image service upstream HTTP', upstream.status);
      const status = upstream.status === 402 || upstream.status === 429 ? 429 : 502;
      return send(res, status, { error: status === 429 ? 'limit' : 'unavailable' });
    }
    const data = await upstream.json();
    const item = data && Array.isArray(data.data) && data.data[0];
    let image = null;
    if (item && typeof item.b64_json === 'string' && item.b64_json) {
      image = 'data:image/png;base64,' + item.b64_json;
    } else if (item && typeof item.url === 'string' && item.url) {
      // Fetch the picture server-side so the browser never contacts
      // the provider's CDN directly.
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) return send(res, 502, { error: 'unavailable' });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mime = (imgRes.headers.get('content-type') || 'image/png').split(';')[0];
      image = 'data:' + mime + ';base64,' + buf.toString('base64');
    }
    if (!image) return send(res, 502, { error: 'unavailable' });
    globalCount += 1;
    return send(res, 200, { image: image });
  } catch (e) {
    console.error('image service error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
};
