import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
// apps/web-ops/src/test/rtl-static.spec.ts · PC-56 RTL-1e — the STATIC RTL backstop for the whole ops console (web-tenant's RTL-1b /
// web-partner's RTL-1d rtl-static.spec, adapted). A render test sees only the pages it mounts; this reads EVERY non-test source with the
// TypeScript parser (comments and strings outside JSX are not counted — the refusal ledgers' "W370 → W372" notes are data, never rendered):
//   • 0 bare "→"/"←" in JSX (U+2192/U+2190 are NOT Bidi_Mirrored) — 0 at 94d07840 too: pinned;
//   • no `.toLocaleString(` call anywhere — 0 at 94d07840: pinned;
//   • no `new Intl.*(…)` at all — 0 at 94d07840 (dates and counts go through @krishalaya/i18n's formatters): pinned;
//   • NO source under app/, components/, features/, lib/ imports `formatMoneyMinor` from anywhere or calls it, except the one helper,
//     features/rtl/money.ts (was 14 calls in 12 files at 94d07840) — and six views whose OPS specs pin the call's TEXT, which bind the name
//     `formatMoneyMinor` to `moneyText` by an aliased import of the helper (named below, exactly);
//   • globals.css stays logical-only, with the RTL-1e rules (banner, the draft tag) in place;
//   • the shell: the root layout draws the machine-draft banner above the shell; the switcher offers the preview language with its draft tag.
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
const MONEY_HELPER = 'features/rtl/money.ts';

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
/** Every `new Intl.X(…)`, as `file:line`. */
export function newIntl(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isNewExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Intl') hits.push(`${file}:${lineOf(sf, n)}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** True when the file binds the local name `formatMoneyMinor` to the console helper: `import { moneyText as formatMoneyMinor } from '…/features/rtl/money'`. */
export function aliasesHelper(file: string, text: string): boolean {
  const sf = parse(file, text);
  return sf.statements.some((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && /(^|\/)features\/rtl\/money$/.test(s.moduleSpecifier.text)
    && !!s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)
    && s.importClause.namedBindings.elements.some((e) => e.propertyName?.text === 'moneyText' && e.name.text === 'formatMoneyMinor'));
}
/** Every use of the PACKAGE's `formatMoneyMinor` — an import of that name (also aliased, from any module), a member call `x.formatMoneyMinor(`,
 *  or a bare call in a file that does not bind the name to the helper — as `file:line kind`. */
export function formatMoneyMinorUses(file: string, text: string): string[] {
  const sf = parse(file, text);
  const bound = aliasesHelper(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if ((ts.isIdentifier(e) && e.text === 'formatMoneyMinor' && !bound) || (ts.isPropertyAccessExpression(e) && e.name.text === 'formatMoneyMinor')) hits.push(`${file}:${lineOf(sf, n)} call`);
    }
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'formatMoneyMinor') hits.push(`${file}:${lineOf(sf, n)} import`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** The number of calls to the bare identifier `name` in a file. */
const callsTo = (file: string, text: string, name: string) => {
  const sf = parse(file, text); let n = 0;
  const visit = (x: ts.Node) => { if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === name) n++; ts.forEachChild(x, visit); };
  visit(sf); return n;
};

describe('the scanners themselves (so a pass below means something)', () => {
  it('arrows: JSX text and JSX expressions found; comments and plain data ignored', () => {
    expect(bareJsxArrows('a.tsx', 'const A = () => <a>← Back</a>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', "const A = () => <p>{x}{' → '}{y}</p>;")).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', 'const A = () => <p title={`a → b`}>x</p>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', '// a → b\nconst A = () => <p>{x} {y}</p>;')).toEqual([]);
    expect(bareJsxArrows('a.ts', "export const NOTES = [{ note: 'Back → W370' }];")).toEqual([]);
  });
  it('toLocaleString / Intl: calls found; comments and strings ignored', () => {
    expect(toLocaleStringCalls('a.tsx', 'const A = () => <b>{n.toLocaleString(lang)}</b>;')).toEqual(['a.tsx:1']);
    expect(toLocaleStringCalls('a.tsx', "// n.toLocaleString(lang)\nconst s = 'toLocaleString(';")).toEqual([]);
    expect(newIntl('a.ts', "const f = new Intl.NumberFormat(lang);\n// new Intl.DateTimeFormat(x)")).toEqual(['a.ts:1']);
  });
  it('formatMoneyMinor: the package\'s import and call are found; the helper alias passes; an alias of the package name does not', () => {
    expect(formatMoneyMinorUses('a.tsx', "import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';\nconst A = () => <b>{formatMoneyMinor(m, 'INR', lang)}</b>;"))
      .toEqual(['a.tsx:1 import', 'a.tsx:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { formatMoneyMinor as f } from 'x';\nconst s = i18n.formatMoneyMinor(m);")).toEqual(['a.ts:1 import', 'a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { moneyText as formatMoneyMinor } from '../../features/rtl/money';\nconst s = formatMoneyMinor(m, 'INR', lang);")).toEqual([]);
    expect(formatMoneyMinorUses('a.ts', "import { moneyText as formatMoneyMinor } from './elsewhere';\nconst s = formatMoneyMinor(m, 'INR', lang);")).toEqual(['a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { moneyLang as formatMoneyMinor } from '../../features/rtl/money';\nconst s = formatMoneyMinor(m);")).toEqual(['a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "// formatMoneyMinor(m)\nconst s = 'formatMoneyMinor(';\nconst t = moneyText(m, 'INR', lang);")).toEqual([]);
  });
});

describe('web-ops: arrows, counts and digits (rtl-safe)', () => {
  it('0 bare "→"/"←" in JSX across every ops source (0 at 94d07840 — pinned)', () => {
    expect(SOURCES.length).toBeGreaterThan(120);
    expect(SOURCES.flatMap((p) => bareJsxArrows(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no source calls toLocaleString( (0 at 94d07840 — pinned)', () => {
    expect(SOURCES.flatMap((p) => toLocaleStringCalls(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no `new Intl.*(…)` in any source (0 at 94d07840 — pinned)', () => {
    expect(SOURCES.flatMap((p) => newIntl(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
});

describe('money goes through the one helper (RTL-1e)', () => {
  const scoped = SOURCES.filter((p) => ['app', 'components', 'features', 'lib'].some((d) => p.startsWith(join(SRC, d) + '/')));
  const rel = (p: string) => relative(SRC, p);
  /** The six views whose OPS specs (ops2c / ops3a / ops3c / ops4a / ops4b / ops5b) pin the call's text: the name is bound to the helper. */
  const ALIASED: Array<[string, number]> = [
    ['components/ops2/BillingView.tsx', 1], ['components/ops3/CounterViews.tsx', 1], ['components/ops3/RatesView.tsx', 2],
    ['components/ops4/ChcViews.tsx', 1], ['components/ops4/UpkeepViews.tsx', 1], ['components/ops5/InsightsViews.tsx', 1],
  ];
  /** The six that call `moneyText` by name. */
  const DIRECT: Array<[string, number]> = [
    ['app/dairy/page.tsx', 2], ['components/ops1/AepsViews.tsx', 1], ['components/ops1/KioskViews.tsx', 1],
    ['components/ops1/PayoutBillView.tsx', 1], ['components/ops1/PayoutView.tsx', 1], ['components/ops5/AlertViews.tsx', 1],
  ];
  it('no use of the package\'s formatMoneyMinor under app/, components/, features/ or lib/ outside the helper (was 14 calls in 12 files at 94d07840)', () => {
    expect(scoped.length).toBeGreaterThan(120);
    const hits = scoped.filter((p) => rel(p) !== MONEY_HELPER).flatMap((p) => formatMoneyMinorUses(rel(p), readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('the helper holds exactly one call: through moneyLang, isolated only under the preview language', () => {
    const money = readFileSync(join(SRC, MONEY_HELPER), 'utf8');
    expect(formatMoneyMinorUses(MONEY_HELPER, money).filter((h) => h.endsWith('call'))).toHaveLength(1);
    expect(money).toContain('const text = formatMoneyMinor(minor, currency, moneyLang(lang));');
    expect(money).toContain('return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;');
  });
  it('the 14 former call sites print through moneyText: 7 by name in 6 files, 7 through the helper alias in the 6 pinned views — exactly', () => {
    const others = scoped.filter((p) => rel(p) !== MONEY_HELPER);
    const direct = others.map((p) => [rel(p), callsTo(p, readFileSync(p, 'utf8'), 'moneyText')] as [string, number]).filter(([, n]) => n > 0).sort();
    expect(direct).toEqual(DIRECT);
    const aliased = others.filter((p) => aliasesHelper(rel(p), readFileSync(p, 'utf8')))
      .map((p) => [rel(p), callsTo(p, readFileSync(p, 'utf8'), 'formatMoneyMinor')] as [string, number]).sort();
    expect(aliased).toEqual(ALIASED);
    expect([...direct, ...aliased].reduce((a, [, n]) => a + n, 0)).toBe(14);
  });
});

describe('codes inside Arabic sentences are isolated (ltrText)', () => {
  const SITES: Array<[string, string]> = [
    ['components/ops2/BillingView.tsx', "t.t('ops2.billing.wdraAsEntered', { wdra: ltrText(w.wdraRegNo, lang) })"],
    ['components/ops4/ChcViews.tsx', "t.t('ops4.hire.bookingNo', { no: ltrText(h.bookingNo, lang) })"],
    ['components/ops4/UpkeepViews.tsx', "t.t('ops4.upkeep.recordedId', { id: ltrText(entry.id, lang) })"],
    ['components/ops5/AlertViews.tsx', 'ref: ltrText(b.subjectRef, lang) })'],
    ['components/ops5/AlertViews.tsx', "serial: b.device.serial != null ? ltrText(b.device.serial, lang) : t.t('ops4.iot.serialUnknown')"],
  ];
  it.each(SITES)('%s: %s', (f, needle) => { expect(readFileSync(join(SRC, f), 'utf8')).toContain(needle); });
});

describe('the shell and the stylesheet', () => {
  it('globals.css is logical-only and carries the RTL-1e rules', () => {
    const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const PHYS = /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|(?:^|[\s;{])float\s*:\s*(?:left|right)/m;
    expect(css.split('\n').filter((l) => PHYS.test(l))).toEqual([]);
    expect(css).toContain('.kv-md-banner { margin-block-end: 12px;');
    expect(css).toContain('.kv-locale__draft {');
  });
  it('the root layout draws the banner for a preview language, above the shell; the switcher offers the preview with its draft tag', () => {
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('const draftBanner = PREVIEW_LANGUAGES.includes(lang.code) ? (');
    expect(layout).toMatch(/\{draftBanner\}\s*<div className="kv-shell">/);
    const sw = readFileSync(join(SRC, 'components', 'LocaleSwitcher.tsx'), 'utf8');
    expect(sw).toContain('const PREVIEW = COMING_SOON_LANGUAGES.filter((l) => PREVIEW_LANGUAGES.includes(l.code));');
    expect(sw).toContain('<span className="kv-locale__draft">({draftLabel})</span>');
    expect(readFileSync(join(SRC, 'components', 'Sidebar.tsx'), 'utf8')).toContain("draftLabel={t.t('lang.draft')}");
  });
});
