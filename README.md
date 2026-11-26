# Vitalize StoryNest

AI-powered children storytelling platform — picture books, animation studio, kids music videos and comics, with free access (no mandatory subscription).

## What it is

- **AI Picture Book Generator** — 7-step workflow: idea / manuscript / upload, age group, story type, language, page count, page-by-page editable story, character profiles, per-page illustrations, visual book editor, PDF / page-image export.
- **AI Animation Studio** — continuity-locked storyboards with a Character Bible, entry/exit continuity, camera rules and copy-ready video prompts; built-in animated-video renderer (duration, aspect ratio and quality selectable) plus optional external video providers (Runway, Pika, Luma, Kling, Google Veo) via Settings.
- **Kids Music Video Creator** — original song lyrics, scene illustration briefs, captioned video rendering.
- **Graphic Novel / Comic Creator** — panels, speech bubbles, dialogue, PDF export.
- **Storybook Library, My Projects, Dashboard, Settings, Admin** — projects can be saved, reopened, edited, duplicated and deleted; admin-configurable daily fair-use limits.

## Brand

Formerly StoryNest Studio. Renamed to **Vitalize StoryNest** (26 Nov 2026) with a full redesign: deep indigo-violet + coral-amber, cream background, bold display typography.

## Status

Live as a Muse web app (artifact `ai-storytelling-platform`). Video integration (built-in renderer + external provider setup) and the Vitalize redesign are in progress in that app. This repository is the code home for the project; the full app source will be published here once the in-progress build is complete.

## Stack (target)

React + TypeScript + Tailwind CSS, Supabase (PostgreSQL, Auth, Storage, Edge Functions), configurable LLM / image / TTS / video providers. API keys stay on the backend and are never committed.

## Free access

All core creation features are free for registered users within admin-configurable daily fair-use limits. No Stripe checkout, no premium-only creation locks, no mandatory watermarks.
