// apps/web-partner/src/features/partner/not-yet.ts · PC-56 PARTNER-0 · founder D8 — THE PAGES WITH NO PARTNER READ YET. PURE.
//
// After PARTNER-0 a session in this console is a PARTNER session (realm 'partner', a pid, no tid). Every route below reads an organisation's
// (FPO's) records through a TENANT route, which refuses a partner token (and used to 422 TENANT_REQUIRED besides). Rather than call it and
// print an outage, each of these pages prints ONE honest state — "not yet available in the partner console" — and makes no API call at all.
// The list is pinned against the app's own page files by src/test-render/not-yet.render.test.tsx (a page that renders <NotYet> must be
// here, and every route here must render it). Repointed instead (they have partner reads now): /dashboard, /loan-queue, /loan-queue/[id].
// /help is static (no API read) and stays as it is (PARTNER-1a reworks it).
//
// PC-56 PARTNER-4a (survey C-17 / E12): the DEAD members `'products'` and `'insurance'` are GONE — no route has
// mapped to either since 2a / 2c / 3a redirected the last of them, and `notYetBack` no longer branches on a surface
// that cannot occur. `'portfolio'` and `'servicing'` go with them: `/portfolio`, `/portfolio/[id]` and `/servicing`
// now answer a real 307 to the lender's own book (`LENDER_BOOK_REDIRECTS`), and their page files are deleted.
export type NotYetSurface = 'fleet' | 'logistics' | 'consents' | 'settlements' | 'notifications' | 'profile';

export const NOT_YET_ROUTES: Readonly<Record<string, NotYetSurface>> = Object.freeze({
  // PC-56 PARTNER-2c: /products and /products/[id] answer 307 to the built `lender/products` routes (the lender's shelf)
  // PC-56 PARTNER-4a: /portfolio, /portfolio/[id] and /servicing answer 307 to the built `lender/portfolio` routes (LENDER_BOOK_REDIRECTS)
  // PC-56 PARTNER-2a: /insurance-book, /insurance-products, /insurance-policies(/[id]) answer 307 to the built `insurer/*` routes; PC-56 PARTNER-3a:
  // the claims pair /insurance-claims(/[id]) answers 307 to the built `insurer/claims` routes (CLAIMS_REDIRECTS) — no insurance page is not-yet now
  '/fleet': 'fleet', '/fleet/carriers/[id]': 'fleet', '/fleet/slots': 'fleet', '/fleet/slots/[id]': 'fleet', '/fleet/vehicles': 'fleet', '/fleet/vehicles/[id]': 'fleet',
  '/shipments': 'logistics', '/shipments/[id]': 'logistics', '/zones': 'logistics', '/zones/[id]': 'logistics', '/routes': 'logistics', '/routes/[id]': 'logistics',
  '/cold-chain': 'logistics',
  '/consents': 'consents',
  '/settlements': 'settlements',
  '/notifications': 'notifications', '/notifications/preferences': 'notifications',
  '/profile': 'profile', '/profile/[id]': 'profile',
});

export function notYetSurface(route: string): NotYetSurface | null {
  return NOT_YET_ROUTES[route] ?? null;
}
export const surfaceKey = (s: NotYetSurface) => `partner.surface.${s}`;

/** PC-56 PARTNER-2a's kind-aware branch is GONE with the `'insurance'` surface (PARTNER-4a, survey C-17): no not-yet route maps to it, so the
 *  branch could never be taken. Every remaining not-yet page goes back to the lender's queue at the canon's own address. */
export function notYetBack(_route: string): { href: string; key: string } {
  return { href: '/lender/queue', key: 'partner.notYet.back' };
}
