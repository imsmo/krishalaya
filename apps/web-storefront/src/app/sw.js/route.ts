// apps/web-storefront/src/app/sw.js/route.ts · PC-56 HOTFIX-8 · D1 (b) — the service worker, served by a ROUTE (it was `public/sw.js`, whose
// version never changed). The body is features/offline/sw-source.ts for THIS build: `VERSION = kv-sw-<NEXT_PUBLIC_BUILD_ID>` (next.config.js
// fixes the id once per build — the deploy's own value when set — and inlines it here). `Cache-Control: no-cache`: the browser revalidates
// the worker on every check (with the registration's `updateViaCache: 'none'`, app/layout.tsx), so a deploy reaches every phone at its next
// visit. Served on every host (the middleware rewrites only a store host's `/`, `/listings/…`, `/trace/…`, `/certificates…` and the
// manifest — `/sw.js` passes through), so one worker per origin, as before.
import { serviceWorkerSource, swBuildId } from '../../features/offline/sw-source';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(serviceWorkerSource(swBuildId(process.env.NEXT_PUBLIC_BUILD_ID)), {
    status: 200,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' },
  });
}
