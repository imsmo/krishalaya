// apps/web-admin/src/features/support/export.ts · the SUPPORT export form (PC-56 ADMIN-2c, canon W1944-45, W2270-71).
//
// The CSV BYTES are written by `features/billing/csv.ts` — imported, not copied. That module carries the CSV-injection
// guard, and this plane needs it more than billing does: the verbatim column is free text a farmer typed, so a comment
// beginning `=` is not a hypothetical here. A second copy of that guard is how one of them ends up missing the fix.
export { toCsv } from '../billing/csv';

export const SUPPORT_REPORTS = ['tickets', 'sla_breaches', 'csat', 'csat_verbatims', 'csat_reviews'] as const;
export type SupportReport = (typeof SUPPORT_REPORTS)[number];

/** Reports whose file contains words somebody wrote about their own problem. The page warns before the download, not
 *  after — a warning that arrives with the file is a warning about something already done. */
const FREE_TEXT = new Set<SupportReport>(['csat_verbatims', 'csat_reviews']);
export function carriesFreeText(report: string): boolean { return FREE_TEXT.has(report as SupportReport); }

/** Reports for which a score filter is meaningful. Offering "scores up to 2" on a ticket export would be a control that
 *  silently does nothing, which teaches people the filters are decorative. */
const SCORED = new Set<SupportReport>(['csat', 'csat_verbatims', 'csat_reviews']);
export function acceptsScoreFilter(report: string): boolean { return SCORED.has(report as SupportReport); }

export const MAX_EXPORT_ROWS = 5000;
export const DEFAULT_EXPORT_ROWS = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SupportExportPayload {
  report: SupportReport; from: string; to: string;
  tenantId?: string; maxScore?: number; limit: number;
}
export type BuiltExport = { ok: true; value: SupportExportPayload } | { ok: false; error: string };

/**
 * Validate the export form.
 *
 * A WINDOW IS REQUIRED — the server refuses without one, and this repeats the check so the operator gets a sentence
 * instead of a round trip. There is no meaningful unbounded export of support data: "every conversation ever" is not a
 * report anybody asked a question with.
 *
 * THE LIMIT IS CLAMPED, NOT DROPPED. A page size is a request about the transfer, not a question about the data, so an
 * over-large value becomes the maximum. (ADMIN-1d shipped the opposite bug — a regex that could not match "99999", so an
 * over-max limit silently became the DEFAULT rather than the maximum. Hence the wide digit range below.)
 */
export function buildSupportExport(raw: {
  report: string; from: string; to: string; tenantId?: string; maxScore?: string; limit?: string;
}): BuiltExport {
  const report = raw.report.trim();
  if (!(SUPPORT_REPORTS as readonly string[]).includes(report)) return { ok: false, error: 'report' };

  const from = raw.from.trim();
  const to = raw.to.trim();
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { ok: false, error: 'window' };
  if (from >= to) return { ok: false, error: 'window' };

  const value: SupportExportPayload = {
    report: report as SupportReport,
    // sent as instants: the API's window is timestamptz, and a bare date would be read as midnight UTC — five and a half
    // hours off the day an Indian operator meant
    from: `${from}T00:00:00.000Z`,
    to: `${to}T00:00:00.000Z`,
    limit: DEFAULT_EXPORT_ROWS,
  };

  const limitRaw = (raw.limit ?? '').trim();
  if (limitRaw) {
    if (!/^\d{1,7}$/.test(limitRaw)) return { ok: false, error: 'limit' };
    value.limit = Math.min(Math.max(Number(limitRaw), 1), MAX_EXPORT_ROWS);
  }

  const tenantId = (raw.tenantId ?? '').trim();
  if (tenantId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return { ok: false, error: 'tenant' };
    value.tenantId = tenantId;
  }

  const maxScoreRaw = (raw.maxScore ?? '').trim();
  if (maxScoreRaw) {
    // DROPPED rather than clamped when the report cannot use it: silently applying a score filter to a ticket export
    // would produce a file that does not match what the operator asked for
    if (!acceptsScoreFilter(report)) return { ok: true, value };
    if (!/^[1-5]$/.test(maxScoreRaw)) return { ok: false, error: 'maxScore' };
    value.maxScore = Number(maxScoreRaw);
  }
  return { ok: true, value };
}

/** A filename carrying report, day and RECEIPT ID — matching admin-api's own helper exactly, so a file traced from the
 *  console and a file traced from the server agree. */
export function supportExportFileName(report: string, receiptId: string, generatedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  return `krishalaya-support-${report}-${day}-${short}.csv`;
}
