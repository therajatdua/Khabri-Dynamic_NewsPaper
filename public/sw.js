// Khabri service worker: offline shell + last-seen feed.
// Strategy: network-first for pages, /api/news and /api/brief (always fresh when online),
// falling back to cache when offline. Static assets: stale-while-revalidate.
const VERSION = 'khabri-v5';
const SHELL = ['/', '/styles.css', '/script.js', '/ui.js', '/theme-init.js', '/manifest.json', '/icon.svg', '/fallback.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .catch(() => { /* ignore offline install */ })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw new Error('offline');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const net = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/analytics') || url.pathname === '/api/analytics') return;

  if (request.mode === 'navigate' || url.pathname === '/api/news' || url.pathname === '/api/brief') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
