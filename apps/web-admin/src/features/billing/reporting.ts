// apps/web-admin/src/features/billing/reporting.ts · PURE console rules for exports, the revenue series, the renewal
// preview and bulk selection (PC-56 ADMIN-1d). No IO, no React → unit-provable.

// ---------------------------------------------------------------------------
// Exports (ADMIN-1-Q3)
// ---------------------------------------------------------------------------
export const EXPORT_REPORTS = ['tenants', 'plans', 'invoices', 'gstr', 'revenue'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export function isExportReport(v: string | null | undefined): v is ExportReport {
  return !!v && (EXPORT_REPORTS as readonly string[]).includes(v);
}

/** Which reports NEED a date period. `gstr` is a filing extract: an unbounded GST export is meaningless, and the
 *  server refuses one — so the form asks for the period rather than letting someone discover that after submitting. */
const NEEDS_PERIOD: ReadonlySet<ExportReport> = new Set<ExportReport>(['gstr']);
export function needsPeriod(report: ExportReport): boolean { return NEEDS_PERIOD.has(report); }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ExportError = 'report' | 'from' | 'to' | 'order' | 'period';
export type ExportResult =
  | { ok: true; value: { report: ExportReport; from?: string; to?: string; tenantId?: string; status?: string; limit: number } }
  | { ok: false; error: ExportError };

/** Build the export request. Dates are validated as a PERIOD (from ≤ to) because a reversed period silently returns
 *  nothing, and an empty CSV reads as "there was no business that month" rather than "you typed the dates backwards". */
export function buildExport(raw: {
  report: string; from?: string; to?: string; tenantId?: string; status?: string; limit?: string;
}): ExportResult {
  if (!isExportReport(raw.report)) return { ok: false, error: 'report' };
  const report = raw.report;

  const from = (raw.from ?? '').trim();
  const to = (raw.to ?? '').trim();
  if (from && !DATE_RE.test(from)) return { ok: false, error: 'from' };
  if (to && !DATE_RE.test(to)) return { ok: false, error: 'to' };
  if (from && to && from > to) return { ok: false, error: 'order' };
  if (needsPeriod(report) && (!from || !to)) return { ok: false, error: 'period' };

  // A limit is a PAGE SIZE, not a question about the data, so an out-of-range value is CLAMPED rather than dropped
  // (the opposite of the tenant directory's riskMin, where clamping would have answered a different question).
  // The digit bound must exceed the ceiling or an over-max value silently becomes the DEFAULT instead of the max —
  // which is exactly the bug this spec caught: `\d{1,4}` could not match "99999", so 99999 quietly meant 1000.
  const l = (raw.limit ?? '').trim();
  const limit = /^\d{1,7}$/.test(l) ? Math.min(Math.max(Number.parseInt(l, 10), 1), 5000) : 1000;

  return {
    ok: true,
    value: {
      report, limit,
      ...(from ? { from } : {}), ...(to ? { to } : {}),
      ...(raw.tenantId?.trim() ? { tenantId: raw.tenantId.trim() } : {}),
      ...(raw.status?.trim() ? { status: raw.status.trim() } : {}),
    },
  };
}

export interface ExportReceipt {
  id?: string; report?: string; generatedAt?: string; rowCount?: number; truncated?: boolean;
}

/** A receipt is only meaningful if it carries an id — the id is what ties the saved file to the audit row. Without one
 *  the console says the export could not be recorded rather than offering a download that has no provenance. */
export function receiptUsable(r: ExportReceipt | null | undefined): boolean {
  return !!r && typeof r.id === 'string' && r.id.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Revenue series (ADMIN-1-Q7)
// ---------------------------------------------------------------------------
export interface MonthPoint { month?: string; issuedMinor?: string; paidMinor?: string; invoices?: number }

/** Collection rate for a month in BASIS POINTS (integer arithmetic on minor-unit strings — Law 2). Returns NULL when
 *  nothing was issued: a month with no invoices has no collection rate, and rendering 0% would say the platform failed
 *  to collect rather than that there was nothing to collect. */
export function collectionRateBps(p: MonthPoint): number | null {
  const issued = big(p.issuedMinor);
  const paid = big(p.paidMinor);
  if (issued === null || paid === null || issued === 0n) return null;
  return Number((paid * 10000n) / issued);
}

function big(v: string | null | undefined): bigint | null {
  const s = String(v ?? '').trim();
  return /^-?\d{1,20}$/.test(s) ? BigInt(s) : null;
}

/** Sum of a money column across the series, skipping unreadable values and SAYING how many it skipped — a total that
 *  silently dropped three months is a total nobody should act on. */
export function seriesTotal(points: readonly MonthPoint[], field: 'issuedMinor' | 'paidMinor'): { totalMinor: bigint; counted: number; skipped: number } {
  let totalMinor = 0n; let counted = 0; let skipped = 0;
  for (const p of points) {
    const v = big(p[field]);
    if (v === null) { skipped += 1; continue; }
    totalMinor += v; counted += 1;
  }
  return { totalMinor, counted, skipped };
}

/** The tallest bar, so a chart can scale. Zero when everything is zero or unreadable — the caller must then draw an
 *  empty chart rather than divide by it. */
export function seriesMax(points: readonly MonthPoint[], field: 'issuedMinor' | 'paidMinor'): bigint {
  let max = 0n;
  for (const p of points) {
    const v = big(p[field]);
    if (v !== null && v > max) max = v;
  }
  return max;
}

/** Bar height as a percentage of the tallest, integer-only. 0 when there is nothing to scale against — never NaN,
 *  which is what `x / 0` would put into a style attribute. */
export function barPct(value: string | null | undefined, max: bigint): number {
  const v = big(value);
  if (v === null || max <= 0n) return 0;
  return Number((v * 100n) / max);
}

export interface CohortPoint { cohort?: string; tenants?: number; stillBilling?: number }

/** Retention in basis points. NULL for an empty cohort — a quarter with no signups has no retention rate, and 0%
 *  would read as "everybody left". */
export function retentionBps(c: CohortPoint): number | null {
  const t = Number(c.tenants); const s = Number(c.stillBilling);
  if (!Number.isFinite(t) || !Number.isFinite(s) || t <= 0) return null;
  return Math.round((s / t) * 10000);
}

// ---------------------------------------------------------------------------
// Renewal preview (ADMIN-1-Q4, visibility only)
// ---------------------------------------------------------------------------
export interface RenewalDueRow { alreadyInvoiced?: boolean; priceMinor?: string; currency?: string; periodEnd?: string }

/** True when the run would skip this row (already invoiced for the period — the job is idempotent). Shown so the
 *  headline count is not read as "this many tenants are about to be billed". */
export function willSkip(r: RenewalDueRow): boolean { return r.alreadyInvoiced === true; }

/** Rows whose period end is already in the past — the run has not picked them up yet, which is worth surfacing
 *  because it usually means the worker is not running. */
export function overduePeriods(rows: readonly RenewalDueRow[], todayIso: string): number {
  const today = todayIso.slice(0, 10);
  return rows.filter((r) => !willSkip(r) && String(r.periodEnd ?? '').slice(0, 10) < today).length;
}

// ---------------------------------------------------------------------------
// Bulk selection (ADMIN-1-Q11)
// ---------------------------------------------------------------------------
export const BULK_ACTIONS = ['issue', 'mark_overdue', 'void'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const MAX_BULK_INVOICES = 100;
export function isBulkAction(v: string | null | undefined): v is BulkAction {
  return !!v && (BULK_ACTIONS as readonly string[]).includes(v);
}

/** Mirror of the server's `appliesTo`, so the console can say "3 of your 12 cannot be voided" BEFORE submitting. */
export function bulkAppliesTo(action: BulkAction, status: string): boolean {
  if (action === 'issue') return status === 'draft';
  if (action === 'mark_overdue') return status === 'issued' || status === 'partially_paid';
  return status !== 'paid' && status !== 'void';
}

export type BulkError = 'action' | 'empty' | 'tooMany' | 'reason' | 'noneApplicable';
export type BulkResult =
  | { ok: true; value: { action: BulkAction; invoiceIds: string[]; reason: string }; skipped: number }
  | { ok: false; error: BulkError };

/**
 * Build the batch from the selected rows.
 *
 * INAPPLICABLE ROWS ARE DROPPED LOCALLY, NOT SENT. The server would report them as `illegal` and carry on, which is
 * correct — but sending them means an audit row for a batch that included invoices the operator never meant to touch.
 * Dropping them here and REPORTING the count ("3 of 12 skipped") keeps the recorded batch equal to the real intent.
 * If nothing is left, that is its own error rather than an empty batch.
 */
export function buildBulk(
  raw: { action: string; reason: string },
  selected: ReadonlyArray<{ id?: string; status?: string | null }>,
): BulkResult {
  if (!isBulkAction(raw.action)) return { ok: false, error: 'action' };
  const action = raw.action;
  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: 'reason' };

  const ids = [...new Set(selected.filter((r) => !!r.id).map((r) => String(r.id)))];
  if (ids.length === 0) return { ok: false, error: 'empty' };

  const applicable = selected.filter((r) => !!r.id && bulkAppliesTo(action, String(r.status ?? '')));
  const invoiceIds = [...new Set(applicable.map((r) => String(r.id)))];
  if (invoiceIds.length === 0) return { ok: false, error: 'noneApplicable' };
  if (invoiceIds.length > MAX_BULK_INVOICES) return { ok: false, error: 'tooMany' };

  return { ok: true, value: { action, invoiceIds, reason }, skipped: ids.length - invoiceIds.length };
}

export interface BulkOutcomeRow { invoiceId?: string; outcome?: string; from?: string; to?: string; detail?: string }

/** Group the server's per-invoice outcomes for display. Every outcome is shown — "42 of 50 succeeded" without saying
 *  WHICH eight forces someone to re-check all fifty. */
export function groupOutcomes(rows: readonly BulkOutcomeRow[]): Record<string, BulkOutcomeRow[]> {
  const out: Record<string, BulkOutcomeRow[]> = {};
  for (const r of rows) {
    const k = String(r.outcome ?? 'failed');
    (out[k] ??= []).push(r);
  }
  return out;
}

/** True when the batch did not fully succeed — the page then leads with what did NOT happen. */
export function batchHadProblems(summary: { illegal?: number; notFound?: number; failed?: number } | null | undefined): boolean {
  if (!summary) return false;
  return (summary.illegal ?? 0) + (summary.notFound ?? 0) + (summary.failed ?? 0) > 0;
}
