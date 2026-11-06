// modules/warehousing/__tests__/ops2c-quantity.spec.ts · PC-56 OPS-2c · OPS2-B23 (survey F-13) — the quantity is parsed from and printed to its
// decimal STRING, digit by digit, never through a JS double — and both repositories use exactly these functions (a source assertion: no
// `Number(` in either repository or in either entity's quantity print).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseQuantityMilli, formatQuantityMilli, STORAGE_FEE_UNIT } from '../domain/quantity';

describe('PC-56 OPS-2c · B23 — the quantity never touches a float', () => {
  it('parses the numeric(12,3) strings node-postgres returns, exactly', () => {
    expect(parseQuantityMilli('6260.125')).toBe(6260125n);
    expect(parseQuantityMilli('100')).toBe(100000n);
    expect(parseQuantityMilli('100.000')).toBe(100000n);
    expect(parseQuantityMilli('0.001')).toBe(1n);
    expect(parseQuantityMilli('62.6')).toBe(62600n);
    expect(parseQuantityMilli('-1.5')).toBe(-1500n);
    expect(parseQuantityMilli('999999999.999')).toBe(999999999999n);   // the column's full precision (9 + 3)
  });
  it('a value a double cannot hold exactly still parses exactly (the float path would round it)', () => {
    const s = '123456789012345.678';                                      // 18 significant digits — beyond a double's 15–17
    expect(parseQuantityMilli(s)).toBe(123456789012345678n);
    expect(BigInt(Math.round(Number(s) * 1000))).not.toBe(123456789012345678n);   // the old toMilli was wrong here
  });
  it('refuses what is not a decimal, or carries a non-zero fourth decimal', () => {
    for (const bad of ['', 'abc', '1e3', '1.2.3', 'NaN', '1.0001']) expect(() => parseQuantityMilli(bad)).toThrow();
    expect(parseQuantityMilli('1.2340')).toBe(1234n);                     // trailing zeros beyond three places are not a loss
  });
  it('prints the scaled integer with exactly three places, and round-trips', () => {
    expect(formatQuantityMilli(6260125n)).toBe('6260.125');
    expect(formatQuantityMilli(100000n)).toBe('100.000');
    expect(formatQuantityMilli(1n)).toBe('0.001');
    expect(formatQuantityMilli(0n)).toBe('0.000');
    expect(formatQuantityMilli(-1500n)).toBe('-1.500');
    for (const s of ['6260.125', '0.001', '62.600', '999999999.999']) expect(formatQuantityMilli(parseQuantityMilli(s))).toBe(s);
  });
  it('the fee unit is the one constant: quintal', () => { expect(STORAGE_FEE_UNIT).toBe('quintal'); });
  it('SOURCE: neither repository nor either entity converts the quantity with Number( — both repositories use the string functions', () => {
    for (const rel of ['repositories/storage-booking.repository.ts', 'repositories/nwr-receipt.repository.ts', 'domain/storage-booking.entity.ts', 'domain/nwr-receipt.entity.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect([rel, /Number\(/.test(src)]).toEqual([rel, false]);
    }
    for (const rel of ['repositories/storage-booking.repository.ts', 'repositories/nwr-receipt.repository.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /toMilli = \(v: string\): bigint => parseQuantityMilli\(v\)/.test(src), /milliToNum = \(m: bigint\): string => formatQuantityMilli\(m\)/.test(src)]).toEqual([rel, true, true]);
    }
  });
});
