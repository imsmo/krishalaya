// apps/admin-api/src/modules/schemes-registry-ops/domain/scheme-export.ts · the registry's export contract
// (W2251 queued / W2252 ready), under the W054-10 audit-receipt law: NO RECEIPT MEANS NO FILE.
//
// Same shape as billing-ops, support-oversight and translations, and `csvCell`/`toCsv` are IMPORTED from
// billing-export rather than copied — a fourth private CSV escaper is a fourth place for a quoting bug to live.
import { csvCell, toCsv } from '../../billing-ops/domain/billing-export';
import { ExportReportUnknownError } from './schemes-registry.errors';

export { csvCell, toCsv };

/** What this plane exports. Registry data only — global, no tenant, no person. */
export const SCHEME_EXPORT_REPORTS = ['schemes', 'authorities', 'versions', 'calendar'] as const;
export type SchemeExportReport = (typeof SCHEME_EXPORT_REPORTS)[number];
export function isSchemeExportReport(v: string): v is SchemeExportReport {
  return (SCHEME_EXPORT_REPORTS as readonly string[]).includes(v);
}
export function assertSchemeExportReport(v: string): SchemeExportReport {
  if (!isSchemeExportReport(v)) throw new ExportReportUnknownError(v, SCHEME_EXPORT_REPORTS);
  return v;
}

/** THE REPORTS THIS PLANE REFUSES, each with the reason written down where the next person will look.
 *
 *  W074 (applications) and W076 (DBT) both show an Export button, and both sit behind this module's read permission
 *  today. Neither is exportable HERE, and the reasons are different in kind:
 *    • `applications` carries a named farmer, a phone number and a government application reference — cross-tenant
 *      PII. W074's own restricted state names a SEPARATE permission for it (`schemes.applications.read`), which does
 *      not exist yet. Exporting it under `schemes.registry.read` would let a scheme-catalogue editor download every
 *      applicant in the country, and the export would be indistinguishable in the audit log from a taxonomy dump.
 *    • `dbt` carries bank-side settlement references. W076 states the rule outright — "bank fields never shown here
 *      at all" — and `dbt_bounces.bank_ref` exists, so a naive `SELECT *` export would carry exactly the field the
 *      canon forbids the screen from displaying.
 *  Both belong to the oversight plane (ADMIN-4b), with their own permission and their own forbidden-column law. The
 *  list is here rather than absent so that adding one is a deliberate act against a stated reason.
 */
export const NOT_EXPORTABLE: Record<string, string> = {
  applications: 'scheme applications carry cross-tenant applicant PII and need their own permission (schemes.applications.read) and its own export receipt — not the registry read permission',
  dbt: 'DBT transfers carry bank-side settlement references; W076 forbids bank fields on this surface entirely, so the export needs an explicit forbidden-column law, not a row dump',
};

/** Columns per report: [header, row key]. Explicit, ordered, and NEVER `SELECT *` — a widened table must not silently
 *  widen a file somebody has a parser pointed at. */
export function schemeExportColumns(report: SchemeExportReport): Array<[string, string]> {
  switch (report) {
    case 'schemes':
      return [
        ['code', 'code'], ['scheme', 'default_name'], ['authority', 'authority_name'], ['authority_level', 'authority_level'],
        ['category', 'category_name'], ['version', 'version'], ['active', 'is_active'],
        // The header says minor units because the value IS minor units. A column headed "processing_fee" invites the
        // reader to divide by 100 in their head, and a fee of 5000 paise read as ₹5,000 is a hundredfold error.
        ['processing_fee_minor_units', 'processing_fee_minor'],
        ['window_opens_mm_dd', 'window_opens'], ['window_closes_mm_dd', 'window_closes'], ['window_season', 'window_season'],
        ['required_docs', 'required_doc_count'], ['regions', 'region_count'], ['source_url', 'source_url'], ['created_at', 'created_at'],
      ];
    case 'authorities':
      return [
        ['authority', 'default_name'], ['level', 'level'], ['region', 'region_name'], ['active_schemes', 'active_schemes'],
        // "portal_mapped" and not "portal_status": a mapping is a record of which portal an authority files through,
        // never evidence that a sync succeeded. See domain/scheme-version.ts portalStateOf.
        ['portal_mapped_provider', 'portal_provider'], ['portal_external_id', 'portal_external_id'], ['created_at', 'created_at'],
      ];
    case 'versions':
      return [
        ['scheme_code', 'scheme_code'], ['version', 'version'], ['status', 'status'],
        // Travels on every row: a downstream reader must be able to separate a version a human signed from one
        // migration 0105 recorded on the platform's behalf.
        ['backfilled_not_signed', 'is_backfilled'], ['has_maker', 'has_maker'], ['has_checker', 'has_checker'],
        ['processing_fee_minor_units', 'processing_fee_minor'],
        ['window_opens_mm_dd', 'window_opens'], ['window_closes_mm_dd', 'window_closes'],
        ['change_reason', 'change_reason'], ['checker_note', 'checker_note'], ['drafted_at', 'drafted_at'], ['published_at', 'published_at'],
      ];
    case 'calendar':
      return [
        ['code', 'code'], ['scheme', 'default_name'], ['season', 'season'],
        ['opens_mm_dd', 'opens'], ['closes_mm_dd', 'closes'], ['wraps_year_end', 'wraps_year'], ['version', 'version'],
      ];
  }
}

/** Deterministic file name carrying the receipt id, so a file on somebody's desktop can be traced back to the audit
 *  row that authorised it. Mirrors billing/support/taxonomy. */
export function schemeExportFileName(report: SchemeExportReport, receiptId: string, generatedAt: Date): string {
  const day = generatedAt.toISOString().slice(0, 10);
  const short = receiptId.replace(/-/g, '').slice(0, 8);
  return `krishalaya-schemes-${report}-${day}-${short}.csv`;
}

/** A file at the row cap may be a TRUNCATED file, and a truncated registry export read as complete is how a
 *  taxonomy migration loses schemes silently. */
export function isTruncated(rowCount: number, limit: number): boolean {
  return rowCount >= limit;
}

/** No date window on any report here, and that is a decision rather than an omission: a registry is a CURRENT STATE,
 *  not a stream of events. "Schemes between March and June" is not a question the object model can answer — a scheme
 *  has no occurrence date, only a created_at, and filtering a catalogue by when its rows happened to be typed would
 *  produce a file that looks like a scheme list and is not one. The version report is the closest thing to a stream
 *  and it is still exported whole, because a partial version ledger is worse than none: the gaps are invisible. */
export const NO_DATE_WINDOW_REASON = 'a registry export is a snapshot of current state; only the version ledger has dates and it is exported whole so its gaps cannot be hidden by a filter';
