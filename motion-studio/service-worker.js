const MOTION_VERSION = 'v30';
const CACHE = 'tumsoev-motion-vfx-studio-v30-hybrid-image-motion';
const PREVIOUS_CACHE = 'tumsoev-motion-vfx-studio-v29-music-fades';
const ASSETS = [
  '/motion-studio/',
  '/motion-studio/index.html',
  '/motion-studio/styles.css',
  '/motion-studio/app.js',
  '/motion-studio/director.js',
  '/motion-studio/remote-gpu.js',
  '/motion-studio/diagnostics.js',
  '/motion-studio/colab-wolf-auto.js',
  '/motion-studio/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

const COLAB_WOLF_SCRIPT = '<script src="./colab-wolf-auto.js?v=1.0.0" data-nova-colab-wolf-auto defer></script>';

async function injectColabWolfAuto(response) {
  if (!response) return response;
  const type = String(response.headers.get('content-type') || '');
  if (!type.includes('text/html')) return response;
  const text = await response.text();
  if (text.includes('colab-wolf-auto.js')) {
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const patched = text.includes('</body>')
    ? text.replace('</body>', `${COLAB_WOLF_SCRIPT}\n</body>`)
    : text + COLAB_WOLF_SCRIPT;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('cache-control', 'no-cache');
  return new Response(patched, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      for (const asset of ASSETS) {
        const response = await fetch(asset, { cache: 'no-store' });
        if (!response.ok) throw new Error('Motion Studio update failed: ' + asset);
        if (asset === '/motion-studio/' || asset === '/motion-studio/index.html') {
          await cache.put(asset, await injectColabWolfAuto(response));
        } else {
          await cache.put(asset, response);
        }
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
        .filter(key => (key === PREVIOUS_CACHE || /^tumsoev-motion-vfx-studio-/i.test(key)) && key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();

    // A newly activated worker must not leave an already-open iPhone page
    // running old JS in memory. Reload Motion Studio exactly once per
    // service-worker activation; the next navigation is controlled by this worker.
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

self.addEventListener('message', event => {
  if (event.data?.type !== 'NOVA_MOTION_DIAGNOSTICS') return;
  const reply = event.ports?.[0];
  if (!reply) return;
  reply.postMessage({
    ok: true,
    version: MOTION_VERSION,
    cache: CACHE,
    scriptURL: self.location.href,
    colabWolfAuto: true
  });
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

  const isMotionHtml = url.pathname === '/motion-studio/' || url.pathname.endsWith('/motion-studio/index.html');

  // Network-first prevents stale v22/v23/v24 code from winning after restart.
  // The v30 cache is only the offline fallback and is refreshed by successful fetches.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(async response => {
        const delivered = isMotionHtml && response.ok ? await injectColabWolfAuto(response) : response;
        if (delivered.ok) {
          const copy = delivered.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return delivered;
      })
      .catch(async () => {
        const cached = await caches.match(event.request, { ignoreSearch: true })
          || (event.request.mode === 'navigate' ? await caches.match('/motion-studio/index.html') : null);
        if (!cached) return Response.error();
        return isMotionHtml ? injectColabWolfAuto(cached) : cached;
      })
  );
});
