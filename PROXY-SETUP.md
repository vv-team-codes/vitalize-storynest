# StoryNest image service — setup (one-time, ~10 minutes)

The public site generates every picture through its OWN endpoint —
`POST /api/generate-image` — so no visitor's browser ever talks to
an image provider, and no key or provider name appears in the site
code, the UI, or browser-visible network traffic. The key lives
only as a server-side environment variable on Vercel.

## 1. Deploy the service on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project** →
   import the repo **`vv-team-codes/vitalize-storynest`** (the same
   repo as the site — the function lives in `api/generate-image.js`).
2. Framework: leave as **Other** (static site + serverless function).
3. Deploy. You will get a URL like
   `https://vitalize-storynest.vercel.app`.

## 2. Add the key (the ONE step only you can do)

1. Vercel dashboard → your project → **Settings → Environment
   Variables**.
2. Add:
   - **Name:** `OPENROUTER_API_KEY`
   - **Value:** your own OpenRouter API key (openrouter.ai → sign
     in → **Keys** → Create key. Free account, no card needed.)
   - **Environments:** tick **Production** (and Preview).
3. Save, then **Deployments → ⋯ on the latest deployment →
   Redeploy** — the function only sees the variable after a redeploy.

**Until this step is done, the site cannot generate pictures
through the service** — every page still shows its built-in
illustration instead (the site never breaks, it just uses the
built-in pictures).

## 3. Point the site at the service

- **If the site is served from the Vercel deployment** (the Vercel
  URL above): nothing to change — the site calls the relative path
  `/api/generate-image` and it just works.
- **If the site stays on GitHub Pages** (the live site today):
  edit ONE line in `app.js`:
  `const IMAGE_PROXY_URL='/api/generate-image';` →
  `const IMAGE_PROXY_URL='https://vitalize-storynest.vercel.app/api/generate-image';`
  (your real Vercel URL), then push. The GitHub Pages site then
  calls your Vercel endpoint.

## 4. Test it

```bash
curl -X POST https://<your-project>.vercel.app/api/generate-image \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a moon rabbit with a glowing lantern in a forest","seed":42}'
```

Expect `{"image":"data:image/png;base64,..."}`. If you get
`{"error":"not-configured"}`, the env var is missing or the
deployment was not redeployed after adding it. `{"error":"limit"}`
means the daily limit was hit (see below).

## Limits — say this plainly

- The free tier allows **50 images/day TOTAL on the key, shared
  across ALL users** of the site.
- The service enforces **48/day globally** and **12/day per IP**
  (two 6-page books), plus 3 seconds between requests from the same
  IP. A 6-page book is 6 images, so roughly **8 books a day** for
  everyone combined.
- When the limit is hit, the site silently uses the built-in
  illustration for that page — nobody sees an error or a provider
  name, and no page is ever left pictureless.

## Security notes

- The key is **never** in this repo, never in the site's client
  code, never in the UI, never in a network call the browser can
  see. The browser only ever calls your own endpoint.
- The provider/model name appears **only** in `api/generate-image.js`
  (the server-side file — it has to name the provider to call it).
  Because this file is in the public repo, anyone browsing the repo
  could read it. The site itself reveals nothing. If even the repo
  must not name the provider, move `api/` into a separate private
  repo and deploy the function from there.
- Counters are in-memory (best-effort on serverless — a cold start
  resets them). For strict accounting, add a small KV/Redis store
  later; the free-tier cap on the provider side is the backstop.
- Vercel **Hobby (free) plan** serverless functions time out after
  10 seconds; a picture can take longer, so some generations may
  time out and fall back to the built-in illustration. If that
  happens often, the fix is a longer function timeout (paid plan)
  or a queued/background generation — the site still works either
  way.

## Video service — same key, same pattern

`api/generate-video.js` works exactly like the image service above,
on the SAME `OPENROUTER_API_KEY` — no new key, no new account.
Because a clip takes minutes to render, it is async:

- `POST /api/generate-video` with `{prompt, image, duration,
  aspect_ratio, with_audio}` returns `{job_id}` immediately.
- `GET /api/generate-video?action=status&id=<job_id>` returns
  `{status, progress, video_url, expires_at, cost}`. When completed,
  `video_url` is a signed download link — the browser downloads the
  MP4 straight from it.
- The Animation Studio chains up to 8 clips of 8s (≈ 1 minute):
  each clip after the first starts from the previous clip's last
  frame, then the site joins them into ONE finished video in the
  browser (canvas + sound recording) with a single download — the
  user never gets separate files to stitch.
- Limits: **10 clips/day per IP, 40/day globally** (one full
  1-minute film is 8 clips, about $3.20 at 720p with sound). When
  the limit is hit the site falls back to its built-in renderer.

## If the site moves to Vercel entirely

Add the Vercel domain to Firebase → Authentication → Settings →
**Authorized domains**, or Google sign-in will be refused on the
new domain. (GitHub Pages domain `vv-team-codes.github.io` is
already authorized.)
