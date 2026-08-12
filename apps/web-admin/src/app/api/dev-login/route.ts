// apps/web-admin/src/app/api/dev-login/route.ts · DEV-56 Part 3 — the console-side half of the dev-only bypass.
//
// This route exists only to reach admin-api's `GET /v1/auth/dev-login` (dev-login.controller.ts) SERVER-TO-SERVER
// (via env.serverAdminApiUrl, never exposed to the browser) and turn its response into the same `kva_session`
// cookie the real IdP callback would set (setAdminSession — admin-auth.ts). It re-checks env.devLoginEnabled
// itself before making the call: the login page only ever RENDERS the CTA that posts here when the flag is on,
// but a route handler must never trust that the page that link came from actually hid the button — the flag is
// re-verified here, and admin-api re-verifies its OWN flag + NODE_ENV + loopback independently again on top of
// that (dev-login.controller.ts). Three independent checks, none of which trusts the other two (Law 8).
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not implement or simulate the real IdP SSO callback — that remains
// unbuilt (no route named `auth/sso/start` exists in admin-api either); this is a clearly separate, disclosed
// bypass path, not a stand-in for the production flow.
import { NextRequest, NextResponse } from 'next/server';
import { env } from '../../../lib/env';
import { setAdminSession } from '../../../lib/admin-auth';

export async function POST(req: NextRequest) {
  if (!env.devLoginEnabled) {
    // Mirrors dev-login.controller.ts's own refusal wording so a stray call here in a misconfigured environment
    // fails exactly as loudly as the API it would have called.
    return NextResponse.redirect(new URL('/login?error=dev_login_disabled', req.url), { status: 303 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${env.serverAdminApiUrl}/v1/auth/dev-login`, { method: 'GET', cache: 'no-store' });
  } catch {
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 });
  }
  if (!upstream.ok) {
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 });
  }

  const body = (await upstream.json()) as { token?: unknown; maxAgeSec?: unknown };
  if (typeof body.token !== 'string' || typeof body.maxAgeSec !== 'number') {
    return NextResponse.redirect(new URL('/login?error=1', req.url), { status: 303 });
  }

  setAdminSession(body.token, body.maxAgeSec);
  return NextResponse.redirect(new URL('/dashboard', req.url), { status: 303 });
}
