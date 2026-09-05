const CACHE = 'tumsoev-motion-vfx-studio-v24-character-motion-lock';
const ASSETS = [
  '/motion-studio/',
  '/motion-studio/index.html',
  '/motion-studio/styles.css',
  '/motion-studio/app.js',
  '/motion-studio/director.js',
  '/motion-studio/remote-gpu.js',
  '/motion-studio/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      for (const asset of ASSETS) {
        const response = await fetch(asset, { cache: 'no-store' });
        if (!response.ok) throw new Error('Motion Studio update failed: ' + asset);
        await cache.put(asset, response);
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => /^tumsoev-motion-vfx-studio-/i.test(key) && key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();

    // A newly activated worker must not leave an already-open iPhone page
    // running the old JS in memory. Reload Motion Studio exactly once per
    // service-worker activation; the next navigation is controlled by v24.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(
      windows
        .filter(client => {
          try { return new URL(client.url).pathname.startsWith('/motion-studio/'); }
          catch (_) { return false; }
        })
        .map(client => typeof client.navigate === 'function' ? client.navigate(client.url).catch(() => null) : null)
    );
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isMotionAsset = sameOrigin && (
    url.pathname.startsWith('/motion-studio/') ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png'
  );

  if (!isMotionAsset) return;

  // Network-first prevents stale v22/v23/v24 code from winning after restart.
  // The v24 cache is only the offline fallback and is refreshed by successful fetches.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true })
          .then(cached => cached || caches.match('/motion-studio/index.html'))
      )
  );
});
