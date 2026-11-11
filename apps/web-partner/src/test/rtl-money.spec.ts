// apps/web-partner/src/test/rtl-money.spec.ts · PC-56 RTL-1d — the partner console's one money helper (`moneyText`, features/rtl/money.ts) and the
// code isolate (`ltrText`, features/rtl/span.ts).
//
// Two promises, both pinned to the byte (web-tenant's RTL-1b-3 / the storefront's RTL-1c rtl-money.spec, adapted):
//   1. under ar (the preview, rtl language) every amount is the INDIAN shape (en-IN: "₹1,23,456.50", symbol first, lakh grouping, Western digits)
//      wrapped in LRI…PDI — never the Arabic locale's own "123,456.50 ₹" (led by an RLM);
//   2. under en/hi/gu it returns EXACTLY what `formatMoneyMinor(minor, currency, lang)` returned before this wave — no marks, no shape change.
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { moneyLang, moneyText } from '../features/rtl/money';
import { LRI, PDI, ltrRun, ltrText } from '../features/rtl/span';

const AMOUNTS: Array<string | bigint> = ['12345650', '-12345650', '0', '-5', '1', '99', '100000', '123456789012345678', '90007199254740993', 12345650n, -1n, 'not-a-number'];
const CURRENCIES = ['INR', 'USD', 'JPY', 'BHD', 'AED'];

describe('moneyText under ar: the Indian shape, isolated', () => {
  it("'12345650' INR → ⁦₹1,23,456.50⁩ (LRI … PDI around the en-IN amount)", () => {
    expect(moneyText('12345650', 'INR', 'ar')).toBe('⁦₹1,23,456.50⁩');
    expect(moneyText('12345650', 'INR', 'ar')).toBe(`${LRI}₹1,23,456.50${PDI}`);
    expect([LRI, PDI]).toEqual(['⁦', '⁩']);
  });
  it('never the Arabic locale shape (no "123,456.50 ₹", no RLM, no Arabic-Indic digit)', () => {
    const s = moneyText('12345650', 'INR', 'ar');
    expect(s).not.toBe(formatMoneyMinor('12345650', 'INR', 'ar'));
    expect(s).not.toMatch(/123,456\.50/);
    expect(s).not.toContain('‏');
    expect(s).not.toMatch(/[٠-٩۰-۹]/);
  });
  it('negative and zero amounts keep their sign and the Indian shape, inside the isolate', () => {
    expect(moneyText('-12345650', 'INR', 'ar')).toBe('⁦-₹1,23,456.50⁩');
    expect(moneyText('0', 'INR', 'ar')).toBe('⁦₹0.00⁩');
    expect(moneyText(-1n, 'INR', 'ar')).toBe('⁦-₹0.01⁩');
  });
  it('a non-INR currency keeps its own scale and symbol, in the Indian grouping, isolated', () => {
    expect(moneyText('12345650', 'USD', 'ar')).toBe('⁦$1,23,456.50⁩');
    expect(moneyText('1234565', 'JPY', 'ar')).toBe('⁦JP¥12,34,565⁩');
    expect(moneyText('1234565', 'BHD', 'ar')).toMatch(/^\u2066BHD\s1,234\.565\u2069$/u);
  });
  it('every amount and currency under ar is exactly LRI + formatMoneyMinor(…, en) + PDI (Law 2: the amount is untouched, beyond 2^53 too)', () => {
    for (const m of AMOUNTS) for (const c of CURRENCIES) {
      expect({ m: String(m), c, s: moneyText(m, c, 'ar') }).toEqual({ m: String(m), c, s: LRI + formatMoneyMinor(m, c, 'en') + PDI });
    }
    expect(moneyText('90007199254740993', 'INR', 'ar')).toBe('⁦₹90,00,71,99,25,47,409.93⁩');
  });
  it('the rule is "rtl preview", not the string "ar"', () => {
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    for (const l of PREVIEW_LANGUAGES) { expect(moneyLang(l)).toBe('en'); expect(moneyText('12345650', 'INR', l)).toBe('⁦₹1,23,456.50⁩'); }
  });
});

describe('moneyText under en / hi / gu: byte-identical to formatMoneyMinor(…, lang)', () => {
  it('every amount × currency × language returns exactly what the views printed before RTL-1d', () => {
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
      expect(moneyText('12345650', 'INR', l)).not.toMatch(/[⁦-⁩]/);
    }
    expect(moneyText('12345650', 'USD', 'gu')).toBe('US$1,23,456.50');
  });
});

describe('codes in sentences', () => {
  it('ltrText isolates a code / phone / key prefix / header name ONLY under the preview language', () => {
    for (const l of ['en', 'hi', 'gu']) for (const s of ['LN-2026-000417', '••••••318', 'kv_live_ab12', 'X-Krishalaya-Signature']) expect(ltrText(s, l)).toBe(s);
    expect(ltrText('LN-2026-000417', 'ar')).toBe('⁦LN-2026-000417⁩');
    expect(ltrText('••••••318', 'ar')).toBe('⁦••••••318⁩');
    expect(ltrRun('x')).toBe('⁦x⁩');
  });
});
