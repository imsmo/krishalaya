// apps/web-storefront/src/middleware.ts · runs before every page request.
//   1. DEV-26, Q16 (URL/locale scheme): a valid `?lang=<code>` is persisted into the SAME `kv_lang` cookie the LocaleSwitcher / `/api/lang`
//      flow reads (`lib/i18n.ts`) — so a shared `?lang=hi` link sets the language for a first-touch visitor. Purely additive.
//   2. PC-56 TENANT-13d · B3 — HOST ROUTING. A request on a TENANT host (not the storefront's own) is resolved through the API: Host routing
//      OFF → untouched (the `/[tenantSlug]` path routes keep working either way); an unknown or unverified host → 404 (never a default
//      tenant); a non-primary host of a tenant whose primary custom domain has a certificate → 301 there ("old links keep working");
//      otherwise the tenant's pages are served at the host's root (`/` → `/<slug>`, `/listings/…` → `/<slug>/listings/…`) and the slug
//      rides a request header for the manifest and metadata.
import { NextRequest, NextResponse } from 'next/server';
import { pickUrlLang } from './lib/locale-url';
import { TENANT_SLUG_HEADER, isOwnHost, resolveStorefrontHost } from './lib/host-routing';
import { hostRewritePath } from './features/branding/brand-theme';

// NOT imported from `lib/i18n.ts` on purpose: that module is `import 'server-only'` + `next/headers` (React Server Component APIs, backed
// by an AsyncLocalStorage context that Middleware's Edge runtime does not provide). The same cookie name `lib/i18n.ts`'s `LANG_COOKIE` holds.
const LANG_COOKIE = 'kv_lang';
const ONE_YEAR = 60 * 60 * 24 * 365;

function withLang(req: NextRequest, res: NextResponse): NextResponse {
  const code = pickUrlLang(req.nextUrl);
  if (code) {
    res.cookies.set(LANG_COOKIE, code, {
      httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: ONE_YEAR,
    });
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const host = req.headers.get('host') ?? '';
  const apiOrigin = process.env.API_URL_INTERNAL || process.env.NEXT_PUBLIC_API_URL || '';
  if (host && apiOrigin && !isOwnHost(host, process.env.NEXT_PUBLIC_SITE_URL || '')) {
    const a = await resolveStorefrontHost(apiOrigin, host);
    if (a.routing && !a.platformHost) {
      if (a.unavailable) return new NextResponse('The organisation for this address could not be looked up — try again shortly.', { status: 503, headers: { 'retry-after': '10' } });
      if (!a.tenant) return new NextResponse('No organisation is served at this address.', { status: 404 });
      if (a.redirectTo) return NextResponse.redirect(`${a.redirectTo}${req.nextUrl.pathname}${req.nextUrl.search}`, 301);
      const headers = new Headers(req.headers);
      headers.set(TENANT_SLUG_HEADER, a.tenant.slug);
      const target = hostRewritePath(a.tenant.slug, req.nextUrl.pathname);
      if (target) {
        const url = req.nextUrl.clone(); url.pathname = target;
        return withLang(req, NextResponse.rewrite(url, { request: { headers } }));
      }
      return withLang(req, NextResponse.next({ request: { headers } }));
    }
  }
  return withLang(req, NextResponse.next());
}

// Skip static assets, Next internals, and the API routes themselves.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
