// @krishi-verse/i18n · formatter + translator unit tests. The critical one: money formats from a bigint-string
// of minor units with FULL precision (no float rounding) and correct Indian lakh/crore grouping.
import { formatMoneyMinor, formatNumber, Translator, resolveLanguage } from '../index';

describe('formatMoneyMinor (bigint-string minor units, no float)', () => {
  it('formats paise → ₹ with 2 decimals + Indian grouping', () => {
    expect(formatMoneyMinor('123456', 'INR', 'en')).toBe('₹1,234.56');
    expect(formatMoneyMinor('5', 'INR', 'en')).toBe('₹0.05');
    expect(formatMoneyMinor('-99900', 'INR', 'en')).toBe('-₹999.00');
  });
  it('keeps FULL precision for amounts beyond JS safe-integer (no float rounding)', () => {
    // 9007199254740991 paise is past Number.MAX_SAFE_INTEGER; rupees=90071992547409, paise=91.
    const out = formatMoneyMinor('9007199254740991', 'INR', 'en');
    expect(out.endsWith('.91')).toBe(true);                               // paise exact
    expect(out.replace(/[^0-9]/g, '')).toBe('9007199254740991');          // all digits preserved (rupees+paise), nothing rounded
  });
  it('falls back safely on a bad amount', () => {
    expect(formatMoneyMinor('not-a-number', 'INR', 'en')).toBe('₹0.00');
  });
  it('handles a zero-decimal currency (JPY) via Intl\'s own ISO 4217 exponent — no hardcoded /100 (DEV-26/Q15)', () => {
    // 500 minor units of a 0-decimal currency IS 500 whole units, never "5.00" (that would be a real Law-2 bug).
    const out = formatMoneyMinor('500', 'JPY', 'en');
    expect(out).not.toMatch(/5\.00/);
    expect(out.replace(/[^0-9]/g, '')).toBe('500');
  });
  it('handles a 3-decimal currency (BHD) exactly — no hardcoded /100 (DEV-26/Q15)', () => {
    // 1234 fils = 1.234 BHD (3 minor-unit digits).
    const out = formatMoneyMinor('1234', 'BHD', 'en');
    expect(out).toMatch(/1\.234/);
  });
  it('currencyDisplay:"code" forces the ISO code instead of a symbol (BRAND-024)', () => {
    const out = formatMoneyMinor('125000', 'AED', 'en', { currencyDisplay: 'code' });
    expect(out).toContain('AED');
    expect(out).not.toContain('₹');
  });
  it('zero amount formats exactly, at any exponent', () => {
    expect(formatMoneyMinor('0', 'INR', 'en')).toBe('₹0.00');
    expect(formatMoneyMinor('0', 'JPY', 'en').replace(/[^0-9]/g, '')).toBe('0');
  });
  it('an unrecognized langCode is treated as a raw Intl locale tag, never silently collapsed to en (DEV-26/Q15)', () => {
    // 'ja-JP' is not an @krishi-verse/i18n LANGUAGE_REGISTRY code — formatMoneyMinor must still honor it directly
    // (this is exactly the contract packages/ui's MoneyText relies on via opts.intlLocale).
    const out = formatMoneyMinor('500', 'JPY', 'ja-JP');
    expect(out).toMatch(/[¥￥]/);
  });
});

describe('languages + numbers', () => {
  it('resolves hi-IN → hi and falls back unknown → en', () => {
    expect(resolveLanguage('hi-IN').code).toBe('hi');
    expect(resolveLanguage('zz').code).toBe('en');
  });
  it('formats plain counts (not money)', () => {
    expect(typeof formatNumber(1234, 'en')).toBe('string');
  });
});

describe('Translator', () => {
  it('interpolates, falls back to default lang then to the key', () => {
    const t = new Translator('hi').register('en', { greeting: 'Hi {name}' }).register('hi', { greeting: 'नमस्ते {name}' });
    expect(t.t('greeting', { name: 'Asha' })).toBe('नमस्ते Asha');
    expect(t.t('missing.key')).toBe('missing.key');
    const en = new Translator('hi').register('en', { only_en: 'Fallback' });
    expect(en.t('only_en')).toBe('Fallback');   // falls back to default-language catalog
  });
});
