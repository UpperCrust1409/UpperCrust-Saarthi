// ════════════════════════════════════════════════════════════
//  SAARTHI SERVICE WORKER — Background Push Notifications
//  Serve this file at /sw.js on your Railway server:
//  app.get('/sw.js', (req, res) => {
//    res.setHeader('Content-Type', 'application/javascript');
//    res.setHeader('Service-Worker-Allowed', '/');
//    res.sendFile(__dirname + '/sw.js');
//  });
// ════════════════════════════════════════════════════════════

const CACHE_NAME = 'saarthi-v1';

// ── Push event: show OS notification ──────────────────────
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const title = data.title || 'Saarthi PMS';
  const options = {
    body:    data.body || '',
    icon:    '/favicon.ico',
    badge:   '/favicon.ico',
    tag:     data.tag || 'saarthi-' + Date.now(),
    data:    { url: data.url || 'https://uppercrustsaarthi.in' },
    requireInteraction: data.priority === 'high',
    silent:  data.priority === 'low',
    vibrate: data.priority === 'high' ? [200, 100, 200] : [100],
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click: open Saarthi at the right page ────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || 'https://uppercrustsaarthi.in';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // If Saarthi is already open, focus it and navigate
      for (const client of clientList) {
        if (client.url.includes('uppercrustsaarthi.in') && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Activate: claim all clients immediately ───────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});
