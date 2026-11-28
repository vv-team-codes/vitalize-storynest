/* StoryNest image service — server-side only.
 *
 * What this is: the ONLY place in this project that turns a prompt
 * into a real picture. It runs as a serverless function (Vercel),
 * never in a browser. The public site calls ONLY this endpoint and
 * gets back a finished picture — the browser never sees a provider
 * name, a model name, or any key.
 *
 * Image generation is ASYNC (a picture takes seconds to a minute),
 * so this endpoint never holds a connection while an image renders:
 *   POST /api/generate-image-eleven -> {job_id} immediately (200)
 *   GET  /api/generate-image-eleven?action=status&id=<job_id>
 *       -> {status, progress, image} (image is a base64 data URL
 *          once completed, fetched server-side so the browser never
 *          contacts the provider's CDN directly)
 * The key is never exposed to the browser.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable ELEVENLABS_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site keeps its built-in
 * illustrations.
 *
 * Plan note: image generation on this provider is a paid feature
 * (Pro plan and above). Below that tier the provider answers 402,
 * which this endpoint passes through as 402 with a clean
 * {error:'paid_plan_required'} — no provider details — and the site
 * keeps its built-in illustrations. There is no free image tier
 * here; every generation is billed to the workspace, so the caps
 * below are deliberately small:
 *  - global: 24 successful images/day
 *  - per IP: 6 images/day (one 6-page book) + 3s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} and the site silently uses the built-in picture
 * for that page.
 * Counters are in-memory (best-effort on serverless: a cold start
 * resets them). For strict accounting, add a small KV/Redis store.
 *
 * Prompt rule learned from a real test: an image model sometimes
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

const PROVIDER_BASE = 'https://api.elevenlabs.io/v1/flows';
const MODEL_ID = 'gemini-3-pro-image';
const KEY_ENV = 'ELEVENLABS_API_KEY';
const GLOBAL_DAY_LIMIT = 24; // paid per generation — keep small
const PER_IP_DAY_LIMIT = 6; // one 6-page book per IP per day
const PER_IP_MIN_GAP_MS = 3000;
const NO_TEXT_SUFFIX = ', no text, no words, no letters, no title';
const ASPECTS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const MAX_IMAGE_BYTES = 3000000; // ~3 MB of image bytes as a download
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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
  // providers/models). 402 = the workspace plan does not cover
  // image generation.
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
  const aspect = ASPECTS.indexOf(body.aspect_ratio) >= 0 ? body.aspect_ratio : '16:9';
  const seed = Number.isFinite(body.seed) ? Math.floor(body.seed) : undefined;

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
    model_id: MODEL_ID,
    prompt: prompt + NO_TEXT_SUFFIX,
    aspect_ratio: aspect,
    resolution: '1K',
  };
  if (seed !== undefined) payload.seed = seed;
  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 30000);
    let upstream;
    try {
      upstream = await fetch(PROVIDER_BASE + '/image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': key,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.error('image service submit HTTP', upstream.status);
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
    console.error('image service submit error', e && e.name ? e.name : 'unknown');
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
      upstream = await fetch(PROVIDER_BASE + '/image/' + encodeURIComponent(id), {
        method: 'GET',
        headers: { 'xi-api-key': key },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.error('image service status HTTP', upstream.status);
      const mapped = upstreamErrorStatus(upstream.status);
      return send(res, mapped, { error: upstreamErrorName(upstream.status) });
    }
    const data = await upstream.json();
    const status = data && typeof data.status === 'string' ? data.status : '';
    if (status === 'completed') {
      const contentUrl = typeof data.content_url === 'string' ? data.content_url : '';
      const mime = typeof data.content_mime_type === 'string' ? data.content_mime_type : 'image/png';
      if (!contentUrl || mime.indexOf('image/') !== 0) {
        return send(res, 502, { error: 'unavailable' });
      }
      // Fetch the picture server-side so the browser never contacts
      // the provider's CDN directly, and hand back a data URL the
      // site can store with the book.
      const imgController = new AbortController();
      const imgTimer = setTimeout(function () { imgController.abort(); }, 60000);
      let imgRes;
      try {
        imgRes = await fetch(contentUrl, { signal: imgController.signal });
      } finally {
        clearTimeout(imgTimer);
      }
      if (!imgRes.ok) return send(res, 502, { error: 'unavailable' });
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
        return send(res, 502, { error: 'unavailable' });
      }
      return send(res, 200, {
        status: 'completed',
        progress: 100,
        image: 'data:' + mime.split(';')[0] + ';base64,' + buf.toString('base64'),
      });
    }
    if (status === 'failed') {
      return send(res, 200, { status: 'failed' });
    }
    if (status === 'pending' || status === 'generating') {
      return send(res, 200, { status: status });
    }
    return send(res, 502, { error: 'unavailable' });
  } catch (e) {
    console.error('image service status error', e && e.name ? e.name : 'unknown');
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
