// Network-first service worker.
//
// The app is small and always online when it matters, so correctness beats
// offline-first here: a stale camera pipeline that cannot be updated is worse
// than a slightly slower load. Every GET goes to the network with caching
// bypassed; the cache is only a fallback for when the network is gone.
//
// This exists because ES module imports are cached independently of the
// entry point, so a refreshed app.js would still pull stale modules.

const VERSION = 'lumen-2026.09.10-1';

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // cache: 'no-store' defeats the HTTP cache layer underneath us, which is
      // the layer that actually holds stale files on iOS.
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw new Error('offline and not cached');
    }
  })());
});
