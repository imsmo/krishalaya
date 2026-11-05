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
// PC-56 PARTNER-6a (founder 6a-3): `'settlements'` is GONE — `/settlements` answers a real 307 to `/insurer/settlements` (next.config.js,
// `SETTLEMENTS_REDIRECTS` in features/partner6/refusals.ts) and its page file is deleted; `partner.surface.settlements` goes with it.
// PC-56 PARTNER-6b (founder 6b-4): `'consents'` is GONE — `/consents` answers a real 307 to `/lender/consents` (`CONSENTS_REDIRECTS`) and its
// page file is deleted; `partner.surface.consents` goes with it.
// PC-56 PARTNER-6c (founder 6c-4): `'notifications'` is GONE — `/notifications` and `/notifications/preferences` answer real 307s to the built
// `/account/notifications` pair (`NOTIFICATIONS_REDIRECTS`), their page files (and the dead `actions.ts`) are deleted, and
// `partner.surface.notifications` goes with them. PARTNER-6 leaves no not-yet route behind.
export type NotYetSurface = 'fleet' | 'logistics' | 'profile';

export const NOT_YET_ROUTES: Readonly<Record<string, NotYetSurface>> = Object.freeze({
  // PC-56 PARTNER-2c: /products and /products/[id] answer 307 to the built `lender/products` routes (the lender's shelf)
  // PC-56 PARTNER-4a: /portfolio, /portfolio/[id] and /servicing answer 307 to the built `lender/portfolio` routes (LENDER_BOOK_REDIRECTS)
  // PC-56 PARTNER-2a: /insurance-book, /insurance-products, /insurance-policies(/[id]) answer 307 to the built `insurer/*` routes; PC-56 PARTNER-3a:
  // the claims pair /insurance-claims(/[id]) answers 307 to the built `insurer/claims` routes (CLAIMS_REDIRECTS) — no insurance page is not-yet now
  '/fleet': 'fleet', '/fleet/carriers/[id]': 'fleet', '/fleet/slots': 'fleet', '/fleet/slots/[id]': 'fleet', '/fleet/vehicles': 'fleet', '/fleet/vehicles/[id]': 'fleet',
  '/shipments': 'logistics', '/shipments/[id]': 'logistics', '/zones': 'logistics', '/zones/[id]': 'logistics', '/routes': 'logistics', '/routes/[id]': 'logistics',
  '/cold-chain': 'logistics',
  '/profile': 'profile', '/profile/[id]': 'profile',
});

export function notYetSurface(route: string): NotYetSurface | null {
  return NOT_YET_ROUTES[route] ?? null;
}
export const surfaceKey = (s: NotYetSurface) => `partner.surface.${s}`;

/** PC-56 PARTNER-2a's kind-aware branch is GONE with the `'insurance'` surface (PARTNER-4a, survey C-17): no not-yet route maps to it, so the
 *  branch could never be taken.
 *  PC-56 PARTNER-6a (survey C-7, founder 6a-3): the old "Go to the loan queue" sent an INSURER (who still reaches `/consents` and
 *  `/notifications`) to a lender page `lenderGate()` sends it away from. A not-yet page reads nothing — not even `/me` — so it cannot know the
 *  kind itself; it goes back to `/dashboard`, which IS kind-aware: a lender (and any other kind) stays on its own home, an insurer is sent on
 *  to `/insurer/dashboard` by that page (`wrongConsole`). The label says "your dashboard" and names no console. */
export function notYetBack(_route: string): { href: string; key: string } {
  return { href: '/dashboard', key: 'partner.notYet.back' };
}
