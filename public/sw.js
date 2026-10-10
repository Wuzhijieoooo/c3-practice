const CACHE = 'c3-practice-v2';
const ASSETS = ['./', './index.html', './style.css', './app.js', './engine.js', './questions.json', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('c3-practice-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_STATUS') return;
  event.waitUntil(caches.open(CACHE).then(async cache => {
    const ready = (await Promise.all(ASSETS.map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ ready });
  }));
});
