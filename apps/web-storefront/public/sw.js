// apps/web-storefront/public/sw.js · conservative offline shell (PC-24c).
// PRIVACY LAW OF THIS FILE: NOTHING authenticated or personal is ever cached.
//  - Navigations: network-first; on failure serve the pre-cached /offline page. Responses are NOT cached
//    (pages can carry session-derived content like the cart badge).
//  - Same-origin static assets (/_next/static, icons, manifest): cache-first (immutable/hashed).
//  - Cross-origin, API paths (/v1/), and any request with Authorization: NEVER touched — pass through.
// The storefront stays a server-rendered app; this shell only makes "no network" a kind page instead of a
// browser error. Offline MUTATIONS are deliberately out of scope — the mobile app is the offline-first surface.
const VERSION = 'kv-sw-v1';
const SHELL = ['/offline', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never intercept mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // never touch cross-origin (API, payments, fonts)
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) return; // never touch API paths
  if (req.headers.get('authorization')) return;           // never touch authed requests

  if (req.mode === 'navigate') {
    // network-first; NO caching of page responses (may be session-derived) — offline fallback only.
    event.respondWith(fetch(req).catch(() => caches.match('/offline')));
    return;
  }

  const isStatic = url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname);
  if (isStatic) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
