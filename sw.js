/* Keeps the page and the text-reading files in the browser so the scanner works offline after the first visit. */
const CACHE = 'uanscan-v2';
const HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com', 'unpkg.com'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'index.html', 'core.js', 'app.js']).catch(() => { }))); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !HOSTS.includes(url.hostname)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: false });
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
    if (url.origin === location.origin) return (await net) || hit || new Response('Offline and not saved yet', { status: 503 });   // our own files: newest first, saved copy when offline
    if (hit) return hit;                                                                                                         // text-reader files: saved copy first
    return (await net) || new Response('Offline and not saved yet', { status: 503 });
  }));
});
