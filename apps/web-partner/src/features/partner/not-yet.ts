// apps/web-partner/src/features/partner/not-yet.ts · PC-56 PARTNER-0 · founder D8 — THE PAGES WITH NO PARTNER READ YET. PURE.
//
// After PARTNER-0 a session in this console is a PARTNER session (realm 'partner', a pid, no tid). Every route below reads an organisation's
// (FPO's) records through a TENANT route, which refuses a partner token (and used to 422 TENANT_REQUIRED besides). Rather than call it and
// print an outage, each of these pages prints ONE honest state — "not yet available in the partner console" — and makes no API call at all.
// The list is pinned against the app's own page files by src/test-render/not-yet.render.test.tsx (a page that renders <NotYet> must be
// here, and every route here must render it). Repointed instead (they have partner reads now): /dashboard, /loan-queue, /loan-queue/[id].
// /help is static (no API read) and stays as it is (PARTNER-1a reworks it).
export type NotYetSurface = 'products' | 'portfolio' | 'servicing' | 'insurance' | 'fleet' | 'logistics' | 'consents' | 'settlements' | 'notifications' | 'profile';

export const NOT_YET_ROUTES: Readonly<Record<string, NotYetSurface>> = Object.freeze({
  '/products': 'products', '/products/[id]': 'products',
  '/portfolio': 'portfolio', '/portfolio/[id]': 'portfolio',
  '/servicing': 'servicing',
  '/insurance-book': 'insurance', '/insurance-claims': 'insurance', '/insurance-claims/[id]': 'insurance',
  '/insurance-policies': 'insurance', '/insurance-policies/[id]': 'insurance', '/insurance-products': 'insurance',
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
