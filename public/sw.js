// This project previously shipped an "Elite" Service Worker that aggressively cached
// the old UI on localhost. That can cause the legacy UI to keep showing even after
// the frontend has been replaced.
//
// We intentionally unregister this Service Worker and clear caches.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // ignore
    }

    try {
      await self.clients.claim();
    } catch {
      // ignore
    }

    try {
      await self.registration.unregister();
    } catch {
      // ignore
    }

    try {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windows.forEach((client) => {
        if ('navigate' in client) client.navigate(client.url);
      });
    } catch {
      // ignore
    }
  })());
});

self.addEventListener('fetch', (event) => {
  // Passthrough while the SW is being removed.
  event.respondWith(fetch(event.request));
});
