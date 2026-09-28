// Service worker minimo: serve solo a rendere il sito installabile (PWA).
// Rete-poi-cache: prova sempre a scaricare la versione live, la cache è solo un fallback
// per quando il telefono non ha connessione. Niente precache, niente versioni da aggiornare
// a ogni deploy: il fallback si aggiorna da solo ad ogni richiesta riuscita.
const CACHE_NAME = 'anime-dashboard-shell';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', event => {
  const req = event.request;
  // solo GET dello stesso sito: le chiamate API (POST, o verso altri domini come AniList) passano sempre dalla rete
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req))
  );
});
