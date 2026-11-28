/* ekiddy image service — server-side only.
 *
 * What this is: the ONLY place in this project that turns a prompt
 * into a real picture. It runs as a serverless function (Vercel),
 * never in a browser. The public site calls ONLY this endpoint and
 * gets back a finished picture — the browser never sees a provider
 * name, a model name, or any key.
 *
 * Image generation here is SYNC under the hood (the provider
 * answers with the finished picture), but this endpoint keeps the
 * same async shape as the old image service so the site needs no
 * changes:
 *   POST /api/generate-image-openrouter -> {job_id} immediately (200)
 *   GET  /api/generate-image-openrouter?action=status&id=<job_id>
 *       -> {status, progress, image} (image is a base64 data URL
 *          once completed)
 * The finished picture is held in memory keyed by job id
 * (best-effort on serverless: a cold start forgets old jobs, and
 * the site then keeps its built-in illustration for that page).
 * The key is never exposed to the browser.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable OPENROUTER_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site keeps its built-in
 * illustrations.
 *
 * Plan note: the image model used here is a free-tier model
 * (no charge per picture). The free tier allows a limited number
 * of free-model requests per day per key, so the caps below are
 * deliberately small:
 *  - global: 40 successful images/day
 *  - per IP: 6 images/day (one 6-page book) + 3s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} and the site silently uses the built-in picture
 * for that page. A 402 from upstream (free limit reached) is also
 * reported as {error:'limit'}.
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

const PROVIDER_URL = 'https://openrouter.ai/api/v1/images';
const MODEL = 'recraft/recraft-v4.1-flash-v2:free';
const KEY_ENV = 'OPENROUTER_API_KEY';
const GLOBAL_DAY_LIMIT = 40; // free-tier model — keep small
const PER_IP_DAY_LIMIT = 6; // one 6-page book per IP per day
const PER_IP_MIN_GAP_MS = 3000;
const NO_TEXT_SUFFIX = ', no text, no words, no letters, no title';
const MAX_JOBS = 50; // finished pictures held in memory
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
function newJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Finished pictures, keyed by job id. Pruned to MAX_JOBS.
const jobs = new Map(); // id -> { image }
function storeJob(image) {
  const id = newJobId();
  jobs.set(id, { image: image });
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    jobs.delete(oldest);
  }
  return id;
}

async function handleSubmit(req, res, key) {
  const body = parseBody(req);
  if (!body) return send(res, 400, { error: 'bad-request' });
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 1200) return send(res, 400, { error: 'bad-request' });

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

  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 55000);
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
        body: JSON.stringify({
          model: MODEL,
          prompt: prompt + NO_TEXT_SUFFIX,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      // Clean error only, never the upstream body (it can name
      // providers/models). 402 = the free limit is reached.
      console.error('image service upstream HTTP', upstream.status);
      if (upstream.status === 429 || upstream.status === 402) {
        return send(res, 429, { error: 'limit' });
      }
      return send(res, 502, { error: 'unavailable' });
    }
    const data = await upstream.json();
    const b64 = data && Array.isArray(data.data) && data.data[0] && data.data[0].b64_json;
    if (typeof b64 !== 'string' || !b64) {
      return send(res, 502, { error: 'unavailable' });
    }
    globalCount += 1;
    const id = storeJob('data:image/png;base64,' + b64);
    return send(res, 200, { job_id: id });
  } catch (e) {
    console.error('image service submit error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
}

async function handleStatus(req, res) {
  const url = new URL(req.url || '', 'http://localhost');
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return send(res, 400, { error: 'bad-request' });
  const job = jobs.get(id);
  if (!job) {
    // Unknown job (e.g. a cold start forgot it): the site keeps
    // its built-in illustration for that page.
    return send(res, 200, { status: 'failed' });
  }
  return send(res, 200, { status: 'completed', progress: 100, image: job.image });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  const key = process.env[KEY_ENV];
  if (!key) return send(res, 503, { error: 'not-configured' });
  if (req.method === 'POST') return handleSubmit(req, res, key);
  if (req.method === 'GET') {
    const url = new URL(req.url || '', 'http://localhost');
    if (url.searchParams.get('action') === 'status') return handleStatus(req, res);
    return send(res, 400, { error: 'bad-request' });
  }
  return send(res, 405, { error: 'bad-request' });
};
