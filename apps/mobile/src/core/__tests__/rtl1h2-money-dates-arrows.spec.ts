// apps/mobile/src/core/__tests__/rtl1h2-money-dates-arrows.spec.ts · PC-56 RTL-1h-2 (brief_rtl1h2.md §D) — the pure half of mobile
// money, dates and arrows, under the "core" project (node, no React Native):
//  1 · `moneyText`: the Indian shape + LRI…PDI under ar; byte-identical to `formatMoneyMinor(…, lang)` under en/hi/gu (grid).
//  2 · `moneyWholeText`: byte-identical to the four bespoke `Intl.NumberFormat` helpers it replaced, under en/hi/gu.
//  3 · `bidi`: arrows, chevrons, spans and isolates — exactly the old characters under ltr, reversed/isolated under rtl.
//  4 · dates: the app's language, never the phone's (survey F-H3), never a throw.
//  5 · static pins (TypeScript parser over every non-test source file under src/): 0 directional glyphs outside bidi.ts, 0 no-locale
//      `toLocale*`, 0 `formatMoneyMinor` (call, namespaced call, import, aliased import) outside money.ts, 0 bespoke currency
//      `Intl.NumberFormat` outside money.ts; floor counts so a mass revert cannot pass; the server-bound ticket subject is never isolated.
// MoneyText (ui-native), Icon mirroring and the screens are proven in src/app/__tests__/render/rtl1h2-arabic-money.render-spec.tsx.
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { formatMoneyMinor, formatDate, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { moneyText, moneyLang, moneyWholeText } from '../i18n/money';
import { LRI, PDI, isRtl, ltrRun, isolate, arrowFwd, arrowBack, chevFwd, chevBack, spanText } from '../i18n/bidi';
import { dateText, dateTimeText } from '../i18n/dates';
import { hourLabel, forecastDayLabel } from '../../features/market/market';

const LTR = ['en', 'hi', 'gu'] as const;
const AMOUNTS: Array<string | bigint> = ['12345650', '0', '-12345650', '5', '-5', '99', '100', '1234567890123456789', 12345650n, -1n, 'not-a-number'];
const CURRENCIES = ['INR', 'USD', 'JPY', 'BHD', 'AED'];
const MARKS = /[⁦-⁩‎‏]/;

describe('1 · moneyText — the Indian shape, isolated, under Arabic; byte-identical under en/hi/gu', () => {
  it('ar: ₹1,23,456.50 inside LRI…PDI — never the ar locale\'s own shape', () => {
    expect(moneyText('12345650', 'INR', 'ar')).toBe('⁦₹1,23,456.50⁩');
    const out = moneyText('12345650', 'INR', 'ar');
    expect(out).not.toContain('123,456.50');
    expect(out).not.toMatch(/[٠-٩‏]/);
    expect(out).not.toBe(formatMoneyMinor('12345650', 'INR', 'ar'));
  });
  it('ar: signs, zero, other currencies, 19 digits', () => {
    expect(moneyText('-12345650', 'INR', 'ar')).toBe('⁦-₹1,23,456.50⁩');
    expect(moneyText('0', 'INR', 'ar')).toBe('⁦₹0.00⁩');
    expect(moneyText(-1n, 'INR', 'ar')).toBe('⁦-₹0.01⁩');
    expect(moneyText('12345650', 'USD', 'ar')).toBe('⁦$1,23,456.50⁩');
    expect(moneyText('1234567890123456789', 'INR', 'ar')).toBe(`⁦${formatMoneyMinor('1234567890123456789', 'INR', 'en')}⁩`);
    expect(moneyText('1234567890123456789', 'INR', 'ar')).toContain('₹12,34,56,78,90,12,34,567.89');
  });
  it('ar grid: exactly LRI + formatMoneyMinor(…, en) + PDI for every amount × currency', () => {
    for (const a of AMOUNTS) for (const c of CURRENCIES) expect(moneyText(a, c, 'ar')).toBe(`${LRI}${formatMoneyMinor(a, c, 'en')}${PDI}`);
  });
  it.each(LTR)('%s grid: byte-identical to formatMoneyMinor(…, lang), no mark at all', (lang) => {
    for (const a of AMOUNTS) for (const c of CURRENCIES) {
      const out = moneyText(a, c, lang);
      expect(out).toBe(formatMoneyMinor(a, c, lang));
      expect(out).not.toMatch(MARKS);
    }
  });
  it('the rule follows PREVIEW_LANGUAGES: moneyLang maps each preview language to en and leaves every other code alone', () => {
    expect(PREVIEW_LANGUAGES).toContain('ar');
    for (const p of PREVIEW_LANGUAGES) expect(moneyLang(p)).toBe('en');
    for (const l of [...LTR, 'mr', 'ur']) expect(moneyLang(l)).toBe(l);
    expect(moneyText('12345650', 'INR', 'ur')).not.toMatch(MARKS);   // registered rtl but not a preview language → untouched
  });
});

describe('2 · moneyWholeText — the four bespoke whole-rupee helpers, kept byte-identical', () => {
  // The exact expression the four helpers (mandi/[id], mandi/history, wallet/earnings, orders/decision) ran before this wave.
  const old = (minor: string, cc: string, lang: string) => {
    try { return new Intl.NumberFormat(lang === 'en' ? 'en-IN' : lang === 'gu' ? 'gu-IN' : 'hi-IN', { style: 'currency', currency: cc, maximumFractionDigits: 0 }).format(Number(BigInt(minor)) / 100); }
    catch { return '—'; }
  };
  const WHOLE = ['12345650', '12345649', '0', '50', '150', '-12345650', '-40', '99999999', '7', 'oops'];
  it.each(LTR)('%s: equals the old helper over amounts × INR/USD/AED', (lang) => {
    for (const a of WHOLE) for (const c of ['INR', 'USD', 'AED']) expect(moneyWholeText(a, c, lang)).toBe(old(a, c, lang));
  });
  it('ar: the en-IN whole shape, isolated (before: hi-IN, unisolated)', () => {
    expect(moneyWholeText('12345650', 'INR', 'ar')).toBe(`${LRI}${old('12345650', 'INR', 'en')}${PDI}`);
    expect(moneyWholeText('12345650', 'INR', 'ar')).toBe('⁦₹1,23,457⁩');
  });
  it('a bad amount is "—" in every language (Law 12)', () => {
    for (const l of [...LTR, 'ar']) expect(moneyWholeText('x', 'INR', l)).toBe('—');
  });
});

describe('3 · bidi — arrows, chevrons, spans and isolates', () => {
  it.each(LTR)('%s: exactly the characters the screens printed before', (lang) => {
    expect(isRtl(lang)).toBe(false);
    expect(arrowFwd(lang)).toBe('→');
    expect(arrowBack(lang)).toBe('←');
    expect(chevFwd(lang)).toBe('›');
    expect(chevBack(lang)).toBe('‹');
    expect(spanText('2026-10-01', '2026-10-15', lang)).toBe('2026-10-01 → 2026-10-15');
    expect(isolate('KR-123', lang)).toBe('KR-123');
  });
  it('ar: forward points left, back points right; chevrons are isolated so a mirroring engine cannot flip them back', () => {
    expect(isRtl('ar')).toBe(true);
    expect(arrowFwd('ar')).toBe('←');
    expect(arrowBack('ar')).toBe('→');
    expect(chevFwd('ar')).toBe('⁦‹⁩');
    expect(chevBack('ar')).toBe('⁦›⁩');
  });
  it('ar: a span reverses its arrow and isolates each end; a code is isolated', () => {
    expect(spanText('2026-10-01', '2026-10-15', 'ar')).toBe('⁦2026-10-01⁩ ← ⁦2026-10-15⁩');
    expect(isolate('KR-123', 'ar')).toBe('⁦KR-123⁩');
    expect(ltrRun('x')).toBe(`${LRI}x${PDI}`);
  });
  it('an unknown or non-servable code is ltr (falls back to English — never mirrored by accident)', () => {
    for (const l of ['xx', '', 'ur']) expect(isRtl(l)).toBe(false);
  });
});

describe('4 · dates follow the app\'s language, never the phone\'s (F-H3)', () => {
  const ISO = '2026-10-04T10:30:00Z';
  it.each([...LTR, 'ar'])('%s: dateText / dateTimeText are formatDate(…, lang) medium (+ short time)', (lang) => {
    expect(dateText(ISO, lang)).toBe(formatDate(ISO, lang, { dateStyle: 'medium' }));
    expect(dateTimeText(ISO, lang)).toBe(formatDate(ISO, lang, { dateStyle: 'medium', timeStyle: 'short' }));
  });
  it('the output depends on the app language, not on the process locale', () => {
    expect(dateText(ISO, 'hi')).toMatch(/[ऀ-ॿ]/);      // Hindi month name
    expect(dateText(ISO, 'gu')).toMatch(/[઀-૿]/);      // Gujarati month name
    expect(dateText(ISO, 'en')).toMatch(/Oct/);
    expect(dateText(ISO, 'ar')).not.toBe(dateText(ISO, 'en'));     // its own locale (ar-AE-u-nu-latn) …
    expect(dateText(ISO, 'ar')).not.toMatch(/[٠-٩۰-۹]/); // … with Western digits (Q4)
    expect(dateText(ISO, 'ar')).toMatch(/2026/);
  });
  it('an unreadable value prints as it came — never a throw in a render path', () => {
    expect(dateText('not a date', 'en')).toBe('not a date');
    expect(dateTimeText('not a date', 'ar')).toBe('not a date');
  });
  it('market.hourLabel: byte-identical to the old toLocaleTimeString for en/hi/gu; Arabic now its own locale', () => {
    const t = '2026-10-04T15:00:00Z';
    for (const l of LTR) expect(hourLabel(t, l)).toBe(new Date(Date.parse(t)).toLocaleTimeString(l === 'en' ? 'en-IN' : l === 'gu' ? 'gu-IN' : 'hi-IN', { hour: 'numeric' }));
    expect(hourLabel(t, 'ar')).toBe(formatDate(Date.parse(t), 'ar', { hour: 'numeric' }));
    expect(hourLabel('nope', 'en')).toBe('nope');
  });
  it('market.forecastDayLabel: the app language\'s weekday (was the phone\'s)', () => {
    const d = { date: '2026-10-07' };
    for (const l of [...LTR, 'ar']) expect(forecastDayLabel(d, l)).toBe(formatDate(Date.parse(d.date), l, { weekday: 'short' }));
    expect(forecastDayLabel(d, 'hi')).toMatch(/[ऀ-ॿ]/);
    expect(forecastDayLabel(d)).toBe(formatDate(Date.parse(d.date), 'en', { weekday: 'short' }));
    expect(forecastDayLabel({ date: 'x' }, 'en')).toBe('x');
  });
});

// ---------- 5 · static pins (parser, not grep) ----------
const SRC = path.resolve(__dirname, '../..');
const BIDI = path.join(SRC, 'core/i18n/bidi.ts');
const MONEY = path.join(SRC, 'core/i18n/money.ts');
const LOCALES = path.join(SRC, 'core/i18n/locales');
function sources(dir = SRC, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // RTL-1h-3 (lead-authorised): the catalogues under core/i18n/locales/ are excluded — ar.ts carries the REVERSED sentence arrows the
    // brief requires; they are pinned "every en → / ← reversed exactly" by core/__tests__/rtl1h3-ar-parity.spec.ts.
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules' && p !== LOCALES) sources(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|render-spec)\./.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const GLYPH = /[→←›‹]/;
interface Hit { where: string; what: string }
/** Scan one source text. Exported shape so the scanner self-test can feed it fixtures. */
function scan(file: string, text: string) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const glyphs: Hit[] = []; const money: Hit[] = []; const toLocale: Hit[] = []; const intlMoney: Hit[] = [];
  let moneyTextCalls = 0; let isolateCalls = 0;
  const at = (n: ts.Node) => `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && GLYPH.test(n.text)) {
      glyphs.push({ where: at(n), what: JSON.stringify(n.text.trim()) });
    }
    if (ts.isIdentifier(n) && n.text === 'formatMoneyMinor' && !ts.isImportSpecifier(n.parent)) money.push({ where: at(n), what: ts.SyntaxKind[n.parent.kind] });
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'formatMoneyMinor') money.push({ where: at(n), what: 'import' });
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (name === 'moneyText') moneyTextCalls++;
      if (name === 'isolate') isolateCalls++;
      if (/^toLocale(Date|Time)?String$/.test(name) && ts.isPropertyAccessExpression(callee)) {
        const first = n.arguments[0];
        if (!first || (ts.isIdentifier(first) && first.text === 'undefined')) toLocale.push({ where: at(n), what: `${name}(${first ? 'undefined' : ''})` });
      }
    }
    if (ts.isNewExpression(n) && n.expression.getText(sf) === 'Intl.NumberFormat' && /style:\s*'currency'/.test(n.getText(sf))) intlMoney.push({ where: at(n), what: 'Intl.NumberFormat currency' });
    n.forEachChild(visit);
  };
  visit(sf);
  return { glyphs, money, toLocale, intlMoney, moneyTextCalls, isolateCalls };
}
const ALL = sources().map((f) => ({ f, r: scan(f, fs.readFileSync(f, 'utf8')) }));
const list = (pick: (r: ReturnType<typeof scan>) => Hit[], except: string[] = []) =>
  ALL.filter(({ f }) => !except.includes(f)).flatMap(({ r }) => pick(r).map((h) => `${h.where} ${h.what}`));

describe('5 · static pins over every source file under src/', () => {
  it('the scanner sees what it must and ignores comments', () => {
    const r = scan('x.tsx', [
      "import { formatMoneyMinor as fm } from '@krishalaya/i18n';",
      "import * as I from '@krishalaya/i18n';",
      "// a → in a comment, formatMoneyMinor in a comment, toLocaleString() in a comment",
      "const a = <Text>{t('k')} →</Text>; const b = '›'; const c = `${x} ←`;",
      "I.formatMoneyMinor('1', 'INR', 'en'); new Date().toLocaleString(); d.toLocaleDateString(undefined, {}); d.toLocaleString('en-IN');",
      "new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }); new Intl.NumberFormat('en-IN');",
      "moneyText('1', 'INR', l); isolate(x, l);",
    ].join('\n'));
    expect(r.glyphs.map((h) => h.what)).toEqual(['"→"', '"›"', '"←"']);
    expect(r.money.map((h) => h.what)).toEqual(['import', 'PropertyAccessExpression']);
    expect(r.toLocale.map((h) => h.what)).toEqual(['toLocaleString()', 'toLocaleDateString(undefined)']);
    expect(r.intlMoney).toHaveLength(1);
    expect([r.moneyTextCalls, r.isolateCalls]).toEqual([1, 1]);
  });
  it('0 bare arrows/chevrons (→ ← › ‹) in JSX text, strings or templates outside core/i18n/bidi.ts (was 60 at 0473c429)', () => {
    expect(list((r) => r.glyphs, [BIDI])).toEqual([]);
  });
  it('0 no-locale toLocaleString/DateString/TimeString calls (was 11 at 0473c429)', () => {
    expect(list((r) => r.toLocale)).toEqual([]);
  });
  it('0 formatMoneyMinor (call, namespaced call, import, aliased import) outside core/i18n/money.ts (was 55 calls in 24 files)', () => {
    expect(list((r) => r.money, [MONEY])).toEqual([]);
  });
  it('0 bespoke currency Intl.NumberFormat outside core/i18n/money.ts (was 4)', () => {
    expect(list((r) => r.intlMoney, [MONEY])).toEqual([]);
  });
  it('the helpers are really used: ≥ 55 moneyText calls, ≥ 70 isolate calls in screens', () => {
    const sum = (k: 'moneyTextCalls' | 'isolateCalls') => ALL.filter(({ f }) => f !== MONEY && f !== BIDI).reduce((n, { r }) => n + r[k], 0);
    expect(sum('moneyTextCalls')).toBeGreaterThanOrEqual(55);
    expect(sum('isolateCalls')).toBeGreaterThanOrEqual(70);
  });
  it('money.ts holds the one call and the isolation rule; bidi.ts holds the four glyph pairs', () => {
    const m = fs.readFileSync(MONEY, 'utf8');
    expect(m).toContain('const text = formatMoneyMinor(minor, currency, moneyLang(lang));');
    expect(m).toContain('return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;');
    const b = fs.readFileSync(BIDI, 'utf8');
    expect(b).toContain("export const LRI = '\\u2066';");
    expect(b).toContain("export const PDI = '\\u2069';");
  });
  it('a value sent to the server is never isolated: the wage-dispute ticket subject keeps the raw booking number', () => {
    const s = fs.readFileSync(path.join(SRC, 'app/(worker)/dispute/[id].tsx'), 'utf8');
    const line = s.split('\n').find((l) => l.includes("'wageDispute.ticketSubject'"))!;
    expect(line).toBeDefined();
    expect(line).not.toContain('isolate(');
  });
});
