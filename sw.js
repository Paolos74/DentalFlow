// Service worker di DentalFlow. Aumenta VERSION a ogni rilascio: comparirà il banner "Aggiorna".
const VERSION = 'dentalflow-v21';

const ASSETS = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/escape.js',
  'js/firebase-config.js',
  'js/ui.js',
  'js/money.js',
  'js/dates.js',
  'js/store.js',
  'js/aggregate.js',
  'js/csv.js',
  'js/backup.js',
  'js/charts.js',
  'js/sync.js',
  'js/calendar.js',
  'js/ics.js',
  'js/colors.js',
  'js/prefs.js',
  'js/icons.js',
  'js/theme-boot.js',
  'js/views/oggi.js',
  'js/views/inserisci.js',
  'js/views/registro.js',
  'js/views/riepilogo.js',
  'js/views/grafici.js',
  'js/views/gestione.js',
  'js/views/calendario.js',
  'js/views/tasse.js',
  'js/tax.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

const scopeUrl = (p) => new URL(p, self.registration.scope).href;
const INDEX_URL = () => scopeUrl('index.html');
const OFFLINE_URL = () => scopeUrl('offline.html');

self.addEventListener('install', (event) => {
  // Nessun skipWaiting qui: il nuovo SW attende che l'utente prema "Aggiorna".
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS.map((p) => new Request(scopeUrl(p), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dentalflow-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'GET_VERSION') event.ports[0]?.postMessage({ version: VERSION });
});

async function handleNavigation(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(INDEX_URL(), { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    const url = new URL(request.url);
    const scopePath = new URL(self.registration.scope).pathname;
    if (res.ok && (url.pathname === scopePath || url.pathname.endsWith('/index.html'))) {
      await cache.put(INDEX_URL(), res.clone());
    }
    return res;
  } catch {
    const offline = await cache.match(OFFLINE_URL());
    return offline || Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
    return res;
  } catch {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      const offline = await cache.match(OFFLINE_URL());
      if (offline) return offline;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase e ogni richiesta esterna vanno in rete
  if (request.mode === 'navigate') event.respondWith(handleNavigation(request));
  else event.respondWith(handleAsset(request));
});
