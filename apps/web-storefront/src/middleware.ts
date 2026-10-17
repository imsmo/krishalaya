// apps/web-storefront/src/middleware.ts · runs before every page request.
//   1. DEV-26, Q16 (URL/locale scheme): a valid `?lang=<code>` is persisted into the SAME `kv_lang` cookie the LocaleSwitcher / `/api/lang`
//      flow reads (`lib/i18n.ts`) — so a shared `?lang=hi` link sets the language for a first-touch visitor. Purely additive.
//   2. PC-56 TENANT-13d · B3 — HOST ROUTING. A request on a TENANT host (not the storefront's own) is resolved through the API: Host routing
//      OFF → untouched (the `/[tenantSlug]` path routes keep working either way); an unknown or unverified host → 404 (never a default
//      tenant); a non-primary host of a tenant whose primary custom domain has a certificate → 301 there ("old links keep working");
//      otherwise the tenant's pages are served at the host's root (`/` → `/<slug>`, `/listings/…` → `/<slug>/listings/…`) and the slug
//      rides a request header for the manifest and metadata.
//   3. PC-56 STORE-6a · D2 (founder Q9) — THE CACHEABLE HEADER, decided by the SERVER per response (a Server Component cannot set a response
//      header in Next 14, and next.config.js headers cannot read a flag — so the middleware decides, after the session check):
//      `X-KV-Cacheable: public` is set ONLY on a public page (features/store6/sw-rules.ts `cacheableScope` — a listing, the organisation's
//      page, a trace / verify page, a certificate page, the browse list), ONLY when the request carries NO session cookie (the worker cannot
//      see cookies; a signed-in person's page may hold a cart count — never kept), ONLY when the deciding organisation's
//      `storefront_offline_reads` is ON (lib/offline-reads.ts — fail closed). The same decision rides a REQUEST header (`x-kv-cacheable`) to
//      the layouts, which stamp the page (`<meta name="kv-cacheable">`, `data-kv-rendered-at` on <main>); an incoming copy of either request
//      header is always stripped first, so a client can never mark its own page.
//   4. PC-56 STORE-6a · D6: an organisation's offline page (`/<slug>/offline`, or `/offline` on its host) is rendered by its layout in the
//      SESSION-FREE shell chrome (`x-kv-shell: offline`) — the worker pre-caches it on a store host, with the page's cookies. And a store host
//      answers `/apple-touch-icon.png` 404: iOS would otherwise put the PLATFORM's icon on an organisation's home screen.
import { NextRequest, NextResponse } from 'next/server';
import { pickUrlLang } from './lib/locale-url';
import { TENANT_SLUG_HEADER, isOwnHost, resolveStorefrontHost } from './lib/host-routing';
import { hostRewritePath } from './features/branding/brand-theme';
import { CACHEABLE_HEADER, SHELL_HEADER, cacheableRule, cacheableScope, hasSessionCookie, isTenantOfflinePath } from './features/store6/sw-rules';
import { offlineReadsOn } from './lib/offline-reads';

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

/** STORE-6a: the request headers the pages see (the offline marks decided here, never by the client) and whether the response is cacheable. */
async function offlineMarks(req: NextRequest, base: Headers, internalPath: string, apiOrigin: string): Promise<{ headers: Headers; cacheable: boolean }> {
  const headers = new Headers(base);
  headers.delete(CACHEABLE_HEADER); headers.delete(SHELL_HEADER);
  const session = hasSessionCookie((n) => req.cookies.has(n));
  const scope = cacheableScope(internalPath);
  // ONE rule decides (features/store6/sw-rules.ts `cacheableRule`): asked first as if the flag were ON — a session cookie or a page that is never
  // cacheable ends it there, and the flag is not even read; only then the organisation's flag (fail closed)
  const eligible = scope !== null && cacheableRule(internalPath, session, true);
  const flagOn = eligible ? await offlineReadsOn(apiOrigin, scope.kind === 'tenant' ? scope.slug : null) : false;
  const cacheable = eligible && cacheableRule(internalPath, session, flagOn);
  if (cacheable) headers.set(CACHEABLE_HEADER, 'public');
  if (isTenantOfflinePath(internalPath)) headers.set(SHELL_HEADER, 'offline');
  return { headers, cacheable };
}
function marked(res: NextResponse, cacheable: boolean): NextResponse {
  if (cacheable) res.headers.set('X-KV-Cacheable', 'public');
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
      // STORE-6a · D6: never the platform's apple-touch icon on an organisation's host (iOS probes the root when a page links none)
      if (req.nextUrl.pathname === '/apple-touch-icon.png' || req.nextUrl.pathname === '/apple-touch-icon-precomposed.png') return new NextResponse(null, { status: 404 });
      const base = new Headers(req.headers);
      base.set(TENANT_SLUG_HEADER, a.tenant.slug);
      const target = hostRewritePath(a.tenant.slug, req.nextUrl.pathname);
      const { headers, cacheable } = await offlineMarks(req, base, target ?? req.nextUrl.pathname, apiOrigin);
      if (target) {
        const url = req.nextUrl.clone(); url.pathname = target;
        return marked(withLang(req, NextResponse.rewrite(url, { request: { headers } })), cacheable);
      }
      return marked(withLang(req, NextResponse.next({ request: { headers } })), cacheable);
    }
  }
  // not a routed store host: a client-sent store header is dropped too (only the host lookup above may name the host's organisation)
  const base = new Headers(req.headers); base.delete(TENANT_SLUG_HEADER);
  const { headers, cacheable } = await offlineMarks(req, base, req.nextUrl.pathname, apiOrigin);
  return marked(withLang(req, NextResponse.next({ request: { headers } })), cacheable);
}

// Skip static assets, Next internals, and the API routes themselves.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
