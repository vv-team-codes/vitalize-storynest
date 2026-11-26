# Vitalize StoryNest

**AI Children's Storytelling Studio — free, unlimited, private.**

Create picture books, animations, music videos and comics in your browser. No account, no payment, no daily limits, no token counting.

**Live site (GitHub Pages):** https://vv-team-codes.github.io/vitalize-storynest/
**Repo:** https://github.com/vv-team-codes/vitalize-storynest

## Run it

No build step. Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or enable GitHub Pages: repo **Settings → Pages → Deploy from a branch → main → / (root)**. The live link is then `https://vv-team-codes.github.io/vitalize-storynest/`.

## What works (built-in, no key needed)

- **Picture Book Generator** — idea / manuscript / `.txt` upload, suggested & random ideas; age 0–3 / 4–6 / 5–7 / 7–9 / 9–12; story types (Fairy Tale, Adventure, Bedtime, Educational, Fantasy, Funny, Moral, Friendship, Family, Animals); 8 languages; 4–12 pages. The built-in engine writes title, description, moral, characters and page-by-page text + scene briefs. Edit or regenerate any single page without regenerating the whole book.
- **Character Bible** — face, hair/fur, outfit, colours, accessories and expression are saved once and injected word-for-word into every illustration and video prompt, so the same character stays the same.
- **Illustrations** — a picture is generated in code (procedural SVG) for every page from the scene brief + Character Bible + chosen style (10 styles: Storybook, 3D Cartoon, Pixar-inspired 3D, Watercolor, Disney-inspired Fairy Tale, Anime, Clay, Paper Cut, Hand Drawn, Digital Painting). Regenerate per page, edit the prompt, or upload your own image path via the editor. No stock photo is passed off as generated art.
- **Book Editor** — fonts, layouts, page backgrounds, add/delete pages, per-page text editing, auto-save to My Projects.
- **Reader + Export** — read-aloud via the browser SpeechSynthesis API, watermark-free PDF via print-to-PDF, page images and story text download, share to Library.
- **Animation Studio** — storyboard with a continuity lock: Character Bible + per-scene entry side/direction, start position, end position and exit side/direction, matched scene-to-scene so characters do not teleport or suddenly appear from behind; camera rules and a negative list; copy-ready prompts per scene and for all scenes. **Built-in video renderer** (canvas + MediaRecorder, 15s–2 min, 9:16 / 16:9 / 1:1, 720p / 1080p, captions) renders a real WebM in your browser and downloads it — no key needed. This is a Ken-Burns-style render of your generated illustrations, not an external AI video model.
- **Music Video Creator** — original lyrics + scene briefs by topic, genre and language. Melody is **not** rendered here: no music provider is connected and this app does not fake one.
- **Comic Creator** — story, panels, speech bubbles, layouts, PDF via print.
- **Library, My Projects, Dashboard, Settings, Admin** — save / reopen / duplicate / delete projects, generation history, story templates, job log. All data lives in `localStorage` in your browser.

## Limits: none

**Generation limits: None.** Unlimited, private, owner-only generation. If this site ever goes public to new users, revisit limits then.

Honest note: external providers still have their own credits/billing if you connect one. Unlimited here applies to the built-in engine and built-in renderer.

## External providers (optional)

Settings → Providers: Runway, Pika, Luma, Kling, Veo, OpenAI. Keys are stored only in this browser. A saved key shows **“Key saved — not verified”** until Test Connection passes against the provider's own endpoint. Nothing here claims a fake render or a fake connection.

## Data model (hosted equivalent)

The hosted Muse artifact uses the same model with server storage; this standalone build stores the same entities in `localStorage`: `projects`, `stories`/`story_pages`, `characters`, `generated_images` (as data URIs), `animations`, `music_projects`, `comic_projects`, `generation_jobs`/`generation_usage` (history log), `user_settings`. There is no multi-user account / Supabase in this standalone build — it is a single local creator profile. User projects and illustrations created inside the hosted artifact are **not** in this repo; only this source code is.

## Files

- `index.html` — the whole app shell (all pages, GitHub Pages-ready, relative paths only)
- `styles.css` — indigo-violet + coral-amber + cream theme
- `app.js` — story engine, Character Bible, SVG illustration generator, editor, reader, storyboard + built-in video renderer, music/comic generators, providers, localStorage persistence
- `README.md` — this file

## v9 — Welcome ends at the hero CTAs (26 Nov 2026)
Signed out, the site shows ONLY the welcome hero: top nav, headline
"Build Magical Stories for Curious Minds", subheading, and the two buttons
Create Your Story + Explore Projects. The 4 hero format cards, the simple
home, footer and bottom nav are all hidden until Google sign-in (any tap
while signed out still opens Google sign-in; no on-load gate). After
sign-in the home shows the creation choices first — Story, Picture Book,
Animation, Music Video, Comic. Story is its own text-only flow (chapters
of prose, no illustrations), separate from the Picture Book. Asset
versions and the service-worker cache bumped to v9 so the live site does
not serve a stale cached build.

## v8 — Welcome-first (26 Nov 2026)
Opening the site shows ONLY the welcome page: the user's own design-3 hero
image (optimised JPEG, 351 KB, in `hero-bg.css` — the GitHub connector only
pushes text files, so no binary `hero.jpg` could be uploaded that way),
animated sparkles / sun glow / lantern flicker, headline, Create Your Story
button and the 4 feature cards. Every tap opens the real Firebase Google
sign-in. Stats, How-it-works, samples, projects and settings stay hidden
until sign-in. After sign-in the home is a simple 1-2-3 flow: big Create a
story button, 4 big choices, then your stories as a simple list. All
features (picture book generator, Character Bible, built-in video renderer,
PDF export, unlimited generation) are unchanged behind the simple surface.
