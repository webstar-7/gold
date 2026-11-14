/* NYANSATEK Gold service worker
   - lets the app be installed and open even when the internet is slow or down
   - pages and scripts come from the network first, so updates arrive straight away;
     the saved copy is only used when the network fails
   - icons and pictures are served from the saved copy first, for speed
   - it NEVER stores anything from the database, sign-in or file storage */
const VERSION = 'nyansatek-gold-v1';
const SHELL = ['./', 'app.js', 'manifest.json', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'assets/gold-reel.jpg', 'assets/gold-reel-tall.jpg'];
const LIBS = /(^|\.)(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

// Each file is saved on its own, so one missing file cannot stop the install.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u =>
    fetch(u).then(r => { if (r && r.ok) return c.put(u, r); }).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nyansatek-gold-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));

const save = (req, res) => { if (res && res.ok && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('.mp4')) return;                 // videos stream in pieces: leave them to the browser
  if (url.origin !== self.location.origin) {
    if (!LIBS.test(url.hostname)) return;                    // database, sign-in, photos: always live
    e.respondWith(caches.match(req).then(hit => {            // libraries and fonts: saved copy, refreshed in the background
      const net = fetch(req).then(res => { if (res) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  const fresh = req.mode === 'navigate' || req.destination === 'script' || req.destination === 'style' || req.destination === 'manifest';
  if (fresh) {                                               // the app itself: network first, saved copy if offline
    e.respondWith(fetch(req).then(res => save(req, res)).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })));
  } else {                                                   // icons and pictures: saved copy first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => save(req, res))));
  }
});
