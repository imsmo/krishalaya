// apps/web-tenant/src/features/people/roster.ts · pure query/link/validation logic for the PEOPLE roster (W153) and
// member detail (W154). No React, no I/O — so every rule below is unit-tested rather than clicked.
//
// **THIS IS THE `/people` ROUTE, NOT `/members`.** `/members` renders PC-28's paid membership-TIER manager (tiers, fees,
// subscribe): a different object that happens to share a word. Renaming that route would break every link and bookmark
// already pointing at it, so the people register takes its own path and both pages cross-link, which is the only way a
// staff member hunting for "members" lands somewhere useful either way.

/** The roles W153 offers as filter chips. A CLOSED list: an arbitrary role code in the URL must not become a query. */
export const ROSTER_ROLE_FILTERS = ['farmer', 'pashupalak', 'dairy_farmer', 'worker', 'ambassador'] as const;
/** The KYC states W153 filters on, and the ones `user_tenant_roles.kyc_status` actually holds (the `kyc_status` enum). */
export const ROSTER_KYC_FILTERS = ['pending', 'verified', 'expired', 'rejected', 'none'] as const;
/** W153's "Rows: 25 · 50 · 100". */
export const ROSTER_PAGE_SIZES = [25, 50, 100] as const;
/** W153's chip says "dormant > 60d"; the census tile uses the same 60. One number, named once. */
export const DORMANT_DAYS = 60;

/**
 * The role codes this console has a translated label for (seeded in db/seeds/core/0004).
 *
 * **ROLES ARE DYNAMIC DATA (Law 6), SO THIS LIST CANNOT BE EXHAUSTIVE AND MUST NOT PRETEND TO BE.** A tenant in
 * Bangladesh with a role code nobody here has seen renders the RAW CODE rather than the string `people.role.<code>` —
 * the translator returns its own key on a miss, and a table cell reading "people.role.jute_grower" is worse than one
 * reading "jute_grower". Rule zero: a hard-coded role list must not block a country.
 */
export const LABELLED_ROLE_CODES = [
  'farmer', 'pashupalak', 'dairy_farmer', 'worker', 'sardar', 'ambassador', 'vyapari',
  'organic_store', 'pharma_store', 'fpo_coordinator', 'tenant_admin', 'tenant_staff', 'auditor',
  'delivery_partner', 'equipment_owner', 'vet', 'customer', 'instructor', 'support_agent',
  'banker', 'insurance_agent', 'gov_officer',
] as const;

export function hasRoleLabel(code: string): boolean {
  return (LABELLED_ROLE_CODES as readonly string[]).includes(code);
}

/** Same rule for KYC states: the five the `kyc_status` enum holds are labelled, anything else prints itself. */
export function hasKycLabel(status: string): boolean {
  return (ROSTER_KYC_FILTERS as readonly string[]).includes(status);
}

export interface RosterFilters {
  q?: string;
  roleCode?: string;
  kycStatus?: string;
  dormantDays?: number;
  cursor?: string;
  limit: number;
}

export type RawParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  const trimmed = s?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Read the URL into a query the SDK can send.
 *
 * **EVERY VALUE IS CHECKED AGAINST A CLOSED LIST OR DROPPED.** The API validates too (zod, `.strict()`), but a console
 * that forwards `?roleCode=<anything>` turns a typo into a 400 the user has to decode and turns a hostile string into a
 * probe. Dropping an unrecognised filter shows the unfiltered roster, which is a correct answer to a broken URL.
 *
 * The free-text search is the one field that CANNOT be validated against a list — it is a name, in Gujarati or Hindi or
 * English — so it is length-capped and passed as data, never as SQL: the API parameterises it (`ILIKE $n`).
 */
export function parseRosterFilters(params: RawParams): RosterFilters {
  const role = one(params.role);
  const kyc = one(params.kyc);
  const size = Number(one(params.rows));
  return {
    q: one(params.q)?.slice(0, 80),
    roleCode: (ROSTER_ROLE_FILTERS as readonly string[]).includes(role ?? '') ? role : undefined,
    kycStatus: (ROSTER_KYC_FILTERS as readonly string[]).includes(kyc ?? '') ? kyc : undefined,
    // The chip is a toggle, so any truthy value means "on" and the WINDOW is ours, not the URL's — a caller cannot ask
    // for "dormant > 2 days" and make every member on the platform look dormant to whoever reads the screen.
    dormantDays: one(params.dormant) === '1' ? DORMANT_DAYS : undefined,
    cursor: one(params.cursor)?.slice(0, 200),
    limit: (ROSTER_PAGE_SIZES as readonly number[]).includes(size) ? size : ROSTER_PAGE_SIZES[0],
  };
}

/**
 * A roster URL with one thing changed.
 *
 * **CHANGING A FILTER DROPS THE CURSOR, ALWAYS.** A keyset cursor is a position in ONE ordered result set: carrying
 * `cursor=<Meera Ben J.>` across a switch to "kyc: pending" would silently skip every pending member sorted before her
 * and present the remainder as the whole answer. Only an explicit `cursor` change keeps a cursor — which is exactly the
 * Next-page link.
 */
export function rosterHref(
  current: RosterFilters,
  // `cursor` is Omit-ed out of the Partial before being re-declared: intersecting `cursor?: string` with
  // `cursor?: string | null` collapses to `string`, which would make `{ cursor: null }` — the "back to page one" link —
  // a type error rather than the explicit reset it is.
  change: Partial<Omit<RosterFilters, 'cursor'>> & { cursor?: string | null },
): string {
  const changingFilter = ['q', 'roleCode', 'kycStatus', 'dormantDays', 'limit']
    .some((k) => Object.prototype.hasOwnProperty.call(change, k));
  const next: RosterFilters = { ...current, ...change } as RosterFilters;
  const cursor = changingFilter ? undefined : (change.cursor === null ? undefined : (change.cursor ?? current.cursor));

  const sp = new URLSearchParams();
  if (next.q) sp.set('q', next.q);
  if (next.roleCode) sp.set('role', next.roleCode);
  if (next.kycStatus) sp.set('kyc', next.kycStatus);
  if (next.dormantDays) sp.set('dormant', '1');
  if (next.limit !== ROSTER_PAGE_SIZES[0]) sp.set('rows', String(next.limit));
  if (cursor) sp.set('cursor', cursor);
  const qs = sp.toString();
  return qs ? `/people?${qs}` : '/people';
}

/** True when any filter narrows the roster — the console uses it to decide between "no members yet" (W153's empty
 *  state, which invites a bulk import) and "nothing matched", which are different messages to a different reader. */
export function isFiltered(f: RosterFilters): boolean {
  return Boolean(f.q || f.roleCode || f.kycStatus || f.dormantDays);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE REVEAL FORM                                                                                               */
/* ------------------------------------------------------------------------------------------------------------ */

/** Mirrors `MIN_REASON_LENGTH` in `apps/api/.../member-pii.service.ts`. The SERVER is the control; this is only so a
 *  staff member learns the rule before they lose their typing to a round trip. */
export const MIN_REVEAL_REASON = 20;

export type RevealBuild =
  | { ok: true; value: { field: 'phone' | 'email' | 'aadhaar_last4'; reason: string } }
  | { ok: false; error: 'field' | 'reason' };

/**
 * Validate a reveal request.
 *
 * **THE REASON IS TRIMMED BEFORE IT IS MEASURED**, so twenty spaces is not a reason — the same rule the server applies,
 * and the trimmed text is what gets sent, so the audit row does not store the whitespace somebody happened to paste.
 */
export function buildReveal(raw: { field?: string; reason?: string }): RevealBuild {
  const field = raw.field ?? '';
  if (field !== 'phone' && field !== 'email' && field !== 'aadhaar_last4') return { ok: false, error: 'field' };
  const reason = (raw.reason ?? '').trim();
  if (reason.length < MIN_REVEAL_REASON) return { ok: false, error: 'reason' };
  return { ok: true, value: { field, reason } };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* W154's TILES                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * How W154's trust tile reads with only the real record behind it.
 *
 * There is no trust score on this platform, so the tile shows the DISPUTE RECORD it was summarising. The three cases are
 * distinct on purpose: a member with no disputes at all has not been tested, and printing "clean" over an empty record
 * would flatter somebody who simply has not sold anything yet.
 */
export function disputeRecordKey(g: { disputesAgainst: number; disputesAgainstUpheld: number; disputesOpen: number }):
  'none' | 'clean' | 'open' | 'upheld' {
  if (g.disputesOpen > 0) return 'open';
  if (g.disputesAgainst === 0) return 'none';
  return g.disputesAgainstUpheld === 0 ? 'clean' : 'upheld';
}

/** Percent for a census tile, floored, and **null rather than 0 when there is nothing to divide by** — a brand-new
 *  organisation showing "0% verified" reads as a failure when the truth is that it has no members yet. */
export function sharePct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.floor((part / whole) * 100);
}
