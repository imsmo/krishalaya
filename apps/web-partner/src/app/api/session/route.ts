// apps/web-partner/src/app/api/session/route.ts · session route handler. POST with _action=logout signs the PARTNER session out at the API
// (best effort) and clears the httpOnly cookies, then /login. PC-56 PARTNER-0 · F-11: GET ?clear=NOT_A_PARTNER is where the persona gate
// sends a session that is not a partner's — a route handler may modify cookies (a page render may not); it clears them and redirects to
// /login?error=NOT_A_PARTNER. (Sign-in itself is handled by Server Actions on /login.)
import { NextRequest, NextResponse } from 'next/server';
import { clearSession } from '../../../lib/partner-auth';
import { partnerClient } from '../../../lib/api-client';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  if (form.get('_action') === 'logout') {
    await partnerClient().partner.auth.logout().catch(() => undefined);
    clearSession();
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('clear') === 'NOT_A_PARTNER') {
    clearSession();
    return NextResponse.redirect(new URL('/login?error=NOT_A_PARTNER', req.url), { status: 303 });
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
