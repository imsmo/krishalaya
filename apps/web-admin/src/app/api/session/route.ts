// apps/web-admin/src/app/api/session/route.ts · logout for the god-mode console.
//
// PC-56 ADMIN-AUTH-1: signing out now ENDS THE SESSION, not just the cookie. admin-api's POST /v1/auth/sign-out revokes the
// session row (0118), so a copied bearer is refused by AdminAuthGuard from the next request on. The cookie is cleared
// whatever admin-api answers — an unreachable API must never leave the operator signed in on this browser — and the
// revocation call is bounded by a timeout (degrade, never hang).
import { NextRequest, NextResponse } from 'next/server';
import { clearAdminSession, getAdminToken } from '../../../lib/admin-auth';
import { env } from '../../../lib/env';
import { forwardToAdminApi, sameOrigin, type FetchLike } from '../../../features/admin-auth/admin-auth';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers.get('origin'), req.url)) return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
  const form = await req.formData();
  if (form.get('_action') === 'logout') {
    const token = getAdminToken();
    if (token) {
      await forwardToAdminApi(globalThis.fetch as unknown as FetchLike, env.serverAdminApiUrl, 'signOut', {}, { bearer: token, timeoutMs: 5_000 });
    }
    clearAdminSession();
    return NextResponse.redirect(new URL('/login?error=signedOut', req.url), { status: 303 });
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
