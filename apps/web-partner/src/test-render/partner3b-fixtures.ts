// apps/web-partner/src/test-render/partner3b-fixtures.ts · PC-56 PARTNER-3b · WHAT THE INSURER DOES NOT HOLD — the render tests' shared
// fixtures. They reuse PARTNER-3a's claim and counts fixtures (the SDK type has no claimant, description, surveyor, report, note, media, payout
// or tenant field to fill), and add: a claim in `survey_scheduled` with NO damage percentage, a `surveyed` claim WITH one, the four survey-stage
// rows, and the words the 3b pages must never print — on top of 3a's `FALSE_3A`: the remaining canon people and honorifics, the four places, the
// flag series and its rates, the two scores, the breed, the schemes, the methodology words, and anything that smells of a media item.
import type { PartnerInsuranceClaim, PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';
import { CLAIMS, COUNTS } from './partner3a-fixtures';

/** The four survey stages as the surveys page receives them from PARTNER-3a's list read (oldest first, as the server answered). */
export const STAGE_ROWS: PartnerInsuranceClaim[] = [
  { ...CLAIMS[0], id: '0192d2c4-d001-7000-8000-000000000001', status: 'survey_scheduled', damagePercent: null, waitingDays: 12 },
  { ...CLAIMS[1], id: '0192d2c4-d002-7000-8000-000000000002', status: 'survey_scheduled', damagePercent: null, waitingDays: 3 },
];
/** One claim awaiting a survey (nothing recorded), and one surveyed with the recorded damage percentage. */
export const CLAIM_SCHEDULED = { ...CLAIMS[0], status: 'survey_scheduled', damagePercent: null, computedAt: '2026-10-28T06:30:00.000Z' };
export const CLAIM_SURVEYED = { ...CLAIMS[1], status: 'surveyed', damagePercent: 62, computedAt: '2026-10-28T06:30:00.000Z' };
export const CLAIM_SURVEYED_NO_DAMAGE = { ...CLAIM_SURVEYED, damagePercent: null };

export const COUNTS_3B: PartnerInsuranceClaimCounts = COUNTS;
/** Nothing in any survey stage — the evidence page's empty state (claims were still filed in the window). */
export const COUNTS_NO_STAGE: PartnerInsuranceClaimCounts = {
  ...COUNTS, total: 9,
  byStatus: { intimated: 0, docs_pending: 0, survey_scheduled: 0, surveyed: 0, approved: 2, partially_approved: 1, rejected: 2, paid: 2, closed: 2 },
};

/** The canon's 3b words, beyond 3a's `FALSE_3A`: no page may print any of them outside its refusal list. */
export const FALSE_3B = /Vaghela|Chudasama|Manju|Popat|Jashu|Karsan|\bBen\s|Bhai|\bDr\.|Bhavnagar|Junagadh|Amreli|Bilkha|FRD-|flag rate|false-?flag|0\.9410|0\.8830|Jaffarabadi|\bANM\b|WBCIS|\bCCE\b|reference (undamaged )?plot|\bGPS\b|theft-?then-?listing|flagged automatically|server-?side|ear[- ]?tag|vaccinat|\bsame[- ]day\b|\bacres?\b|provisional hold|risk case/i;
/** Anything that would be a MEDIA item: a count of one, a file, a URL. Founder 3b-1: counts of CLAIMS only, never of media. */
export const MEDIA_WORDS = /photo|video|image|document|media|attachment|file/i;
export const MEDIA_FILES = /\.jpe?g|\.png|\.mp4|\.mov|\.pdf|https?:\/\//i;
/** The identity FIELDS the API never answers (never the English words "description" or "notes", which the honest copy uses to refuse them). */
//  (`survey_report` in snake case is this wave's SURFACE name — `data-kv-insurer="survey_report"` — so the camel-case field name is the pin.)
export const IDENTITY_FIELDS = /claimantUserId|claimant_user_id|surveyorUserId|surveyor_user_id|surveyReport|tenantId|tenant_id|payoutId|payout_id|createdBy|created_by|updatedBy|updated_by|holderUserId|uploaderUserId/;
/** A digit next to a media word, in either order — "3 photos", "photos: 3", "1 video (0:42)". The claim STATUS "Documents pending" is a status
 *  of the state machine, not a count of documents, so it is taken out before the scan (its tab carries a count of CLAIMS). */
export const mediaCount = (text: string) => {
  const t = text.replace(/Documents pending/gi, 'DOCS_PENDING_STATUS');
  return [...t.matchAll(/(\d[\d,]*)\s*(photo|video|image|document|media|attachment|file)s?\b/gi)].map((m) => m[0])
    .concat([...t.matchAll(/\b(photo|video|image|document|media|attachment|file)s?\b[^.<]{0,12}?(\d[\d,]*)/gi)].map((m) => m[0]));
};
