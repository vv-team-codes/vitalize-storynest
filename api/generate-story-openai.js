/* ekiddy story service — server-side only.
 *
 * What this is: the ONLY place in this project that turns a story
 * idea into a finished picture-book story. It runs as a serverless
 * function (Vercel), never in a browser. The public site calls ONLY
 * this endpoint (POST /api/generate-story-openai) and gets back a
 * story — the browser never sees a provider name, a model name, or
 * any key.
 *
 * Credentials: the provider key is read ONLY from the environment
 * variable OPENAI_API_KEY, set in the Vercel dashboard
 * (Settings > Environment Variables). It is NEVER in this file,
 * NEVER in the repo, NEVER in client code. If the variable is not
 * set, this endpoint answers 503 and the site falls back silently
 * to its built-in story engine — story generation never breaks.
 *
 * What it returns (JSON): { title, pages: [{ text, imagePrompt,
 *   videoPrompt, dialogue }] } — one story of 6 pages by default.
 * Each page's text is short (picture-book length); imagePrompt is
 * a visual description for the picture service (same character on
 * every page, no words in the picture); videoPrompt is a short
 * motion description for the video service; dialogue is one short
 * line the main character says aloud. The picture and video
 * services keep using these per-scene prompts exactly as before.
 *
 * Second mode on the same endpoint: POST { action: 'describe',
 * image } with a downscaled picture data URL (max ~1 MB base64)
 * returns { description, idea, character, style } — what the
 * picture shows, a story idea for it, a Character Bible line, and
 * the closest art style. The site uses that to seed the story and
 * the per-scene prompts, so generated pictures keep the dropped
 * character and style. Same key, same clean errors, separate
 * small caps (20/day global, 5/day per IP, 3s gap).
 *
 * Limits (best-effort, in-memory counters on serverless):
 *  - global: 20 stories/day
 *  - per IP: 5 stories/day + 3s between requests
 *  - output: about 1,200 words max (enforced by validation)
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

const PROVIDER_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const KEY_ENV = 'OPENAI_API_KEY';
const GLOBAL_DAY_LIMIT = 20;
const PER_IP_DAY_LIMIT = 5;
const PER_IP_MIN_GAP_MS = 3000;
const MAX_TOKENS = 2800;
const MAX_TOTAL_WORDS = 1500;

const SYSTEM_PROMPT = [
  'You write original children\'s picture books. Reply with JSON ONLY, no other text.',
  'The JSON must have exactly these keys:',
  'title (string, the book title),',
  'pages (array of exactly the requested number of objects, each with:',
  'text (2-3 short sentences, picture-book length, warm and kind),',
  'imagePrompt (one visual description for an illustrator: the scene, the setting, what the characters are doing; repeat the Character Bible verbatim at the start of EVERY imagePrompt so the same character appears on every page; NEVER any words, letters, titles or text in the picture),',
  'videoPrompt (one short motion description for a video clip of this scene: what moves and how the camera moves; repeat the Character Bible verbatim at the start of EVERY videoPrompt),',
  'dialogue (one short line the main character says aloud in this scene)).',
  'Keep the same main character on every page, with the same face, hair, outfit and colours.',
  'Write completely original stories. Never copy any existing book, film or character, and never use a famous or copyrighted character.',
  'Child-safe only: gentle, kind, no fear, no violence, no sadness that lingers.',
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
const DESCRIBE_SYSTEM_PROMPT = [
  'You describe a picture for a children\'s picture book. Reply with JSON ONLY, no other text.',
  'The JSON must have exactly these keys:',
  'description (2-3 sentences: what the picture shows — the main character, the setting, the mood),',
  'idea (one sentence: a story idea this picture could become),',
  'character (one Character Bible line for the main character in the picture: "Name — kind; face: ...; hair/fur: ...; outfit: ...; colours: ...; accessories: ...; expression: ...; SAME character in every scene — do not change face, hair, outfit or colours." If the picture has no clear character, invent a gentle one that fits it),',
  'style (one of: 3D Cartoon, Anime, Pixar-inspired 3D, Watercolor, Storybook Illustration, Disney-inspired Fairy Tale, Clay Animation, Paper Cut, Hand Drawn, Digital Painting — whichever the picture looks closest to).',
  'Child-safe only: gentle, kind, no fear, no violence.',
].join(' ');
const DESCRIBE_MAX_TOKENS = 600;
const DESCRIBE_MAX_IMAGE_CHARS = 1400000; // ~1 MB of base64
const DESCRIBE_GLOBAL_DAY_LIMIT = 20;
const DESCRIBE_PER_IP_DAY_LIMIT = 5;

// Describe counters (separate from story counters, same style).
let describeDay = todayKey();
let describeGlobalCount = 0;
const describePerIp = new Map(); // ip -> { count, lastAt }
function resetDescribeIfNewDay() {
  const t = todayKey();
  if (t !== describeDay) {
    describeDay = t;
    describeGlobalCount = 0;
    describePerIp.clear();
  }
}
function describeLimitHit(req) {
  resetDescribeIfNewDay();
  if (describeGlobalCount >= DESCRIBE_GLOBAL_DAY_LIMIT) return true;
  const ip = clientIp(req);
  const entry = describePerIp.get(ip) || { count: 0, lastAt: 0 };
  if (entry.count >= DESCRIBE_PER_IP_DAY_LIMIT) return true;
  if (Date.now() - entry.lastAt < PER_IP_MIN_GAP_MS) return true;
  entry.count += 1;
  entry.lastAt = Date.now();
  describePerIp.set(ip, entry);
  return false;
}
function validateDescription(data) {
  if (!data || typeof data !== 'object') return null;
  const description = cleanStr(data.description, 600);
  const idea = cleanStr(data.idea, 300);
  const character = cleanStr(data.character, 600);
  const style = cleanStr(data.style, 40);
  if (!description || !idea || !character || !style) return null;
  return { description: description, idea: idea, character: character, style: style };
}

async function handleDescribe(req, res, key, body) {
  const image = typeof body.image === 'string' ? body.image.trim() : '';
  if (!image || image.length > DESCRIBE_MAX_IMAGE_CHARS || image.indexOf('data:image/') !== 0) {
    return send(res, 400, { error: 'bad-request' });
  }
  if (describeLimitHit(req)) return send(res, 429, { error: 'limit' });

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
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: DESCRIBE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this picture for a children\'s picture book.' },
                { type: 'image_url', image_url: { url: image, detail: 'low' } },
              ],
            },
          ],
          temperature: 0.7,
          max_tokens: DESCRIBE_MAX_TOKENS,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!upstream.ok) {
      console.error('story service describe upstream HTTP', upstream.status);
      const status = upstream.status === 429 ? 429 : 502;
      return send(res, status, { error: status === 429 ? 'limit' : 'unavailable' });
    }
    const data = await upstream.json();
    const content = data && Array.isArray(data.choices) && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    const result = validateDescription(parseJsonLoose(content));
    if (!result) return send(res, 502, { error: 'unavailable' });
    describeGlobalCount += 1;
    return send(res, 200, result);
  } catch (e) {
    console.error('story service describe error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
}

function wordCount(s) {
  return s.split(/\s+/).filter(function (w) { return !!w; }).length;
}
function validateStory(data, pageCount) {
  if (!data || typeof data !== 'object') return null;
  const title = cleanStr(data.title, 120);
  if (!title) return null;
  if (!Array.isArray(data.pages) || data.pages.length < 3) return null;
  const pages = [];
  let totalWords = wordCount(title);
  for (let i = 0; i < data.pages.length && pages.length < pageCount; i++) {
    const p = data.pages[i];
    if (!p || typeof p !== 'object') continue;
    const text = cleanStr(p.text, 600);
    const imagePrompt = cleanStr(p.imagePrompt, 400);
    const videoPrompt = cleanStr(p.videoPrompt, 400);
    const dialogue = cleanStr(p.dialogue, 200);
    if (!text || !imagePrompt || !videoPrompt) continue;
    totalWords += wordCount(text) + wordCount(imagePrompt) + wordCount(videoPrompt) + (dialogue ? wordCount(dialogue) : 0);
    pages.push({ text: text, imagePrompt: imagePrompt, videoPrompt: videoPrompt, dialogue: dialogue || '' });
  }
  if (pages.length < 3) return null;
  if (totalWords > MAX_TOTAL_WORDS) return null;
  return { title: title, pages: pages };
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

  // Second mode on the same endpoint: describe a dropped picture
  // (vision). Same key, same clean errors, separate small caps.
  if (body.action === 'describe') return handleDescribe(req, res, key, body);

  const idea = cleanStr(body.idea, 500);
  const hero = cleanStr(body.hero, 60) || 'Luna';
  const storyType = cleanStr(body.storyType, 30) || 'Adventure';
  const ageGroup = cleanStr(body.ageGroup, 10) || '5-7';
  const language = cleanStr(body.language, 20) || 'English';
  const character = cleanStr(body.character, 600) || '';
  const picture = cleanStr(body.picture, 600) || '';
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
    'Story type: ' + storyType + '.',
    'Age group: ' + ageGroup + '.',
    'Write all story text (title, page text, dialogue) in ' + language + '.',
    'Write imagePrompt and videoPrompt in English.',
    'Pages: ' + pageCount + '.',
    character ? 'Character Bible — repeat this description verbatim at the start of every imagePrompt and videoPrompt, and keep this character identical on every page: ' + character : '',
    picture ? 'Picture description — the story must follow this picture: ' + picture : '',
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
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
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
    return send(res, 200, story);
  } catch (e) {
    console.error('story service error', e && e.name ? e.name : 'unknown');
    return send(res, 502, { error: 'unavailable' });
  }
};
