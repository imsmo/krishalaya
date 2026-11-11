// apps/mobile/src/core/__tests__/rtl1h3-ar-parity.spec.ts · PC-56 RTL-1h-3 (brief_rtl1h3.md §B) — the first WHOLE-catalogue ×4 parity
// spec on mobile. en.json / hi.json / gu.json / ar.ts (the Arabic MACHINE DRAFT, assembled by records-scripts/rtl1h3_ar_assemble.py):
//  1 · the four key sets are equal (ar also in en.json key order — the assembler's shape);
//  2 · every `{placeholder}` token equals en's, on every key, in every language;
//  3 · ar: no Arabic-Indic digits (Western numerals, founder Q4); every en → / ← reversed EXACTLY (→ becomes ←, ← becomes →);
//  4 · ar: "translated, not copied" — every value carries Arabic script, except the verbatim values named BY RULE:
//      (a) the en value is written in Hindi/Gujarati script (the *vern* lines, language names in their own script) → ar keeps it
//          verbatim; a MIXED en value (English + an Indic name, e.g. "Hindi · हिंदुस्तानी") is translated AND keeps every
//          Indic run; (b) the en value has no letters (symbols, emoji, numbers, placeholders only); (c) once its {placeholders} and the
//          named codes/brands/units below are removed, no letter is left. Any other en-equal value fails;
//  5 · ar.ts carries the MACHINE DRAFT header and the RTL-1h-3 scope.
// (This replaces RTL-1h-1's "Arabic script in every value" check, written for the 26-key partial draft — lead-authorised.)
import * as fs from 'fs';
import * as path from 'path';
import ar from '../i18n/locales/ar';
import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import gu from '../i18n/locales/gu.json';

const E = en as Record<string, string>;
const CATS: Record<string, Record<string, string>> = { hi: hi as Record<string, string>, gu: gu as Record<string, string>, ar };
const AR_SRC = fs.readFileSync(path.resolve(__dirname, '../i18n/locales/ar.ts'), 'utf8');
const placeholders = (s: string) => (s.match(/\{[^{}]+\}/g) ?? []).sort();
const count = (s: string, ch: string) => s.split(ch).length - 1;
const ARABIC = /[؀-ۿ]/;
const INDIC = /[ऀ-૿]/;                 // Devanagari … Gujarati
const LATIN = /[A-Za-z]/;
/** Written in Hindi/Gujarati script: Indic letters and no Latin letter (outside placeholders). */
const indicOnly = (e: string) => INDIC.test(e) && !LATIN.test(e.replace(/\{[^{}]+\}/g, ''));
const indicRuns = (e: string) => e.match(/[ऀ-૿]+(?:\s+[ऀ-૿]+)*/g) ?? [];
const EASTERN_DIGITS =/[٠-٩۰-۹]/;
/** Codes, brands, units and fixed identifiers that stay in Latin script in every language (rule c). Phrases first, longest first. */
const NAMED = [
  'Pradhan Mantri Suraksha Bima Yojana', 'NPOP / India Organic', 'Krishalaya Pvt Ltd', 'Pashu Aadhaar', 'Schedule H',
  'hello@krishalaya.com', 'krishalaya.com', 'yourname@upi', 'CIN U72200GJ2024', 'YYYY-MM-DD',
  'Krishalaya', 'GPay', 'Paytm', 'PhonePe', 'WhatsApp', 'Excel', 'English',
  'IFSC', 'GSTIN', 'PAN', 'FPO', 'HUF', 'LLP', 'EMD', 'CSV', 'JSON', 'PDF', 'SMS', 'GMV', 'KYC', 'OBC', 'SC', 'ST', 'UPI', 'UTR',
  'UV', 'AI', 'DELETE', '°C', 'qtl', 'kg', 'km/h', 'km', 'hPa', 'm',
];
/** One romanised-Gujarati speech sample the tutorial shows as "what to say" — kept as spoken, by design. */
const SPOKEN_SAMPLES = ['system.tutorial.speak.example'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const NAMED_RE = new RegExp(NAMED.map((n) => `(?<![A-Za-z])${esc(n)}(?![A-Za-z])`).join('|'), 'g');
/** The letters left in an en value once placeholders and named codes/brands/units are removed. */
const translatable = (e: string) => /\p{L}/u.test(e.replace(/\{[^{}]+\}/g, '').replace(NAMED_RE, ''));
const verbatimRule = (k: string): string | null => {
  const e = E[k];
  if (indicOnly(e)) return 'indic';
  if (!/\p{L}/u.test(e.replace(/\{[^{}]+\}/g, ''))) return 'no-letters';
  if (!translatable(e)) return 'named';
  if (SPOKEN_SAMPLES.includes(k)) return 'spoken-sample';
  return null;
};

describe('1 · four equal key sets', () => {
  it('hi, gu and ar carry exactly the en key set', () => {
    const ek = Object.keys(E).sort();
    for (const c of Object.keys(CATS)) expect([c, Object.keys(CATS[c]).sort()]).toEqual([c, ek]);
  });
  it('ar is in en.json key order (the assembler\'s output shape)', () => {
    expect(Object.keys(ar)).toEqual(Object.keys(E));
  });
  it('no empty value in any language', () => {
    const empty = Object.entries(CATS).flatMap(([c, m]) => Object.entries(m).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => `${c}:${k}`));
    expect(empty).toEqual([]);
  });
});

describe('2 · {placeholder} tokens equal en on every key, every language', () => {
  it.each(Object.keys(CATS))('%s', (c) => {
    const bad = Object.keys(E).filter((k) => JSON.stringify(placeholders(CATS[c][k] ?? '')) !== JSON.stringify(placeholders(E[k])));
    expect(bad).toEqual([]);
  });
});

describe('3 · ar numerals and arrows', () => {
  it('no Arabic-Indic digit in any ar value', () => {
    expect(Object.keys(ar).filter((k) => EASTERN_DIGITS.test(ar[k]))).toEqual([]);
  });
  it('every en → is a ← in ar and every en ← a → (counts equal, key by key)', () => {
    const bad = Object.keys(E).filter((k) => count(E[k], '→') !== count(ar[k], '←') || count(E[k], '←') !== count(ar[k], '→'));
    expect(bad).toEqual([]);
  });
  it('the arrow values are really there (28 en values with an arrow → 28 reversed)', () => {
    const withArrow = Object.keys(E).filter((k) => /[→←]/.test(E[k]));
    expect(withArrow.length).toBeGreaterThanOrEqual(28);
    for (const k of withArrow) expect([k, ar[k]]).toEqual([k, expect.stringMatching(/←/)]);
  });
});

describe('4 · ar is translated, not copied', () => {
  it('every value that must be translated carries Arabic script', () => {
    const bad = Object.keys(E).filter((k) => verbatimRule(k) === null && !ARABIC.test(ar[k]));
    expect(bad).toEqual([]);
  });
  it('every ar value equal to en is verbatim BY RULE (Indic script · no letters · named codes/brands/units · the spoken sample)', () => {
    const bad = Object.keys(E).filter((k) => ar[k] === E[k] && verbatimRule(k) === null);
    expect(bad).toEqual([]);
  });
  it('Indic-script en values are kept verbatim in ar (the lead call: *vern* lines and language names in their own script)', () => {
    const indic = Object.keys(E).filter((k) => indicOnly(E[k]));
    expect(indic.length).toBeGreaterThanOrEqual(20);
    expect(indic.filter((k) => ar[k] !== E[k])).toEqual([]);
  });
  it('mixed English + Indic en values: the English part translated (Arabic present), every Indic run kept as written', () => {
    const mixed = Object.keys(E).filter((k) => INDIC.test(E[k]) && !indicOnly(E[k]));
    expect(mixed.length).toBeGreaterThan(0);
    expect(mixed.filter((k) => !ARABIC.test(ar[k]) || indicRuns(E[k]).some((r) => !ar[k].includes(r)))).toEqual([]);
  });
  it('the rules really bite: an ordinary en sentence is translatable, a named code alone is not', () => {
    expect(verbatimRule('home.sellIn60')).toBeNull();
    expect(verbatimRule('profile.bank.ifsc')).toBe('named');
    expect(verbatimRule('home.weather.temp')).toBe('named');        // '{deg}°C'
    expect(verbatimRule('common.dash')).toBe('no-letters');
    expect(translatable('IFSC code')).toBe(true);
    expect(translatable('Smart')).toBe(true);        // "m" is a unit only as a whole word
  });
});

describe('5 · the header', () => {
  it('ar.ts opens with the MACHINE DRAFT line and names the RTL-1h-3 whole-app scope', () => {
    expect(AR_SRC.split('\n')[0]).toContain('MACHINE DRAFT, NOT REVIEWED.');
    expect(AR_SRC).toContain('SCOPE (RTL-1h-3): the whole app');
    expect(AR_SRC).toContain('Founder review owed');
  });
});
