// modules/insurance/__tests__/premium-calc.spec.ts · pure money math (Law 2 — exact bigint, no drift).
import { parsePremiumCalc, computeTotalPremiumMinor, splitPremium } from '../domain/premium-calc';
import { InvalidPremiumCalcError } from '../domain/insurance.errors';

describe('parsePremiumCalc', () => {
  it('parses pct_of_sum_insured and flat_minor shapes', () => {
    expect(parsePremiumCalc({ kind: 'pct_of_sum_insured', bps: 1200 })).toEqual({ kind: 'pct_of_sum_insured', bps: 1200 });
    expect(parsePremiumCalc({ kind: 'flat_minor', amountMinor: '9900' })).toEqual({ kind: 'flat_minor', amountMinor: '9900' });
  });
  it('rejects any unrecognised shape (never guesses)', () => {
    expect(() => parsePremiumCalc({ kind: 'parametric_weather', trigger: 'rainfall<50mm' })).toThrow(InvalidPremiumCalcError);
    expect(() => parsePremiumCalc(null)).toThrow(InvalidPremiumCalcError);
    expect(() => parsePremiumCalc({ kind: 'pct_of_sum_insured', bps: 20000 })).toThrow(InvalidPremiumCalcError); // >100%
  });
});

describe('computeTotalPremiumMinor', () => {
  it('screen 283: ₹10,000 sum insured (1,000,000 minor units) × 12% (PMFBY full-season premium incl. govt share) = ₹1,200 (120,000 minor units)', () => {
    expect(computeTotalPremiumMinor({ kind: 'pct_of_sum_insured', bps: 1200 }, 10_000_00n)).toBe(1_200_00n);
  });
  it('flat_minor ignores sum insured entirely (screen 285: ₹99/month flat bundle)', () => {
    expect(computeTotalPremiumMinor({ kind: 'flat_minor', amountMinor: '9900' }, 700_000_00n)).toBe(9900n);
  });
});

describe('splitPremium — govt subsidy, exact bigint (Law 2: no drift)', () => {
  it('screen 283: ₹1,200 total, govt pays 83.33% (8333 bps) → farmer share ≈ ₹200, sums exactly', () => {
    const s = splitPremium(1_200_00n, 8333);
    expect(s.govtShareMinor + s.farmerShareMinor).toBe(1_200_00n); // exact, no paisa drift
    expect(s.farmerShareMinor).toBeGreaterThan(0n);
  });
  it('zero subsidy → farmer pays the full premium', () => {
    const s = splitPremium(300_00n, 0);
    expect(s.govtShareMinor).toBe(0n); expect(s.farmerShareMinor).toBe(300_00n);
  });
  it('100% subsidy (10000 bps) → farmer pays zero', () => {
    const s = splitPremium(500_00n, 10000);
    expect(s.farmerShareMinor).toBe(0n); expect(s.govtShareMinor).toBe(500_00n);
  });
});
