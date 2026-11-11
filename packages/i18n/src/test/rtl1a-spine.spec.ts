// @krishalaya/i18n · PC-56 RTL-1a · THE SPINE. Founder: Q1/Q2 "Draft all, opt-in only", Q4 "Western digits".
// Proves, for the shared package only (no app registers `ar` in this wave):
//   1. the Translator keys catalogues by the REGISTRY code — an `ar` catalogue can never merge into or overwrite `en`
//      (survey F-1, the collapse trap);
//   2. `ar` stays `machine-draft-pending-review` and NOT live — `LANGUAGES`/`resolveLanguage`/`isSupported` unchanged —
//      but is servable through `resolveServable` on an EXPLICIT choice only, never an implicit/browser preference;
//   3. `ar`'s Intl locale is `ar-AE-u-nu-latn` (Western digits) and money stays minor-unit exact (Law 2).
// Mutants (RTL-1a §C): M1 collapse → "Translator · no collapse" red; M2 `ar` live → "registry" red; M3 `-u-nu-latn`
// dropped → "the ar Intl locale pins Western digits" red; M4 implicit `ar` served → "resolveServable · implicit" red.
import {
  LANGUAGE_REGISTRY, LANGUAGES, COMING_SOON_LANGUAGES, DEFAULT_LANGUAGE, PREVIEW_LANGUAGES,
  resolveLanguage, resolveServable, isSupported, getRegistryEntry,
  Translator, formatMoneyMinor, formatNumber, formatDate, type Messages,
} from '../index';

const ARABIC_INDIC = /[٠-٩۰-۹]/;   // ٠-٩ and the extended (Persian/Urdu) set ۰-۹
const RLM = '‏';
const NBSP = ' ';

describe('RTL-1a · registry — 3 live; ar servable-only (founder Q1)', () => {
  it('LANGUAGES is still exactly en/hi/gu, in registry order, and does not contain ar', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['hi', 'en', 'gu']);
    expect(LANGUAGES.some((l) => l.code === 'ar')).toBe(false);
  });
  it('ar keeps status machine-draft-pending-review and stays a "coming soon" entry', () => {
    expect(getRegistryEntry('ar')?.status).toBe('machine-draft-pending-review');
    expect(COMING_SOON_LANGUAGES.map((l) => l.code)).toContain('ar');
    expect(LANGUAGE_REGISTRY.filter((l) => l.status === 'live').map((l) => l.code).sort()).toEqual(['en', 'gu', 'hi']);
  });
  it('resolveLanguage and isSupported still refuse ar (→ en / false), with or without a region', () => {
    for (const c of ['ar', 'ar-AE', 'ar-AE-u-nu-latn']) {
      expect(resolveLanguage(c).code).toBe(DEFAULT_LANGUAGE);
      expect(isSupported(c)).toBe(false);
    }
  });
  it('PREVIEW_LANGUAGES is exactly [ar] — every preview code is a registered, non-live entry', () => {
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    for (const c of PREVIEW_LANGUAGES) {
      expect(getRegistryEntry(c)?.status).toBe('machine-draft-pending-review');
      expect(isSupported(c)).toBe(false);
    }
  });
});

describe('RTL-1a · resolveServable — explicit choice only', () => {
  it('explicit ar (and ar-AE) → the ar definition: rtl, Arabic, ar-AE-u-nu-latn, LanguageDef fields only', () => {
    for (const c of ['ar', 'ar-AE']) {
      const def = resolveServable(c, 'explicit');
      expect(def).toEqual({ code: 'ar', nameNative: 'العربية', nameEnglish: 'Arabic', intlLocale: 'ar-AE-u-nu-latn', dir: 'rtl' });
      expect(Object.keys(def).sort()).toEqual(['code', 'dir', 'intlLocale', 'nameEnglish', 'nameNative']);   // no status/fontPack leaked
    }
  });
  it('implicit ar (a browser / device preference) is NEVER served — it falls back to en', () => {
    for (const c of ['ar', 'ar-AE', 'ar-SA', 'ar-AE-u-nu-latn']) {
      expect(resolveServable(c, 'implicit').code).toBe(DEFAULT_LANGUAGE);
      expect(resolveServable(c, 'implicit').dir).toBe('ltr');
    }
  });
  it('a live code resolves to the very same object resolveLanguage returns, for both kinds of choice', () => {
    for (const c of ['en', 'hi', 'gu', 'hi-IN', 'gu-IN', 'en-GB']) {
      expect(resolveServable(c, 'explicit')).toBe(resolveLanguage(c));
      expect(resolveServable(c, 'implicit')).toBe(resolveLanguage(c));
    }
  });
  it('every other non-live code (ur too — RTL but not a preview), unknown codes and empty input still fall back to en', () => {
    const others = LANGUAGE_REGISTRY.filter((l) => l.status !== 'live' && !PREVIEW_LANGUAGES.includes(l.code)).map((l) => l.code);
    expect(others).toHaveLength(10);
    for (const c of [...others, 'zz', 'xx-YY', '', undefined, null]) {
      expect(resolveServable(c, 'explicit').code).toBe(DEFAULT_LANGUAGE);
      expect(resolveServable(c, 'implicit').code).toBe(DEFAULT_LANGUAGE);
    }
  });
});

describe('RTL-1a · Translator · no collapse (survey F-1)', () => {
  const en: Messages = { 'nav.home': 'Home', 'listing.price': 'Price {amount}', 'common.save': 'Save', 'only.en': 'English only' };
  const hi: Messages = { 'nav.home': 'होम', 'listing.price': 'कीमत {amount}', 'common.save': 'सहेजें' };
  const gu: Messages = { 'nav.home': 'હોમ', 'listing.price': 'કિંમત {amount}', 'common.save': 'સાચવો' };
  const ar: Messages = { 'nav.home': 'الرئيسية', 'listing.price': 'السعر {amount}', 'common.save': 'حفظ', 'only.ar': 'عربي فقط' };
  // The order an app would use: en first, then the rest — ar LAST, so a collapse would overwrite en.
  const build = (lang: string) => new Translator(lang).register('en', en).register('hi', hi).register('gu', gu).register('ar', ar);

  it('an en user sees every en string unchanged after an ar catalogue is registered', () => {
    const t = build('en');
    for (const [k, v] of Object.entries(en)) expect(t.t(k, { amount: '₹10' })).toBe(v.replace('{amount}', '₹10'));
    expect(t.t('only.ar')).toBe('only.ar');                    // an ar-only key never leaks into en (falls to the key)
  });
  it('the same holds when ar is registered under a region tag, and before en', () => {
    const t = new Translator('en').register('ar-AE', ar).register('en', en);
    for (const [k, v] of Object.entries(en)) expect(t.t(k)).toBe(v);
  });
  it('hi and gu users are untouched too; their missing keys fall back to en, never to ar', () => {
    expect(build('hi').t('nav.home')).toBe('होम');
    expect(build('gu').t('nav.home')).toBe('હોમ');
    expect(build('hi').t('only.en')).toBe('English only');
    expect(build('hi').t('only.ar')).toBe('only.ar');
  });
  it('a non-live, non-preview catalogue (mr) and an unknown one (zz) never merge into en either', () => {
    const t = new Translator('en').register('en', en).register('mr', { 'nav.home': 'मुख्यपृष्ठ' }).register('zz', { 'nav.home': 'ZZ' });
    expect(t.t('nav.home')).toBe('Home');
  });
});

describe('RTL-1a · Translator · explicit ar resolves; unknown codes still fall back to en', () => {
  const en: Messages = { 'nav.home': 'Home', 'listing.price': 'Price {amount}', 'only.en': 'English only' };
  const ar: Messages = { 'nav.home': 'الرئيسية', 'listing.price': 'السعر {amount}' };
  it('a Translator built with ar serves the ar catalogue, interpolates, and falls back to en per key', () => {
    const t = new Translator('ar').register('en', en).register('ar', ar);
    expect(t.t('nav.home')).toBe('الرئيسية');
    expect(t.t('listing.price', { amount: '‏1,234.56 ₹' })).toBe('السعر ‏1,234.56 ₹');
    expect(t.t('only.en')).toBe('English only');
    expect(t.t('missing.key')).toBe('missing.key');
  });
  it('a Translator built with ar but no ar catalogue prints English (never blank)', () => {
    expect(new Translator('ar').register('en', en).t('nav.home')).toBe('Home');
  });
  it('unknown and non-preview codes (zz, mr, ur) are served en even when a catalogue exists for them', () => {
    for (const c of ['zz', 'mr', 'ur']) {
      const t = new Translator(c).register('en', en).register(c, { 'nav.home': `${c}-home` });
      expect(t.t('nav.home')).toBe('Home');
    }
  });
});

describe('RTL-1a · format — ar money: Western digits, minor-unit exact (founder Q4, Law 2)', () => {
  it('the ar Intl locale pins Western digits: the tag carries -u-nu-latn and Intl reads numberingSystem latn from it', () => {
    const tag = resolveServable('ar', 'explicit').intlLocale;
    expect(tag).toBe('ar-AE-u-nu-latn');
    expect(getRegistryEntry('ar')?.intlLocale).toBe('ar-AE-u-nu-latn');
    expect(new Intl.Locale(tag).numberingSystem).toBe('latn');   // from the TAG, not this runtime's ICU default
    expect(new Intl.NumberFormat(tag).resolvedOptions().numberingSystem).toBe('latn');
  });
  it('an ar INR amount prints Western digits, exact to the paisa — and records the ar-AE shape (symbol after, 3-digit groups)', () => {
    const out = formatMoneyMinor('12345650', 'INR', 'ar');
    expect(out).not.toMatch(ARABIC_INDIC);
    expect(out.replace(/[^0-9]/g, '')).toBe('12345650');
    // Recorded (Node 22.14 ICU), not chosen: RLM + "123,456.50" + NBSP + "₹" — the symbol AFTER the amount and
    // 3-digit grouping (no lakh). The canon page shows "₹8,450" in an LTR isolate; that choice is RTL-1b's (§7 Q).
    expect(out).toBe(`${RLM}123,456.50${NBSP}₹`);
    expect(out).not.toBe(formatMoneyMinor('12345650', 'INR', 'en'));   // ar is no longer silently formatted as en-IN
  });
  it('keeps FULL precision past Number.MAX_SAFE_INTEGER in ar (no float)', () => {
    const out = formatMoneyMinor('9007199254740991', 'INR', 'ar');
    expect(out).not.toMatch(ARABIC_INDIC);
    expect(out.replace(/[^0-9]/g, '')).toBe('9007199254740991');
    expect(out).toContain('.91');
  });
  it('negative, zero, 0-decimal (JPY) and 3-decimal (BHD) amounts are exact in ar', () => {
    expect(formatMoneyMinor('-99900', 'INR', 'ar')).toBe(`-${RLM}999.00${NBSP}₹`);
    expect(formatMoneyMinor('0', 'INR', 'ar').replace(/[^0-9]/g, '')).toBe('000');
    expect(formatMoneyMinor('500', 'JPY', 'ar').replace(/[^0-9]/g, '')).toBe('500');
    expect(formatMoneyMinor('1234', 'BHD', 'ar')).toMatch(/1\.234/);
    for (const [m, c] of [['-99900', 'INR'], ['500', 'JPY'], ['1234', 'BHD'], ['125000', 'AED']]) {
      expect(formatMoneyMinor(m, c, 'ar')).not.toMatch(ARABIC_INDIC);
    }
  });
  it('plain numbers and dates in ar are Western digits too', () => {
    expect(formatNumber(1234567, 'ar')).toBe('1,234,567');
    const d = formatDate('2026-11-11T12:00:00Z', 'ar', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    expect(d).not.toMatch(ARABIC_INDIC);
    expect(d.replace(/[^0-9]/g, '')).toBe('11112026');
  });
  it('en / hi / gu money is unchanged (Indian grouping, symbol first)', () => {
    expect(formatMoneyMinor('12345650', 'INR', 'en')).toBe('₹1,23,456.50');
    expect(formatMoneyMinor('12345650', 'INR', 'hi')).toBe(formatMoneyMinor('12345650', 'INR', 'hi-IN'));
    expect(formatMoneyMinor('12345650', 'INR', 'mr')).toBe('₹1,23,456.50');   // non-preview target code: still en-IN
  });
});
