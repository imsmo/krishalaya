// core/database/__tests__/pg-numeric.spec.ts · PC-56 TENANT-6c-1.
// `numeric` comes back from node-pg as a STRING because the type is arbitrary-precision. Reading it through a double
// is the same class of quiet defect `pg-date.ts` exists for; these tests pin the digits.
import { numericFromScaled, scaledFromNumeric, scaledFromNumericOrNull } from '../pg-numeric';

describe('scaledFromNumeric', () => {
  it('reads the digits at the column scale', () => {
    expect(scaledFromNumeric('204.526', 3)).toBe(204_526n);
    expect(scaledFromNumeric('204.5', 3)).toBe(204_500n);
    expect(scaledFromNumeric('204', 3)).toBe(204_000n);
    expect(scaledFromNumeric('0.001', 3)).toBe(1n);
    expect(scaledFromNumeric('.5', 3)).toBe(500n);
  });

  it('is EXACT where the float route was not — the milk-bill litres defect', () => {
    // The mapper this replaces was `BigInt(Math.round(Number(r.total_litres) * 1000))`. These are the values where a
    // binary double and a decimal column disagree; the assertion is that we no longer care which ones those are.
    for (const s of ['8.615', '10.235', '1.005', '2.675', '1234567.891']) {
      const digits = BigInt(s.replace('.', ''));
      expect(scaledFromNumeric(s, 3)).toBe(digits);
    }
  });

  it('handles sign and scale 0', () => {
    expect(scaledFromNumeric('-12.750', 3)).toBe(-12_750n);
    expect(scaledFromNumeric('-0.001', 3)).toBe(-1n);
    expect(scaledFromNumeric('42', 0)).toBe(42n);
  });

  it('TRUNCATES beyond the scale rather than rounding up — it must never invent milk that was not poured', () => {
    expect(scaledFromNumeric('1.9999', 3)).toBe(1_999n);
    expect(scaledFromNumeric('-1.9999', 3)).toBe(-1_999n);
  });

  it('THROWS on a non-decimal instead of coercing to zero', () => {
    // A mapper that turns an unexpected value into "zero litres" produces a bill for nothing and no error to find it by.
    for (const bad of ['', ' ', 'abc', '1.2.3', 'NaN', '1e3', null, undefined, {}]) {
      expect(() => scaledFromNumeric(bad as unknown, 3)).toThrow(TypeError);
    }
    expect(() => scaledFromNumeric('1.0', -1)).toThrow(RangeError);
  });

  it('a NULL column is a missing value, not a zero', () => {
    expect(scaledFromNumericOrNull(null, 3)).toBeNull();
    expect(scaledFromNumericOrNull(undefined, 3)).toBeNull();
    expect(scaledFromNumericOrNull('0.000', 3)).toBe(0n);
  });
});

describe('numericFromScaled', () => {
  it('writes the decimal string `numeric` expects', () => {
    expect(numericFromScaled(204_526n, 3)).toBe('204.526');
    expect(numericFromScaled(500n, 3)).toBe('0.500');
    expect(numericFromScaled(0n, 3)).toBe('0.000');
    expect(numericFromScaled(-12_750n, 3)).toBe('-12.750');
    expect(numericFromScaled(-1n, 3)).toBe('-0.001');
    expect(numericFromScaled(42n, 0)).toBe('42');
  });

  it('round-trips at the scale — the property the two-decimal column could not hold', () => {
    for (const v of [0n, 1n, 999n, 204_526n, -204_526n, 1_234_567_891n]) {
      expect(scaledFromNumeric(numericFromScaled(v, 3), 3)).toBe(v);
    }
  });

  it('the OLD write path lost the third decimal — pinned so it cannot come back', () => {
    // `(Number(204_526n) / 1000).toFixed(2)` was the line: 204.526 kg of milk stored as 204.53, read back as 204,530
    // milli-kg, so a bill's own litres could not equal the sum of the pours it settled.
    expect((Number(204_526n) / 1000).toFixed(2)).toBe('204.53');
    expect(numericFromScaled(204_526n, 3)).toBe('204.526');
  });
});
