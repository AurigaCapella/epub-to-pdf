const CACHE = 'paperbridge-v5';
const ROOT = new URL('./', self.location).href;
const SHELL = ['./','./index.html','./styles.css','./app.js','./print.html','./print.js','./print.css','./epub.js','./unzip-worker.js','./vendor/fflate.js','./vendor/purify.min.js','./icon.svg','./manifest.webmanifest','./README.md'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('paperbridge-') && key !== CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(ROOT)) return;
  // Cache only the app shell. Book bytes never become network requests or cache entries.
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});