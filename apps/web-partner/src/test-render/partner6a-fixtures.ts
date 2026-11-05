// apps/web-partner/src/test-render/partner6a-fixtures.ts · PC-56 PARTNER-6a · WHERE A CLAIM IS NOT PAID — the render tests' shared fixtures:
// the counts read as the API answers it (the SDK type carries counts only — no amount, no claimant, no account), an empty window, the ids a
// claim's settlement page may be opened with (every one must print the SAME page), and the canon's false words as one visible-text regex.
// No person, institution, place, claim reference, account tail or figure from the canon.
import type { PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';

export const COUNTS_6A: PartnerInsuranceClaimCounts = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', total: 23,
  byStatus: { intimated: 4, docs_pending: 2, survey_scheduled: 1, surveyed: 3, approved: 5, partially_approved: 2, rejected: 4, paid: 0, closed: 2 },
  byEvent: { death: 9, hail: 7, flood: 4, not_recorded: 3 },
  decided: { approved: 5, partiallyApproved: 2, rejected: 4 }, computedAt: '2026-11-05T06:30:00.000Z',
};
/** Claims were filed, but none is approved or partially approved — the empty state (paid 0 and the statement still print). */
export const COUNTS_6A_EMPTY: PartnerInsuranceClaimCounts = {
  ...COUNTS_6A, total: 6, byStatus: { intimated: 3, docs_pending: 0, survey_scheduled: 1, surveyed: 1, approved: 0, partially_approved: 0, rejected: 1, paid: 0, closed: 0 },
  decided: { approved: 0, partiallyApproved: 0, rejected: 1 },
};
/** An explicit (non-FY) window. */
export const COUNTS_6A_RANGE: PartnerInsuranceClaimCounts = { ...COUNTS_6A, fy: null, from: '2026-08-01', to: '2026-11-01' };

/** Every id a claim's settlement page may be opened with. The page looks nothing up, so all of them print the same page. */
export const IDS_6A = {
  claim: '0192d2c4-c002-7000-8000-000000000002',
  foreign: '0192d2c4-c0ff-7000-8000-0000000f0e19',
  unknown: '00000000-0000-0000-0000-000000000000',
  malformed: 'not-a-uuid',
  hostile: '"><script>alert(1)</script>',
} as const;

/** The canon's false words as they would appear in VISIBLE text (the refusal list is stripped first — it names what it refuses). */
export const FALSE_6A = /%|₹|ready to pay|paid (FY|today)|today[’']?s run|\b16:00\b|payout_id|\bpo-|zero-sum|reconcil|verified a\/c|a\/c ••|2nd approver|hash-sealed|sha256|watermark|\b7 years\b|reinsurance|cedant|pre-approved|vet desk|ear-tag|money[- ](lands|tonight|in[- ]account)|village can verify|finance role|see plan settings|\bruns?\b|checker|\brails?\b|median|destination|\bCLM-|Kesar|Bhavna|Rathod|\bShah\b|\bIyer\b|Bharat Krishi/i;   // the canon avatar "PM" is scanned case-sensitively in the brand guard (an as-of time prints "pm")

/** Any form control at all. */
export const FORM_CONTROL_6A = /<input|<select|<textarea|<form|<label|<button|\bfor="/i;
