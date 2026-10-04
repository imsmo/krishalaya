// apps/web-tenant/src/app/api/ping/route.ts · PC-56 TENANT-SW-f · W318 §2 — the console's HEARTBEAT. The browser asks the console (same
// origin, no CORS, no token); the console asks the API's public liveness probe with a 3-second budget. 200 = there is signal end to end;
// 503 = the console cannot reach the API, so the browser goes read-only (OnlineGuard). Never cached, never indexed, carries no data.
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
