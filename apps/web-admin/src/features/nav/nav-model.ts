// apps/web-admin/src/features/nav/nav-model.ts · PURE, framework-free model for the god-mode console chrome +
// admin-api error→notice mapping. No React, no fetch → unit-tested. The nav links ONLY to routes that exist in
// this app (`live: true`); not-yet-built surfaces render as a non-link "(soon)" label until their wave lands.
// True owner-RBAC is enforced by admin-api per call — the UI reflects route existence here, and degrades a 403 to
// the `needsElevation` notice rather than pretending it can grant access.

export interface AdminNavItem {
  /** App route (or null for a not-yet-built surface). */
  href: string;
  /** i18n key for the label. */
  labelKey: string;
  /** true once the route is built in this app (only then is it a real link). */
  live: boolean;
}

/** The full god-mode surface map. Flip `live: true` as each wave ships its route (links only to built routes). */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', live: true },
  { href: '/ai-models', labelKey: 'nav.aiModels', live: true },
  { href: '/tenants', labelKey: 'nav.tenants', live: true },
  { href: '/reports', labelKey: 'nav.reports', live: true },
  { href: '/flags', labelKey: 'nav.flags', live: true },
  { href: '/recon', labelKey: 'nav.recon', live: true },
  { href: '/billing', labelKey: 'nav.billing', live: true },
  { href: '/plans', labelKey: 'nav.plans', live: true },
  { href: '/providers', labelKey: 'nav.providers', live: true },
  { href: '/support', labelKey: 'nav.support', live: true },
  { href: '/compliance', labelKey: 'nav.compliance', live: true },
  { href: '/impersonation', labelKey: 'nav.impersonation', live: true },
  // PC-56 ADMIN-9: the realm's own operators. Before 0118 there was no list of the people this console lets in.
  { href: '/staff', labelKey: 'nav.staff', live: true },
  { href: '/staff/me', labelKey: 'nav.myWork', live: true },
  // PC-56 ADMIN-10: the builder and the export receipts. The dashboard is already the console's root.
  { href: '/analytics/reports', labelKey: 'nav.reportBuilder', live: true },
  { href: '/analytics/exports', labelKey: 'nav.exports', live: true },
  // PC-56 ADMIN-11: the typed platform registry. `scope='platform'` rows were unreachable by every surface until 0121.
  { href: '/analytics/mandi-pulse', labelKey: 'nav.mandiPulse', live: true },
  // PC-56 ADMIN-SWEEP-c3: W108 — the district-grain demand read, between Mandi Pulse and Farmer 360 as the canon tabs it.
  { href: '/analytics/demand-map', labelKey: 'nav.demandMap', live: true },
  // PC-56 ADMIN-SWEEP-b4: W109 — linked the day it stopped 404ing.
  { href: '/analytics/farmer-360', labelKey: 'nav.farmer360', live: true },
  { href: '/templates', labelKey: 'nav.templates', live: true },
  { href: '/integrations', labelKey: 'nav.integrations', live: true },
  { href: '/settings', labelKey: 'nav.settings', live: true },
  { href: '/announcements', labelKey: 'nav.announcements', live: true },
  { href: '/catalogue', labelKey: 'nav.catalogue', live: true },
  { href: '/schemes-registry', labelKey: 'nav.schemes', live: true },
  { href: '/cells', labelKey: 'nav.cells', live: true },
  // PC-56 ADMIN-5d. The canon's sidebar has carried "Moderation" since W089 and the route did not exist; it does now.
  // ADMIN-5f built the queue half (listings, reports) and ADMIN-SWEEP-b1 built appeals — all linked from the
  // overview page the day each stopped 404ing, this model's own rule (a link only when the route is built).
  { href: '/moderation', labelKey: 'nav.moderation', live: true },
];

/** Built routes — rendered as real links. */
export function liveNav(items: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  return items.filter((i) => i.live);
}
/** Not-yet-built surfaces — rendered as non-link "(soon)" labels. */
export function soonNav(items: readonly AdminNavItem[] = ADMIN_NAV): AdminNavItem[] {
  return items.filter((i) => !i.live);
}

/**
 * DEV-61 (shell adoption): which nav `href` (if any) is the "active" one for a given pathname — the SINGLE
 * source of truth for `Sidebar`'s `aria-current="page"` highlight, kept here (pure, framework-free) so it is
 * unit-tested exactly like the rest of this model, per this file's own charter. Not a "preserved" behavior —
 * the pre-existing `Sidebar` had no active-item detection at all (grep-verified before this batch); this is a
 * genuine new capability the shell swap adds (see `middleware.ts`/`layout.tsx` for how `pathname` reaches here).
 *
 * Exact match wins outright. Otherwise, the LONGEST `href` that is a real path-segment ancestor of `pathname`
 * wins (`pathname.startsWith(href + '/')`) — this is what keeps a detail route like `/staff/me/permissions`
 * (a sub-page under a nav item, not a nav item itself) highlighting `/staff/me`, not the broader `/staff`,
 * because `/staff/me` is both a real nav item AND the longer (more specific) ancestor match. A plain
 * `startsWith(href)` (no trailing slash) would be wrong: it would make `/staffing` match `/staff`.
 */
export function activeNavHref(pathname: string, items: readonly AdminNavItem[] = ADMIN_NAV): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const item of items) {
    if (pathname === item.href) return item.href; // exact match is unambiguous — return immediately
    if (pathname.startsWith(`${item.href}/`) && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}

/** The notice key a page shows when an admin-api read/write fails, derived from the HTTP status. A 403 means
 *  owner-perm / hardware-key / step-up was not satisfied → prompt re-auth; 401 → session expired; 404 → not found
 *  (callers usually prefer notFound()); anything else → a generic transient notice (degrade, never die). */
export type AdminNoticeKey = 'needsElevation' | 'unauthorized' | 'notFound' | 'unavailable';
export function adminNoticeKey(status: number | undefined): AdminNoticeKey {
  if (status === 403) return 'needsElevation';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  return 'unavailable';
}
