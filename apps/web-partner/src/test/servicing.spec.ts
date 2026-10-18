// apps/web-partner/src/test/servicing.spec.ts · PC-55 B7. The lending-servicing rules. (PC-56 PARTNER-2a, survey F-15: the DEV-24 tenant-realm
// insurer-AUTHORING rules — features/insurance/authoring.ts, its server action and the cases that pinned them — are REMOVED with the action:
// products are authored by the platform and nobody issues on the platform (founder Q5 + Q7); the one premium shape lives in the API.)
// Every case here is a place where a wrong default costs a borrower money, mis-prices a policy, or turns a
// two-person control into a one-person formality.
import {
  DPD_ORDER, KCC_ENTRY_KINDS, RESTRUCTURE_STATUSES,
  dpdRank, sortDpd, isNpaBucket, totalLoans, kccSign, isKccEntryKind, buildKccEntry, kccRowDirection, absMinor,
  offeredTransitions, awaitingChecker, isRestructureStatus, buildRestructure, canWriteOff, buildWriteOff,
} from '../features/lending/servicing';
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
