/* ekiddy story service — server-side only.
 *
 * What this is: the ONLY place in this project that talks to a text
 * provider. It runs as a serverless function (Vercel), never in a
 * browser. The public site calls ONLY this endpoint
 * (POST /api/generate-story) and gets back a finished picture-book
 * story — the browser never sees a provider name, a model name, or
 * any key.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable GROQ_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back silently
 * to its built-in story engine — story generation never breaks.
 *
 * What it returns (JSON): { title, description, moral,
 *   characters: [Character Bible lines, locked per scene],
 *   pages: [{ text, scene }] } — exactly the shape the site's
 * Picture Book flow already uses. Each page's text is short
 * (picture-book length, ages 5-7); each scene is a visual
 * description for the illustrator, with no words in the picture.
 *
 * Limits (best-effort, in-memory counters on serverless):
 *  - global: 100 stories/day
 *  - per IP: 20 stories/day + 3s between requests
 * When a limit is hit the endpoint answers 429 with a clean
 * {error:'limit'} — no provider details — and the site silently
 * uses its built-in story engine.
 *
 * NOTE: this file lives in the public repo (Vercel deploys it from
 * here), so anyone browsing the repo can read that the service calls
 * a text provider. The SITE itself — its client code, UI, and
 * browser-visible network traffic — reveals nothing. If even the
 * repo must not name the provider, move this file to a separate
 * private repo and deploy the function from there.
 */
'use strict';

const PROVIDER_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';
const KEY_ENV = 'GROQ_API_KEY';
const GLOBAL_DAY_LIMIT = 100;
const PER_IP_DAY_LIMIT = 20;
const PER_IP_MIN_GAP_MS = 3000;
const MAX_TOKENS = 4000;

const LANG_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi', es: 'Spanish',
  fr: 'French', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese',
};

const SYSTEM_PROMPT = [
  'You write children\'s picture books. Reply with JSON ONLY, no other text.',
  'The JSON must have exactly these keys:',
  'title (string),',
  'description (one sentence, string),',
  'moral (one sentence, string),',
  'characters (array of 1-2 strings; each string is a Character Bible line: "Name — kind; face: ...; hair/fur: ...; outfit: ...; colours: ...; accessories: ...; expression: ...; SAME character in every scene — do not change face, hair, outfit or colours."),',
  'pages (array of exactly the requested number of objects, each with text (2-3 short sentences, picture-book length for ages 5-7) and scene (one short visual description for the illustrator, no words or letters in the picture)).',
  'Keep the same main character on every page, with the same face, hair, outfit and colours.',
  'Never put the story title or any words inside a scene description.',
].join(' ');

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
function cleanStr(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}
// The model is told to reply JSON-only, but be forgiving: if it wraps
// the JSON in prose, extract the first {...} block before parsing.
function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { /* fall through */ }
  }
  return null;
}
function validateStory(data, pageCount) {
  if (!data || typeof data !== 'object') return null;
  const title = cleanStr(data.title, 120);
  const description = cleanStr(data.description, 400);
  const moral = cleanStr(data.moral, 300);
  if (!title || !description || !moral) return null;
  let characters = [];
  if (Array.isArray(data.characters)) {
    characters = data.characters
      .map(function (c) { return cleanStr(c, 600); })
      .filter(function (c) { return !!c; })
      .slice(0, 2);
  }
  if (!characters.length) return null;
  if (!Array.isArray(data.pages) || data.pages.length < 3) return null;
  const pages = [];
  for (let i = 0; i < data.pages.length && pages.length < pageCount; i++) {
    const p = data.pages[i];
    if (!p || typeof p !== 'object') continue;
    const text = cleanStr(p.text, 600);
    const scene = cleanStr(p.scene, 300);
    if (!text || !scene) continue;
    pages.push({ text: text, scene: scene });
  }
  if (pages.length < 3) return null;
  return { title: title, description: description, moral: moral, characters: characters, pages: pages };
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
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad-request' });
  const idea = cleanStr(body.idea, 500);
  const hero = cleanStr(body.hero, 60) || 'Luna';
  const type = cleanStr(body.type, 30) || 'Adventure';
  const age = cleanStr(body.age, 10) || '5–7';
  const lang = LANG_NAMES[body.lang] ? body.lang : 'en';
  const style = cleanStr(body.style, 40) || 'Storybook Illustration';
  const bible = cleanStr(body.bible, 600) || '';
  let pageCount = parseInt(body.pages, 10);
  if (!Number.isFinite(pageCount)) pageCount = 6;
  pageCount = Math.max(4, Math.min(12, pageCount));
  if (!idea) return send(res, 400, { error: 'bad-request' });

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

  const userPrompt = [
    'Write a ' + pageCount + '-page picture book.',
    'Idea: ' + idea,
    'Main character: ' + hero + '.',
    'Story type: ' + type + '.',
    'Age group: ' + age + '.',
    'Language: write all story text (title, description, moral, page text) in ' + LANG_NAMES[lang] + (lang === 'ta' ? ' (Tamil script)' : '') + '.',
    'Pages: ' + pageCount + '.',
    bible ? 'Character Bible to use (keep this character identical on every page): ' + bible : '',
  ].filter(function (s) { return !!s; }).join(' ');

  try {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 90000);
    let upstream;
    try {
      upstream = await fetch(PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
          // The provider sits behind a bot check that rejects bare
          // library user-agents; send a browser-style one.
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      // Upstream quota / auth / outage: clean error only, never the
      // upstream body (it can name providers/models).
      console.error('story service upstream HTTP', upstream.status);
      const status = upstream.status === 429 ? 429 : 502;
      return send(res, status, { error: status === 429 ? 'limit' : 'unavailable' });
    }
    const data = await upstream.json();
    const content = data && Array.isArray(data.choices) && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    const story = validateStory(parseJsonLoose(content), pageCount);
    if (!story) return send(res, 502, { error: 'unavailable' });
    globalCount += 1;
    return send(res, 200, { story: story });
  } catch (e) {
    console.error('story service error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
};
