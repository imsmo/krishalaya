// apps/web-storefront/src/app/api/session/clear/route.ts · PC-56 HOTFIX-8 · D1 (c) — where sign-out (and a different person's sign-in)
// pass on their way: `Clear-Site-Data: "cache", "storage"` on a 303 to `next` (same-origin paths only), sent ONLY when the httpOnly one-shot
// arm `kvs_csd` is present (a link from elsewhere clears nothing) — the arm is dropped in the same answer. A request carrying `rsc` is
// Next's own in-process prefetch of a Server Action's redirect target: it answers 204, untouched, and the browser then navigates here itself
// (features/offline/owner.ts `clearRouteAnswer` — the rule, unit-tested). Under /api/: the service worker never touches it and the
// middleware skips it. Never cached.
import { clearRouteAnswer } from '../../../../features/offline/owner';

export const dynamic = 'force-dynamic';

export function GET(req: Request): Response {
  const a = clearRouteAnswer({
    next: new URL(req.url).searchParams.get('next'),
    cookie: req.headers.get('cookie'),
    rsc: req.headers.get('rsc') === '1',
  });
  const headers = new Headers();
  for (const [k, v] of a.headers) headers.append(k, v);
  return new Response(null, { status: a.status, headers });
}
