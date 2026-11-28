/* StoryNest narration service — server-side only.
 *
 * What this is: the ONLY place in this project that turns story text
 * into spoken audio. It runs as a serverless function (Vercel), never
 * in a browser. The public site calls ONLY this endpoint (POST
 * /api/narrate) with { text, voice } — where voice is a role key
 * ('narrator', 'luna', 'max', 'pip') — and gets back MP3 audio. The
 * browser never sees a provider name, a model name, a voice ID, or
 * any key.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable ELEVENLABS_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back to the
 * browser's built-in voice.
 *
 * Model: the provider's fast speech model (half character cost).
 * Voice IDs are premade voices, verified live from the provider's
 * voice list on 28 Nov 2026; if one is retired, update the map
 * below — never in client code.
 *
 * Limits (the free plan is 10,000 credits a month, not unlimited):
 *  - the fast model costs ~0.5 credits per character, so the proxy
 *    allows 18,000 characters a month (~9,000 credits), leaving
 *    headroom for the account owner's own use
 *  - per request: 4,000 characters max
 *  - per IP: 4,000 characters a day + 2s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} — no provider details — and the site still reads
 * the story aloud with the browser voice.
 * Counters are in-memory (best-effort on serverless: a cold start
 * resets them). For strict accounting, add a small KV/Redis store.
 *
 * NOTE: this file lives in the public repo (Vercel deploys it from
 * here), so anyone browsing the repo can read that the service calls
 * a speech provider. The SITE itself — its client code, UI, and
 * browser-visible network traffic — reveals nothing.
 */
'use strict';

const PROVIDER_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const MODEL_ID = 'eleven_flash_v2_5';
const OUTPUT_FORMAT = 'mp3_44100_128';
const KEY_ENV = 'ELEVENLABS_API_KEY';

// Role keys the site sends -> premade voice IDs, verified live from
// the provider's voice list on 28 Nov 2026. If one is retired,
// update the map here — never in client code.
const VOICES = {
  narrator: 'JBFqnCBsd6RMkjVDRZzb', // George — warm, captivating storyteller
  luna: 'cgSgspJ2msm6clMCkdW9', // Jessica — playful, bright, warm
  max: 'IKne3meq5aSn9XLyUdCD', // Charlie — deep, confident, energetic
  pip: 'yj30vwTGJxSHezdAGsv9', // Jessa — easygoing and effortless
};
// Alternate (not wired): Bella 'hpp4J3VqNfWAUOO0d1Us' — professional,
// bright, warm. Future (not wired): Tamil voices Ashwin
// 'OP382u5y4MvFmE1mReFV' and Vanishree 'OUBMjq0LvBjb07bhwD3H'.

const MAX_TEXT_CHARS = 4000;
const MONTHLY_CHAR_LIMIT = 18000; // ~9,000 credits at 0.5/char
const PER_IP_DAY_CHAR_LIMIT = 4000;
const PER_IP_MIN_GAP_MS = 2000;
const UPSTREAM_TIMEOUT_MS = 60000;

function monthKey() {
  return new Date().toISOString().slice(0, 7); // UTC YYYY-MM
}
function dayKey() {
  return new Date().toISOString().slice(0, 10); // UTC date
}

// In-memory counters (best-effort on serverless — see header).
let month = monthKey();
let monthChars = 0;
const perIp = new Map(); // ip -> { day, chars, lastAt }
function resetIfNewPeriod() {
  const m = monthKey();
  if (m !== month) {
    month = m;
    monthChars = 0;
    perIp.clear();
  }
}
function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function sendJson(res, status, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(obj);
}

async function callSpeech(key, voiceId, text) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      PROVIDER_URL + '/' + encodeURIComponent(voiceId) + '?output_format=' + OUTPUT_FORMAT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
          'xi-api-key': key,
        },
        body: JSON.stringify({
          text: text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
        signal: controller.signal,
      }
    );
    if (!upstream.ok) {
      console.error('narrate service upstream HTTP', upstream.status);
      if (upstream.status === 402 || upstream.status === 429) return { error: 'limit' };
      return { error: 'unavailable' };
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length === 0) return { error: 'unavailable' };
    return { audio: buf };
  } catch (e) {
    console.error('narrate service error', e && e.name ? e.name : 'unknown');
    return { error: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'bad-request' });

  const key = process.env[KEY_ENV];
  if (!key) return sendJson(res, 503, { error: 'not-configured' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad-request' }); }
  }
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  const voice = body && typeof body.voice === 'string' ? body.voice.trim().toLowerCase() : 'narrator';
  if (!text || text.length > MAX_TEXT_CHARS) return sendJson(res, 400, { error: 'bad-request' });
  const voiceId = VOICES[voice] || VOICES.narrator;

  resetIfNewPeriod();
  if (monthChars + text.length > MONTHLY_CHAR_LIMIT) return sendJson(res, 429, { error: 'limit' });
  const ip = clientIp(req);
  const entry = perIp.get(ip) || { day: dayKey(), chars: 0, lastAt: 0 };
  if (entry.day !== dayKey()) {
    entry.day = dayKey();
    entry.chars = 0;
  }
  if (entry.chars + text.length > PER_IP_DAY_CHAR_LIMIT) return sendJson(res, 429, { error: 'limit' });
  if (Date.now() - entry.lastAt < PER_IP_MIN_GAP_MS) {
    return sendJson(res, 429, { error: 'limit', retry_after_ms: PER_IP_MIN_GAP_MS - (Date.now() - entry.lastAt) });
  }
  entry.lastAt = Date.now();
  perIp.set(ip, entry);

  const result = await callSpeech(key, voiceId, text);
  if (result.audio) {
    monthChars += text.length;
    entry.chars += text.length;
    perIp.set(ip, entry);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(result.audio.length));
    res.status(200).send(result.audio);
    return;
  }
  if (result.error === 'limit') return sendJson(res, 429, { error: 'limit' });
  return sendJson(res, 502, { error: 'unavailable' });
};
