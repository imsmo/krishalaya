// apps/admin-api/src/modules/billing-ops/domain/billing-export.ts · pure export vocabulary + CSV shaping
// (PC-56 ADMIN-1d, closes ADMIN-1-Q3). No I/O → unit-provable.
//
// The columns are declared HERE rather than inferred from whatever the SQL happened to return, for two reasons that
// both bite later: a CSV whose column order drifts breaks every spreadsheet formula pointing at it, and a query that
// gains a column would silently start exporting a field nobody approved for export.

export const EXPORT_REPORTS = ['tenants', 'plans', 'invoices', 'gstr', 'revenue'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export function isExportReport(v: string | null | undefined): v is ExportReport {
  return !!v && (EXPORT_REPORTS as readonly string[]).includes(v);
}

/** The exact columns, in order, per report. Adding a field to an export is therefore a deliberate edit here — which is
 *  what makes "no PII was added to an export by accident" a claim anyone can check. */
const COLUMNS: Readonly<Record<ExportReport, readonly string[]>> = Object.freeze({
  tenants: ['slug', 'status', 'riskScore', 'createdAt', 'approvedAt'],
  plans: ['code', 'version', 'defaultName', 'currency', 'monthlyPriceMinor', 'annualPriceMinor', 'setupFeeMinor', 'isPublic', 'status'],
  invoices: ['invoiceNo', 'tenantSlug', 'status', 'currency', 'subtotalMinor', 'taxMinor', 'totalMinor', 'paidMinor', 'dueDate', 'paidAt', 'createdAt'],
  // A GST return extract: the fields a filing needs, exactly as filed on the invoice. No rate bucketing, no recompute.
  gstr: ['invoiceNo', 'invoiceDate', 'tenantSlug', 'tenantGstin', 'placeOfSupply', 'taxableValueMinor', 'taxMinor', 'totalMinor', 'currency'],
  revenue: ['month', 'invoices', 'issuedMinor', 'paidMinor'],
});

export function exportColumns(report: ExportReport): readonly string[] { return COLUMNS[report]; }

/**
 * CSV escaping, RFC-4180 style. Three details that matter more than they look:
 *
 *   • A value starting with `=`, `+`, `-` or `@` is prefixed with a single quote. This is CSV INJECTION defence: a
 *     tenant-controlled string like `=HYPERLINK("http://evil","click")` in a slug or a reason becomes a live formula
 *     when the file is opened in Excel, and a platform-billing export is precisely the file a finance team opens in
 *     Excel. The quote makes it text.
 *   • Newlines inside a value are preserved but quoted, so a multi-line reason cannot forge extra rows.
 *   • null and undefined become EMPTY, never the string "null" — which a spreadsheet would then sort and sum as text.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  const injectionRisk = /^[=+\-@\t\r]/.test(s);
  const body = injectionRisk ? `'${s}` : s;
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

/** Build the whole CSV from declared columns + rows. Header always present, even for an empty result — a file with no
 *  header is indistinguishable from a failed download. */
export function toCsv(columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>): string {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [head, ...body].join('\r\n');
}

/** A filename that carries the report, the day and the RECEIPT ID. The receipt id in the filename is the point: months
 *  later, somebody holding the file can find the audit row that says who produced it and with what filters. */
export function exportFileName(report: ExportReport, receiptId: string, generatedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  return `krishalaya-${report}-${day}-${short}.csv`;
}

/** Was the export cut off at the limit? Reported on the receipt AND in the UI, because a truncated CSV that looks
 *  complete is how a reconciliation quietly goes wrong. */
export function isTruncated(rowCount: number, limit: number): boolean { return rowCount >= limit; }
