// apps/web-admin/src/features/reports/dashboard.ts · W001 / W111 view logic (PC-56 ADMIN-10).
//
// **THE RULE THIS WHOLE FILE SERVES: A TILE NEVER RENDERS A NUMBER IT DOES NOT HAVE.** The dashboard is the screen an
// operator glances at and believes, and three of W001's figures do not exist on this platform — a per-minute peak, a
// payout retry count, and the week-over-week change in active tenants. Each of them is easy to approximate and every
// approximation would be a plausible number under a label that means something else.

export type FigureBasis = 'computed' | 'partial_window' | 'unavailable';
export interface Figure { basis: FigureBasis; value: string | null; note?: string }

/** What the tile shows in place of a value. Never an empty cell: a blank invites the reader to assume zero. */
export function figureKey(f: Figure | null | undefined): string {
  if (!f) return 'rp.figure.unreadable';
  if (f.basis === 'computed') return 'rp.figure.value';
  return f.basis === 'partial_window' ? 'rp.figure.partial' : 'rp.figure.unavailable';
}

export function figureClass(f: Figure | null | undefined): string {
  if (!f || f.basis === 'unavailable') return 'kv-stat is-muted';
  return f.basis === 'partial_window' ? 'kv-stat is-warn' : 'kv-stat';
}

/** True when the tile has a number to print. Used so a page cannot accidentally render `null` as "null". */
export function hasValue(f: Figure | null | undefined): boolean {
  return !!f && f.basis === 'computed' && f.value !== null;
}

/* ------------------------------------------------------------------------------------------------ */
/* DELTAS                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface Delta {
  kind: 'up' | 'down' | 'flat' | 'no_baseline';
  bps?: number;
  comparedWith: string;
  unavailableReason?: string;
}

export function deltaKey(d: Delta | null | undefined): string {
  if (!d) return 'rp.delta.none';
  switch (d.kind) {
    case 'up': return 'rp.delta.up';
    case 'down': return 'rp.delta.down';
    case 'flat': return 'rp.delta.flat';
    // "Nothing to compare with" is not "no change", and a tile that rendered them alike would report a flat week on the
    // platform's first day.
    default: return d.unavailableReason ? 'rp.delta.cannotCompare' : 'rp.delta.noBaseline';
  }
}

export function deltaClass(d: Delta | null | undefined): string {
  if (!d || d.kind === 'no_baseline') return 'kv-delta is-muted';
  if (d.kind === 'flat') return 'kv-delta';
  return d.kind === 'up' ? 'kv-delta is-up' : 'kv-delta is-down';
}

/** Basis points → a percentage string with one decimal, formatted for en-IN. 820bps → "8.2". Integer arithmetic all the
 *  way: the backend never sends a float and this never creates one. */
export function bpsToPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const tenth = Math.abs(Math.trunc((bps % 100) / 10));
  return `${whole}.${tenth}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* FRESHNESS                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export interface Freshness { kind: 'live' | 'cached' | 'unavailable'; asOf?: string; reason?: string }

export function freshnessKey(f: Freshness | null | undefined): string {
  if (!f) return 'rp.fresh.unknown';
  if (f.kind === 'cached') return 'rp.fresh.cached';
  return f.kind === 'unavailable' ? 'rp.fresh.unavailable' : 'rp.fresh.asOf';
}

export function freshnessClass(f: Freshness | null | undefined): string {
  if (!f || f.kind === 'unavailable') return 'kv-note is-danger';
  return f.kind === 'cached' ? 'kv-note is-warn' : 'kv-note';
}

/**
 * **THE WORD "LIVE" IS NOT USED FOR A POINT-IN-TIME READ.** W001 labels its lifecycle band "(live)" and offers a "Live
 * revenue ticker". A figure read once when the page rendered is a point in time, and calling it live teaches an
 * operator to trust it at 18:20 when it was true at 18:14.
 */
export function isStreamBacked(): boolean { return false; }

/* ------------------------------------------------------------------------------------------------ */
/* THE REVENUE GATE — the permission split W001 describes and this platform did not have             */
/* ------------------------------------------------------------------------------------------------ */

/** Whether to render the money block, and what to say when it is withheld. A 403 for the whole screen would make
 *  W001's own restricted state unreachable: it describes a role that sees the dashboard WITHOUT the revenue. */
export function revenueStateKey(visible: boolean): string {
  return visible ? 'rp.revenue.visible' : 'rp.revenue.gated';
}

/* ------------------------------------------------------------------------------------------------ */
/* ALERTS                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** W001's alert stack has three rows and this platform can currently produce none of them. An empty stack with no
 *  explanation reads as "all clear", which is the most dangerous possible misreading of an alert panel. */
export function alertStackKey(itemCount: number, unavailableCount: number): string {
  if (itemCount > 0) return 'rp.alerts.some';
  return unavailableCount > 0 ? 'rp.alerts.noneComputable' : 'rp.alerts.clear';
}

export function alertStackClass(itemCount: number, unavailableCount: number): string {
  if (itemCount > 0) return 'kv-note is-danger';
  // Warn, not ok: "nothing is wrong" and "we are not checking" must not look the same.
  return unavailableCount > 0 ? 'kv-note is-warn' : 'kv-note is-ok';
}

/* ------------------------------------------------------------------------------------------------ */
/* W111 · THE BUILDER                                                                                */
/* ------------------------------------------------------------------------------------------------ */

export function metricKey(metric: string): string {
  const known = ['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor'];
  return known.includes(metric) ? `rp.metric.${metric}` : 'rp.metric.other';
}

export function bucketKey(bucket: string): string {
  const known = ['day', 'week', 'month'];
  return known.includes(bucket) ? `rp.bucket.${bucket}` : 'rp.bucket.other';
}

/** Whether a metric is money, so the console formats it as rupees rather than as a count. Getting this wrong would
 *  print a GMV of ₹1,84,20,516 as "18420516 orders". */
export function isMoneyMetric(metric: string): boolean {
  return metric.endsWith('_minor');
}

/** The replica sentence, chosen by the FACT rather than by the copy. W111 promises the analytics replica; there is one
 *  pool on the primary. When a replica lands, the payload flips and this sentence changes with it. */
export function replicaKey(readsFromReplica: boolean): string {
  return readsFromReplica ? 'rp.builder.replica' : 'rp.builder.primary';
}

export function replicaClass(readsFromReplica: boolean): string {
  return readsFromReplica ? 'kv-note' : 'kv-note is-warn';
}

/** Client-side range check, mirroring the server's cap so an operator is told before they wait. The SERVER is
 *  authoritative — this exists to save a round trip, never to be the control. */
export function rangeTooLong(fromIso: string, toIso: string, maxDays: number): boolean {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
  return (to - from) / 86_400_000 > maxDays;
}

/* ------------------------------------------------------------------------------------------------ */
/* EXPORTS — the receipt, the watermark, and the fetch log                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface ExportReceiptView {
  id: string; report: string; generatedAt: string; rowCount: number; truncated: boolean;
  fileName: string; contentSha256: string; digestBasis: string; watermarked: boolean;
}

/** Every field W2127 enumerates: "file name, row count, sha256, generated-at, requester". A receipt missing one is a
 *  receipt that does not answer the question it exists for, so the console asserts the shape rather than rendering
 *  whatever arrived. */
export function receiptComplete(r: Partial<ExportReceiptView> & { generatedBy?: string }): boolean {
  return !!(r.fileName && typeof r.rowCount === 'number' && r.contentSha256 && r.generatedAt && r.generatedBy);
}

export function truncatedKey(truncated: boolean): string {
  // A truncated export that looks complete is how a reconciliation goes wrong months later.
  return truncated ? 'rp.exports.truncated' : 'rp.exports.complete';
}

export function watermarkKey(watermarked: boolean): string {
  return watermarked ? 'rp.exports.watermarked' : 'rp.exports.notWatermarked';
}

/** The async promise W2126 makes and this platform does not keep. Rendered on the queued state rather than a fake
 *  position and ETA. */
export function deliveryKey(async: boolean): string {
  return async ? 'rp.exports.async' : 'rp.exports.sync';
}

/** A digest mismatch is the loudest thing this plane can say: the bytes served did not match the bytes recorded. */
export function mismatchKey(count: number): string {
  return count > 0 ? 'rp.exports.mismatch' : 'rp.exports.noMismatch';
}

export function mismatchClass(count: number): string {
  return count > 0 ? 'kv-note is-danger' : 'kv-note is-ok';
}
