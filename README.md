# Vitalize StoryNest

AI-powered children storytelling platform — picture books, animation studio, kids music videos and comics, with free access (no mandatory subscription).

## What it is

- **AI Picture Book Generator** — 7-step workflow: idea / manuscript / upload, age group, story type, language, page count, page-by-page editable story, character profiles, per-page illustrations, visual book editor, PDF / page-image export.
- **AI Animation Studio** — continuity-locked storyboards with a Character Bible, entry/exit continuity, camera rules and copy-ready video prompts; built-in animated-video renderer (duration, aspect ratio and quality selectable) plus optional external video providers (Runway, Pika, Luma, Kling, Google Veo) via Settings.
- **Kids Music Video Creator** — original song lyrics, scene illustration briefs, captioned video rendering.
- **Graphic Novel / Comic Creator** — panels, speech bubbles, dialogue, PDF export.
- **Storybook Library, My Projects, Dashboard, Settings, Admin** — projects can be saved, reopened, edited, duplicated and deleted.

## Brand

Formerly StoryNest Studio. Renamed to **Vitalize StoryNest** (26 Nov 2026) with a full redesign: deep indigo-violet + coral-amber, cream background, bold display typography, theme switcher in Settings (Vitalize / Soft Light).

## Video generation

- **Built-in renderer (free, no API key):** canvas + MediaRecorder in the browser. Animates the real scene illustrations (slow zoom/pan, crossfades, burned-in narration captions). Duration 15s–2 min (default 1 min), aspect ratios 9:16 / 16:9 / 1:1, quality 720p / 1080p. Finished video is saved on the project for replay/download. Scenes without illustrations are flagged missing, never faked.
- **External providers (optional):** Runway, Pika, Luma, Kling, Google Veo in Settings → Video Providers, with a real Test Connection. A saved key shows "Key saved — not verified" until a test passes; "Connected" only after a successful test. As of 26 Nov 2026 12:10 IST, no external provider is connected (no key saved, not verified).
- **Continuity lock:** Character Bible repeated verbatim in every scene prompt, plus per-scene entry/exit, camera/space rules and a negative list (no teleporting, no sudden appearance from behind, no changed clothes/face/colours).

## Live content (26 Nov 2026, verified in the app)

- 5 projects, 12 characters. Luna the Moon Rabbit (animation, 5 scenes): all 5 scenes illustrated 26 Nov, ready for a built-in video render; no video file rendered yet. Ellie and the Twinkling Fireflies (book, 6 pages): all 6 pages illustrated. No external video provider connected.

## Free access / limits

Private owner-only use for now: no token/daily limits in the website — free unlimited generation, continuous use. An edit to remove the previous in-app daily limits (20 stories / 60 images / 10 videos per day) was started 26 Nov 2026 12:09 IST and is still running; it is not yet verified live. If new users go public later, limits will be revisited then. External providers still have their own credits/billing if connected — that cannot be bypassed; unlimited applies to the built-in free renderer/image generation.

## Status — please read

Live as a Muse web app (artifact `ai-storytelling-platform`). **This repository currently contains only this README.** The full app source lives inside the Muse artifact runtime and cannot be pulled out directly, so no full code push has happened yet. This README is kept current with the live app's real state; the full source will be published here once a legitimate export route exists. Do not treat this README as the app's source code.

## Stack (target)

React + TypeScript + Tailwind CSS, Supabase (PostgreSQL, Auth, Storage, Edge Functions), configurable LLM / image / TTS / video providers. API keys stay on the backend and are never committed.
