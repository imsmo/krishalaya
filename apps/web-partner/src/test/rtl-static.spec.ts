import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
// apps/web-partner/src/test/rtl-static.spec.ts · PC-56 RTL-1d — the STATIC RTL backstop for the whole partner console (web-tenant's RTL-1b /
// the storefront's RTL-1c rtl-static.spec, adapted). A render test sees only the pages it mounts; this reads EVERY non-test source with the
// TypeScript parser (comments and strings are not code, so they are never counted):
//   • 0 bare "→"/"←" in JSX (U+2192/U+2190 are NOT Bidi_Mirrored) — 0 at b77c7f0f too (PARTNER-SWEEP removed them): pinned;
//   • no `.toLocaleString(` call anywhere — 0 at b77c7f0f: pinned;
//   • no `new Intl.*(lang, …)` with the BARE app code (dates and counts go through @krishalaya/i18n's formatDate/formatNumber, which pin the
//     registry's Western-digit tag) — 0 at b77c7f0f: pinned;
//   • NO source under app/, components/, features/, lib/ touches `formatMoneyMinor` except the one helper, features/rtl/money.ts (was 20 calls
//     in 19 files at b77c7f0f) — every amount prints in the Indian shape, isolated, under ar, and byte-identical under en/hi/gu;
//   • globals.css stays logical-only, with the RTL-1d rules (banner, the draft tag, the code isolate) in place;
//   • the shell: the root layout draws the machine-draft banner; the language choice offers the preview language with its draft tag.
const SRC = join(__dirname, '..');
const isTest = (p: string) => /\/(test|test-render)\//.test(p) || /\.(spec|test)\.tsx?$/.test(p);
const isCatalogue = (p: string) => /\/i18n\/(en|hi|gu|ar)\.ts$/.test(p);
function walk(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p, out); } else out.push(p);
  }
  return out;
}
const SOURCES = walk(SRC).filter((p) => /\.tsx?$/.test(p) && !isTest(p) && !isCatalogue(p));
const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const ARROW = /[→←]/;

/** Every JSX-text or JSX-expression string carrying a horizontal arrow, as `file:line text`. */
export function bareJsxArrows(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const inJsx = (n: ts.Node) => { for (let p = n.parent; p; p = p.parent) { if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true; if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false; } return false; };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && ARROW.test(n.getText())) hits.push(`${file}:${lineOf(sf, n)} ${n.getText().trim().slice(0, 60)}`);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && ARROW.test(n.text) && inJsx(n)) {
      hits.push(`${file}:${lineOf(sf, n)} ${n.text.slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** Every `x.toLocaleString(…)` call, as `file:line`. */
export function toLocaleStringCalls(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'toLocaleString') hits.push(`${file}:${lineOf(sf, n)}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** Every `new Intl.X(lang …)` whose first argument is the bare identifier `lang`, as `file:line`. */
export function bareIntlLang(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isNewExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Intl'
      && n.arguments?.[0] && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === 'lang') hits.push(`${file}:${lineOf(sf, n)}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** Every use of `formatMoneyMinor` — a call (bare or `x.formatMoneyMinor(`) or an import of the name (also aliased) — as `file:line kind`. */
export function formatMoneyMinorUses(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if ((ts.isIdentifier(e) && e.text === 'formatMoneyMinor') || (ts.isPropertyAccessExpression(e) && e.name.text === 'formatMoneyMinor')) hits.push(`${file}:${lineOf(sf, n)} call`);
    }
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'formatMoneyMinor') hits.push(`${file}:${lineOf(sf, n)} import`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('the scanners themselves (so a pass below means something)', () => {
  it('arrows: JSX text and JSX expressions found; comments, plain data and DirArrow ignored', () => {
    expect(bareJsxArrows('a.tsx', 'const A = () => <a>← Back</a>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', "const A = () => <p>{x}{' → '}{y}</p>;")).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', 'const A = () => <p title={`a → b`}>x</p>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', '// a → b\nconst A = () => <p>{x} <DirArrow /> {y}</p>;')).toEqual([]);
    expect(bareJsxArrows('a.ts', 'export const label = (a: string, b: string) => `${a} → ${b}`;')).toEqual([]);
  });
  it('toLocaleString / bare-code Intl / formatMoneyMinor: calls and imports found (aliased too); comments and strings ignored', () => {
    expect(toLocaleStringCalls('a.tsx', 'const A = () => <b>{n.toLocaleString(lang)}</b>;')).toEqual(['a.tsx:1']);
    expect(toLocaleStringCalls('a.tsx', "// n.toLocaleString(lang)\nconst s = 'toLocaleString(';")).toEqual([]);
    expect(bareIntlLang('a.ts', "const f = new Intl.NumberFormat(lang);\nconst g = new Intl.DateTimeFormat(intlTag(lang), {});")).toEqual(['a.ts:1']);
    expect(formatMoneyMinorUses('a.tsx', "import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';\nconst A = () => <b>{formatMoneyMinor(m, 'INR', lang)}</b>;"))
      .toEqual(['a.tsx:1 import', 'a.tsx:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { formatMoneyMinor as f } from 'x';\nconst s = i18n.formatMoneyMinor(m);")).toEqual(['a.ts:1 import', 'a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "// formatMoneyMinor(m)\nconst s = 'formatMoneyMinor(';\nconst t = moneyString(m, 'INR', lang);")).toEqual([]);
  });
});

describe('web-partner: arrows, counts and digits (rtl-safe)', () => {
  it('0 bare "→"/"←" in JSX across every partner source (0 at b77c7f0f — pinned)', () => {
    expect(SOURCES.length).toBeGreaterThan(150);
    expect(SOURCES.flatMap((p) => bareJsxArrows(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no source calls toLocaleString( (0 at b77c7f0f — pinned)', () => {
    expect(SOURCES.flatMap((p) => toLocaleStringCalls(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no `new Intl.*(lang …)` with the bare app code (0 at b77c7f0f — pinned)', () => {
    expect(SOURCES.flatMap((p) => bareIntlLang(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
});

describe('money goes through the one helper (RTL-1d)', () => {
  const MONEY_HELPER = 'features/rtl/money.ts';
  const scoped = SOURCES.filter((p) => ['app', 'components', 'features', 'lib'].some((d) => p.startsWith(join(SRC, d) + '/')));
  it('no formatMoneyMinor anywhere under app/, components/, features/ or lib/ outside the helper (was 20 calls in 19 files at b77c7f0f)', () => {
    expect(scoped.length).toBeGreaterThan(150);
    const hits = scoped.filter((p) => relative(SRC, p) !== MONEY_HELPER).flatMap((p) => formatMoneyMinorUses(relative(SRC, p), readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('the helper holds exactly one call: through moneyLang, isolated only under the preview language', () => {
    const money = readFileSync(join(SRC, MONEY_HELPER), 'utf8');
    expect(formatMoneyMinorUses(MONEY_HELPER, money).filter((h) => h.endsWith('call'))).toHaveLength(1);
    expect(money).toContain('const text = formatMoneyMinor(minor, currency, moneyLang(lang));');
    expect(money).toContain('return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;');
  });
  it('the 20 former call sites print through moneyText (19 views)', () => {
    const uses = scoped.filter((p) => relative(SRC, p) !== MONEY_HELPER).map((p) => {
      const sf = ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let n = 0; const visit = (x: ts.Node) => { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'moneyText') n++; ts.forEachChild(x, visit); }; visit(sf);
      return [relative(SRC, p), n] as const;
    }).filter(([, n]) => n > 0);
    expect(uses.length).toBe(19);
    expect(uses.reduce((a, [, n]) => a + n, 0)).toBe(20);
  });
});

describe('codes inside Arabic sentences are isolated (ltrText)', () => {
  const SITES: Array<[string, string]> = [
    ['components/LoginSteps.tsx', "{ phone: ltrText(phoneMasked ?? '', lang) }"],
    ['components/partner1/SettingsView.tsx', "phone: ltrText(subject.phone ?? '', lang)"],
    ['components/partner1/SettingsView.tsx', '{ltrText(i.phoneMasked, lang)}'],
    ['components/partner1/RevokeChain.tsx', 'prefix: ltrText(keyRow.keyPrefix, lang), min: KEY_REVOKE_REASON_MIN'],
    ['components/partner1/RevokeChain.tsx', '{ prefix: ltrText(keyRow.keyPrefix, lang), time }'],
    ['components/partner1/WebhooksView.tsx', 'header: ltrText(W.signatureHeader, lang), legacy: ltrText(W.legacySignatureHeader, lang)'],
    ['components/partner1/HelpView.tsx', '{ format: ltrText(W.headerFormat, lang) }'],
    ['components/partner2/InsurerDashboardView.tsx', '{ ref: ltrText(regulatorRefMasked, lang) }'],
  ];
  it.each(SITES)('%s: %s', (f, needle) => { expect(readFileSync(join(SRC, f), 'utf8')).toContain(needle); });
  it('the pages hand those views the language', () => {
    expect(readFileSync(join(SRC, 'app/login/page.tsx'), 'utf8')).toMatch(/<LoginSteps\s+t=\{t\}\s+lang=\{getLang\(\)\}/);
    expect(readFileSync(join(SRC, 'app/help/page.tsx'), 'utf8')).toContain('<HelpView t={t} lang={getLang()} mailbox={mailbox} />');
    expect(readFileSync(join(SRC, 'app/account/api/page.tsx'), 'utf8')).toContain('<RevokeConfirm t={t} lang={lang} ');
    expect(readFileSync(join(SRC, 'app/account/settings/page.tsx'), 'utf8')).toContain('<ActConfirm t={t} lang={lang} ');
  });
});

describe('the shell and the stylesheet', () => {
  it('globals.css is logical-only and carries the RTL-1d rules', () => {
    const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const PHYS = /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|(?:^|[\s;{])float\s*:\s*(?:left|right)/m;
    expect(css.split('\n').filter((l) => PHYS.test(l))).toEqual([]);
    expect(css).toContain('.kv-md-banner { margin-block-end: 12px;');
    expect(css).toContain('.kv-lang-choice__draft {');
    expect(css).toContain('code.kv-code, code.kv-token { direction: ltr; unicode-bidi: isolate; }');
  });
  it('the root layout draws the banner for a preview language, above the chrome; the language choice offers the preview with its draft tag', () => {
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('const draftBanner = PREVIEW_LANGUAGES.includes(lang.code) ? (');
    expect(layout).toMatch(/\{draftBanner\}\s*\{authed \?/);
    const page = readFileSync(join(SRC, 'app/account/notifications/preferences/page.tsx'), 'utf8');
    expect(page).toContain('choices={LANGUAGE_CHOICES} previews={PREVIEW_CHOICES} />');
    const view = readFileSync(join(SRC, 'components/partner6/AccountNotificationPrefsView.tsx'), 'utf8');
    expect(view).toContain("<span className=\"kv-lang-choice__draft\">({t.t('lang.draft')})</span>");
  });
});
