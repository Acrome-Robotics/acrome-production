// Acrome Support bildirimleri: içeriksiz push gelir, burada genel bir uyarı gösterilir.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  e.waitUntil(self.registration.showNotification('Acrome Support', {
    body: 'Yeni support maili geldi.',
    tag: 'acrome-support', renotify: true,
    icon: 'icon-192.png', badge: 'icon-192.png',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL('./#/bildirimler', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
