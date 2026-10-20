// apps/web-partner/src/test-render/partner3a-fixtures.ts · PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — the render tests' shared fixtures:
// claim facts as the API answers them (the SDK type carries no claimant, description, surveyor, report, note, media, payout or tenant field),
// the counts in an FY window, and the words no 3a page may print outside its refusal list. Neutral names only; no person anywhere.
import type { PartnerInsuranceClaim, PartnerInsuranceClaimCounts } from '@krishalaya/sdk-js';

export const CLAIMS: PartnerInsuranceClaim[] = [
  { id: '0192d2c4-c001-7000-8000-000000000001', policyId: '0192d2c4-9001-7000-8000-000000000001', policyNo: null, productId: '0192d2c4-aaaa-7000-8000-00000000000a',
    productName: 'Fixture cattle cover', fpoName: 'Fixture Dairy Collective', subjectType: 'animal', sumInsuredMinor: '11000000', eventTypeCode: 'death', eventDate: '2026-10-08',
    status: 'intimated', reportedWithin72h: false, approvedMinor: null, damagePercent: null, filedAt: '2026-10-11T04:00:00.123456Z', lastChangedAt: '2026-10-11T04:00:00.000Z',
    closedAt: null, waitingDays: 9 },
  { id: '0192d2c4-c002-7000-8000-000000000002', policyId: '0192d2c4-9002-7000-8000-000000000002', policyNo: 'INS-0001', productId: '0192d2c4-aaaa-7000-8000-00000000000b',
    productName: null, fpoName: null, subjectType: 'crop_season', sumInsuredMinor: '9007199254740993', eventTypeCode: null, eventDate: '2026-10-15',
    status: 'partially_approved', reportedWithin72h: true, approvedMinor: '2850000', damagePercent: 62, filedAt: '2026-10-16T04:00:00.000000Z', lastChangedAt: '2026-10-18T04:00:00.000Z',
    closedAt: null, waitingDays: 4 },
  { id: '0192d2c4-c003-7000-8000-000000000003', policyId: '0192d2c4-9001-7000-8000-000000000001', policyNo: null, productId: '0192d2c4-aaaa-7000-8000-00000000000a',
    productName: 'Fixture cattle cover', fpoName: 'Fixture Dairy Collective', subjectType: 'animal', sumInsuredMinor: '11000000', eventTypeCode: 'flood', eventDate: '2026-09-01',
    status: 'closed', reportedWithin72h: true, approvedMinor: null, damagePercent: null, filedAt: '2026-09-02T04:00:00.000000Z', lastChangedAt: '2026-09-20T04:00:00.000Z',
    closedAt: '2026-09-20T04:00:00.000Z', waitingDays: null },
];
export const CLAIM = { ...CLAIMS[1], computedAt: '2026-10-20T06:30:00.000Z' };
export const COUNTS: PartnerInsuranceClaimCounts = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', total: 75,
  byStatus: { intimated: 2, docs_pending: 3, survey_scheduled: 1, surveyed: 4, approved: 1, partially_approved: 1, rejected: 3, paid: 4, closed: 56 },
  byEvent: { death: 30, hail: 20, pest: 10, fire: 5, flood: 5, not_recorded: 5 },
  decided: { approved: 1, partiallyApproved: 1, rejected: 3 }, computedAt: '2026-10-20T06:30:00.000Z',
};
export const COUNTS_EMPTY: PartnerInsuranceClaimCounts = { ...COUNTS, total: 0, byStatus: Object.fromEntries(Object.keys(COUNTS.byStatus).map((k) => [k, 0])), byEvent: { not_recorded: 0 },
  decided: { approved: 0, partiallyApproved: 0, rejected: 0 } };

/** Words no 3a page may print (the canon's claims words, persons, numbers) — outside the refusal list, which NAMES what it refuses. */
export const FALSE_3A = /paying|16:00|settlement run|\bvoice\b|second approver|₹\s*1,00,000|94\s*%|appeal path|\b7 years\b|clock|geo-?tag|\bEXIF\b|same device|hash-?sealed|watermark|auto-?verified|duplicat|confidence|re-?shoot|empanel|professional network|paid per|auto-?recuse|cluster|\bslots?\b|quadrat|field sheet|indicated payout|loss ratio|median|ombudsman|jointly funded|risk desk|\bFIR\b|\bserial\b|Kesar|Rathod|\bShah\b|\bIyer\b|BKI-|CLM-|\+91|Bilkha|Junagadh|claimant name|phone number/i;
/** The markup without the refusal list. */
export const withoutRefusals = (html: string) => html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, '');
/** Every percentage sign in the visible text. */
export const percents = (text: string) => (text.match(/%/g) ?? []).length;
