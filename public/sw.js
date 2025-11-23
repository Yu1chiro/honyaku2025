const CACHE_NAME = 'honyaku-v2';

// Aset Lokal
const LOCAL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Aset Eksternal (CDN)
// Perbaikan: Gunakan URL lengkap gambar/file, jangan hanya domain root
const CDN_ASSETS = [
  'https://ucarecdn.com/ebe81342-64fc-4e47-bcc5-632c0552c657/11zon_cropped.png', // URL Gambar Icon
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 1. Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching assets...');

      // Cache Lokal
      try {
        await cache.addAll(LOCAL_ASSETS);
      } catch (error) {
        console.error('[SW] Gagal cache aset lokal:', error);
      }

      // Cache CDN (No-CORS)
      const cdnPromises = CDN_ASSETS.map(async (url) => {
        try {
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

// 2. Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
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

  // Jangan cache request API (biar selalu fresh)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategi: Cache First, Fallback Network
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request).catch(() => {
        // Opsional: Return halaman offline custom jika mau
        console.log('Offline dan aset tidak ada di cache:', url.pathname);
      });
    })
  );
});