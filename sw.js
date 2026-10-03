/* Service worker: lưu khung app để mở nhanh & mở được khi mất mạng.
   Dữ liệu cost KHÔNG đi qua đây (chỉ lấy từ máy chủ sau khi đăng nhập). */
const CACHE = 'kbt-cost-v1.6.0';
const SHELL = ['./', 'index.html', 'app.css?v=1.6.0', 'app.js?v=1.6.0', 'parser.js?v=1.6.0', 'parser2.js?v=1.6.0', 'engine2.js?v=1.6.0', 'export2.js?v=1.6.0', 'config.js?v=1.6.0', 'vendor/supabase.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/logo-login.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin !== location.origin) { // font Google: lưu lại dùng dần; Supabase: luôn đi mạng
    if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) e.respondWith(caches.open(CACHE).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('index.html'))); return; }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok && /vendor\//.test(u.pathname)) caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })));
});
