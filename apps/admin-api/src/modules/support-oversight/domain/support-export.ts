// apps/admin-api/src/modules/support-oversight/domain/support-export.ts · pure export vocabulary for the support plane
// (PC-56 ADMIN-2c, closes ADMIN-2-Q5). No I/O → unit-provable.
//
// Same law and same shape as ADMIN-1d's billing exports: columns DECLARED here rather than inferred from the query, so
// adding a field to an export is a deliberate edit to this file. That is what makes "no personal data was added to an
// export by accident" a claim somebody can check by reading one screen of code.
//
// AND IN THIS PLANE THAT MATTERS MORE THAN IT DID FOR BILLING, because a support export can contain three things a
// billing export cannot:
//   1. A FARMER'S OWN WORDS. The 0099 verbatim is free text a person wrote about their own money going missing. It is
//      exportable — a desk lead genuinely needs to read it — but never alongside a user id, so a CSV cannot become a
//      list of named people and what they complained about.
//   2. A NAMED AGENT'S PERFORMANCE. The agent columns are opaque user ids, never names or emails, and the coaching
//      report is deliberately NOT offered as an export at all (see NOT_EXPORTABLE below).
//   3. THE PLATFORM'S OWN VERDICTS about a tenant's desk. Exportable, because the platform is accountable for them.
//
// The CSV shaping (injection defence, quoting, empty-for-null) is imported from the billing module rather than copied:
// one implementation of that guard in this realm, tested once, used twice. A second copy is how one of them ends up
// missing the fix.
export { csvCell, toCsv } from '../../billing-ops/domain/billing-export';

export const SUPPORT_EXPORT_REPORTS = ['tickets', 'sla_breaches', 'csat', 'csat_verbatims', 'csat_reviews'] as const;
export type SupportExportReport = (typeof SUPPORT_EXPORT_REPORTS)[number];
export function isSupportExportReport(v: string | null | undefined): v is SupportExportReport {
  return !!v && (SUPPORT_EXPORT_REPORTS as readonly string[]).includes(v);
}

/**
 * WHAT IS DELIBERATELY NOT EXPORTABLE, recorded here so the absence reads as a decision rather than an oversight.
 *
 * `coaching` — the 0100 records. A coaching export is a spreadsheet of named individuals and written judgements about
 * their competence, which can be forwarded anywhere and outlives every context that made it fair. The console shows
 * them, filtered and in context, to somebody holding the permission; a CSV strips all of that. If this is ever needed,
 * it wants a retention decision and a named owner, not a download button.
 */
export const NOT_EXPORTABLE = Object.freeze({
  coaching: 'A coaching export would be a portable spreadsheet of named people and judgements about their competence. It is shown in the console, in context, and not offered as a file.',
});

/** The exact columns, in order, per report. */
const COLUMNS: Readonly<Record<SupportExportReport, readonly string[]>> = Object.freeze({
  tickets: ['ticketNo', 'tenantSlug', 'severity', 'status', 'sla', 'createdAt', 'firstRespondedAt', 'resolvedAt'],
  // The breach report is the one a tenant may end up reading in an argument about a missed promise, so it carries the
  // TARGET as well as the overrun — an overrun with no target beside it is a number nobody can check.
  sla_breaches: ['ticketNo', 'tenantSlug', 'severity', 'status', 'breachKind', 'dueAt', 'overdueMinutes', 'createdAt'],
  // Scores WITHOUT the words: the common case is a trend analysis, and it does not need anybody's free text.
  csat: ['ticketNo', 'tenantSlug', 'score', 'ratedAt', 'ratedAtIsEstimated', 'severity', 'agentUserId', 'reviewCount', 'latestVerdict'],
  // The words, WITHOUT the respondent. Deliberate asymmetry (point 1 in the header): the comment is here, the person
  // who wrote it is not, so this file cannot become a list of named farmers and their complaints.
  csat_verbatims: ['ticketNo', 'tenantSlug', 'score', 'commentLanguage', 'comment', 'ratedAt', 'ratedAtIsEstimated'],
  // The platform's own judgements. The reviewer IS included: the platform is accountable for its verdicts, and an
  // anonymous verdict about somebody's work is exactly what the rest of this wave refuses.
  csat_reviews: ['ticketNo', 'tenantSlug', 'score', 'verdict', 'finding', 'reviewerAdminId', 'reviewedAt', 'coachingCreated'],
});

export function supportExportColumns(report: SupportExportReport): readonly string[] { return COLUMNS[report]; }

/** Columns whose presence in a report means the file contains free text somebody wrote about themselves. Used to add a
 *  visible warning to the receipt, so the audit row records that a verbatim export happened — not merely "an export". */
export function containsVerbatim(report: SupportExportReport): boolean {
  return supportExportColumns(report).includes('comment') || supportExportColumns(report).includes('finding');
}

/** A filename carrying report, day and RECEIPT ID, matching ADMIN-1d exactly so a support CSV and a billing CSV found
 *  in the same folder are traceable the same way. */
export function supportExportFileName(report: SupportExportReport, receiptId: string, generatedAt: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  return `krishalaya-support-${report}-${day}-${short}.csv`;
}
