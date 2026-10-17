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
//
// PC-56 STORE-6a (founder D2 / D3 / D4) — what changed:
//   • THE RULES ARE features/store6/sw-rules.ts, EMBEDDED: `swRoute` (method / origin / path / auth / navigate), `swStorable` (the response's
//     `X-KV-Cacheable: public` header — never the body), `evictPlan` (20 pages, 7 days, least-recently-stored out first) and `swFallback`
//     (the host-root `/offline`) are self-contained functions whose exact text is printed into the worker (`String(fn)`), so the specs pin the
//     very code the phone runs;
//   • a SECOND cache, `kv-pages-<build>`: a navigation's response is kept ONLY when the server marked it cacheable (a public page, no session
//     cookie on the request, the organisation's `storefront_offline_reads` ON — middleware.ts); offline, a navigation is answered with the
//     kept copy of THAT url (within 7 days) if one exists, else the shell. Each kept copy carries the instant it was stored. No prefetch: only
//     pages the person opened; install pre-caches the shell set only, as before. Photos never;
//   • POLITE: `install` no longer calls `skipWaiting` — a new worker WAITS until every tab of the old one is closed, or until the page's
//     "a new version is ready" notice (components/offline/UpdateNotice.tsx) is tapped, which posts `SKIP_WAITING` (the notice never shows over
//     a form with content in it);
//   • `activate` keeps exactly two caches — `kv-sw-<build>` and `kv-pages-<build>` — and deletes every other;
//   • the KILL-SWITCH: with `storefront_pwa` OFF the route serves `unregisterWorkerSource()` instead — it deletes every `kv-*` cache, claims the
//     open pages and unregisters itself, so a bad worker is undone by a flag flip, not a deploy.
import { evictPlan, swFallback, swRoute, swStorable } from '../store6/sw-rules';

/** The build id as the worker may print it: [A-Za-z0-9._-], at most 64 characters; anything else (or nothing) → 'dev'. */
export function swBuildId(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : 'dev';
}

/** The cache name for a build. */
export function swCacheName(buildId: string): string { return `kv-sw-${swBuildId(buildId)}`; }

/** PC-56 STORE-6a · D2: the kept public pages' cache for a build (bounded: 20 pages, 7 days; dropped with the build). */
export function swPagesCacheName(buildId: string): string { return `kv-pages-${swBuildId(buildId)}`; }

/** The worker's JavaScript for one build (`storefront_pwa` ON). */
export function serviceWorkerSource(buildId: string): string {
  return `// /sw.js · the storefront's offline worker (PC-24c; versioned by the build since PC-56 HOTFIX-8; public pages kept per STORE-6a).
// PRIVACY LAW OF THIS FILE: NOTHING authenticated or personal is ever cached.
//  - Navigations: network-first. A response is KEPT only when the server marked it 'X-KV-Cacheable: public' (a public page, requested
//    with no session cookie, the organisation's offline reads ON) — at most 20 pages, 7 days. Offline: the kept copy of that url, else the
//    pre-cached /offline shell (session-free).
//  - Same-origin static assets (/_next/static, icons, manifest): cache-first, in THIS build's cache only.
//  - Cross-origin, API paths (/v1/, /api/), photos (/media/, images), and any request with Authorization: NEVER touched — pass through.
//  - A new version WAITS (no skipWaiting at install) until the page's "new version" notice is tapped (SKIP_WAITING) or every tab closes.
//  - Every cache not named for this build is deleted on activate. Sign-out sends Clear-Site-Data (cache + storage).
const VERSION = '${swCacheName(buildId)}';
const PAGES = '${swPagesCacheName(buildId)}';
const SHELL = ['/offline', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/manifest.webmanifest'];
const STAMP = 'x-kv-stored-at';
const route = (${String(swRoute)});
const storable = (${String(swStorable)});
const evictPlan = (${String(evictPlan)});
const fallback = (${String(swFallback)});

self.addEventListener('install', (event) => {
  // polite: no take-over here — a new version waits for the page's notice (its message) or for every tab to close
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function prune(cache) {
  return cache.keys()
    .then((reqs) => Promise.all(reqs.map((r) => cache.match(r).then((m) => ({ url: r.url, storedAt: Number(m ? m.headers.get(STAMP) : 0) })))))
    .then((entries) => Promise.all(evictPlan(entries, Date.now()).map((u) => cache.delete(u))));
}

function keep(req, res) {
  if (!storable(res.status, res.type, res.redirected, res.headers.get('x-kv-cacheable'), res.headers.get('content-type'))) return Promise.resolve();
  const copy = res.clone();
  return copy.blob().then((body) => {
    const h = new Headers(copy.headers);
    h.set(STAMP, String(Date.now()));
    return caches.open(PAGES).then((c) => c.put(req.url, new Response(body, { status: copy.status, statusText: copy.statusText, headers: h })).then(() => prune(c)));
  }).catch(() => undefined);
}

function kept(req) {
  return caches.open(PAGES).then((c) => c.match(req.url, { ignoreVary: true })).then((hit) => {
    if (hit && evictPlan([{ url: req.url, storedAt: Number(hit.headers.get(STAMP)) }], Date.now()).length === 0) return hit;
    return caches.match(fallback(new URL(req.url).pathname));
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const what = route(req.method, req.url, self.location.origin, !!req.headers.get('authorization'), req.mode, req.destination || '', SHELL);
  if (what === 'pass') return;                            // never a mutation, cross-origin, API, photo or authorised request

  if (what === 'navigate') {
    // network-first; a public page the server marked cacheable is kept (bounded); offline → the kept copy of this url, else the shell
    event.respondWith(fetch(req).then((res) => { event.waitUntil(keep(req, res)); return res; }).catch(() => kept(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
`;
}

/** PC-56 STORE-6a · D4: the worker served while `storefront_pwa` is OFF — it takes over at once, deletes every `kv-*` cache, claims the open
 *  pages and unregisters itself: the next load runs with no worker at all. No fetch handler — every request goes to the network. */
export function unregisterWorkerSource(): string {
  return `// /sw.js · the storefront's worker is SWITCHED OFF (flag storefront_pwa) — this one removes itself and every kv-* cache.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('kv-') === 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});
`;
}
