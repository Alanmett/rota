// Çevrimdışı destek: uygulama dosyaları önbelleğe alınır; gezilen harita parçaları ve
// açılan Wikipedia özetleri de saklanır. Kayıtlı geziler zaten cihazda (localStorage).

const VERSION = 'rota-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ui.js', 'js/util.js', 'js/store.js', 'js/api.js', 'js/hours.js', 'js/places.js',
  'js/planner.js', 'js/budget.js', 'js/tips.js', 'js/tripgen.js', 'js/map.js', 'js/details.js', 'js/components.js',
  'js/views/near.js', 'js/views/plan.js', 'js/views/trip.js', 'js/views/trips.js', 'js/views/settings.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
const TILES = 'rota-tiles';
const WIKI = 'rota-wiki';
const MAX_TILES = 600;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rota-v') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

// Önce ağ (güncel kalsın), ağ yoksa ya da yavaşsa önbellek.
async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') return cache.match('index.html');
    throw new Error('çevrimdışı');
  }
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    if (max) trim(cacheName, max);
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) { e.respondWith(networkFirst(req, VERSION, 3500)); return; }
  if (url.hostname === 'cdnjs.cloudflare.com') { e.respondWith(cacheFirst(req, VERSION)); return; }
  if (url.hostname === 'tile.openstreetmap.org') { e.respondWith(cacheFirst(req, TILES, MAX_TILES)); return; }
  if (url.hostname.endsWith('wikipedia.org') || url.hostname === 'www.wikidata.org' || url.hostname === 'upload.wikimedia.org') {
    e.respondWith(networkFirst(req, WIKI, 6000));
  }
  // Diğer istekler (Overpass, Nominatim, hava) doğrudan ağa gider.
});
