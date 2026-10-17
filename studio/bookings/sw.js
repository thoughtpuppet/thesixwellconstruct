// Deliberately no fetch handler or cache: client records and credentials stay out of CacheStorage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function inboxUrl(value) {
  try {
    const url = new URL(value || '/studio/bookings/', self.location.origin);
    if (url.origin === self.location.origin && url.pathname === '/studio/bookings/') return url.href;
  } catch { /* Use the private inbox for malformed or external URLs. */ }
  return new URL('/studio/bookings/', self.location.origin).href;
}

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
  event.waitUntil(self.registration.showNotification(message.title || 'Booking Update', {
    body: message.body || 'Open your booking inbox to review the update.',
    icon: '/studio/bookings/icons/icon-192.png',
    tag: message.tag || 'artpill-booking',
    data: { url: inboxUrl(message.url) },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = inboxUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && url.pathname === '/studio/bookings/' && 'navigate' in client) {
        const navigated = await client.navigate(target);
        if (navigated) return navigated.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
