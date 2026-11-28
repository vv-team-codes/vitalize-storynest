/* ekiddy video service — server-side only.
 *
 * What this is: the ONLY place in this project that talks to a video
 * provider. It runs as a serverless function (Vercel), never in a
 * browser. The public site calls ONLY this endpoint and gets back a
 * finished clip — the browser never sees a provider name, a model
 * name, or any key.
 *
 * Video generation is ASYNC (a clip takes 30s to a few minutes), so
 * this endpoint never holds a connection while a video renders:
 *   POST /api/generate-video-openrouter -> {job_id} immediately (200)
 *   GET  /api/generate-video-openrouter?action=status&id=<job_id>
 *       -> {status, progress, video_url, expires_at, cost}
 * When a job is completed, video_url is a signed download URL that
 * works without a key until expires_at — the browser downloads the
 * MP4 straight from it, so no video bytes ever pass through this
 * function. The key is never exposed to the browser.
 *
 * The first frame: POST accepts an optional `image` (a picture data
 * URL, JPG/PNG/WebP). When present it is sent as the clip's first
 * frame, so a photo can be animated into a clip — that is how the
 * sample video from an uploaded photo works.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable OPENROUTER_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back to its
 * built-in renderer.
 *
 * Plan note: video generation on this provider is PAID per second
 * of output (no free video tier). The model used here costs about
 * $0.05 per second with audio at 720p, so one 8-second clip costs
 * about $0.40, billed to the provider account balance. A 402 from
 * upstream (out of credits) is passed through as 402 with a clean
 * {error:'paid_plan_required'} — no provider details — and the site
 * falls back to its built-in renderer. The caps below allow one
 * full film per IP per day plus a little spare:
 *  - global: 40 clips/day (about one 1-minute film is 8 clips)
 *  - per IP: 10 clips/day + 10s between submissions
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} and the site falls back to its built-in renderer.
 * Counters are in-memory (best-effort on serverless: a cold start
 * resets them). For strict accounting, add a small KV/Redis store.
 *
 * NOTE: this file lives in the public repo (Vercel deploys it from
 * here), so anyone browsing the repo can read that the service calls
 * a video provider. The SITE itself — its client code, UI, and
 * browser-visible network traffic — reveals nothing. If even the
 * repo must not name the provider, move this file to a separate
 * private repo and deploy the function from there.
 */
'use strict';

const PROVIDER_URL = 'https://openrouter.ai/api/v1/videos';
const MODEL_ID = 'google/veo-3.1-lite';
const KEY_ENV = 'OPENROUTER_API_KEY';
const GLOBAL_DAY_LIMIT = 40; // 8s clips with audio
const PER_IP_DAY_LIMIT = 10; // one full 1-minute film (8 clips) + spare
const PER_IP_MIN_GAP_MS = 10000;
const RESOLUTION = '720p';
const DURATIONS = [4, 6, 8];
const ASPECTS = ['16:9', '9:16'];
const MAX_IMAGE_CHARS = 3000000; // ~2.2 MB of image bytes as a data URL
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const IMAGE_URL_RE = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(obj);
}
function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  return body && typeof body === 'object' ? body : null;
}
function upstreamErrorStatus(status) {
  // Clean error only, never the upstream body (it can name
  // providers/models). 402 = the account is out of credits.
  if (status === 402) return 402;
  if (status === 429) return 429;
  return 502;
}
function upstreamErrorName(status) {
  if (status === 402) return 'paid_plan_required';
  if (status === 429) return 'limit';
  return 'unavailable';
}

async function handleSubmit(req, res, key) {
  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'bad-request' });
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 1200) return send(res, 400, { error: 'bad-request' });
  const duration = DURATIONS.indexOf(body.duration) >= 0 ? body.duration : 8;
  const aspect = ASPECTS.indexOf(body.aspect_ratio) >= 0 ? body.aspect_ratio : '16:9';
  const withAudio = body.with_audio !== false;
  let image = null;
  if (body.image != null) {
    if (typeof body.image !== 'string' || body.image.length > MAX_IMAGE_CHARS) {
      return send(res, 400, { error: 'bad-request' });
    }
    const m = IMAGE_URL_RE.exec(body.image);
    if (!m) return send(res, 400, { error: 'bad-request' });
    image = body.image;
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

  const payload = {
    model: MODEL_ID,
    prompt: prompt,
    duration: duration,
    resolution: RESOLUTION,
    aspect_ratio: aspect,
    generate_audio: withAudio,
  };
  if (image) {
    payload.frame_images = [
      {
        type: 'image_url',
        image_url: { url: image },
        frame_type: 'first_frame',
      },
    ];
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 60000);
    let upstream;
    try {
      upstream = await fetch(PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
          'HTTP-Referer': 'https://ekiddy.com',
          'X-Title': 'ekiddy',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.error('video service submit HTTP', upstream.status);
      const mapped = upstreamErrorStatus(upstream.status);
      return send(res, mapped, { error: upstreamErrorName(upstream.status) });
    }
    const data = await upstream.json();
    if (!data || typeof data.id !== 'string' || !ID_RE.test(data.id)) {
      return send(res, 502, { error: 'unavailable' });
    }
    globalCount += 1;
    return send(res, 200, { job_id: data.id });
  } catch (e) {
    console.error('video service submit error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
}

async function handleStatus(req, res, key) {
  const url = new URL(req.url || '', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return send(res, 400, { error: 'bad-request' });
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 30000);
    let upstream;
    try {
      upstream = await fetch(PROVIDER_URL + '/' + encodeURIComponent(id), {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + key,
          'HTTP-Referer': 'https://ekiddy.com',
          'X-Title': 'ekiddy',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.error('video service status HTTP', upstream.status);
      const mapped = upstreamErrorStatus(upstream.status);
      return send(res, mapped, { error: upstreamErrorName(upstream.status) });
    }
    const data = await upstream.json();
    const status = data && typeof data.status === 'string' ? data.status : '';
    if (status === 'completed') {
      const out = { status: 'completed', progress: 100 };
      const urls = Array.isArray(data.urls) ? data.urls : [];
      const videoUrl = typeof urls[0] === 'string' ? urls[0] : '';
      if (videoUrl) {
        out.video_url = videoUrl;
      } else {
        // No signed copy to hand the browser: the finished video
        // expired before download. The client treats this as a
        // failed clip and falls back to the built-in renderer.
        out.error = 'expired';
      }
      if (data.usage && typeof data.usage.cost === 'number') out.cost = data.usage.cost;
      return send(res, 200, out);
    }
    if (status === 'failed' || status === 'cancelled') {
      return send(res, 200, { status: 'failed' });
    }
    if (status === 'expired') {
      return send(res, 200, { status: 'failed', error: 'expired' });
    }
    if (status === 'pending' || status === 'in_progress') {
      return send(res, 200, { status: status === 'in_progress' ? 'generating' : 'pending' });
    }
    return send(res, 502, { error: 'unavailable' });
  } catch (e) {
    console.error('video service status error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  const key = process.env[KEY_ENV];
  if (!key) return send(res, 503, { error: 'not-configured' });
  if (req.method === 'POST') return handleSubmit(req, res, key);
  if (req.method === 'GET') {
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.get('action') === 'status') return handleStatus(req, res, key);
    return send(res, 400, { error: 'bad-request' });
  }
  return send(res, 405, { error: 'bad-request' });
};
