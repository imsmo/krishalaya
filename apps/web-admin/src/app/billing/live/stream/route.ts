// apps/web-admin/src/app/billing/live/stream/route.ts · the SSE PROXY for the live money ticker (PC-56 ADMIN-1e).
//
// WHY A PROXY AND NOT A DIRECT EventSource. The admin bearer lives in an httpOnly, SameSite=Strict cookie and is
// attached SERVER-SIDE only — that is the whole design of this realm. A browser `EventSource` cannot set an
// Authorization header, so the only way to connect the browser straight to admin-api would be to put a god-mode token
// where JavaScript can read it. That is not a trade worth a ticker.
//
// So: the browser opens a SAME-ORIGIN stream (the cookie rides along automatically), this handler authenticates from
// that cookie, opens the upstream stream with the bearer, and pipes the bytes through untouched. The token never
// crosses the network boundary to the client, and nothing about the admin realm's isolation changes.
//
// The body is piped, not buffered: buffering an event stream would defeat the point (and grow without bound).
import { NextRequest, NextResponse } from 'next/server';
import { getAdminToken } from '../../../../lib/admin-auth';
import { env } from '../../../../lib/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const token = getAdminToken();
  // 401 as a normal response rather than a redirect: an EventSource follows redirects and would end up parsing an HTML
  // login page as event frames. The client treats a non-200 as "closed" and stops retrying.
  if (!token) return new NextResponse('unauthenticated', { status: 401 });

  const q = req.nextUrl.searchParams;
  const upstream = new URL(`${env.serverAdminApiUrl.replace(/\/+$/, '')}/v1/billing/stream/money`);
  // only the cursor params are forwarded — never the whole query string, which would let a client smuggle parameters
  // into a god-mode endpoint through a same-origin path
  const after = q.get('after'); const afterId = q.get('afterId');
  if (after && afterId) { upstream.searchParams.set('after', after); upstream.searchParams.set('afterId', afterId); }

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
      // no timeout: this is a long-lived stream by design. The SERVER bounds it (one hour of frames) and the client
      // reconnects with its cursor, so neither side leaks a connection forever.
      cache: 'no-store',
      signal: req.signal,          // the browser closing the tab closes the upstream too
    });
  } catch {
    return new NextResponse('upstream unavailable', { status: 502 });
  }

  if (!res.ok || !res.body) return new NextResponse('upstream refused', { status: res.status || 502 });

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',   // no-transform: a proxy that buffered this would break the stream
      connection: 'keep-alive',
      'x-accel-buffering': 'no',                   // tells nginx not to buffer, which would make "live" arrive in bursts
    },
  });
}
