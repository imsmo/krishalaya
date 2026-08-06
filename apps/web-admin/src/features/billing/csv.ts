// apps/web-admin/src/features/billing/csv.ts · CSV shaping for the console's downloads (PC-56 ADMIN-1d).
// A DELIBERATE MIRROR of admin-api's `domain/billing-export.ts`: the server owns which columns may leave the platform,
// this owns how they are written into a file. Duplicating ~30 lines is the right trade against making the console
// import from an API app — and the injection defence in particular must exist on whichever side writes the bytes.
// Pinned by its own spec, and the two implementations are asserted to agree on the injection rule.

/**
 * One CSV cell. The important line is the injection guard.
 *
 * A value beginning `=`, `+`, `-`, `@` or a control character becomes a live FORMULA when the file is opened in Excel
 * or Sheets. Tenant-controlled text reaches these exports (a slug, an adjustment reason), and a platform-billing CSV is
 * exactly the file a finance team opens in Excel. Prefixing a quote makes it text and costs nothing.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  const injectionRisk = /^[=+\-@\t\r]/.test(s);
  const body = injectionRisk ? `'${s}` : s;
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body;
}

/** The whole file. A header is always written, even for an empty result — a file with no header is indistinguishable
 *  from a failed download, and somebody will treat it as "no data" rather than "no file". */
export function toCsv(columns: readonly string[], rows: ReadonlyArray<Record<string, unknown>>): string {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return [head, ...body].join('\r\n');
}

/** Filename carrying report, day and RECEIPT ID — so a file found months later can be traced to the audit row that
 *  says who produced it and with which filters. */
export function exportFileName(report: string, receiptId: string, generatedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  const safeReport = report.replace(/[^a-z0-9-]/gi, '') || 'export';
  return `krishalaya-${safeReport}-${day}-${short}.csv`;
}
