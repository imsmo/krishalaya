// modules/partner-console/domain/partner-claims.rules.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — FACTS, NEVER A CLAIMANT — the
// PURE pieces (no I/O).
//
// Founder Q4 (2026-10-18): an insurer sees CLAIM FACTS on ITS OWN PRODUCTS only — the claim reference (its id: there is no claim number), the
// policy reference (number or none yet), the product, the FPO's PUBLIC name, the subject TYPE, the event type CODE (a platform `claim_event`
// value, else not recorded), the event date, "reported within 72 hours" as a recorded yes/no, the status, the approved amount AS RECORDED, the
// filed / last changed / closed times and the survey's damage percentage (a number) when recorded. NEVER `claimant_user_id`, a name, a phone,
// the description, any media, the surveyor, the survey notes, a vet certificate, the payout id, a village or parcel, `created_by` /
// `updated_by`. 0230's definers never return those columns; `projectClaim` below is the second wall: it BUILDS each output field by field from
// an allow-list, so an identity column that ever reached a row (a definer widened by mistake — mutant M3) still cannot reach a response.
// The console never returns the claim's `tenantId`: the FPO is named by its public display name only, in the field `fpoName`.
//
// Money: bigint minor-unit STRINGS (Law 2); counts: integers; no float, no ratio, no percentage except the recorded damage figure.
// The FY window: April–March in Asia/Kolkata, ANSWERED BY THE DATABASE (`FY_WINDOW_SQL`, the 1a month-boundary pattern); `fyWindow(now)` is the
// same rule in TypeScript, unit-tested at its boundaries and used to label a window.
import { CLAIM_STATUSES, type ClaimStatus } from '../../insurance/domain/insurance-claim.state';
import { pgDateOrNull } from '../../../core/database/pg-date';

/** The statuses an insurer may filter its claims by — the state machine's own list (insurance-claim.state.ts), never invented. */
export const PARTNER_CLAIM_STATUSES: readonly ClaimStatus[] = CLAIM_STATUSES;
export const isPartnerClaimStatus = (v: unknown): v is ClaimStatus => typeof v === 'string' && (CLAIM_STATUSES as readonly string[]).includes(v);
/** A claim is OPEN (still waiting on somebody) until it is rejected, paid or closed. `approved` stays open: nothing pays it (founder Q1). */
export const CLOSED_CLAIM_STATUSES: readonly ClaimStatus[] = ['rejected', 'paid', 'closed'];
export const isOpenClaim = (s: string) => isPartnerClaimStatus(s) && !CLOSED_CLAIM_STATUSES.includes(s);

/** Property names that never leave the partner realm's claims read (the deep-key wall the live spec and the unit spec both assert). */
export const CLAIM_IDENTITY_FIELDS = Object.freeze([
  'claimantUserId', 'claimant_user_id', 'claimant', 'description', 'surveyorUserId', 'surveyor_user_id', 'surveyor', 'surveyReport', 'survey_report',
  'notes', 'note', 'payoutId', 'payout_id', 'tenantId', 'tenant_id', 'createdBy', 'created_by', 'updatedBy', 'updated_by', 'phone', 'name',
  'holderUserId', 'holder_user_id', 'subjectId', 'subject_id', 'media', 'evidence', 'vetCertRef', 'village', 'parcel',
] as const);

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const minorOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return /^-?\d+$/.test(s) ? BigInt(s).toString() : null;
};
const DAY_MS = 86_400_000;

/** Whole days a claim has waited: from its filing (`created_at`) to the read's `computedAt`; null once it is rejected, paid or closed. */
export function waitingDays(createdAt: string | null, computedAt: string, status: string): number | null {
  if (!createdAt || !isOpenClaim(status)) return null;
  const a = Date.parse(createdAt); const b = Date.parse(computedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

export interface PartnerClaimView {
  /** The claim's id — the claim REFERENCE (there is no claim number on the platform; the console prints its short form). */
  id: string;
  policyId: string;
  /** NULL on every activated policy today (no insurer issues on the platform — 2a founder Q5): "no policy number yet". */
  policyNo: string | null;
  productId: string;
  productName: string | null;
  /** The FPO's PUBLIC display name (0204's `public_tenant_profile`), or null for a non-live organisation — never its id. */
  fpoName: string | null;
  subjectType: string;
  /** The POLICY's sum insured (bigint minor-unit string). */
  sumInsuredMinor: string;
  /** A platform `claim_event` code (drought … accident), or null: "not recorded". */
  eventTypeCode: string | null;
  eventDate: string | null;
  status: string;
  /** The recorded yes / no (computed once at filing) — a late report is recorded; nothing rejects a claim for it. Null if never recorded. */
  reportedWithin72h: boolean | null;
  /** The approved amount AS RECORDED by the desk's decision (bigint minor-unit string), or null — never "paid". */
  approvedMinor: string | null;
  /** The survey's damage percentage (a whole number 0–100) when recorded — the ONE number of the survey an insurer sees. */
  damagePercent: number | null;
  filedAt: string | null;
  lastChangedAt: string | null;
  closedAt: string | null;
  /** Whole days since filing, for an open claim; null once rejected / paid / closed. */
  waitingDays: number | null;
}

/** One claim row (as 0230's definer answers it, snake or camel) → the view. Field by field from the allow-list; nothing else passes. */
export function projectClaim(row: Record<string, unknown>, names: { fpoName: string | null; productName: string | null }, computedAt: string): PartnerClaimView {
  const status = String(row.status ?? '');
  const filedAt = str(row.created_us) ?? iso(row.created_at ?? row.createdAt);
  const dp = row.damage_percent ?? row.damagePercent;
  const w = row.intimated_within_72h ?? row.intimatedWithin72h;
  return {
    id: String(row.id),
    policyId: String(row.policy_id ?? row.policyId),
    policyNo: str(row.policy_no ?? row.policyNo),
    productId: String(row.product_id ?? row.productId),
    productName: names.productName,
    fpoName: names.fpoName,
    subjectType: String(row.subject_type ?? row.subjectType ?? ''),
    sumInsuredMinor: minorOrNull(row.sum_insured_minor ?? row.sumInsuredMinor) ?? '0',
    eventTypeCode: str(row.event_type_code ?? row.eventTypeCode),
    eventDate: pgDateOrNull(row.event_date ?? row.eventDate),
    status,
    reportedWithin72h: typeof w === 'boolean' ? w : null,
    approvedMinor: minorOrNull(row.approved_minor ?? row.approvedMinor),
    damagePercent: Number.isInteger(dp) && (dp as number) >= 0 && (dp as number) <= 100 ? (dp as number) : null,
    filedAt,
    lastChangedAt: iso(row.updated_at ?? row.updatedAt),
    closedAt: iso(row.closed_at ?? row.closedAt),
    waitingDays: waitingDays(filedAt, computedAt, status),
  };
}

// ── the FY window (April–March, Asia/Kolkata) ───────────────────────────────────────────────────────────────────────────────────────────
/** The current FY's first and next-first day in IST, answered by the DATABASE from now() — no application clock (the 1a pattern). */
export const FY_WINDOW_SQL = `
  WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today),
       y AS (SELECT CASE WHEN extract(month FROM today) >= 4 THEN extract(year FROM today)::int ELSE extract(year FROM today)::int - 1 END AS y FROM d)
  SELECT make_date(y, 4, 1)::text AS fy_from, make_date(y + 1, 4, 1)::text AS fy_to FROM y`;
export const FY_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;   // Asia/Kolkata has no daylight saving: UTC+05:30 all year

/** The FY (April 1 → the next April 1, IST calendar days) that contains `now`. Same rule as FY_WINDOW_SQL. */
export function fyWindow(now: Date): { from: string; to: string; label: string } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-04-01`, label: fyLabel(`${y}-04-01`, `${y + 1}-04-01`) as string };
}
/** "2026-27" for [2026-04-01, 2027-04-01); null for any other window (a custom from / to). */
export function fyLabel(from: string, to: string): string | null {
  const m = /^(\d{4})-04-01$/.exec(from);
  if (!m || to !== `${Number(m[1]) + 1}-04-01`) return null;
  return `${m[1]}-${String((Number(m[1]) + 1) % 100).padStart(2, '0')}`;
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A window a caller may ask for: two real calendar days, from < to, at most 400 days apart. */
export function validWindow(from: string, to: string): boolean {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return false;
  const a = Date.parse(`${from}T00:00:00Z`); const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return false;
  return a < b && b - a <= 400 * DAY_MS;
}

// ── the counts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One row of `partner_insurance_claim_counts(from, to)` on one shard. */
export interface ClaimCountRow { product_id: string; status: string; event_type_code: string | null; n: string | number }
export const NOT_RECORDED = 'not_recorded';

export interface PartnerClaimCounts {
  /** The window: IST calendar days, [from, to). */
  from: string; to: string; timeZone: string;
  /** "2026-27" when the window is an FY, else null. */
  fy: string | null;
  total: number;
  /** Every claim status of the machine, 0 when none. */
  byStatus: Record<string, number>;
  /** By platform `claim_event` code, plus `not_recorded` — 0 when none. */
  byEvent: Record<string, number>;
  /** DECIDED COUNTS by current status (founder E10: counts, never a rate). */
  decided: { approved: number; partiallyApproved: number; rejected: number };
  computedAt: string;
}

/** Merge the shards' rows: counts add; every status of the machine present; an event code the definer did not resolve counts as not recorded. */
export function mergeClaimCounts(rows: readonly ClaimCountRow[], window: { from: string; to: string }, computedAt: string): PartnerClaimCounts {
  const byStatus: Record<string, number> = Object.fromEntries(CLAIM_STATUSES.map((s) => [s, 0]));
  const byEvent: Record<string, number> = { [NOT_RECORDED]: 0 };
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    if (!Number.isInteger(n) || n < 0) continue;
    total += n;
    if (isPartnerClaimStatus(r.status)) byStatus[r.status] += n;
    const code = r.event_type_code && /^[a-z][a-z_]{0,59}$/.test(r.event_type_code) ? r.event_type_code : NOT_RECORDED;
    byEvent[code] = (byEvent[code] ?? 0) + n;
  }
  return {
    from: window.from, to: window.to, timeZone: FY_TIME_ZONE, fy: fyLabel(window.from, window.to), total, byStatus, byEvent,
    decided: { approved: byStatus.approved, partiallyApproved: byStatus.partially_approved, rejected: byStatus.rejected },
    computedAt,
  };
}
