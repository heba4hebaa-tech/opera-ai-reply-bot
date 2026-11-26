/* LUNZERA Service Worker — تطبيق قابل للتثبيت + تخزين مؤقت */
const CACHE = 'lunzera-v4';
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

/* ---------------- إشعارات الهاتف (Web Push) ---------------- */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'LUNZERA';
  const options = {
    body: data.body || 'لديك إشعار جديد من متجرنا',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'lunzera-notification',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [120, 60, 120],
    data: { url: data.url || '/' },
    actions: [{ action: 'open', title: 'فتح التطبيق' }],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(self.location.origin)) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
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
