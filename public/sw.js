const CACHE_NAME = 'honyaku-v1';

// Aset Lokal (Satu domain dengan server kita)
const LOCAL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Aset Eksternal (CDN) - Butuh perlakuan khusus 'no-cors'
const CDN_ASSETS = [
  'https://ucarecdn.com',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. Install Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching assets');

      // Langkah A: Cache Aset Lokal (Cara Biasa)
      try {
        await cache.addAll(LOCAL_ASSETS);
      } catch (error) {
        console.error('[SW] Gagal cache local assets:', error);
      }

      // Langkah B: Cache CDN Assets dengan mode 'no-cors' (SOLUSI CORS ERROR)
      // Kita lakukan manual fetch satu per satu untuk CDN
      const cdnPromises = CDN_ASSETS.map(async (url) => {
        try {
          // KUNCI UTAMA: mode 'no-cors' agar browser tidak memblokir
          const request = new Request(url, { mode: 'no-cors' });
          const response = await fetch(request);
          return cache.put(request, response);
        } catch (error) {
          console.error(`[SW] Gagal cache CDN ${url}:`, error);
        }
      });

      return Promise.all(cdnPromises);
    })
  );
  self.skipWaiting();
});

// 2. Activate Service Worker (Cleanup old caches)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strategi: Network Only untuk API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategi: Cache First, Fallback to Network untuk aset statis
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      // Jika tidak ada di cache, ambil dari internet
      // Penting: Gunakan mode no-cors jika fetch ke CDN gagal di runtime
      return fetch(event.request).catch(() => {
         // Fallback jika offline total dan aset tidak ada di cache
         // (Opsional: bisa return halaman offline.html custom disini)
      });
    })
  );
});