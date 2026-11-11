// apps/web-tenant/src/test/rtl-money.spec.ts · PC-56 RTL-1b-3 — `moneyText`, the one money helper for text.
//
// Two promises, both pinned to the byte:
//   1. under ar (the preview, rtl language) every amount is the INDIAN shape (en-IN: "₹1,23,456.50", symbol first, lakh
//      grouping, Western digits) wrapped in LRI…PDI — never the Arabic locale's own "123,456.50 ₹" (led by an RLM);
//   2. under en/hi/gu it returns EXACTLY what `formatMoneyMinor(minor, currency, lang)` returned before this wave — no
//      marks, no shape change — so no en/hi/gu screen moves by a byte.
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { moneyText, moneyLang } from '../features/rtl/money';
import { LRI, PDI } from '../features/rtl/span';

const AMOUNTS: Array<string | bigint> = ['12345650', '-12345650', '0', '-5', '1', '99', '100000', '123456789012345678', 12345650n, -1n, 'not-a-number'];
const CURRENCIES = ['INR', 'USD', 'JPY', 'BHD', 'AED'];

describe('moneyText under ar: the Indian shape, isolated', () => {
  it("'12345650' INR → \u2066₹1,23,456.50\u2069 (LRI … PDI around the en-IN amount)", () => {
    expect(moneyText('12345650', 'INR', 'ar')).toBe('\u2066₹1,23,456.50\u2069');
    expect(moneyText('12345650', 'INR', 'ar')).toBe(`${LRI}₹1,23,456.50${PDI}`);
  });
  it('never the Arabic locale shape (no "123,456.50 ₹", no RLM, no Arabic-Indic digit)', () => {
    const s = moneyText('12345650', 'INR', 'ar');
    expect(s).not.toBe(formatMoneyMinor('12345650', 'INR', 'ar'));
    expect(s).not.toMatch(/123,456\.50/);
    expect(s).not.toContain('\u200f');
    expect(s).not.toMatch(/[٠-٩۰-۹]/);
  });
  it('negative and zero amounts keep their sign and the Indian shape, inside the isolate', () => {
    expect(moneyText('-12345650', 'INR', 'ar')).toBe('\u2066-₹1,23,456.50\u2069');
    expect(moneyText('0', 'INR', 'ar')).toBe('\u2066₹0.00\u2069');
    expect(moneyText('-5', 'INR', 'ar')).toBe('\u2066-₹0.05\u2069');
    expect(moneyText(-1n, 'INR', 'ar')).toBe('\u2066-₹0.01\u2069');
  });
  it('a non-INR currency keeps its own scale and symbol, in the Indian grouping, isolated', () => {
    expect(moneyText('12345650', 'USD', 'ar')).toBe('\u2066$1,23,456.50\u2069');
    expect(moneyText('1234565', 'JPY', 'ar')).toBe('\u2066JP¥12,34,565\u2069');
    expect(moneyText('1234565', 'BHD', 'ar')).toBe('\u2066BHD\u00a01,234.565\u2069');
    expect(moneyText('12345650', 'AED', 'ar')).toBe('\u2066AED\u00a01,23,456.50\u2069');
  });
  it('every amount and currency under ar is exactly LRI + formatMoneyMinor(…, en) + PDI (Law 2: the amount is untouched)', () => {
    for (const m of AMOUNTS) for (const c of CURRENCIES) {
      expect({ m: String(m), c, s: moneyText(m, c, 'ar') }).toEqual({ m: String(m), c, s: LRI + formatMoneyMinor(m, c, 'en') + PDI });
    }
    // a 18-digit amount survives digit for digit (no Number(), no float)
    expect(moneyText('123456789012345678', 'INR', 'ar')).toBe('\u2066₹1,23,45,67,89,01,23,456.78\u2069');
  });
  it('every preview language is treated the same way (the rule is "rtl preview", not the string "ar")', () => {
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    for (const l of PREVIEW_LANGUAGES) {
      expect(moneyLang(l)).toBe('en');
      expect(moneyText('12345650', 'INR', l)).toBe('\u2066₹1,23,456.50\u2069');
    }
  });
});

describe('moneyText under en / hi / gu: byte-identical to formatMoneyMinor(…, lang)', () => {
  it('every amount × currency × language returns exactly what the pages printed before RTL-1b-3', () => {
    for (const l of ['en', 'hi', 'gu']) for (const m of AMOUNTS) for (const c of CURRENCIES) {
      expect({ l, m: String(m), c, s: moneyText(m, c, l) }).toEqual({ l, m: String(m), c, s: formatMoneyMinor(m, c, l) });
    }
  });
  it('no isolation mark under ltr, and the pinned shapes (₹1,23,456.50 · -₹1,23,456.50 · ₹0.00 · US$ under gu)', () => {
    for (const l of ['en', 'hi', 'gu']) {
      expect(moneyLang(l)).toBe(l);
      expect(moneyText('12345650', 'INR', l)).toBe('₹1,23,456.50');
      expect(moneyText('-12345650', 'INR', l)).toBe('-₹1,23,456.50');
      expect(moneyText('0', 'INR', l)).toBe('₹0.00');
      expect(moneyText('12345650', 'INR', l)).not.toMatch(/[\u2066-\u2069]/);
    }
    expect(moneyText('12345650', 'USD', 'gu')).toBe('US$1,23,456.50'); // gu's own locale, untouched (not forced to en)
  });
});
