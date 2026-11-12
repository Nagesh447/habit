// Caches the app's own files so it opens fast and survives a weak connection.
// Database traffic (Supabase) is never cached. Bump VERSION when you upload changed files.
const VERSION = 'ascent-v6';
const FILES = ['./', 'index.html', 'app.js', 'lessons.js', 'config.js', 'supabase.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});

// Phone reminders
self.addEventListener('push', e => {
  let d = { title: 'Atomic Ascent', body: 'Close your circle today.' };
  try { if (e.data) d = Object.assign(d, e.data.json()); } catch {}
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'ascent-' + (d.kind || 'reminder'), data: { url: './#today' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./#today');
  }));
});
