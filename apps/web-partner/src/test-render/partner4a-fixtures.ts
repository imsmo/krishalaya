// apps/web-partner/src/test-render/partner4a-fixtures.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — the render tests' shared
// fixtures: loan facts as the API answers them (the SDK type carries no borrower, no repayment channel, no bank account, no narrative, no
// money-record anchor and no tenant field), the counts in an FY window, and the words no 4a page may print outside its refusal list.
// Neutral names only; no person anywhere, and no canon institution, bank, place, loan number or avatar.
import type { PartnerApplication, PartnerBookCounts, PartnerBookLoan, PartnerBookRepayment } from '@krishalaya/sdk-js';

export const APPLICATIONS: PartnerApplication[] = [
  { id: '0192d2c4-a001-7000-8000-000000000001', applicantRef: '0192d2c4-a001-7000-8000-000000000001', tenantId: '0192d2c4-7001-7000-8000-000000000001',
    product: { id: '0192d2c4-p001-7000-8000-00000000000a', name: 'Fixture seasonal credit' }, purposeCategory: 'crop', purposeText: null,
    amountRequestedMinor: '30000000', amountApprovedMinor: null, status: 'under_review', createdAt: '2026-10-11T04:00:00.123456Z',
    decisionAt: null, coolingOffUntil: null, applicantPhoneMasked: null },
  { id: '0192d2c4-a002-7000-8000-000000000002', applicantRef: '0192d2c4-a002-7000-8000-000000000002', tenantId: '0192d2c4-7001-7000-8000-000000000001',
    product: { id: '0192d2c4-p002-7000-8000-00000000000b', name: 'Fixture dairy credit' }, purposeCategory: null, purposeText: 'inputs for the season',
    amountRequestedMinor: '16000000', amountApprovedMinor: '16000000', status: 'approved', createdAt: '2026-10-09T04:00:00.000000Z',
    decisionAt: '2026-10-10T04:00:00.000Z', coolingOffUntil: '2026-10-11T04:00:00.000Z', applicantPhoneMasked: '••••••318' },
];
/** The one under review, for the decision forms; and the approved one, for the disbursal statement. */
export const APPLICATION = APPLICATIONS[0];
export const APPLICATION_APPROVED = APPLICATIONS[1];

export const LOANS: PartnerBookLoan[] = [
  { id: '0192d2c4-c001-7000-8000-000000000001', applicationId: '0192d2c4-a002-7000-8000-000000000002',
    productId: '0192d2c4-p002-7000-8000-00000000000b', productName: 'Fixture dairy credit', kindCode: 'dairy', fpoName: 'Fixture Dairy Collective',
    principalMinor: '16000000', interestAprBps: 1050, disbursedAt: '2026-02-09', maturityDate: null, status: 'active',
    outstandingMinor: '13841000', nextDueDate: null, openedAt: '2026-02-09T04:00:00.123456Z', lastChangedAt: '2026-07-01T04:00:00.000Z' },
  { id: '0192d2c4-c002-7000-8000-000000000002', applicationId: '0192d2c4-a003-7000-8000-000000000003',
    productId: '0192d2c4-p003-7000-8000-00000000000c', productName: null, kindCode: null, fpoName: null,
    principalMinor: '9007199254740993', interestAprBps: 0, disbursedAt: '2026-09-01', maturityDate: null, status: 'overdue',
    outstandingMinor: '9007199254740993', nextDueDate: null, openedAt: '2026-09-01T04:00:00.000000Z', lastChangedAt: null },
  { id: '0192d2c4-c003-7000-8000-000000000003', applicationId: '0192d2c4-a004-7000-8000-000000000004',
    productId: '0192d2c4-p001-7000-8000-00000000000a', productName: 'Fixture seasonal credit', kindCode: 'crop', fpoName: 'Fixture Growers Collective',
    principalMinor: '5000000', interestAprBps: 1100, disbursedAt: '2026-06-15', maturityDate: null, status: 'written_off',
    outstandingMinor: '1100000', nextDueDate: null, openedAt: '2026-06-15T04:00:00.000000Z', lastChangedAt: '2026-10-01T04:00:00.000Z' },
];
export const LOAN = { ...LOANS[0], computedAt: '2026-10-28T06:30:00.000Z' };

export const REPAYMENTS: PartnerBookRepayment[] = [
  { id: '0192d2c4-r001-7000-8000-000000000001', loanId: LOAN.id, dueDate: '2026-07-03', amountDueMinor: '418000', amountPaidMinor: '418000',
    paidAt: '2026-07-03T04:00:00.000Z', recordedAt: '2026-07-03T04:00:00.123456Z' },
  { id: '0192d2c4-r002-7000-8000-000000000002', loanId: LOAN.id, dueDate: '2026-06-19', amountDueMinor: '418000', amountPaidMinor: '418000',
    paidAt: '2026-06-19T04:00:00.000Z', recordedAt: '2026-06-19T04:00:00.000000Z' },
];

export const COUNTS: PartnerBookCounts = {
  from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', total: 7,
  byStatus: { active: 3, overdue: 1, restructured: 1, closed: 1, written_off: 1 },
  byKind: { crop: 4, dairy: 1, kcc: 1, not_recorded: 1 },
  outstandingByKindMinor: { crop: '400000', dairy: '13841000', kcc: '10000', not_recorded: '0' },
  principalByKindMinor: { crop: '800000', dairy: '16000000', kcc: '70000', not_recorded: '5000' },
  servicing: { count: 4, outstandingMinor: '14241000' },
  restructured: 1, writtenOff: { count: 1, outstandingMinor: '1100000' },
  computedAt: '2026-10-28T06:30:00.000Z',
};
export const COUNTS_EMPTY: PartnerBookCounts = {
  ...COUNTS, total: 0,
  byStatus: Object.fromEntries(Object.keys(COUNTS.byStatus).map((k) => [k, 0])),
  byKind: { not_recorded: 0 }, outstandingByKindMinor: { not_recorded: '0' }, principalByKindMinor: { not_recorded: '0' },
  servicing: { count: 0, outstandingMinor: '0' }, restructured: 0, writtenOff: { count: 0, outstandingMinor: '0' },
};

/** Words no 4a page may print (the canon's lending words, persons, banks, places, ids) — OUTSIDE the refusal list, which NAMES what it
 *  refuses. Note `disburs(e|al|…)` is banned as an ACT; the status word "Disbursed" is legitimate and is not in this pattern. */
export const FALSE_4A = /disburs(e\b|es\b|e[- ]|al\b|als\b|ing\b|ement)|co-?approv|\bSLA\b|clock|credit[- ]?scor|\b742\b|model v|factor|verified platform income|account[- ]?aggregator|aadhaa?r|\b7\/12\b|\bacres?\b|scale[- ]?of[- ]?finance|effective|origination fee|sanction letter|\bEMI\b|schedul|\bon[- ]?time\b|\bDPD\b|\bPAR\b|off[- ]?platform|credit[- ]?officer|servicing role|credit[- ]?risk role|collections role|milk bill|\bherds?\b|ledger anchor|LTX-|\b7 years\b|code of conduct|Saurashtra|Gramin|Kotak|\bSBI\b|Anand|Mehsana|Junagadh|LA-2026|LN-2026|KCC-2026|XXXX-XXXX|\bAJ\b|RBI ref|\bBen\s|Bhai|\+91/i;
/** The markup without the refusal list. Strip the HTML, THEN take its text — never the other way round (the 3a lesson). */
export const withoutRefusals = (html: string) => html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/g, '');
/** Every percentage sign in the visible text. A lending page must have ZERO. */
export const percents = (text: string) => (text.match(/%/g) ?? []).length;
/** The identity and money-plane fields no 4a response or page may carry, at any depth. */
export const IDENTITY_4A = /borrowerUserId|borrower_user_id|repaymentChannel|repayment_channel|"channel"|bankAccount|bank_account|narrative|ledgerTxnId|ledger_txn_id|originationFeeTxnId|origination_fee_txn_id|createdBy|created_by|updatedBy|updated_by|purposeText.*:|decisionNote|decision_note|applicantUserId|applicant_user_id|creditScoreId|credit_score_id/;
