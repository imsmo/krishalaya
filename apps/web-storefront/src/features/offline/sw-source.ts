// apps/web-storefront/src/features/offline/sw-source.ts · PC-56 HOTFIX-8 · D1 (b) — the service worker's SOURCE, versioned by the BUILD.
// Pure (a string builder), so the rule is tested without a browser (src/test-render/sw-route.render.test.tsx); served by the route
// `app/sw.js/route.ts` with `Cache-Control: no-cache`, registered with `{ updateViaCache: 'none' }` (app/layout.tsx).
//
// It replaces `public/sw.js` (PC-24c), whose `VERSION 'kv-sw-v1'` never changed (survey STORE-6 F-1 / F-6): the pre-cached `/offline` was
// kept forever — rendered, until HOTFIX-8, inside the signed-in person's header. Now:
//   • VERSION = `kv-sw-<build id>` — the build id is `NEXT_PUBLIC_BUILD_ID`, which next.config.js fixes ONCE per build (the deploy's value
//     when it sets one, else a value minted at build time) and also hands to Next as `generateBuildId`. A deploy is a new worker byte → the
//     browser installs it → `activate` deletes EVERY cache not named for the current build (kept from PC-24c) — so the static cache is
//     bounded to one build, and an old shell cannot outlive a deploy;
//   • the shell is fetched with `cache: 'reload'` (never a stale HTTP-cache copy) and is SESSION-FREE (the `(shell)` route group: no
//     SiteHeader, no session read) — so what is cached is the same for every person on the phone.
// The fetch rules are PC-24c's, unchanged: never a non-GET, never cross-origin, never /v1/ or /api/, never a request with Authorization;
// navigations network-first with the shell as the offline fallback (page responses are never cached); same-origin static assets cache-first.
// `skipWaiting`/`claim` stay (a polite "new version" notice and the `storefront_pwa` kill-switch are STORE-6a's, survey B3).

/** The build id as the worker may print it: [A-Za-z0-9._-], at most 64 characters; anything else (or nothing) → 'dev'. */
export function swBuildId(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : 'dev';
}

/** The cache name for a build. */
export function swCacheName(buildId: string): string { return `kv-sw-${swBuildId(buildId)}`; }

/** The worker's JavaScript for one build. */
export function serviceWorkerSource(buildId: string): string {
  return `// /sw.js · the storefront's conservative offline shell (PC-24c; versioned by the build since PC-56 HOTFIX-8).
// PRIVACY LAW OF THIS FILE: NOTHING authenticated or personal is ever cached.
//  - Navigations: network-first; on failure serve the pre-cached /offline shell (session-free: no header that reads a session).
//    Page responses are NOT cached.
//  - Same-origin static assets (/_next/static, icons, manifest): cache-first, in THIS build's cache only.
//  - Cross-origin, API paths (/v1/, /api/), and any request with Authorization: NEVER touched — pass through.
//  - Every cache not named for this build is deleted on activate. Sign-out sends Clear-Site-Data (cache + storage).
const VERSION = '${swCacheName(buildId)}';
const SHELL = ['/offline', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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
`;
}
