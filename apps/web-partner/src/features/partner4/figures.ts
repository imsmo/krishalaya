// apps/web-partner/src/features/partner4/figures.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — the presentational maths and the
// page states. PURE (no React, no fetch). The SERVER computes every figure (`/v1/partner/loans*`: loan facts, integer counts, bigint
// minor-unit sums, the FY window answered by the database, every date already read through `pgDate` on the API side); this file only turns
// them into text and links, with integer arithmetic.
//
// **NO FUNCTION IN THIS FILE CAN EMIT A `%`.** There is no ratio, no rate, no average, no PAR and no share of the book anywhere on a lending
// page (founder 4a-5 / 4a-7, survey E9): a percentage over a book whose due dates are ALL NULL would be a lie whichever way it rounded. Rates
// are the lender's own stored INTEGERS in basis points (the 2c rule — `bpsInt`, imported rather than re-written). `lender-figures.spec` scans
// this file's source and proves the absence.
//
// Dates: a `date` column reaches this file as the `YYYY-MM-DD` string the API already produced with `pgDate` (the day-early bug
// `loan.repository.ts:10-11` records is fixed on the server, once, for every reader). Nothing here re-parses one into a Date.
import { bpsInt } from '../partner2/figures';

export { bpsInt };

// ── the statuses ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The FIVE loan statuses the platform can produce (the API's own list). `transferred` is in the enum and nothing writes it. */
export const LOAN_STATUSES = ['active', 'overdue', 'restructured', 'closed', 'written_off'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const isLoanStatus = (v: unknown): v is LoanStatus => typeof v === 'string' && (LOAN_STATUSES as readonly string[]).includes(v);
export const loanStatusKey = (s: string) => (isLoanStatus(s) ? `partner4.status.${s}` : 'partner4.status.unknown');
export function loanStatusTone(s: string): 'ok' | 'info' | 'muted' | 'warn' {
  if (s === 'active') return 'ok';
  if (s === 'overdue') return 'warn';
  if (s === 'restructured') return 'info';
  return 'muted';   // closed / written_off / an unknown status (including the refused `transferred`)
}

/** The SEVEN application statuses the machine can produce (`fintech/domain/loan-application.state.ts`), in its own order.
 *  `docs_pending` and `closed` are in the enum, reserved for deferred flows with no edge into either, and refused by name. */
export const APPLICATION_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'disbursed'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const isApplicationStatus = (v: unknown): v is ApplicationStatus => typeof v === 'string' && (APPLICATION_STATUSES as readonly string[]).includes(v);
/** `draft` is never visible on this axis: the consent oracle needs a consent keyed to a SUBMITTED application. */
export const APPLICATION_STATUSES_VISIBLE = APPLICATION_STATUSES.filter((s) => s !== 'draft');
/** The statuses the enum holds that the machine cannot reach — printed nowhere, refused by name. */
export const REFUSED_APPLICATION_STATUSES = ['docs_pending', 'closed'] as const;

// ── the platform's nine loan kinds ───────────────────────────────────────────────────────────────────────────────
/** Seed core/0005's NINE platform `loan_kind` codes. The schema comment's four extra are never seeded; the canon's "13 kinds" is false. */
export const LOAN_KIND_CODES = ['kcc', 'crop', 'tractor', 'dairy', 'whr', 'gold', 'bnpl', 'shg', 'tenant_wc'] as const;
export const NOT_RECORDED = 'not_recorded';
export function kindLabel(code: string | null | undefined): { key: string } | { raw: string } {
  if (!code || code === NOT_RECORDED) return { key: 'partner4.kind.notRecorded' };
  return (LOAN_KIND_CODES as readonly string[]).includes(code) ? { key: `partner4.kind.${code}` } : { raw: code };
}

// ── references ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A loan's REFERENCE: its id's head (the link carries the full id). There is no loan number on this platform. */
export const loanRef = (id: string) => `${id.slice(0, 8)}…`;
/** An application's REFERENCE, likewise — `partner_app_ref` is never written. */
export const applicationRef = (id: string) => `${id.slice(0, 8)}…`;

// ── rates: integer basis points, never a percentage ──────────────────────────────────────────────────────────────
/** The loan's stamped rate as a sentence variable: the INTEGER in basis points. "1050" from 1050 — never "10.5%". */
export function aprLine(interestAprBps: number): { key: 'partner4.loan.aprLine'; vars: { apr: string } } {
  return { key: 'partner4.loan.aprLine', vars: { apr: bpsInt(interestAprBps) } };
}
/** The product's terms as the 2c sentence: APR − subsidy = net, all three INTEGERS in basis points. A negative subvention
 *  (a product priced above its own APR) prints as the negative integer it is; nothing is clamped and nothing is a float. */
export function netAprLine(interestAprBps: number, subventionBps: number): { key: 'partner4.application.aprLine'; vars: { apr: string; subvention: string; net: string } } {
  const a = Number.isInteger(interestAprBps) ? interestAprBps : 0;
  const s = Number.isInteger(subventionBps) ? subventionBps : 0;
  return { key: 'partner4.application.aprLine', vars: { apr: bpsInt(a), subvention: bpsInt(s), net: bpsInt(a - s) } };
}

// ── the dates the platform does not hold ─────────────────────────────────────────────────────────────────────────
/** The maturity date, or the truth: every loan both rails open has it NULL, so there is no term to print. */
export function maturityText(v: string | null | undefined): { key: 'partner4.loan.maturity'; vars: { date: string } } | { key: 'partner4.loan.noMaturity'; vars?: undefined } {
  return v ? { key: 'partner4.loan.maturity', vars: { date: v } } : { key: 'partner4.loan.noMaturity' };
}
/** The next due date, or the truth — there is no instalment plan on this platform. */
export function nextDueText(v: string | null | undefined): { key: 'partner4.loan.nextDue'; vars: { date: string } } | { key: 'partner4.loan.noNextDue'; vars?: undefined } {
  return v ? { key: 'partner4.loan.nextDue', vars: { date: v } } : { key: 'partner4.loan.noNextDue' };
}

// ── the queue's and the book's own links ─────────────────────────────────────────────────────────────────────────
const CURSOR_OK = (c: string | undefined): c is string => !!c && c.length <= 200 && /^[A-Za-z0-9_-]+$/.test(c);
const one = (sp: Record<string, string | string[] | undefined> | undefined, k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };

/** The two boxes of the queue: the review queue (the default) and every consented application. */
export const QUEUE_BOXES = ['review', 'all'] as const;
export type QueueBox = (typeof QUEUE_BOXES)[number];
export const isQueueBox = (v: unknown): v is QueueBox => v === 'review' || v === 'all';
export const boxKey = (b: QueueBox) => `partner4.queue.box.${b}`;

/** The queue's query from the URL: a box, a status of the machine (never a refused one), an opaque cursor. Nothing else. */
export function queueQuery(sp: Record<string, string | string[] | undefined> | undefined): { box: QueueBox; status?: ApplicationStatus; cursor?: string } {
  const box = one(sp, 'box'); const status = one(sp, 'status'); const cursor = one(sp, 'cursor');
  return {
    box: isQueueBox(box) ? box : 'review',
    status: isApplicationStatus(status) ? status : undefined,
    cursor: CURSOR_OK(cursor) ? cursor : undefined,
  };
}
/** A `/lender/queue` href preserving the active box and status (the chips and the keyset pager use it). */
export function queueHref(box: QueueBox, status?: string, cursor?: string): string {
  const q = new URLSearchParams();
  if (box !== 'review') q.set('box', box);
  if (status && isApplicationStatus(status)) q.set('status', status);
  if (CURSOR_OK(cursor)) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `/lender/queue?${s}` : '/lender/queue';
}
/** The portfolio's query: a loan status of the FIVE the platform can produce, and an opaque cursor. */
export function portfolioQuery(sp: Record<string, string | string[] | undefined> | undefined): { status?: LoanStatus; cursor?: string } {
  const status = one(sp, 'status'); const cursor = one(sp, 'cursor');
  return { status: isLoanStatus(status) ? status : undefined, cursor: CURSOR_OK(cursor) ? cursor : undefined };
}
export function portfolioHref(status?: string, cursor?: string): string {
  const q = new URLSearchParams();
  if (status && isLoanStatus(status)) q.set('status', status);
  if (CURSOR_OK(cursor)) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `/lender/portfolio?${s}` : '/lender/portfolio';
}
export const loanHref = (id: string) => `/lender/portfolio/${encodeURIComponent(id)}`;
export const applicationHref = (id: string) => `/lender/queue/${encodeURIComponent(id)}`;

// ── the counts: integers and bigint sums ─────────────────────────────────────────────────────────────────────────
const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const bigintStr = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? v : '0');

export interface LoanCountsShape {
  from: string; to: string; fy: string | null; total: number;
  byStatus: Record<string, number>; byKind: Record<string, number>;
  outstandingByKindMinor: Record<string, string>; principalByKindMinor: Record<string, string>;
  servicing: { count: number; outstandingMinor: string };
  restructured: number; writtenOff: { count: number; outstandingMinor: string };
  computedAt: string;
}

/** The window's label: "FY 2026-27" when the server answered an FY, else the two days — never computed from the browser's clock. */
export function windowLabel(w: { from: string; to: string; fy: string | null } | null | undefined): { key: 'partner4.portfolio.fy' | 'partner4.portfolio.window'; vars: Record<string, string> } | null {
  if (!w) return null;
  return w.fy ? { key: 'partner4.portfolio.fy', vars: { fy: w.fy } } : { key: 'partner4.portfolio.window', vars: { from: w.from, to: w.to } };
}

/** The portfolio's headline figures — each one a COUNT or a bigint minor-unit SUM, never a ratio and never an average. */
export function headlineFigures(c: LoanCountsShape | null | undefined): Array<{ id: string; key: string; count: number; minor: string | null }> {
  return [
    { id: 'servicing', key: 'partner4.portfolio.servicing', count: int(c?.servicing?.count), minor: bigintStr(c?.servicing?.outstandingMinor) },
    { id: 'opened', key: 'partner4.portfolio.opened', count: int(c?.total), minor: null },
    { id: 'restructured', key: 'partner4.portfolio.restructured', count: int(c?.restructured), minor: null },
    { id: 'written_off', key: 'partner4.portfolio.writtenOff', count: int(c?.writtenOff?.count), minor: bigintStr(c?.writtenOff?.outstandingMinor) },
  ];
}

/** The status rows: every status the platform can produce, 0 when none. Integers only. */
export function statusRows(byStatus: Record<string, number> | null | undefined): Array<{ status: LoanStatus; key: string; n: number }> {
  return LOAN_STATUSES.map((s) => ({ status: s, key: loanStatusKey(s), n: int(byStatus?.[s]) }));
}

/** The kind mix: the NINE platform codes in registry order, any other code the server answered, and "not recorded" last —
 *  each with its count and its two bigint sums. No bucket, no grouping, no share. */
export function kindRows(c: LoanCountsShape | null | undefined): Array<{ code: string; label: { key: string } | { raw: string }; n: number; outstandingMinor: string; principalMinor: string }> {
  const seen = Object.keys(c?.byKind ?? {});
  const extra = seen.filter((k) => k !== NOT_RECORDED && !(LOAN_KIND_CODES as readonly string[]).includes(k) && /^[a-z][a-z0-9_]{0,59}$/.test(k)).sort();
  return [...LOAN_KIND_CODES, ...extra, NOT_RECORDED].map((code) => ({
    code,
    label: kindLabel(code),
    n: int(c?.byKind?.[code]),
    outstandingMinor: bigintStr(c?.outstandingByKindMinor?.[code]),
    principalMinor: bigintStr(c?.principalByKindMinor?.[code]),
  }));
}

// ── the page states ──────────────────────────────────────────────────────────────────────────────────────────────
/** A lender page's failure: the console is switched off, or something else went wrong. There is NO `lending_off` state —
 *  the platform's `fintech` flag is a TENANT module switch the partner realm does not consult (survey F-20 / E5), so a
 *  lending page can never honestly say "lending is switched off", and the asymmetry with the insurer's pages is recorded. */
export type LenderFailure = 'off' | 'error';
export type LenderListState = 'ok' | 'empty' | LenderFailure;
export function listState(items: readonly unknown[] | null, failure: LenderFailure | null): LenderListState {
  if (failure) return failure;
  if (!items) return 'error';
  return items.length === 0 ? 'empty' : 'ok';
}
/** The portfolio's state: its figures are the counts, and it is EMPTY when no loan was opened in the window. */
export type LenderCountsState = 'ok' | 'empty' | LenderFailure;
export function countsState(c: { total: number } | null, failure: LenderFailure | null): LenderCountsState {
  if (failure) return failure;
  if (!c) return 'error';
  return c.total === 0 ? 'empty' : 'ok';
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE (founder 4b-4 … 4b-7) — W210's pipeline counts, W211's collected
// window and arrears buckets, and W218's honest-page state. Still **NO FUNCTION HERE CAN EMIT A `%`**: no arrears
// rate, no portfolio-at-risk share, no channel mix, no punctuality figure (survey E9). Counts are integers; money is
// a bigint minor-unit string the view formats; every figure arrives server-computed with its own `computedAt`.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** W210's four chips, in the canon's own order. Each is a COUNT the server answered — nothing here is an act. */
export const PIPELINE_CHIPS = ['pipeline', 'ready', 'coolingOff', 'disbursed'] as const;
export type PipelineChip = (typeof PIPELINE_CHIPS)[number];

export interface PipelineShape { from: string; to: string; fy: string | null; ready: number; coolingOff: number; disbursed: number; approved: number; pipeline: number; computedAt: string }

/** The four chips as rows: id, key, count. No share, no ratio, no "of N" arithmetic beyond the counts themselves. */
export function pipelineRows(p: PipelineShape | null | undefined): Array<{ id: PipelineChip; key: string; n: number }> {
  return PIPELINE_CHIPS.map((id) => ({ id, key: `partner4.pipeline.${id}`, n: int(p?.[id]) }));
}

/** The SIX arrears buckets the server answers, in the order the page prints them: the four arrears, then the two that
 *  say why those four are zero on this platform. `not_due` and `no_due_date` are not arrears and are never added in. */
export const ARREARS_ROWS = ['1-30', '31-60', '61-90', '90+', 'not_due', 'no_due_date'] as const;
export type ArrearsBucket = (typeof ARREARS_ROWS)[number];
/** The i18n key of a bucket. The acronym the canon uses for days-past-due is never printed: the page says the days. */
export const arrearsKey = (b: string) => `partner4.arrears.bucket.${b.replace('+', 'plus').replace('-', '_')}`;

export interface ArrearsShape {
  buckets: Record<string, { count: number; outstandingMinor: string }>;
  arrears: { count: number; outstandingMinor: string };
  noDueDate: { count: number; outstandingMinor: string };
  servicing: { count: number; outstandingMinor: string };
  noScheduleOnPlatform: boolean;
  computedAt: string;
}

export function arrearsRows(a: ArrearsShape | null | undefined): Array<{ bucket: ArrearsBucket; key: string; arrears: boolean; n: number; outstandingMinor: string }> {
  return ARREARS_ROWS.map((bucket) => ({
    bucket,
    key: arrearsKey(bucket),
    arrears: bucket !== 'not_due' && bucket !== 'no_due_date',
    n: int(a?.buckets?.[bucket]?.count),
    outstandingMinor: bigintStr(a?.buckets?.[bucket]?.outstandingMinor),
  }));
}

/**
 * THE HONEST REASON THE ARREARS BUCKETS ARE ZERO (founder 4b-7, survey F-8). Which sentence the page prints is decided
 * HERE, from the server's own counts, never from a guess:
 *   `none`     — nothing is being serviced yet, so there is nothing to be late;
 *   `noDates`  — loans are being serviced and NOT ONE has a next due date recorded: no loan can be counted late;
 *   `someDates`— some loans have a date and some do not: the buckets cover only the ones that do, and the page says how many do not;
 *   `dates`    — every serviced loan has a date, so the buckets are the whole truth about this book.
 * No percentage in any of the four.
 */
export type ArrearsReason = 'none' | 'noDates' | 'someDates' | 'dates';
export function arrearsReason(a: ArrearsShape | null | undefined): ArrearsReason {
  const serviced = int(a?.servicing?.count);
  const without = int(a?.noDueDate?.count);
  if (serviced === 0) return 'none';
  if (without === serviced) return 'noDates';
  return without > 0 ? 'someDates' : 'dates';
}
export const arrearsReasonKey = (r: ArrearsReason) => `partner4.arrears.why.${r}`;

export interface CollectedShape { from: string; to: string; fy: string | null; repayments: number; amountPaidMinor: string; loans: number; computedAt: string }

/** The collected window's figures: a count, a bigint sum and a count of loans. Never a rate, never an average. */
export function collectedFigures(c: CollectedShape | null | undefined): Array<{ id: string; key: string; count: number; minor: string | null }> {
  return [
    { id: 'collected', key: 'partner4.repayments.collected', count: int(c?.repayments), minor: bigintStr(c?.amountPaidMinor) },
    { id: 'loans', key: 'partner4.repayments.loansPaying', count: int(c?.loans), minor: null },
  ];
}

/** W211's state: EMPTY when nothing is being serviced and nothing was recorded in the window. */
export function servicingState(a: ArrearsShape | null, c: CollectedShape | null, failure: LenderFailure | null): LenderCountsState {
  if (failure) return failure;
  if (!a || !c) return 'error';
  return a.servicing.count === 0 && c.repayments === 0 ? 'empty' : 'ok';
}
/** W210's state: EMPTY when no application of this book is approved or was disbursed in the window. */
export function pipelineState(p: PipelineShape | null, failure: LenderFailure | null): LenderCountsState {
  if (failure) return failure;
  if (!p) return 'error';
  return p.pipeline === 0 ? 'empty' : 'ok';
}

/**
 * W218's state. The page makes NO READ (it is an honest page about whose money moves and who signs, so it writes no
 * audit row and has NO error state of its own — the 3b rule), so its state is the platform's public, client-safe flag
 * map: `partner_console` OFF is printed as OFF, an unreadable map as the ordinary error notice, and NEVER
 * "lending is switched off" — the `fintech` flag is a TENANT module switch the partner realm does not consult
 * (survey F-20 / E5). The asymmetry with the insurer's pages is recorded, not fixed.
 */
export type LenderHonestState = 'ok' | 'off' | 'error';
export function lenderSwitchState(map: Record<string, boolean> | null | undefined): LenderHonestState {
  if (!map) return 'error';
  if (map.partner_console === false) return 'off';
  return map.partner_console === true ? 'ok' : 'error';
}

/** `/lender/disbursements` and `/lender/repayments` hrefs (the two 4b sub-navigation rows), and W218's address.
 *  W218's `[id]` is a disbursement-RUN id, which the partner axis never holds and this console never reads — so the
 *  inbound edge W210 → W218 that the canon never drew is built at the one address a lender can honestly be sent to,
 *  and EVERY id prints the same honest page because there is nothing to look up (recorded as a DELTA). */
export const PENDING_BATCH = 'pending';
export const batchHref = (id: string = PENDING_BATCH) => `/lender/disbursements/${encodeURIComponent(id)}`;
