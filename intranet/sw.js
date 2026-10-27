/* Kukpo One service worker — push notifications only (no offline caching). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Kukpo One', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Kukpo One', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag,
    icon: '/intranet/icon-192.png', badge: '/intranet/icon-192.png',
    data: { url: d.url || '/intranet/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/intranet/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/intranet/')) { await c.focus(); c.postMessage({ type: 'open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
