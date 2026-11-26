/* LUNZERA Service Worker — تطبيق قابل للتثبيت + تخزين مؤقت */
const CACHE = 'lunzera-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/css/modern.css',
  '/css/app.css',
  '/js/common.js',
  '/js/store.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // لا نخزّن الطلبات الحساسة (API)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) return;

  // صفحات التنقل: شبكة أولاً ثم الذاكرة
  if (e.request.method === 'GET' && url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
  }
});
