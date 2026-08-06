// apps/web-admin/src/features/billing/invoice-lines.ts · PURE rules for showing what an invoice actually BILLS
// (PC-56 ADMIN-1, canon W013 line items + W441 the PDF asset). No IO, no React → unit-provable.
//
// AN INVOICE IS A TAX DOCUMENT, so this file computes as little as possible. The server sends the lines exactly as
// they were filed (`saas_invoices.line_items`, projected for the first time in this wave) and the invoice's own
// subtotal/tax/total columns. This module NEVER re-derives GST, never re-multiplies qty × unit price to "check" a
// line, and never fills a total in from the parts. What it DOES do is compare — and when the visible lines do not
// add up to the filed subtotal, it says so, loudly, instead of quietly showing whichever number came last.
//
// That reconciliation is the whole point. A malformed line is dropped server-side (parseLineItems) rather than
// rendered as ₹0.00, which means the lines a finance officer sees can legitimately be INCOMPLETE. The document's
// total remains authoritative; the mismatch is the signal that something is wrong with the record, and hiding it
// would turn a data problem into a wrong number in a filing.

export interface LineRow {
  desc?: string | null;
  qty?: number | null;
  unitMinor?: string | null;
  totalMinor?: string | null;
  hsn?: string | null;
  gstRatePct?: number | null;
}

const MINOR_RE = /^-?\d{1,20}$/;

/** Parse a minor-unit string to bigint, or null when it is not one. Never coerces to 0 (Law 2). */
export function minor(v: string | null | undefined): bigint | null {
  const s = String(v ?? '').trim();
  return MINOR_RE.test(s) ? BigInt(s) : null;
}

/** Sum of the line totals we can actually read, and how many we could not. Both are returned so the caller cannot
 *  present the sum as complete when it is not. */
export function lineSum(rows: readonly LineRow[]): { sumMinor: bigint; readable: number; unreadable: number } {
  let sumMinor = 0n; let readable = 0; let unreadable = 0;
  for (const r of rows) {
    const v = minor(r.totalMinor);
    if (v === null) { unreadable += 1; continue; }
    sumMinor += v; readable += 1;
  }
  return { sumMinor, readable, unreadable };
}

/** Does what we can see account for what was filed?
 *   • `ok`        — the lines sum exactly to the invoice's subtotal.
 *   • `no_lines`  — the invoice carries no readable lines at all (an old row, or a producer that never wrote them).
 *   • `mismatch`  — they sum to something else. THE FILED SUBTOTAL WINS; this flag exists so the page can say the
 *                   itemisation is incomplete rather than let a reader add up the visible rows and get a wrong number.
 *   • `unknown`   — the invoice's own subtotal is unreadable, so there is nothing to reconcile against.
 *  Note this compares against SUBTOTAL, not total: tax is a separate filed column and is never re-derived here. */
export type LineReconciliation = 'ok' | 'no_lines' | 'mismatch' | 'unknown';
export function reconcileLines(rows: readonly LineRow[], subtotalMinor: string | null | undefined): LineReconciliation {
  const subtotal = minor(subtotalMinor);
  if (subtotal === null) return 'unknown';
  if (rows.length === 0) return 'no_lines';
  const { sumMinor, unreadable } = lineSum(rows);
  if (unreadable > 0) return 'mismatch';
  return sumMinor === subtotal ? 'ok' : 'mismatch';
}

/** The signed difference (lines − filed subtotal), for the mismatch note. Null when either side is unreadable —
 *  a difference computed against an unknown is not a difference. */
export function lineVarianceMinor(rows: readonly LineRow[], subtotalMinor: string | null | undefined): bigint | null {
  const subtotal = minor(subtotalMinor);
  if (subtotal === null) return null;
  const { sumMinor, unreadable } = lineSum(rows);
  if (unreadable > 0) return null;
  return sumMinor - subtotal;
}

/** GST rate for display. Returns null when absent — an invoice line with no recorded rate must read as "not
 *  recorded", because printing "0%" next to a service line is a statement about someone's tax position. */
export function gstLabelPct(row: LineRow): number | null {
  // NOT `Number(row.gstRatePct)`: Number(null) is 0, which would render a line with NO recorded rate as "0%" — the
  // exact fabricated tax statement this function exists to prevent (found by its own spec).
  if (row.gstRatePct === null || row.gstRatePct === undefined) return null;
  const n = Number(row.gstRatePct);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** HSN/SAC as recorded, or null. Never guessed from the description: a wrong HSN is a filing error, and 998314
 *  (IT services) is exactly the kind of plausible default that would go unnoticed for a year. */
export function hsnLabel(row: LineRow): string | null {
  const s = String(row.hsn ?? '').trim();
  return s ? s : null;
}

/** True when NO line on the invoice carries an HSN/SAC code — the page then shows one honest note instead of a
 *  column of dashes. */
export function hsnAbsentThroughout(rows: readonly LineRow[]): boolean {
  return rows.length > 0 && rows.every((r) => hsnLabel(r) === null);
}

// ---------------------------------------------------------------------------
// The PDF asset (canon W441)
// ---------------------------------------------------------------------------
/** State of the invoice's PDF, as far as the platform can honestly say:
 *   • `generated`   — a media id is recorded, so the artefact exists.
 *   • `not_generated` — no media id. Said plainly; the tenant has not received a document.
 *  There is deliberately no `available` state: admin-api has NO media-presign route (the media/S3 core lives in
 *  apps/api), so this console cannot mint a download link and does not render a button that would 404. Queued as
 *  GAP-BACKEND ADMIN-1-Q2 — the media id is shown so the asset is at least traceable by an operator with access. */
export type PdfState = 'generated' | 'not_generated';
export function pdfState(pdfMediaId: string | null | undefined): PdfState {
  return String(pdfMediaId ?? '').trim() ? 'generated' : 'not_generated';
}

/** A stable, human filename for the day a download route exists (and for operators naming a manual copy). Built
 *  from the invoice NUMBER, never the uuid: the number is what appears on the document and in the tenant's records. */
export function invoicePdfFileName(invoiceNo: string | null | undefined): string {
  const safe = String(invoiceNo ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? `${safe}.pdf` : 'invoice.pdf';
}
