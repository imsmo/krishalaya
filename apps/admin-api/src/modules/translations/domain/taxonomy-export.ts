// apps/admin-api/src/modules/translations/domain/taxonomy-export.ts · the TAXONOMY export vocabulary
// (PC-56 ADMIN-3b, closes ADMIN-3-Q2 — canon W019's "Export tree" and W028's "Export missing"). No I/O.
//
// Same receipt law and same declared-columns discipline as ADMIN-1d's billing exports and ADMIN-2c's support exports: the
// columns are DECLARED here rather than inferred from the query, so adding a field to an export is a deliberate edit to
// this file.
//
// WHAT MAKES THIS PLANE DIFFERENT FROM THE OTHER TWO:
//   • NO DATE WINDOW. A taxonomy is a CURRENT STATE, not a stream of events. "The categories as they are now" is exactly
//     the useful export, and demanding a window would be ceremony borrowed from a different kind of data.
//   • THE MISSING-TRANSLATIONS REPORT IS THE POINT. W028's "Export missing" is what somebody hands to a translator, so it
//     carries the CANONICAL text and the empty target — a list of keys with no source text would be unusable.
//   • NOTHING HERE CARRIES A PERSON. No reviewer ids, no author ids. A translator receiving this file needs the words,
//     and a taxonomy export is not the place to publish who approved what.
export { csvCell, toCsv } from '../../billing-ops/domain/billing-export';

export const TAXONOMY_EXPORT_REPORTS = ['category_tree', 'attributes', 'lookup_values', 'missing_translations'] as const;
export type TaxonomyExportReport = (typeof TAXONOMY_EXPORT_REPORTS)[number];
export function isTaxonomyExportReport(v: string | null | undefined): v is TaxonomyExportReport {
  return !!v && (TAXONOMY_EXPORT_REPORTS as readonly string[]).includes(v);
}

const COLUMNS: Readonly<Record<TaxonomyExportReport, readonly string[]>> = Object.freeze({
  // the tree, flattened — `path` and `depth` are what make a flat file reconstructible into a hierarchy
  category_tree: ['code', 'path', 'depth', 'defaultName', 'commerceKind', 'isActive', 'requiresLicense', 'requiresCertificate'],
  attributes: ['code', 'defaultName', 'dataType', 'unitCode', 'validation', 'boundTo', 'optionCount', 'isActive'],
  lookup_values: ['typeCode', 'code', 'defaultName', 'sortOrder', 'isActive'],
  // WHAT A TRANSLATOR NEEDS: the key, the English words, the target language, and an empty column to fill in.
  missing_translations: ['entityType', 'entityId', 'field', 'sourceText', 'languageCode', 'translation'],
});

export function taxonomyExportColumns(report: TaxonomyExportReport): readonly string[] { return COLUMNS[report]; }

/** Reports that name a LANGUAGE and are therefore meaningless without one. */
export function needsLanguage(report: TaxonomyExportReport): boolean { return report === 'missing_translations'; }

export function taxonomyExportFileName(report: TaxonomyExportReport, receiptId: string, generatedAt: string, lang?: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  const suffix = lang ? `-${lang}` : '';
  return `krishalaya-taxonomy-${report}${suffix}-${day}-${short}.csv`;
}
