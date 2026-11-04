// apps/web-partner/src/features/partner5/figures.ts · PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS (founder 5a-6 / 5a-7) — the
// presentational maths and the page states of W223 (`/lender/portfolio/aging`) and W222 (`/lender/portfolio/writeoffs`). PURE (no React,
// no fetch). The SERVER computes every figure (`GET /v1/partner/loans/dpd`, `GET /v1/partner/loans/counts`,
// `GET /v1/partner/loans?status=written_off` — the 4a/4b reads, unchanged); this file only orders them, adds bigint strings with BigInt,
// and builds links.
//
// **NO FUNCTION IN THIS FILE CAN EMIT A PERCENTAGE SIGN.** No share of the book, no rate, no average (founder 5a-6 / 5a-8, survey E9).
// `lender-figures.spec` scans this file's source and proves the absence.
//
// The two windows, said once: the six rows of W223 come from the dpd read, which is NOT windowed (every servicing loan on the book); the
// restructured count beside them and W222's count and outstanding come from the counts read, which IS windowed (the loans OPENED in the
// IST window the database answered). W222's list is NOT windowed (every written-off loan on the book, whenever opened). The pages say so.
import { kindLabel, loanHref, loanRef, loanStatusKey, loanStatusTone, windowLabel, type LenderFailure } from '../partner4/figures';

export { kindLabel, loanHref, loanRef, loanStatusKey, loanStatusTone, windowLabel };

const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
const bigintStr = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? v : '0');

// ── W223 · the six rows ──────────────────────────────────────────────────────────────────────────────────────────────
/** The platform's SIX buckets (0232:115-123), in the order W223 prints them: the loans with NO due date recorded FIRST (today that is
 *  every servicing loan, and the page says why beside it), then the loans not yet due, then the four rows behind a recorded due date.
 *  There is no "up to date" row: a loan with no due date is not on time, it is undated (survey §1F). */
export const AGING_ROWS = ['no_due_date', 'not_due', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_ROWS)[number];
/** The row label — PARTNER-4b's own keys (the days spelled out, the acronym never printed). */
export const agingKey = (b: string) => `partner4.arrears.bucket.${b.replace('+', 'plus').replace('-', '_')}`;

export interface AgingDpdShape {
  buckets: Record<string, { count: number; outstandingMinor: string }>;
  servicing: { count: number; outstandingMinor: string };
  computedAt: string;
}
export interface AgingCountsShape {
  from: string; to: string; fy: string | null;
  restructured: number;
  writtenOff: { count: number; outstandingMinor: string };
  computedAt: string;
}

/** The six rows: an integer count and a bigint minor-unit string per bucket, 0 / "0" when the server answered none. Never a float. */
export function agingRows(d: AgingDpdShape | null | undefined): Array<{ bucket: AgingBucket; key: string; behind: boolean; n: number; outstandingMinor: string }> {
  return AGING_ROWS.map((bucket) => ({
    bucket,
    key: agingKey(bucket),
    behind: bucket !== 'not_due' && bucket !== 'no_due_date',
    n: int(d?.buckets?.[bucket]?.count),
    outstandingMinor: bigintStr(d?.buckets?.[bucket]?.outstandingMinor),
  }));
}

/**
 * THE SUM-CHECK (founder 5a-6): the six buckets are exhaustive and disjoint over `active` + `overdue` (0232:38), so the BigInt sum of
 * their outstanding equals the servicing book's outstanding. Both figures are returned as strings so the page prints BOTH — never a tick
 * alone. `restructured` is the counts read's own integer: loans whose status is restructured sit outside the buckets AND outside the
 * servicing total, and the page prints their count beside it (from the WINDOWED counts read — the label says so).
 */
export function agingSumCheck(d: AgingDpdShape | null | undefined, c: Pick<AgingCountsShape, 'restructured'> | null | undefined): { sum: string; total: string; equal: boolean; restructured: number } {
  const sum = agingRows(d).reduce((acc, r) => acc + BigInt(r.outstandingMinor), BigInt(0));
  const total = BigInt(bigintStr(d?.servicing?.outstandingMinor));
  return { sum: sum.toString(), total: total.toString(), equal: sum === total, restructured: int(c?.restructured) };
}
/** The restructured note is printed iff at least one such loan was counted. */
export const showRestructuredNote = (restructured: number) => int(restructured) > 0;

/** W223's state: EMPTY when nothing is being serviced on this book. */
export type Lender5State = 'ok' | 'empty' | LenderFailure;
export function agingState(d: AgingDpdShape | null, c: AgingCountsShape | null, failure: LenderFailure | null): Lender5State {
  if (failure) return failure;
  if (!d || !c) return 'error';
  return int(d.servicing?.count) === 0 ? 'empty' : 'ok';
}

// ── W222 · the written-off loans ─────────────────────────────────────────────────────────────────────────────────────
export const WRITEOFFS_PAGE = '/lender/portfolio/writeoffs';
export const AGING_PAGE = '/lender/portfolio/aging';
const CURSOR_OK = (c: string | undefined): c is string => !!c && c.length <= 200 && /^[A-Za-z0-9_-]+$/.test(c);
const one = (sp: Record<string, string | string[] | undefined> | undefined, k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v[0] : v; };

/** W222's count and outstanding — the counts read's `writtenOff`, over the loans OPENED in its window, with that window's label. */
export function writeoffsSummary(c: AgingCountsShape | null | undefined): { count: number; outstandingMinor: string; window: ReturnType<typeof windowLabel> } {
  return { count: int(c?.writtenOff?.count), outstandingMinor: bigintStr(c?.writtenOff?.outstandingMinor), window: windowLabel(c) };
}
/** W222's query: an opaque URL-safe cursor and nothing else (the status is fixed to `written_off` by the page itself). */
export function writeoffsQuery(sp: Record<string, string | string[] | undefined> | undefined): { cursor?: string } {
  const cursor = one(sp, 'cursor');
  return { cursor: CURSOR_OK(cursor) ? cursor : undefined };
}
export function writeoffsHref(cursor?: string): string {
  return CURSOR_OK(cursor) ? `${WRITEOFFS_PAGE}?cursor=${encodeURIComponent(cursor)}` : WRITEOFFS_PAGE;
}
/** W222's state: EMPTY when the list of written-off loans is empty (the list is every such loan, whenever opened). */
export function writeoffsState(c: AgingCountsShape | null, items: readonly unknown[] | null, failure: LenderFailure | null): Lender5State {
  if (failure) return failure;
  if (!c || !items) return 'error';
  return items.length === 0 ? 'empty' : 'ok';
}
