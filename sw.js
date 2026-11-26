/* Vitalize StoryNest service worker — offline app shell (v12).
   v11: same network-first worker as v8, cache name + asset versions
   bumped so a stale v9 shell can never be served again.
   v12: cache name + asset versions bumped to v12. */
const CACHE = 'vsn-shell-v12';
const ASSETS = ['./', './index.html', './styles.css?v=12', './hero.css?v=12', './hero-bg.css?v=12', './app.js?v=12', './auth.js?v=12', './manifest.json', './icon.svg'];
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
