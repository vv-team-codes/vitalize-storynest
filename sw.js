/* Vitalize StoryNest service worker — offline app shell (v6).
   v6 fix: the v4 worker cached ?v=4 assets and served them cache-first
   with ignoreSearch, so auth.js?v=5 still returned the OLD full-screen
   gate code (and hero.css was never cached at all). This worker is
   network-first for same-origin GETs — a first load always gets the live
   files — and only falls back to the cache when the network fails.
   It activates immediately (skipWaiting + clients.claim) and deletes
   every older cache on activation. */
const CACHE = 'vsn-shell-v6';
const ASSETS = ['./', './index.html', './styles.css?v=6', './hero.css?v=6', './app.js?v=6', './auth.js?v=6', './manifest.json', './icon.svg'];
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
