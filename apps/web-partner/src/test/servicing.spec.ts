// apps/web-partner/src/test/servicing.spec.ts · PC-55 B7. The lending-servicing and insurer-authoring rules.
// Every case here is a place where a wrong default costs a borrower money, mis-prices a policy, or turns a
// two-person control into a one-person formality.
import {
  DPD_ORDER, KCC_ENTRY_KINDS, RESTRUCTURE_STATUSES,
  dpdRank, sortDpd, isNpaBucket, totalLoans, kccSign, isKccEntryKind, buildKccEntry, kccRowDirection, absMinor,
  offeredTransitions, awaitingChecker, isRestructureStatus, buildRestructure, canWriteOff, buildWriteOff,
} from '../features/lending/servicing';
import {
  CALC_MODES, isCalcMode, buildPremiumCalc, buildProduct, describeCalc,
  canIssue, issueBlockedReason, buildIssue, lossRatioBps, sumMinor, countByStatus,
} from '../features/insurance/authoring';
import { parseMajorToMinor } from '../features/money';

const M = parseMajorToMinor;

describe('money parsing stays float-free and paise-precise', () => {
  it('parses two decimals, rejects junk', () => {
    expect(M('2000')).toBe('200000');
    expect(M('2000.50')).toBe('200050');
    expect(M('0.05')).toBe('5');
    expect(M('abc')).toBeUndefined();
    expect(M('-5')).toBeUndefined();
    expect(M('1.005')).toBeUndefined();
    expect(M('')).toBeUndefined();
  });
});

describe('DPD ladder — the worst bucket is never buried', () => {
  it('orders worst-first and pushes an unknown bucket LAST', () => {
    expect([...DPD_ORDER]).toEqual(['180+', '90-179', '60-89', '30-59', '1-29', 'current']);
    const rows = [{ bucket: 'current' }, { bucket: 'mystery' }, { bucket: '180+' }, { bucket: '30-59' }];
    expect(sortDpd(rows).map((r) => r.bucket)).toEqual(['180+', '30-59', 'current', 'mystery']);
    expect(dpdRank('nope')).toBe(DPD_ORDER.length);
  });
  it('labels 90+ as NPA and nothing else', () => {
    expect(isNpaBucket('90-179')).toBe(true);
    expect(isNpaBucket('180+')).toBe(true);
    expect(isNpaBucket('60-89')).toBe(false);
    expect(isNpaBucket('current')).toBe(false);
  });
  it('totals only the loans the API returned', () => {
    expect(totalLoans([{ loans: 3 }, { loans: 4 }, { loans: null }, {}])).toBe(7);
    expect(totalLoans([])).toBe(0);
  });
});

describe('KCC ledger — the entry TYPE carries the sign', () => {
  it('knows which kinds add to the drawn balance', () => {
    expect([...KCC_ENTRY_KINDS]).toEqual(['drawl', 'repayment', 'interest']);
    expect(kccSign('drawl')).toBe(1);
    expect(kccSign('interest')).toBe(1);
    expect(kccSign('repayment')).toBe(-1);
    expect(isKccEntryKind('writeoff')).toBe(false);
  });

  const base = { entryKind: 'drawl', amountMajor: '20000', narrative: 'seed and fertiliser', destinationKind: '', repaymentChannel: '' };

  it('always sends a POSITIVE amount — the sign is the server’s to apply', () => {
    const r = buildKccEntry(base, M);
    expect(r).toEqual({ ok: true, value: { entryKind: 'drawl', amountMinor: '2000000', narrative: 'seed and fertiliser' } });
  });
  it('refuses a zero or unreadable amount, and demands a purpose', () => {
    expect(buildKccEntry({ ...base, amountMajor: '0' }, M)).toEqual({ ok: false, error: 'amount' });
    expect(buildKccEntry({ ...base, amountMajor: 'lots' }, M)).toEqual({ ok: false, error: 'amount' });
    expect(buildKccEntry({ ...base, narrative: 'ok' }, M)).toEqual({ ok: false, error: 'narrative' });
  });
  it('keeps channel and destination on the entry types they belong to', () => {
    expect(buildKccEntry({ ...base, repaymentChannel: 'upi' }, M)).toEqual({ ok: false, error: 'channel' });        // a drawl has no channel
    expect(buildKccEntry({ ...base, entryKind: 'repayment', destinationKind: 'other' }, M)).toEqual({ ok: false, error: 'destination' });
    const ok = buildKccEntry({ ...base, entryKind: 'repayment', repaymentChannel: 'milk_bill_deduction' }, M);
    expect(ok.ok && ok.value.repaymentChannel).toBe('milk_bill_deduction');
    expect(buildKccEntry({ ...base, repaymentChannel: 'barter' }, M)).toEqual({ ok: false, error: 'channel' });
  });
  it('reads a signed ledger row without recomputing anything', () => {
    expect(kccRowDirection('-5000')).toBe('out');
    expect(kccRowDirection('5000')).toBe('in');
    expect(kccRowDirection(null)).toBe('unknown');
    expect(absMinor('-5000')).toBe('5000');
    expect(absMinor('5000')).toBe('5000');
  });
});

describe('restructure — maker-checker is enforced by ABSENCE', () => {
  it('mirrors the server’s flow exactly', () => {
    expect([...RESTRUCTURE_STATUSES]).toEqual(['draft', 'mediation', 'accepted', 'checker_approved', 'activated', 'rejected', 'expired']);
    expect(offeredTransitions('draft', 'u1', 'u2')).toEqual(['mediation', 'rejected']);
    expect(offeredTransitions('mediation', 'u1', 'u2')).toEqual(['accepted', 'rejected', 'expired']);
    expect(offeredTransitions('checker_approved', 'u1', 'u2')).toEqual(['activated', 'rejected']);
    expect(offeredTransitions('activated', 'u1', 'u2')).toEqual([]);
    expect(offeredTransitions('nonsense', 'u1', 'u2')).toEqual([]);
    expect(isRestructureStatus('accepted')).toBe(true);
  });
  it('does NOT offer checker approval to the person who proposed it', () => {
    expect(offeredTransitions('accepted', 'officer-1', 'officer-2')).toEqual(['checker_approved', 'rejected']);
    expect(offeredTransitions('accepted', 'officer-1', 'officer-1')).toEqual(['rejected']);
  });
  it('flags the state where a borrower is waiting on an internal handoff', () => {
    expect(awaitingChecker('accepted')).toBe(true);
    expect(awaitingChecker('mediation')).toBe(false);
  });

  const rs = {
    reasonCode: 'weather_distress', oldInstalmentMajor: '5000', newInstalmentMajor: '3500',
    oldTenorMonths: '24', newTenorMonths: '36', rateAprBps: '900', currentRateAprBps: 900,
    totalInterestDeltaMajor: '1200', caseRef: 'DR-2026-11', holidayMonths: '', holidayStartsOn: '', penalInterestWaived: false,
  };

  it('builds a proposal that relieves the borrower', () => {
    const r = buildRestructure(rs, M);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      reasonCode: 'weather_distress', oldInstalmentMinor: '500000', newInstalmentMinor: '350000',
      oldTenorMonths: 24, newTenorMonths: 36, rateAprBps: 900, totalInterestDeltaMinor: '120000', caseRef: 'DR-2026-11',
    });
  });
  it('REFUSES a rate change — a restructure re-shapes the schedule, it does not re-price the debt', () => {
    expect(buildRestructure({ ...rs, rateAprBps: '1200' }, M)).toEqual({ ok: false, error: 'rateChanged' });
    expect(buildRestructure({ ...rs, rateAprBps: '800' }, M)).toEqual({ ok: false, error: 'rateChanged' });
  });
  it('REFUSES a proposal that relieves nothing (same instalment, same tenor, no holiday)', () => {
    expect(buildRestructure({ ...rs, newInstalmentMajor: '5000', newTenorMonths: '24' }, M)).toEqual({ ok: false, error: 'noRelief' });
    // …but a holiday alone IS relief.
    expect(buildRestructure({ ...rs, newInstalmentMajor: '5000', newTenorMonths: '24', holidayMonths: '3' }, M).ok).toBe(true);
  });
  it('refuses a holiday start date with no holiday months, and out-of-range numbers', () => {
    expect(buildRestructure({ ...rs, holidayStartsOn: '2026-09-01' }, M)).toEqual({ ok: false, error: 'holidayMonths' });
    expect(buildRestructure({ ...rs, holidayMonths: '25' }, M)).toEqual({ ok: false, error: 'holidayMonths' });
    expect(buildRestructure({ ...rs, newTenorMonths: '36.5' }, M)).toEqual({ ok: false, error: 'newTenor' });
    expect(buildRestructure({ ...rs, reasonCode: 'because' }, M)).toEqual({ ok: false, error: 'reason' });
  });
});

describe('write-off — only from overdue, always with a reason', () => {
  it('offers itself on overdue only', () => {
    expect(canWriteOff('overdue')).toBe(true);
    expect(canWriteOff('active')).toBe(false);
    expect(canWriteOff('written_off')).toBe(false);
    expect(canWriteOff(null)).toBe(false);
  });
  it('demands a written reason, and refuses on a paying loan even if a reason was typed', () => {
    expect(buildWriteOff({ reason: 'crop failure, no recovery' }, 'overdue')).toEqual({ ok: true, value: { reason: 'crop failure, no recovery' } });
    expect(buildWriteOff({ reason: ' ' }, 'overdue')).toEqual({ ok: false, error: 'reason' });
    expect(buildWriteOff({ reason: 'crop failure' }, 'active')).toEqual({ ok: false, error: 'status' });
  });
});

describe('premium formula — exactly one shape, never a hybrid', () => {
  const blank = { mode: 'pct_of_sum_insured', pct: '', flatMajor: '', parametricJson: '' };
  it('builds each of the three shapes the server accepts', () => {
    expect([...CALC_MODES]).toEqual(['pct_of_sum_insured', 'flat_minor', 'parametric']);
    expect(buildPremiumCalc({ ...blank, pct: '2.5' }, M)).toEqual({ ok: true, value: { pct_of_sum_insured: 2.5 } });
    expect(buildPremiumCalc({ ...blank, mode: 'flat_minor', flatMajor: '350' }, M)).toEqual({ ok: true, value: { flat_minor: '35000' } });
    expect(buildPremiumCalc({ ...blank, mode: 'parametric', parametricJson: '{"rainfall_mm_below":400}' }, M))
      .toEqual({ ok: true, value: { parametric: { rainfall_mm_below: 400 } } });
  });
  it('sends ONLY the chosen shape, even when other fields were filled', () => {
    const r = buildPremiumCalc({ mode: 'pct_of_sum_insured', pct: '2', flatMajor: '999', parametricJson: '{"x":1}' }, M);
    expect(r).toEqual({ ok: true, value: { pct_of_sum_insured: 2 } });   // no flat_minor, no parametric
  });
  it('refuses a zero percentage (free cover is not a product) and a zero flat premium', () => {
    expect(buildPremiumCalc({ ...blank, pct: '0' }, M)).toEqual({ ok: false, error: 'pct' });
    expect(buildPremiumCalc({ ...blank, pct: '101' }, M)).toEqual({ ok: false, error: 'pct' });
    expect(buildPremiumCalc({ ...blank, mode: 'flat_minor', flatMajor: '0' }, M)).toEqual({ ok: false, error: 'flat' });
  });
  it('tells bad JSON apart from a shape that is not allowed', () => {
    expect(buildPremiumCalc({ ...blank, mode: 'parametric', parametricJson: '{oops' }, M)).toEqual({ ok: false, error: 'parametricJson' });
    expect(buildPremiumCalc({ ...blank, mode: 'parametric', parametricJson: '[]' }, M)).toEqual({ ok: false, error: 'parametric' });
    expect(buildPremiumCalc({ ...blank, mode: 'parametric', parametricJson: '{}' }, M)).toEqual({ ok: false, error: 'parametric' });
    expect(isCalcMode('table')).toBe(false);
  });
  it('reads a stored formula back, and says so when it cannot', () => {
    expect(describeCalc({ pct_of_sum_insured: 2.5 })).toEqual({ mode: 'pct_of_sum_insured', pct: 2.5 });
    expect(describeCalc({ flat_minor: '35000' })).toEqual({ mode: 'flat_minor', flatMinor: '35000' });
    expect(describeCalc({ parametric: { x: 1 } })).toEqual({ mode: 'parametric' });
    expect(describeCalc({ nonsense: true })).toEqual({ mode: 'unknown' });
    expect(describeCalc(null)).toEqual({ mode: 'unknown' });
  });
});

describe('buildProduct', () => {
  const P = '00000000-0000-7000-8000-0000000000p1'.replace('p1', 'b1');
  const K = '00000000-0000-7000-8000-0000000000b2';
  const base = {
    partnerId: P, productKindId: K, defaultName: 'Cattle cover — Kheda',
    mode: 'pct_of_sum_insured', pct: '3', flatMajor: '', parametricJson: '',
    sumInsuredJson: '', govtSubsidyBps: '', ourCommissionBps: '',
  };
  it('derives isParametric from the FORMULA, so the flag can never contradict the price', () => {
    const pct = buildProduct(base, M);
    expect(pct.ok && pct.value.isParametric).toBe(false);
    const par = buildProduct({ ...base, mode: 'parametric', parametricJson: '{"rain":1}' }, M);
    expect(par.ok && par.value.isParametric).toBe(true);
  });
  it('validates basis points strictly — a clamped commission would move real money', () => {
    expect(buildProduct({ ...base, ourCommissionBps: '250' }, M).ok).toBe(true);
    expect(buildProduct({ ...base, ourCommissionBps: '10001' }, M)).toEqual({ ok: false, error: 'commission' });
    expect(buildProduct({ ...base, ourCommissionBps: '2.5' }, M)).toEqual({ ok: false, error: 'commission' });
    expect(buildProduct({ ...base, govtSubsidyBps: 'half' }, M)).toEqual({ ok: false, error: 'subsidy' });
    const blank = buildProduct(base, M);
    expect(blank.ok && 'ourCommissionBps' in blank.value).toBe(false);   // absent ⇒ the API's own default
  });
  it('refuses a bad partner, kind, name or sum-insured JSON', () => {
    expect(buildProduct({ ...base, partnerId: 'sbi' }, M)).toEqual({ ok: false, error: 'partner' });
    expect(buildProduct({ ...base, productKindId: '' }, M)).toEqual({ ok: false, error: 'kind' });
    expect(buildProduct({ ...base, defaultName: 'ab' }, M)).toEqual({ ok: false, error: 'name' });
    expect(buildProduct({ ...base, sumInsuredJson: '{bad' }, M)).toEqual({ ok: false, error: 'sumInsuredJson' });
  });
});

describe('issuance — no premium, no cover', () => {
  it('offers issuance only for a proposed policy whose premium is paid', () => {
    expect(canIssue({ status: 'proposed', premiumPaymentId: 'pay1' })).toBe(true);
    expect(canIssue({ status: 'proposed', premiumPaymentId: null })).toBe(false);
    expect(canIssue({ status: 'active', premiumPaymentId: 'pay1' })).toBe(false);
  });
  it('says WHY it is unavailable rather than hiding a button silently', () => {
    expect(issueBlockedReason({ status: 'proposed', premiumPaymentId: null })).toBe('no_premium');
    expect(issueBlockedReason({ status: 'active', premiumPaymentId: 'pay1' })).toBe('not_proposed');
    expect(issueBlockedReason({ status: 'proposed', premiumPaymentId: 'pay1' })).toBe('none');
  });
  it('validates the policy number and any trigger JSON', () => {
    expect(buildIssue({ policyNo: 'ICL/2026/0091', triggersJson: '' })).toEqual({ ok: true, value: { policyNo: 'ICL/2026/0091' } });
    expect(buildIssue({ policyNo: 'no', triggersJson: '' })).toEqual({ ok: false, error: 'policyNo' });
    expect(buildIssue({ policyNo: 'ICL/1', triggersJson: '{bad' })).toEqual({ ok: false, error: 'triggersJson' });
    const withTriggers = buildIssue({ policyNo: 'ICL/1', triggersJson: '{"rain":1}' });
    expect(withTriggers.ok && withTriggers.value.parametricTriggers).toEqual({ rain: 1 });
  });
});

describe('loss ratio — UNKNOWN on an empty book, never 0 %', () => {
  it('returns null when no premium has been written', () => {
    expect(lossRatioBps([], [])).toBeNull();
    expect(lossRatioBps([{ premium: '0' }], [{ approved: '5000' }])).toBeNull();
  });
  it('computes basis points as integer arithmetic on minor-unit strings', () => {
    expect(lossRatioBps([{ premium: '100000' }], [{ approved: '40000' }])).toBe(4000);   // 40.00 %
    expect(lossRatioBps([{ premium: '100000' }, { premium: '100000' }], [{ approved: '40000' }])).toBe(2000);
    expect(lossRatioBps([{ premium: '100000' }], [])).toBe(0);   // premium written, nothing claimed yet → a real 0 %
  });
  it('sums only readable minor-unit strings, and counts by status without inventing any', () => {
    expect(sumMinor(['100', '200', null, 'abc', undefined])).toBe(300n);
    expect(countByStatus([{ status: 'active', n: 2 }, { status: 'active', n: 3 }, { status: '', n: 9 }, { n: 1 }])).toEqual({ active: 5 });
  });
});
