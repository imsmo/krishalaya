// apps/web-tenant/src/middleware.ts · DEV-26, Q16 (URL/locale scheme). Mirrors
// `apps/web-storefront/src/middleware.ts` exactly (see that file's own header for the full reasoning): if the
// request URL carries a valid `?lang=<code>`, persists it into the existing `kvt_lang` cookie (`lib/i18n.ts`'s
// `getLang()` already reads this cookie first) — purely additive, zero change for a request with no `lang` param.
import { NextRequest, NextResponse } from 'next/server';
import { pickUrlLang } from './lib/locale-url';

// NOT imported from `lib/i18n.ts` (that module is `import 'server-only'` + `next/headers`, RSC-only APIs that
// Middleware's Edge runtime does not provide) — this is the same cookie name `lib/i18n.ts`'s own `LANG_COOKIE`
// constant holds; kept in sync by both files' own comments (a disclosed one-string duplication).
const LANG_COOKIE = 'kvt_lang';
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

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
