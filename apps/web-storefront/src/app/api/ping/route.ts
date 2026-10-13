// apps/web-storefront/src/app/api/ping/route.ts · PC-56 STORE-1a · C5 — the sign-in screen's HEARTBEAT (the ported OnlineGuard asks
// `/api/ping` every 30 s, 5 s timeout). Same contract as web-tenant's: the browser asks the storefront (same origin, no token); the
// storefront asks the API's public liveness probe with a 3-second budget. 200 = signal end to end; 503 = the API cannot be reached, so
// the sign-in buttons hold ("— needs signal") rather than send a code into the void. Never cached, never indexed, carries no data.
import { env } from '../../../lib/env';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-type': 'application/json' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const r = await fetch(`${env.serverApiUrl.replace(/\/+$/, '')}/v1/healthz`, { cache: 'no-store', signal: ctl.signal });
    return new Response(JSON.stringify({ ok: r.ok }), { status: r.ok ? 200 : 503, headers });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
  } finally { clearTimeout(timer); }
}
