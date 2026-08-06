// apps/web-partner/src/features/nav/nav-model.ts · PURE, framework-free model for the partner-portal chrome +
// SDK-error→notice mapping. No React, no fetch → unit-tested. The nav is PERSONA-AWARE: a lender (perm
// `loan.manage`) sees the Lending group; a logistics partner (perm `logistics.manage`) sees the Fleet group; the
// `*` wildcard sees both. Within a visible group, only routes that exist in this app (`live: true`) render as real
// links; not-yet-built surfaces render as a non-link "(soon)" label until their wave lands. Partner RBAC + RLS are
// enforced by the platform API per call — this nav reflects route existence + persona, never grants access.

export type NavGroup = 'common' | 'lending' | 'fleet' | 'insurance';

export interface PartnerNavItem {
  href: string;
  /** i18n key for the label. */
  labelKey: string;
  /** which persona group this surface belongs to. */
  group: NavGroup;
  /** true once the route is built in this app (only then is it a real link). */
  live: boolean;
}

/** Permission strings that unlock each persona group (mirrors apps/api policies). `*` is the platform wildcard. */
export const LENDING_PERM = 'loan.manage';
export const FLEET_PERM = 'logistics.manage';
/** Mirrors apps/api's InsurancePermissions.Manage (modules/insurance/policies/insurance.policies.ts) — the
 *  insurer-side console permission (request-documents/schedule-survey/record-survey/decide/settle/close +
 *  the read-only claims/policies lists). NOTE: unlike LENDING_PERM/FLEET_PERM, the API does not RLS-scope this
 *  to a specific insurance partner (see features/insurance/insurance.ts's header) — it is tenant-wide. */
export const INSURANCE_PERM = 'insurance.manage';
export const WILDCARD_PERM = '*';

/** The full partner surface map. Flip `live: true` as each wave ships its route (links only to built routes). */
export const PARTNER_NAV: readonly PartnerNavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard', group: 'common', live: true },
  { href: '/notifications', labelKey: 'nav.notifications', group: 'common', live: true },
  { href: '/settlements', labelKey: 'nav.settlements', group: 'common', live: true },
  { href: '/consents', labelKey: 'nav.consents', group: 'common', live: true },
  { href: '/help', labelKey: 'nav.help', group: 'common', live: true },
  // lending vertical (financial partners)
  { href: '/loan-queue', labelKey: 'nav.loanQueue', group: 'lending', live: true },
  { href: '/products', labelKey: 'nav.products', group: 'lending', live: true },
  { href: '/profile', labelKey: 'nav.lenderProfile', group: 'lending', live: true },
  { href: '/portfolio', labelKey: 'nav.portfolio', group: 'lending', live: true },
  { href: '/servicing', labelKey: 'nav.servicing', group: 'lending', live: true },   // PC-55 B7 (W54-8)
  // logistics vertical (3PL partners)
  { href: '/shipments', labelKey: 'nav.shipments', group: 'fleet', live: true },
  { href: '/fleet', labelKey: 'nav.fleetSetup', group: 'fleet', live: true },
  { href: '/zones', labelKey: 'nav.zones', group: 'fleet', live: true },
  { href: '/routes', labelKey: 'nav.routes', group: 'fleet', live: true },
  { href: '/cold-chain', labelKey: 'nav.coldChain', group: 'fleet', live: true },
  // insurance vertical (insurer partners, KV-BL-056/DEV-24)
  { href: '/insurance-claims', labelKey: 'nav.insuranceClaims', group: 'insurance', live: true },
  { href: '/insurance-policies', labelKey: 'nav.insurancePolicies', group: 'insurance', live: true },
  { href: '/insurance-products', labelKey: 'nav.insuranceProducts', group: 'insurance', live: true },
  { href: '/insurance-book', labelKey: 'nav.insuranceBook', group: 'insurance', live: true },   // PC-55 B7 (W54-9)
];

export function hasLending(perms: ReadonlySet<string>): boolean {
  return perms.has(LENDING_PERM) || perms.has(WILDCARD_PERM);
}
export function hasFleet(perms: ReadonlySet<string>): boolean {
  return perms.has(FLEET_PERM) || perms.has(WILDCARD_PERM);
}
export function hasInsurance(perms: ReadonlySet<string>): boolean {
  return perms.has(INSURANCE_PERM) || perms.has(WILDCARD_PERM);
}
/** Which persona groups this partner can see (common is always visible). */
export function visibleGroups(perms: ReadonlySet<string>): NavGroup[] {
  const groups: NavGroup[] = ['common'];
  if (hasLending(perms)) groups.push('lending');
  if (hasFleet(perms)) groups.push('fleet');
  if (hasInsurance(perms)) groups.push('insurance');
  return groups;
}
/** Nav items the partner may see at all (their persona groups), preserving map order. */
export function navForPartner(perms: ReadonlySet<string>, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  const groups = new Set(visibleGroups(perms));
  return items.filter((i) => groups.has(i.group));
}
/** Built routes the partner may see — rendered as real links. */
export function liveNavForPartner(perms: ReadonlySet<string>, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  return navForPartner(perms, items).filter((i) => i.live);
}
/** Not-yet-built routes in the partner's groups — rendered as non-link "(soon)" labels. */
export function soonNavForPartner(perms: ReadonlySet<string>, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  return navForPartner(perms, items).filter((i) => !i.live);
}

/** Map an SDK error status to a localized notice key (degrade, never die). */
export function partnerNoticeKey(status?: number): 'forbidden' | 'unauthorized' | 'notFound' | 'unavailable' {
  if (status === 403) return 'forbidden';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  return 'unavailable';
}
