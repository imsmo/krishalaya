// apps/web-tenant/src/app/api/mechanism/route.ts · DEV-19. The theme/senior-mode preference switcher's no-JS
// endpoint — mirrors `apps/web-tenant/src/app/api/lang/route.ts` exactly (a plain `<form method="post">`, no
// client JS, no token, no PII). Differs from that route in ONE deliberate way: rather than a hidden `from`
// field (which needs a client component to read the current pathname, per `LocaleSwitcher.tsx`'s own header
// comment), this route reads the `Referer` header to compute the redirect target — avoiding the need for ANY
// client component at all for the settings-page toggle forms (see `app/settings/page.tsx`), which is a purer
// SSR-only design (this route is the ONLY place a mechanism preference is ever written).
import { NextRequest, NextResponse } from 'next/server';
import { THEME_PREFERENCES } from '@krishalaya/ui';
import { THEME_COOKIE, SENIOR_COOKIE } from '../../../lib/mechanism';

const ONE_YEAR = 60 * 60 * 24 * 365;

function sameOriginRedirectTarget(req: NextRequest): string {
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === req.nextUrl.origin) return url.pathname + url.search;
    } catch {
      // fall through to default below
    }
  }
  return '/settings';
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const res = NextResponse.redirect(new URL(sameOriginRedirectTarget(req), req.url), 303);
  if (form.has('theme')) {
    const raw = String(form.get('theme') ?? '');
    // fail-closed to 'system' — never trust the client value (same discipline /api/lang's own `isSupported` check uses)
    const theme = (THEME_PREFERENCES as readonly string[]).includes(raw) ? raw : 'system';
    res.cookies.set(THEME_COOKIE, theme, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  }
  if (form.has('senior')) {
    const raw = String(form.get('senior') ?? '');
    const senior = raw === 'on' ? 'on' : 'off';
    res.cookies.set(SENIOR_COOKIE, senior, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR });
  }
  return res;
}
