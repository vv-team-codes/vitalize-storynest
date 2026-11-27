/* ekiddy.com — service worker retired.
   The old site used a service worker to cache its shell. This version
   ships no offline cache, so this worker unregisters itself and clears
   the old caches on activation, letting the browser fetch fresh files. */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) { /* ignore cache errors */ }
      try { await self.registration.unregister(); } catch (e) { /* ignore */ }
      try {
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(function (c) { c.navigate(c.url); });
      } catch (e) { /* ignore */ }
    })()
  );
});
