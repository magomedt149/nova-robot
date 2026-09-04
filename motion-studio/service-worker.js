const CACHE = 'tumsoev-motion-vfx-studio-v9';
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
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('/motion-studio/index.html')))
  );
});
