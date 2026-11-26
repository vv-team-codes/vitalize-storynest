/* ekiddy.com service worker — offline app shell (v20).
   v11: same network-first worker as v8, cache name + asset versions
   bumped so a stale v9 shell can never be served again.
   v13: cache name + asset versions bumped to v14.
   v15: new horizontal logo (logo.css added to precache) + versions bumped to v15.
   v16: mobile-only optimisation (styles.css + hero.css + app.js) + versions bumped to v16.
   v17: welcome no-scroll + mobile header fit (styles.css + hero.css) + versions bumped to v17.
   v18: cinematic welcome overlays (hero.css + index.html) + versions bumped to v18.
   v19: headline clears the header on short viewports (hero.css) + versions bumped to v19.
   v20: dark logo backdrop + all-white nav pills with purple hover (styles.css) + versions bumped to v20.
   v21: mobile flash fix + header order + sticky header (styles.css + auth.js + index.html) + versions bumped to v21.
   v22: visible welcome motion — flowing water, pool ripples, swaying grass, wind petals, faster clouds (hero.css + index.html) + versions bumped to v22.
   v23: real video — server-side video service (api/generate-video.js) + Animation Studio real-video mode with automatic 1-minute join + comic panel clips (app.js + index.html) + versions bumped to v23.
   v25: welcome hero is a video background (hero-video.js + index.html + hero.css) + smaller line-style icons on the four hero cards (index.html + hero.css); static hero picture stays as poster/fallback; assets v25, SW vsn-shell-v25.
   v24: Quick Video — in-site video only (app.js + index.html + styles.css): title/topic/wish-list, character upload or 3 sample multi-part SVG characters, style picture picker, animation select, parallel fast scene pictures, direct render with moving character parts (arms/legs/mouth) + scene crossfades; external-video UI hidden, video proxy code kept dormant in the repo + versions bumped to v24.
   v26: purple auth splash removed (index.html + styles.css + auth.js) — welcome hero shows immediately on load; assets v26, SW vsn-shell-v26. */
const CACHE = 'vsn-shell-v26';
const ASSETS = ['./', './index.html', './styles.css?v=26', './hero.css?v=23', './hero-bg.css?v=15', './hero-video.js?v=25', './logo.css?v=15', './app.js?v=18', './auth.js?v=26', './manifest.json', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; /* Firebase / CDN: let the browser handle it */
  e.respondWith(fetch(e.request).then(function (r) {
    if (r && r.ok) { var c = r.clone(); caches.open(CACHE).then(function (cache) { cache.put(e.request, c); }); }
    return r;
  }).catch(function () { return caches.match(e.request); }));
});
