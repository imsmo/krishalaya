// apps/web-storefront/src/middleware.ts · DEV-26, Q16 (URL/locale scheme). Runs before every page request.
// If the request URL carries a valid `?lang=<code>` (see `lib/locale-url.ts` for the scheme decision + the
// rejected path-prefix alternative), persists it into the SAME `kv_lang` cookie the existing LocaleSwitcher/
// `/api/lang` flow already reads (`lib/i18n.ts`'s `getLang()`) — so a shared/bookmarked `?lang=hi` link sets the
// language for a FIRST-touch visitor with no prior cookie, with zero change to how every existing server
// component resolves the active language. Purely additive: a request with no `lang` param is untouched.
import { NextRequest, NextResponse } from 'next/server';
import { pickUrlLang } from './lib/locale-url';

// NOT imported from `lib/i18n.ts` on purpose: that module is `import 'server-only'` + `next/headers`
// (React Server Component APIs, backed by an AsyncLocalStorage context that Middleware's Edge runtime does not
// provide) — pulling it into the Middleware bundle risks a real runtime failure, not just an unused import.
// This is the same cookie name `lib/i18n.ts`'s own `LANG_COOKIE` constant holds; kept in sync by both files'
// own comments (a disclosed one-string duplication, not a risky cross-runtime import).
const LANG_COOKIE = 'kv_lang';
const ONE_YEAR = 60 * 60 * 24 * 365;

export function middleware(req: NextRequest): NextResponse {
  const code = pickUrlLang(req.nextUrl);
  const res = NextResponse.next();
  if (code) {
    res.cookies.set(LANG_COOKIE, code, {
      httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR,
    });
  }
  return res;
}

// Skip static assets, Next internals, and the API routes themselves (the /api/lang route sets the cookie its
// own way already; no need to double-run this middleware over API calls).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
