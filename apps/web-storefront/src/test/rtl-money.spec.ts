// apps/web-storefront/src/test/rtl-money.spec.ts · PC-56 RTL-1c — the storefront's one money helper (`moneyString`, features/rtl/money.ts) and the
// three helpers that print through it (`moneyText` — features/discovery/money.ts, `planPrice` — features/pricing/plans.ts, `driftView` — the cart).
//
// Two promises, both pinned to the byte (web-tenant's RTL-1b-3 rtl-money.spec, adapted):
//   1. under ar (the preview, rtl language) every amount is the INDIAN shape (en-IN: "₹1,23,456.50", symbol first, lakh grouping, Western digits)
//      wrapped in LRI…PDI — never the Arabic locale's own "123,456.50 ₹" (led by an RLM);
//   2. under en/hi/gu it returns EXACTLY what `formatMoneyMinor(minor, currency, lang)` returned before this wave — no marks, no shape change.
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { moneyLang, moneyString, withSign } from '../features/rtl/money';
import { LRI, PDI, ltrRun, ltrText } from '../features/rtl/span';
import { intlTag } from '../features/rtl/intl';
import { moneyText } from '../features/discovery/money';
import { planPrice } from '../features/pricing/plans';
import { driftView } from '../features/store2b/cart';

const AMOUNTS: Array<string | bigint> = ['12345650', '-12345650', '0', '-5', '1', '99', '100000', '123456789012345678', 12345650n, -1n, 'not-a-number'];
const CURRENCIES = ['INR', 'USD', 'JPY', 'BHD', 'AED'];

describe('moneyString under ar: the Indian shape, isolated', () => {
  it("'12345650' INR → ⁦₹1,23,456.50⁩ (LRI … PDI around the en-IN amount)", () => {
    expect(moneyString('12345650', 'INR', 'ar')).toBe('⁦₹1,23,456.50⁩');
    expect(moneyString('12345650', 'INR', 'ar')).toBe(`${LRI}₹1,23,456.50${PDI}`);
  });
  it('never the Arabic locale shape (no "123,456.50 ₹", no RLM, no Arabic-Indic digit)', () => {
    const s = moneyString('12345650', 'INR', 'ar');
    expect(s).not.toBe(formatMoneyMinor('12345650', 'INR', 'ar'));
    expect(s).not.toMatch(/123,456\.50/);
    expect(s).not.toContain('‏');
    expect(s).not.toMatch(/[٠-٩۰-۹]/);
  });
  it('negative and zero amounts keep their sign and the Indian shape, inside the isolate', () => {
    expect(moneyString('-12345650', 'INR', 'ar')).toBe('⁦-₹1,23,456.50⁩');
    expect(moneyString('0', 'INR', 'ar')).toBe('⁦₹0.00⁩');
    expect(moneyString(-1n, 'INR', 'ar')).toBe('⁦-₹0.01⁩');
  });
  it('a non-INR currency keeps its own scale and symbol, in the Indian grouping, isolated', () => {
    expect(moneyString('12345650', 'USD', 'ar')).toBe('⁦$1,23,456.50⁩');
    expect(moneyString('1234565', 'JPY', 'ar')).toBe('⁦JP¥12,34,565⁩');
    expect(moneyString('1234565', 'BHD', 'ar')).toBe('⁦BHD 1,234.565⁩');
  });
  it('every amount and currency under ar is exactly LRI + formatMoneyMinor(…, en) + PDI (Law 2: the amount is untouched)', () => {
    for (const m of AMOUNTS) for (const c of CURRENCIES) {
      expect({ m: String(m), c, s: moneyString(m, c, 'ar') }).toEqual({ m: String(m), c, s: LRI + formatMoneyMinor(m, c, 'en') + PDI });
    }
    expect(moneyString('123456789012345678', 'INR', 'ar')).toBe('⁦₹1,23,45,67,89,01,23,456.78⁩');
  });
  it('the rule is "rtl preview", not the string "ar"', () => {
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    for (const l of PREVIEW_LANGUAGES) { expect(moneyLang(l)).toBe('en'); expect(moneyString('12345650', 'INR', l)).toBe('⁦₹1,23,456.50⁩'); }
  });
});

describe('moneyString under en / hi / gu: byte-identical to formatMoneyMinor(…, lang)', () => {
  it('every amount × currency × language returns exactly what the pages printed before RTL-1c', () => {
    for (const l of ['en', 'hi', 'gu']) for (const m of AMOUNTS) for (const c of CURRENCIES) {
      expect({ l, m: String(m), c, s: moneyString(m, c, l) }).toEqual({ l, m: String(m), c, s: formatMoneyMinor(m, c, l) });
    }
  });
  it('no isolation mark under ltr, and the pinned shapes (₹1,23,456.50 · -₹1,23,456.50 · ₹0.00 · US$ under gu)', () => {
    for (const l of ['en', 'hi', 'gu']) {
      expect(moneyLang(l)).toBe(l);
      expect(moneyString('12345650', 'INR', l)).toBe('₹1,23,456.50');
      expect(moneyString('-12345650', 'INR', l)).toBe('-₹1,23,456.50');
      expect(moneyString('0', 'INR', l)).toBe('₹0.00');
      expect(moneyString('12345650', 'INR', l)).not.toMatch(/[⁦-⁩]/);
    }
    expect(moneyString('12345650', 'USD', 'gu')).toBe('US$1,23,456.50');
  });
});

describe('the storefront helpers print through moneyString (and keep their own null rules)', () => {
  it('moneyText (discovery): en/hi/gu byte-identical to formatMoneyMinor; ar isolated Indian shape; null rules unchanged', () => {
    for (const l of ['en', 'hi', 'gu']) expect(moneyText('12345650', 'inr', l)).toBe(formatMoneyMinor('12345650', 'INR', l));
    expect(moneyText('12345650', 'INR', 'ar')).toBe('⁦₹1,23,456.50⁩');
    expect(moneyText('12.5', 'INR', 'ar')).toBeNull();
    expect(moneyText('100', 'XX', 'ar')).toBeNull();
    expect(moneyText(null, 'INR', 'ar')).toBeNull();
  });
  it('planPrice (pricing): the same, and an exponent mismatch is still refused', () => {
    expect(planPrice('99900', 'INR', 2, 'en')).toBe(formatMoneyMinor('99900', 'INR', 'en'));
    expect(planPrice('99900', 'INR', 2, 'ar')).toBe('⁦₹999.00⁩');
    expect(planPrice('99900', 'INR', 0, 'ar')).toBeNull();
  });
  it('the cart drift: the sign sits INSIDE the isolate under ar; under en exactly as before ("+₹40.00" / "−₹20.00")', () => {
    const line = { priceChanged: true, addedPriceMinor: '252000', currentPriceMinor: '256000', priceDeltaMinor: '4000', currencyCode: 'INR' };
    expect(driftView(line, 'en')).toEqual({ added: '₹2,520.00', current: '₹2,560.00', delta: '+₹40.00', up: true });
    expect(driftView({ ...line, priceDeltaMinor: '-2000' }, 'en')?.delta).toBe('−₹20.00');
    expect(driftView(line, 'ar')).toEqual({ added: '⁦₹2,520.00⁩', current: '⁦₹2,560.00⁩', delta: '⁦+₹40.00⁩', up: true });
    expect(driftView({ ...line, priceDeltaMinor: '-2000' }, 'ar')?.delta).toBe('⁦−₹20.00⁩');
  });
  it('withSign: inside an isolate when there is one, else in front', () => {
    expect(withSign('+', '₹1.00')).toBe('+₹1.00');
    expect(withSign('−', ltrRun('₹1.00'))).toBe('⁦−₹1.00⁩');
  });
});

describe('codes in sentences and the Intl tag', () => {
  it('ltrText isolates a code / phone / order number ONLY under the preview language', () => {
    for (const l of ['en', 'hi', 'gu']) expect(ltrText('ORD-2026-000417', l)).toBe('ORD-2026-000417');
    expect(ltrText('ORD-2026-000417', 'ar')).toBe('⁦ORD-2026-000417⁩');
    expect(ltrText('+91 96••• ••114', 'ar')).toBe('⁦+91 96••• ••114⁩');
  });
  it('intlTag: the bare code under en/hi/gu (unchanged), the registry\'s Western-digit tag under ar', () => {
    for (const l of ['en', 'hi', 'gu']) expect(intlTag(l)).toBe(l);
    expect(intlTag('ar')).toBe('ar-AE-u-nu-latn');
    expect(new Intl.NumberFormat(intlTag('ar')).format(1234567)).not.toMatch(/[٠-٩]/);
  });
});
