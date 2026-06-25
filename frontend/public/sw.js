/* Gurmat Saanj service worker — minimal runtime cache.
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS, fonts, images, favicon, manifest): runtime
 *    cache via a network-first-then-cache fallback. After the first
 *    successful online visit, the shell will load offline.
 *  - SPA navigations: if the network is down, serve the cached "/" document
 *    so the React app can mount and the rest of the experience (already-
 *    cached shabads in localStorage) works offline.
 *  - API requests (/api/*, BaniDB): pass-through, no SW caching — the app's
 *    own 14-day localStorage cache handles that and SW caching of dynamic
 *    JSON would just complicate cache invalidation.
 *
 * Bump CACHE_VERSION whenever you want to force a refresh.
 */
const CACHE_VERSION = 'saanj-kirtan-v8';

// NOTE: we deliberately do NOT call skipWaiting() on install. When a new SW
// is deployed, we want it to wait in "installed" state until the app calls
// postMessage({type:'SKIP_WAITING'}) — that way the user can choose when to
// refresh instead of having the new code drop into a live session mid-kirtan.
self.addEventListener('install', () => {
  // no-op: just wait until activated by the app's explicit Refresh action.
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Reap older cache versions on activate.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('saanj-kirtan-') && n !== CACHE_VERSION)
        .map((n) => caches.delete(n)),
    );
    await self.clients.claim();
  })());
});

const isApiRequest = (url) => /\/api\//.test(url.pathname);
const isHttp = (url) => url.protocol === 'http:' || url.protocol === 'https:';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isHttp(url)) return;

  // Skip API traffic — let the app handle it (its own retry + localStorage
  // cache is more correct than a generic SW cache for JSON).
  if (isApiRequest(url)) return;

  // Skip cross-origin requests we don't control (e.g. Google Fonts, BaniDB)
  // unless they're our own origin. Browsers cache fonts themselves anyway.
  if (url.origin !== self.location.origin) return;

  // Navigation fallback — try network, fall back to cached "/" so the SPA
  // shell can still render offline. The SPA then routes based on the URL.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('/', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match('/');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Static assets — network-first so updates are picked up on each online
  // visit; cache the response for next time we're offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type !== 'opaque') {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      // Network call rejected (offline, DNS, aborted, etc.). Try the cache
      // — if it hits, great. Otherwise return a graceful empty 504 instead
      // of throwing, so the browser surfaces a normal "failed request" in
      // the network tab without filling the console with uncaught-promise
      // errors. This is especially noisy on the first load after a deploy,
      // when a hashed chunk briefly 404s while the SW is updating.
      const cached = await cache.match(req);
      if (cached) return cached;
      return new Response('', {
        status: 504,
        statusText: 'Service worker: network failed and no cache match',
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })());
});
