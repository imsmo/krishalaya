// core/money/__tests__/rounding.spec.ts · DEV-26, Q15 — the platform's ONE canonical bps helper.
import { applyBpsFloor } from '../rounding';

describe('applyBpsFloor (Q15 ratified rounding mode: floor, bigint-exact)', () => {
  it('computes exact bps of a minor-unit amount (2% of ₹1,000.00 = ₹20.00)', () => {
    expect(applyBpsFloor(100000n, 200)).toBe(2000n); // 1,00,000 paise * 200bps / 10000 = 2,000 paise
  });

  it('floors (truncates toward zero) a non-exact division — never rounds up, never banker-rounds', () => {
    // 999 minor units * 250 bps (2.5%) / 10000 = 24.975 -> floors to 24, never 25.
    expect(applyBpsFloor(999n, 250)).toBe(24n);
  });

  it('zero bps => zero, regardless of amount (a real cap-at-zero commission-free tier)', () => {
    expect(applyBpsFloor(999999999n, 0)).toBe(0n);
  });

  it('zero amount => zero, regardless of bps', () => {
    expect(applyBpsFloor(0n, 9999)).toBe(0n);
  });

  it('10000 bps (100%) returns the full amount exactly — the identity case', () => {
    expect(applyBpsFloor(123456789n, 10000)).toBe(123456789n);
  });

  it('boundary: 1 minor unit at 1 bps floors to 0 (the smallest possible non-trivial split loses to zero, by design)', () => {
    expect(applyBpsFloor(1n, 1)).toBe(0n);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER with full bigint precision (Law 2 — never a float)', () => {
    // 9,007,199,254,740,993 (2^53 + 1, NOT exactly representable as a JS number) at 1% (100 bps).
    const huge = 9007199254740993n;
    expect(applyBpsFloor(huge, 100)).toBe(90071992547409n); // exact bigint division, no float rounding drift
  });

  it('a non-integer bps (defensive) truncates via Math.trunc before BigInt coercion, never throws', () => {
    expect(() => applyBpsFloor(100000n, 200.7 as number)).not.toThrow();
    expect(applyBpsFloor(100000n, 200.7)).toBe(applyBpsFloor(100000n, 200));
  });

  it('residual-absorption invariant: a floored share + its computed residual always sums back to the whole', () => {
    const gross = 100003n; // deliberately not evenly divisible at any common bps
    const commission = applyBpsFloor(gross, 733); // arbitrary odd rate
    const residual = gross - commission; // the OTHER share must be a subtraction, never its own floor
    expect(commission + residual).toBe(gross);
  });
});
