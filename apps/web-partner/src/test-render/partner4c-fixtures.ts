// apps/web-partner/src/test-render/partner4c-fixtures.ts · PC-56 PARTNER-4c · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP — the render tests'
// shared fixtures: ONE loan whose product kind is `kcc` (which is all a "KCC account" is on this platform), the words no 4c page may print
// outside its refusal list, and the two assertions this wave turns on — that no FIELD of the drawl ledger is named anywhere, and that no
// DIGIT stands beside a drawl, balance or interest word on the drawls page (founder 4c-1: nothing of the ledger reaches a lender).
// Neutral figures only; no person, no bank, no place, no crop, no account number, no avatar.
import type { PartnerBookLoan } from '@krishalaya/sdk-js';

/** A loan of the kind the canon draws as a "KCC account": an ordinary loan whose product kind code is `kcc`. */
export const KCC_LOAN: PartnerBookLoan & { computedAt: string } = {
  id: '0192d2c4-c0cc-7000-8000-000000000001', applicationId: '0192d2c4-a0cc-7000-8000-000000000002',
  productId: '0192d2c4-p0cc-7000-8000-00000000000b', productName: 'Fixture seasonal credit line', kindCode: 'kcc',
  fpoName: 'Fixture Growers Collective', principalMinor: '40000000', interestAprBps: 700, disbursedAt: '2026-02-09',
  maturityDate: null, status: 'active', outstandingMinor: '22000000', nextDueDate: null,
  openedAt: '2026-02-09T04:00:00.123456Z', lastChangedAt: '2026-07-01T04:00:00.000Z',
  computedAt: '2026-10-28T06:30:00.000Z',
};
/** The same loan with nothing resolved — a product this axis cannot name and a kind code it cannot resolve. */
export const KCC_LOAN_BARE: PartnerBookLoan & { computedAt: string } = {
  ...KCC_LOAN, id: '0192d2c4-c0cc-7000-8000-000000000003', productName: null, kindCode: null, fpoName: null,
  principalMinor: '9007199254740993', interestAprBps: 0, outstandingMinor: '9007199254740993', status: 'overdue',
};

/** Words no 4c page may print OUTSIDE its refusal list, which names what it refuses: the canon's account, its figures, its engines, its
 *  person, her crops and her account number — plus 4a's and 4b's own banned words. */
export const FALSE_4C = /revolving|credit limit|\blimit ₹|unused limit|drawing power|scale[- ]?of[- ]?finance|worksheet|renewal|limit review|utilisation|utilization|headroom|available ₹|accrual|accrue|interest applied|interest accrued|subvention credited|prompt[- ]?repayment|purpose check|moneylender|ledger is append-?only|append-?only and safe|one truth, two languages|cotton|cumin|KCC-|Jayesh|supplier[- ]?direct|harvest_settlement|kharif|disburs(e\b|es\b|e[- ]|al\b|als\b|ing\b|ement)|\bSLA\b|credit[- ]?scor|effective|schedul|\bon[- ]?time\b|\bDPD\b|\bPAR\b|servicing role|credit[- ]?officer|milk bill|\bherds?\b|\bacres?\b|Saurashtra|Gramin|Kotak|\bSBI\b|Anand|Mehsana|Junagadh|\bAJ\b|RBI ref|\bBen\s|Bhai|\+91/i;

/** Every FIELD name of `kcc_drawl_ledger` (0069:75-97) — none may appear in the markup of either KCC page, at any depth. */
export const LEDGER_FIELDS = /entryKind|entry_kind|amountMinor|amount_minor|balanceAfterMinor|balance_after_minor|narrative|destinationKind|destination_kind|purposeCheckStatus|purpose_check_status|repaymentChannel|repayment_channel|accrualBasis|accrual_basis|ledgerTxnId|ledger_txn_id|entryDate|entry_date/i;

/** THE ASSERTION OF THIS WAVE (founder 4c-1): not one DIGIT stands beside a drawl, a balance or an interest word — in any direction, in any
 *  language — because no figure of the ledger reaches a lender at all. Returns the offending fragments, so a failure names itself. */
export function figuresBesideLedgerWords(text: string): string[] {
  const WORDS = 'drawl|drawls|drawn|balance|interest|repaid|ledger|entry|entries|ઉપાડ|વ્યાજ|સરવાળો|चोपड|निकासी|ब्याज|जोड़|बही|चोपड़';
  const res = [
    new RegExp(`(?:${WORDS})[^.।॥]{0,24}?[\\d०-९૦-૯]`, 'gi'),
    new RegExp(`[\\d०-९૦-૯][^.।॥]{0,24}?(?:${WORDS})`, 'gi'),
  ];
  return res.flatMap((re) => text.match(re) ?? []);
}
