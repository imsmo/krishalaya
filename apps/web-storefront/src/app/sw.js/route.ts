// apps/web-storefront/src/app/sw.js/route.ts · PC-56 HOTFIX-8 · D1 (b) — the service worker, served by a ROUTE (it was `public/sw.js`, whose
// version never changed). The body is features/offline/sw-source.ts for THIS build: `VERSION = kv-sw-<NEXT_PUBLIC_BUILD_ID>` (next.config.js
// fixes the id once per build — the deploy's own value when set — and inlines it here). `Cache-Control: no-cache`: the browser revalidates
// the worker on every check (with the registration's `updateViaCache: 'none'`, app/layout.tsx), so a deploy reaches every phone at its next
// visit. Served on every host (the middleware rewrites only a store host's `/`, `/listings/…`, `/trace/…`, `/certificates…`, the policy pages
// and the manifest — `/sw.js` passes through), so one worker per origin, as before.
//
// PC-56 STORE-6a · D4 (Law 10): the worker is a FLAGGED route. `storefront_pwa` (platform-scoped — one worker per origin serves every path
// store — read through the public flags endpoint with no tenant) ON → the versioned worker; OFF → a SELF-UNREGISTERING worker (it deletes
// every `kv-*` cache and unregisters itself), so a bad worker is undone by a flag flip, not a deploy. The read FAILS OPEN, as the API's own
// answer does (FAIL_OPEN_FLAGS): an API or flag-store outage must never unregister every phone's worker. The answer is held for 30 s in this
// instance (lib/worker-switch.ts).
import { serviceWorkerSource, swBuildId, unregisterWorkerSource } from '../../features/offline/sw-source';
import { workerSwitchedOn } from '../../lib/worker-switch';

export const dynamic = 'force-dynamic';
// STORE-6a (found by the `next start` probe): in a route handler Next 14's data cache KEEPS a plain `fetch` — the SDK's flags read was answered from
// `.next/cache/fetch-cache` after the flag was switched OFF, so the kill-switch never flipped. Every fetch in this route is no-store.
export const fetchCache = 'force-no-store';

export async function GET(): Promise<Response> {
  const on = await workerSwitchedOn();
  const body = on ? serviceWorkerSource(swBuildId(process.env.NEXT_PUBLIC_BUILD_ID)) : unregisterWorkerSource();
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex', 'X-KV-Worker': on ? 'on' : 'off' },
  });
}
