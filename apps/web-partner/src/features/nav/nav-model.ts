// apps/web-partner/src/features/nav/nav-model.ts · PURE, framework-free model for the partner-portal chrome +
// SDK-error→notice mapping. No React, no fetch → unit-tested. The nav is PERSONA-AWARE and — PC-56 PARTNER-2a (founder Q9, survey P2-B13) —
// KIND-AWARE: an INSURER organisation (`financial_partners.partner_kind = 'insurer'`, from `/me`) holding `partner.insurance.read` sees the
// insurer group (Dashboard · Products · Policies · Issuance · Premiums · Reports — PARTNER-2b; Parametric is linked from the dashboard and the
// products page, never the nav) and NEVER the lending group; a LENDER
// (`bank` / `nbfc` / `mfi` / `gold_loan`) holding `partner.applications.read` sees the lending group and never the insurer group; an asset
// manager (`amc`) sees neither vertical; an UNKNOWN kind (the `/me` read failed) keeps the lending group as before PARTNER-2 and never opens
// the insurer group by a guess. The Account group is for every partner person, last. Within a visible group, only routes that exist in this
// app (`live: true`) render as real links. Partner RBAC + RLS are enforced by the platform API per call — this nav never grants access.

/** PC-56 PARTNER-1a (founder D7): + `account` — Settings and Help (PARTNER-1b: + API keys, Webhooks, Readiness), visible to every partner person,
 *  rendered last under its own heading. PC-56 PARTNER-2a: the DEV-24 `insurance` group (keyed to the TENANT permission `insurance.manage`, which
 *  a partner token never carries — survey C-10) is replaced by `insurer`, keyed to the partner realm's `partner.insurance.read` AND the kind. */
export type NavGroup = 'common' | 'lending' | 'fleet' | 'insurer' | 'account';

export interface PartnerNavItem {
  href: string;
  /** i18n key for the label. */
  labelKey: string;
  /** which persona group this surface belongs to. */
  group: NavGroup;
  /** true once the route is built in this app (only then is it a real link). */
  live: boolean;
}

/** Permission strings that unlock each persona group (mirrors apps/api policies). `*` is the platform wildcard.
 *  PC-56 PARTNER-0: a session here is a PARTNER session — its token carries the partner realm's permissions (0225), never a tenant's
 *  `loan.manage`; the lending group opens on `partner.applications.read`. The fleet group stays keyed to a tenant permission a partner token
 *  never carries (its pages print "not yet available in the partner console" — features/partner/not-yet.ts).
 *  PC-56 PARTNER-2a: the insurer group opens on `partner.insurance.read` (0228 — every partner role) for an insurer organisation only. */
export const LENDING_PERM = 'partner.applications.read';
export const FLEET_PERM = 'logistics.manage';
export const INSURER_PERM = 'partner.insurance.read';
export const WILDCARD_PERM = '*';

/** The full partner surface map. Flip `live: true` as each wave ships its route (links only to built routes). */
export const PARTNER_NAV: readonly PartnerNavItem[] = [
  // the home of each console: a lender's dashboard (PARTNER-1a), an insurer's (PARTNER-2a) — an insurer landing on /dashboard is sent to its own
  { href: '/dashboard', labelKey: 'nav.dashboard', group: 'lending', live: true },
  { href: '/insurer/dashboard', labelKey: 'partner2.nav.dashboard', group: 'insurer', live: true },
  { href: '/insurer/products', labelKey: 'partner2.nav.products', group: 'insurer', live: true },
  { href: '/insurer/policies', labelKey: 'partner2.nav.policies', group: 'insurer', live: true },
  // PC-56 PARTNER-2b (founder 2b-4): + Issuance · Premiums · Reports. `/insurer/parametric` is NOT a nav item (the canon's insurer sidebar has
  // none — W262 is reached from the dashboard and the products page).
  { href: '/insurer/issuance', labelKey: 'partner2.nav.issuance', group: 'insurer', live: true },
  { href: '/insurer/premiums', labelKey: 'partner2.nav.premiums', group: 'insurer', live: true },
  { href: '/insurer/reports', labelKey: 'partner2.nav.reports', group: 'insurer', live: true },
  { href: '/notifications', labelKey: 'nav.notifications', group: 'common', live: true },
  { href: '/settlements', labelKey: 'nav.settlements', group: 'common', live: true },
  { href: '/consents', labelKey: 'nav.consents', group: 'common', live: true },
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
  // account (PC-56 PARTNER-1a · D7): built routes only — the canon's `account/settings` and the built `/help` (canon `account/help`, DELTA);
  // PARTNER-1b (D7): + the canon's `account/api`, `account/webhooks` and `onboarding/status` ("Readiness"). Help stays last.
  { href: '/account/settings', labelKey: 'partner1.nav.settings', group: 'account', live: true },
  { href: '/account/api', labelKey: 'partner1.nav.keys', group: 'account', live: true },
  { href: '/account/webhooks', labelKey: 'partner1.nav.webhooks', group: 'account', live: true },
  { href: '/onboarding/status', labelKey: 'partner1.nav.readiness', group: 'account', live: true },
  { href: '/help', labelKey: 'partner1.nav.help', group: 'account', live: true },
];

export type NavKind = 'insurer' | 'lender' | 'other' | 'unknown';
/** `financial_partners.partner_kind` → the console it belongs to (features/partner2/figures.ts partnerKindClass is the same rule). */
export function navKind(kind: string | null | undefined): NavKind {
  if (!kind) return 'unknown';
  if (kind === 'insurer') return 'insurer';
  if (kind === 'bank' || kind === 'nbfc' || kind === 'mfi' || kind === 'gold_loan') return 'lender';
  return 'other';
}

export function hasLending(perms: ReadonlySet<string>): boolean {
  return perms.has(LENDING_PERM) || perms.has(WILDCARD_PERM);
}
export function hasFleet(perms: ReadonlySet<string>): boolean {
  return perms.has(FLEET_PERM) || perms.has(WILDCARD_PERM);
}
export function hasInsurer(perms: ReadonlySet<string>): boolean {
  return perms.has(INSURER_PERM) || perms.has(WILDCARD_PERM);
}
/** Which persona groups this partner can see (the kind decides lending vs insurer; account always, last). The wildcard sees every group. */
export function visibleGroups(perms: ReadonlySet<string>, kind?: string | null): NavGroup[] {
  const k = navKind(kind);
  const all = perms.has(WILDCARD_PERM);
  const groups: NavGroup[] = ['common'];
  if (hasLending(perms) && (all || k === 'lender' || k === 'unknown')) groups.push('lending');
  if (hasFleet(perms)) groups.push('fleet');
  if (hasInsurer(perms) && (all || k === 'insurer')) groups.push('insurer');
  groups.push('account');
  return groups;
}
/** Nav items the partner may see at all (their persona groups), preserving map order. */
export function navForPartner(perms: ReadonlySet<string>, kind?: string | null, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  const groups = new Set(visibleGroups(perms, kind));
  return items.filter((i) => groups.has(i.group));
}
/** Built routes the partner may see — rendered as real links. */
export function liveNavForPartner(perms: ReadonlySet<string>, kind?: string | null, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  return navForPartner(perms, kind, items).filter((i) => i.live);
}
/** Not-yet-built routes in the partner's groups — rendered as non-link "(soon)" labels. */
export function soonNavForPartner(perms: ReadonlySet<string>, kind?: string | null, items: readonly PartnerNavItem[] = PARTNER_NAV): PartnerNavItem[] {
  return navForPartner(perms, kind, items).filter((i) => !i.live);
}
/** Where the brand mark (and a person after sign-in) goes: the insurer's dashboard for an insurer, the lender's otherwise. */
export function homeHref(kind: string | null | undefined): string {
  return navKind(kind) === 'insurer' ? '/insurer/dashboard' : '/dashboard';
}

/** Map an SDK error status to a localized notice key (degrade, never die). */
export function partnerNoticeKey(status?: number): 'forbidden' | 'unauthorized' | 'notFound' | 'unavailable' {
  if (status === 403) return 'forbidden';
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  return 'unavailable';
}
