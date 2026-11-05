// apps/web-ops/src/middleware.ts · DEV-26, Q16 (URL/locale scheme). Mirrors
// `apps/web-storefront/src/middleware.ts` (see that file's own header for the full reasoning): if the request URL
// carries a valid `?lang=<code>`, persists it into the console's language cookie (`lib/i18n.ts`'s `getLang()` reads
// it first) — purely additive, zero change for a request with no `lang` param.
//
// PC-56 HOTFIX-10 · H10-4 (survey OPS-1 F-20 / C-10): this file was copied from web-tenant and kept web-tenant's own
// cookie name (`kvt_lang`) while web-ops reads `kvo_lang` — so a `?lang=` choice never stuck. The name now comes from
// `lib/lang-cookie.ts`, the ONE definition (framework-free, so the Edge runtime can import it; `lib/i18n.ts` cannot be
// imported here — it is `server-only` + `next/headers`).
import { NextRequest, NextResponse } from 'next/server';
import { pickUrlLang } from './lib/locale-url';
import { LANG_COOKIE } from './lib/lang-cookie';
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
