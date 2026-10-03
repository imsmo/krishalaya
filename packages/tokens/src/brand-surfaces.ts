// @krishalaya/tokens · brand-surfaces.ts — PC-56 TENANT-13d · WHERE A TENANT BRAND MAY GO, AND WHERE THE PLATFORM MARK STAYS.
//
// Canon W191, the coverage list:
//   ＝ "“Powered by Krishalaya” stays (small, honest)"
//   ＝ "Trust surfaces (escrow, KYC, disputes) keep platform marks — trust is not re-brandable"
//   ＝ "SMS sender ID stays DLT-registered"
// Founder decision (brief_t13d A5): the small "Powered by Krishalaya" mark is on every member-facing surface; a tenant may remove it ONLY
// with the plan feature `white_label_unbranded` (read for real by the API), and NEVER on a trust surface — the list below is the ONE
// constant every renderer consults (API, storefront, console preview). It is pinned by tests in packages/ui and the API.
//
// DEV-27 (Q23, founder ruling 2026-07-22): every billing DOCUMENT header carries the tenant's name AND the platform mark — "never one
// without the other". Settlement statements and tax invoices are therefore listed as trust surfaces here: the plan feature does not
// remove the mark from a document either.

/** The platform's own words for the mark. A brand literal kept in ONE place (not deleted — brief: "the brand mark list"). */
export const PLATFORM_BRAND = Object.freeze({
  name: 'Krishalaya',
  /** The storefront's platform-level app name, shown ONLY when no tenant is resolved (the platform's own pages). */
  platformStoreName: 'Krishalaya Store',
  poweredByMark: 'Powered by Krishalaya',
});

export const TRUST_SURFACES = Object.freeze([
  'escrow',              // checkout / pay / order escrow status
  'kyc',                 // identity verification
  'disputes',            // disputes and returns
  'ledger_receipts',     // wallet statements, payment receipts
  'settlement_statements', // DEV-27: billing documents keep both marks
  'tax_invoices',          // DEV-27
] as const);
export type TrustSurface = (typeof TRUST_SURFACES)[number];

export const BRANDABLE_SURFACES = Object.freeze([
  'storefront',          // the tenant's storefront pages
  'member_app',          // app name, icon, colours (PWA manifest / metadata)
  'notifications',       // notification sender name inside the app (SMS sender ID is NOT this — it stays DLT-registered)
] as const);
export type BrandableSurface = (typeof BRANDABLE_SURFACES)[number];
export type BrandSurface = TrustSurface | BrandableSurface;

export function isTrustSurface(s: string): s is TrustSurface {
  return (TRUST_SURFACES as readonly string[]).includes(s);
}

/**
 * Does this surface show "Powered by Krishalaya"?
 *   • a trust surface — ALWAYS (whatever the plan, whatever the tenant chose);
 *   • otherwise — unless the tenant chose to hide it AND its plan currently includes `white_label_unbranded`.
 * A lapsed plan brings the mark back by itself: `planAllowsRemoval` is read at render time, never stored as a permission.
 */
export function showsPoweredBy(surface: BrandSurface, tenantChoseToHide: boolean, planAllowsRemoval: boolean): boolean {
  if (isTrustSurface(surface)) return true;
  return !(tenantChoseToHide && planAllowsRemoval);
}

/** The SMS sender ID is a DLT registration (msg91), never a brand field: a fact the console prints, stated here as data. */
export const SMS_SENDER_IS_DLT_REGISTERED = true as const;
