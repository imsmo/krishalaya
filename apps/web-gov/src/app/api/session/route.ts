// apps/web-gov/src/app/api/session/route.ts · PC-56 GOV-1a — the session route handler (a route handler may write cookies; a page render may
// not). Sign-in itself is handled by Server Actions on /login.
//   POST _action=logout       → the GOV session is signed out at the API (`gov.auth.logout`, best effort), the cookies cleared, → /login.
//   GET  ?clear=<CODE>        → where the persona gate sends a session that is not a government authority's (NOT_A_GOVERNMENT_ACCOUNT) or has
//                               ended (SESSION_ENDED): the cookies are cleared, → the login chain's failure state naming it.
//   GET  ?refresh=1&next=<p>  → the ONE place a refresh token is spent: `gov.auth.refresh` (the GOV realm — a tenant or partner refresh token
//                               is refused there), the new pair written, → the same-origin `next`; refused → cleared, SESSION_ENDED.
import { NextRequest, NextResponse } from 'next/server';
import { clearSession, getRefreshToken, setSession } from '../../../lib/auth';
import { anonClient, govClient } from '../../../lib/api-client';
import { CLEAR_CODES } from '../../../features/gov1/persona';
import { safeNext } from '../../../features/nav/safe-next';

const to = (req: NextRequest, path: string) => NextResponse.redirect(new URL(path, req.url), { status: 303 });

export async function POST(req: NextRequest) {
  const form = await req.formData();
  if (form.get('_action') === 'logout') {
    await govClient().gov.auth.logout().catch(() => undefined);
    clearSession();
  }
  return to(req, '/login');
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const clear = q.get('clear');
  if (clear) {
    clearSession();
    return to(req, (CLEAR_CODES as readonly string[]).includes(clear) ? `/login?act=failure&error=${clear}` : '/login');
  }
  if (q.get('refresh') === '1') {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        const tk = await anonClient().gov.auth.refresh(refreshToken);
        setSession(tk.accessToken, tk.refreshToken, tk.expiresInSec);
        return to(req, safeNext(q.get('next')));
      } catch { /* refused: ended, removed, expired — fall through */ }
    }
    clearSession();
    return to(req, '/login?act=failure&error=SESSION_ENDED');
  }
  return to(req, '/login');
}
