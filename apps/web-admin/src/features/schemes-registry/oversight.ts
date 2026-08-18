// apps/web-admin/src/features/schemes-registry/oversight.ts · PURE, framework-free helpers for the scheme OVERSIGHT
// plane (PC-56 ADMIN-4b: W074 applications, W076 DBT, W078 performance). No fetch, no React → unit-tested.
//
// NOTHING HERE MASKS ANYTHING. The mask is applied server-side in admin-api, and the raw name and phone never reach
// this process — which is the point: a console-side mask is a mask that already travelled over the wire and through a
// log line. What this module does is make sure the screen never overstates what the numbers mean.
//
// DEV-60 (UI Port Program batch 3, Part 1, slice B): the 2 `kv-status`-returning helpers below (eligibilityClass/
// bounceClass) now return a `StatusTone` per the founder's pill-vs-text ruling (`spec_dev60.md` CONTINUATION
// block) — disposition (c), domain logic stays.

import type { StatusTone } from '@krishalaya/ui';

/* ===================== W074 · the pipeline ===================== */

export const APPLICATION_STATES = [
  'draft', 'submitted', 'under_verification', 'clarification_needed', 'approved', 'disbursed', 'closed', 'rejected', 'appealed',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export function isApplicationState(v: string | null | undefined): v is ApplicationState {
  return (APPLICATION_STATES as readonly string[]).includes((v ?? '').trim());
}

export interface MaskedApplicant { userId: string; nameMasked: string | null; phoneMasked: string | null; masked: boolean }

export interface ApplicationRow {
  id: string;
  tenantId: string; tenantName: string | null;
  schemeId: string; schemeCode: string; schemeName: string;
  schemeVersion: number; schemeVersionResolvable: boolean;
  status: string; statusClass: string;
  applicant: MaskedApplicant;
  assistedBy: string | null; assisted: boolean;
  govtAppRef: string | null;
  eligibility: EligibilityView; needsHumanLook: boolean;
  rejectionReasonCode: string | null;
  submittedAt: string | null; decidedAt: string | null; createdAt: string | null;
}

export type EligibilityView =
  | { kind: 'scored'; eligible: boolean; score: number }
  | { kind: 'unscored'; eligible: boolean }
  | { kind: 'never_checked' };

/** The AI-check cell. THREE outcomes and the third is the important one: a row with no check is not "ineligible" and
 *  not 0.00 — it is an application nobody ran a check against, which is a fact about our pipeline, not the farmer. */
export function eligibilityLabel(v: EligibilityView): { key: string; score: string | null } {
  switch (v.kind) {
    case 'scored': return { key: v.eligible ? 'eligible' : 'ineligible', score: v.score.toFixed(2) };
    case 'unscored': return { key: v.eligible ? 'eligibleUnscored' : 'ineligibleUnscored', score: null };
    default: return { key: 'neverChecked', score: null };
  }
}
/** `never_checked` is MUTED, not red. Nobody did anything wrong; the check simply never ran, and a wall of red against
 *  historical rows trains an operator to stop reading red. A LOW score IS a warning — that is the row the canon routes
 *  to an ambassador. */
export function eligibilityTone(v: EligibilityView): StatusTone {
  if (v.kind === 'never_checked') return 'neutral';
  if (v.kind === 'unscored') return v.eligible ? 'success' : 'neutral';
  if (!v.eligible) return 'neutral';
  return v.score < 0.7 ? 'warning' : 'success';
}

export type StateCounts = Partial<Record<ApplicationState, number>>;

/** The chip number, or null to render NO number.
 *
 *  This is the whole reason the function exists. The counts query can fail on its own (Law 12), and a chip reading
 *  "0" beside a tab holding 1,842 applications makes an operator skip the tab. An ABSENT key means unknown; a present
 *  0 means the aggregate really counted zero. Those must render differently.
 */
export function chipCount(counts: StateCounts | null | undefined, s: ApplicationState): number | null {
  if (!counts) return null;
  const n = counts[s];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Total for the "All" chip. Null when we know nothing at all, so it can be blank rather than 0. */
export function totalChip(counts: StateCounts | null | undefined): number | null {
  if (!counts) return null;
  const vals = APPLICATION_STATES.map((s) => counts[s]).filter((v): v is number => typeof v === 'number');
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
}

/** ADMIN-4's version pointer, as a label. An application whose rules cannot be retrieved is flagged, because a
 *  grievance officer looking at a refusal needs to know when the platform cannot show them the rule it was refused
 *  under. Silence here would read as "the rules are fine". */
export function rulesRecoverable(r: Pick<ApplicationRow, 'schemeVersionResolvable'>): boolean {
  return r.schemeVersionResolvable === true;
}

/* ===================== the unmask request ===================== */

/** Ten characters, matching the server. Validated here so a too-short reason never leaves the browser — and with its
 *  own error key, because an operator told only "invalid" will pad the field rather than explain themselves. */
export const UNMASK_REASON_MIN = 10;
export type UnmaskResult = { ok: true; value: { reason: string } } | { ok: false; error: 'reasonTooShort' | 'reasonTooLong' };
export function buildUnmask(raw: { reason?: string }): UnmaskResult {
  const reason = (raw.reason ?? '').trim();
  if (reason.length < UNMASK_REASON_MIN) return { ok: false, error: 'reasonTooShort' };
  if (reason.length > 500) return { ok: false, error: 'reasonTooLong' };
  return { ok: true, value: { reason } };
}

/* ===================== W076 · DBT ===================== */

export interface DbtTile { creditsObserved: number; amountMinor: string; farmers: number; lastCreditedOn: string | null }
export interface NotifyGap { available: boolean; reason?: string; missing?: readonly string[] }

/** A minor-unit total as text with the unit named. NEVER divided, NEVER parsed — the same rule as the scheme fee, and
 *  it matters more here: these are lakhs of rupees of government money and `Number()` on a 15-digit paise sum is a
 *  rounding error in a figure somebody will put in a report. */
export function minorText(minor: string | null | undefined): string {
  const s = (minor ?? '').trim();
  if (!s || !/^[0-9]{1,30}$/.test(s)) return '—';
  return `${s} minor units`;
}

/** Whether a per-transfer notification state can be shown at all. FALSE today: nothing notifies a farmer on credit
 *  observation, so a tick or a cross would both be inventions. */
export function notificationKnown(meta: { notificationStateAvailable?: boolean } | null | undefined): boolean {
  return meta?.notificationStateAvailable === true;
}

/** The instalment ordinal — "20th instalment". Null in, null out: a scheme that does not number its instalments must
 *  not be shown a "1st". */
export function instalmentLabel(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  const rem100 = n % 100;
  const suffix = rem100 >= 11 && rem100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Bounce reason styling. `open` bounces are the actionable ones; a fully resolved reason is not a live problem. */
export function bounceTone(open: number, total: number): StatusTone {
  if (!Number.isFinite(total) || total <= 0) return 'neutral';
  return open > 0 ? 'danger' : 'success';
}

/** The Aadhaar-seeding tile. NULL when the bounce aggregate reported no such reason at all — which is not the same as
 *  zero seeding failures, and the console says so rather than printing a reassuring 0. */
export function seedingText(s: { open: number; total: number } | null | undefined): { known: boolean; open: number; total: number } {
  return s ? { known: true, open: s.open, total: s.total } : { known: false, open: 0, total: 0 };
}

/* ===================== W078 · performance ===================== */

export interface Rate { pct: number | null; numerator: number; denominator: number; lowSample: boolean }

/** How to render a rate. FOUR outcomes, and the two middle ones are the ones a naive `${pct}%` gets wrong:
 *    unknown   — no denominator at all. Blank, not 0%.
 *    lowSample — a real percentage over too few rows. The COUNTS are shown instead; the number is still true, it just
 *                stops being a rate, and "78%" over nine applications is a decision waiting to be made badly.
 *    pct       — the normal case.
 */
export type RateView =
  | { kind: 'unknown' }
  | { kind: 'lowSample'; numerator: number; denominator: number }
  | { kind: 'pct'; pct: number; numerator: number; denominator: number };

export function rateView(r: Rate | null | undefined): RateView {
  if (!r || r.pct === null || !Number.isFinite(r.pct) || r.denominator <= 0) return { kind: 'unknown' };
  if (r.lowSample) return { kind: 'lowSample', numerator: r.numerator, denominator: r.denominator };
  return { kind: 'pct', pct: r.pct, numerator: r.numerator, denominator: r.denominator };
}

export type Duration =
  | { kind: 'days'; days: number; sampleSize: number }
  | { kind: 'none_disbursed' }
  | { kind: 'untimeable'; disbursals: number };

/** The median-time tile. `none_disbursed` is NOT "0 days" — the fastest possible number would be rendered for the
 *  slowest possible reality, which is that no farmer has been paid yet. */
export function durationKey(d: Duration | null | undefined): 'days' | 'noneDisbursed' | 'untimeable' | 'unknown' {
  if (!d) return 'unknown';
  if (d.kind === 'days') return 'days';
  if (d.kind === 'none_disbursed') return 'noneDisbursed';
  return 'untimeable';
}

export interface RejectionSlice { code: string; n: number; pctOfCoded: number | null; fixable: boolean }
export interface RejectionBreakdown {
  slices: RejectionSlice[]; coded: number; uncoded: number; totalRejections: number; coverage: Rate;
}

/** Is the rejection breakdown worth drawing as a chart at all?
 *
 *  THE NUMBER THAT DECIDES IT IS COVERAGE, NOT VOLUME. Ten thousand rejections of which 300 are coded still cannot
 *  say where to send ambassadors. Below the floor the console shows the counts and the coverage warning INSTEAD of the
 *  percentages, because a founder allocates people against whatever is on this panel.
 */
export const COVERAGE_FLOOR_PCT = 50;
export function breakdownTrustworthy(b: RejectionBreakdown | null | undefined): boolean {
  if (!b || b.coded <= 0) return false;
  const pct = b.coverage?.pct;
  return typeof pct === 'number' && pct >= COVERAGE_FLOOR_PCT;
}

/** Bar width for a slice, guarding divide-by-zero — the ADMIN-3c lesson, and the same class (`kv-bar`) that had gone
 *  unstyled for three waves before ADMIN-3c caught it. */
export function sliceWidthPct(n: number, coded: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(coded) || coded <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / coded) * 100)));
}

/** Fixable slices first, then the rest — each group keeping the server's order, which is remedy order rather than
 *  frequency order. A chart that reorders itself as the data moves is a chart nobody learns to read. */
export function orderedSlices(b: RejectionBreakdown): RejectionSlice[] {
  return [...b.slices.filter((s) => s.fixable), ...b.slices.filter((s) => !s.fixable)];
}

/** The headline's attribution. Rendered beside the number, never omitted: "₹38.2 Cr facilitated" with no basis is a
 *  claim somebody will have to defend in a room. */
export interface BenefitTotal {
  amountMinor: string; transfers: number; attributionBasis: string;
  unattributedTransfers: number; unattributedAmountMinor: string;
}
export function hasUnattributed(b: BenefitTotal | null | undefined): boolean {
  return !!b && b.unattributedTransfers > 0;
}

/* ===================== exports ===================== */

export const OVERSIGHT_EXPORT_REPORTS = ['applications', 'dbt_credits', 'dbt_bounces', 'rejections'] as const;
export type OversightExportReport = (typeof OVERSIGHT_EXPORT_REPORTS)[number];
export function isOversightExportReport(v: string | null | undefined): v is OversightExportReport {
  return (OVERSIGHT_EXPORT_REPORTS as readonly string[]).includes((v ?? '').trim());
}
export type BuildOversightExportResult =
  | { ok: true; value: { report: OversightExportReport; limit?: number; days?: number; status?: string; schemeId?: string; assistedOnly?: string } }
  | { ok: false; error: 'report' | 'limit' | 'days' | 'status' };
export function buildOversightExport(raw: { report?: string; limit?: string; days?: string; status?: string; schemeId?: string; assistedOnly?: string }): BuildOversightExportResult {
  const report = (raw.report ?? '').trim();
  if (!isOversightExportReport(report)) return { ok: false, error: 'report' };
  const out: { report: OversightExportReport; limit?: number; days?: number; status?: string; schemeId?: string; assistedOnly?: string } = { report };

  const limit = (raw.limit ?? '').trim();
  if (limit) {
    if (!/^[0-9]{1,5}$/.test(limit) || Number(limit) < 1 || Number(limit) > 20000) return { ok: false, error: 'limit' };
    out.limit = Number(limit);
  }
  const days = (raw.days ?? '').trim();
  if (days) {
    if (!/^[0-9]{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 365) return { ok: false, error: 'days' };
    out.days = Number(days);
  }
  const status = (raw.status ?? '').trim();
  if (status && status !== 'all') {
    // Rejected here rather than passed through: an unrecognised status silently ignored by the server produces a file
    // of EVERY application on the platform under a filename that says otherwise.
    if (!isApplicationState(status)) return { ok: false, error: 'status' };
    out.status = status;
  }
  const schemeId = (raw.schemeId ?? '').trim();
  if (schemeId) out.schemeId = schemeId;
  if ((raw.assistedOnly ?? '').trim() === 'true') out.assistedOnly = 'true';
  return { ok: true, value: out };
}
