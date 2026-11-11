import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
// apps/web-tenant/src/test/rtl-static.spec.ts · PC-56 RTL-1b-1 — the STATIC RTL backstop for the whole console (survey G-10).
//
// A render test sees only the pages it mounts; this reads EVERY non-test source with the TypeScript parser (comments are
// not code, so they are never counted). Under dir="rtl" (the Arabic machine draft):
//   • a bare "→"/"←" in JSX points the wrong way — U+2192/U+2190 are NOT Bidi_Mirrored. A range or "go there" arrow is
//     `<DirArrow />` (flipped by CSS under rtl); a "← Back" link keeps its words and drops the glyph (PARTNER-SWEEP rule).
//     At HEAD cb84ffb9 there were 47 (44 JSX text + 3 JSX expressions); this pins 0. The breadcrumb "›" IS Bidi_Mirrored
//     and is left alone.
//   • a physical CSS rule (margin-left, padding-right, left:, text-align:right, float:left …) does not mirror.
//   • the proof pages print money only through <Money> (the <bdi> isolate), never a bare formatMoneyMinor.
//   • /billing/upgrade's counts go through formatNumber (the language's pinned Intl locale), never toLocaleString(code).
//   • RTL-1b-2: NO page or component under app/ calls toLocaleString( — a count goes through formatNumber, a date through
//     formatDate (both pin the language's Intl locale; a bare code or no code at all does not pin the digits).
//   • RTL-1b-2: the two feature-level spans (settlements periodLabel, dairy diversionRowText) carry no arrow glyph in code —
//     the arrow is catalogue copy (rtl.span) so Arabic reverses it.
//   • RTL-1b-3: NO source under app/, components/, features/ touches formatMoneyMinor except the one helper
//     (features/rtl/money.ts `moneyText`, and `<Money>` in components/Bidi.tsx) — every amount prints in the Indian shape,
//     isolated, under ar, and byte-identical under en/hi/gu.
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
const ARROW = /[→←]/;

/** Every JSX-text or JSX-expression string carrying a horizontal arrow, as `file:line text`. DirArrow.tsx is the one
 *  sanctioned glyph (it renders the flipping span). */
export function bareJsxArrows(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const inJsx = (n: ts.Node) => { for (let p = n.parent; p; p = p.parent) { if (ts.isJsxExpression(p) || ts.isJsxAttribute(p)) return true; if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false; } return false; };
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && ARROW.test(n.getText())) hits.push(`${file}:${line(n)} ${n.getText().trim().slice(0, 60)}`);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && ARROW.test(n.text) && inJsx(n)) {
      hits.push(`${file}:${line(n)} ${n.text.slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('the scanner itself (so a pass below means something)', () => {
  it('finds JSX text and JSX-expression arrows; ignores comments, plain data and DirArrow', () => {
    expect(bareJsxArrows('a.tsx', 'const A = () => <a>← Back</a>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', "const A = () => <p>{x}{' → '}{y}</p>;")).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', 'const A = () => <p title={`a → b`}>x</p>;')).toHaveLength(1);
    expect(bareJsxArrows('a.tsx', '// a → b\nconst A = () => <p>{x} <DirArrow /> {y}</p>;')).toEqual([]);
    expect(bareJsxArrows('a.ts', "export const label = (a: string, b: string) => `${a} → ${b}`;")).toEqual([]);
  });
});

describe('web-tenant renders no bare horizontal arrow (rtl-safe direction)', () => {
  it('0 bare "→"/"←" in JSX across every console source (was 47 at cb84ffb9)', () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    const hits = SOURCES.filter((p) => !p.endsWith('/components/DirArrow.tsx'))
      .flatMap((p) => bareJsxArrows(relative(SRC, p), readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('DirArrow is still the flipping span its CSS rule targets', () => {
    expect(readFileSync(join(SRC, 'components', 'DirArrow.tsx'), 'utf8')).toContain('<span className="kv-dir-flip">→</span>');
    expect(readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8')).toContain('[dir="rtl"] .kv-dir-flip { display: inline-block; transform: scaleX(-1); }');
  });
});

describe('web-tenant CSS is logical-only', () => {
  it('globals.css has no physical margin/padding/border side, left:/right:, text-align or float left/right', () => {
    const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const PHYS = /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|(?:^|[\s;{])float\s*:\s*(?:left|right)/m;
    expect(css.split('\n').filter((l) => PHYS.test(l))).toEqual([]);
  });
});

describe('money and counts on the RTL-1b-1 surfaces', () => {
  it('the proof pages print money only through <Money> (an LTR <bdi>), never a bare formatMoneyMinor', () => {
    for (const f of ['app/listings/page.tsx', 'app/listings/import/page.tsx', 'components/ListingsTable.tsx']) {
      expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/formatMoneyMinor\(/);
    }
    expect(readFileSync(join(SRC, 'components', 'Bidi.tsx'), 'utf8')).toContain('<bdi dir="ltr" className="kv-money">{formatMoneyMinor(minor, currency, moneyLang(lang))}</bdi>');
  });
  it('/billing/upgrade formats its counts through formatNumber, never a bare-code toLocaleString', () => {
    const src = readFileSync(join(SRC, 'app', 'billing', 'upgrade', 'page.tsx'), 'utf8');
    expect(src).not.toMatch(/\.toLocaleString\(/);
    expect(src.match(/formatNumber\(Number\(/g)).toHaveLength(4);
  });
});

/** Every `x.toLocaleString(…)` CALL in a source, as `file:line` (comments and strings are not calls, so never counted). */
export function toLocaleStringCalls(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'toLocaleString') {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** Every string/template literal carrying a horizontal arrow, anywhere in a source (not only JSX), as `file:line`. */
function anyArrowLiterals(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && ARROW.test(n.text)) {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('counts, dates and spans app-wide (RTL-1b-2)', () => {
  it('the toLocaleString scanner finds a call and ignores comments and strings', () => {
    expect(toLocaleStringCalls('a.tsx', 'const A = () => <b>{n.toLocaleString(lang)}</b>;')).toEqual(['a.tsx:1']);
    expect(toLocaleStringCalls('a.tsx', "// n.toLocaleString(lang)\nconst s = 'toLocaleString(';")).toEqual([]);
  });
  it('no .tsx under app/ calls toLocaleString( (counts → formatNumber, dates → formatDate; was 11 + 1 at 07332bb4)', () => {
    const appTsx = SOURCES.filter((p) => p.startsWith(join(SRC, 'app') + '/') && p.endsWith('.tsx'));
    expect(appTsx.length).toBeGreaterThan(300);
    expect(appTsx.flatMap((p) => toLocaleStringCalls(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('the 11 RTL-1b-2 counts go through formatNumber(Number(…), lang)', () => {
    for (const [f, n] of [['app/dashboard/page.tsx', 4], ['app/people/page.tsx', 4], ['app/governance/register/page.tsx', 3]] as const) {
      expect({ f, n: (readFileSync(join(SRC, f), 'utf8').match(/formatNumber\(Number\(/g) ?? []).length }).toEqual({ f, n });
    }
  });
  it('settlements periodLabel and dairy diversionRowText build no arrow in code (the arrow is rtl.span copy)', () => {
    for (const f of ['features/settlements/console.ts', 'features/dairy/diversion.ts']) {
      const src = readFileSync(join(SRC, f), 'utf8');
      expect(anyArrowLiterals(f, src)).toEqual([]);
      expect(src).toMatch(/spanText\(t, /);
    }
  });
});

/** Every use of `formatMoneyMinor` in a source — a call (bare or `x.formatMoneyMinor(`) or an import of the name (also an
 *  aliased one, `{ formatMoneyMinor as f }`) — as `file:line kind`. Comments and strings are not code, so never counted. */
export function formatMoneyMinorUses(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if ((ts.isIdentifier(e) && e.text === 'formatMoneyMinor') || (ts.isPropertyAccessExpression(e) && e.name.text === 'formatMoneyMinor')) hits.push(`${at(n)} call`);
    }
    if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'formatMoneyMinor') hits.push(`${at(n)} import`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
/** Every `moneyText(` call, as `file:line`. */
function moneyTextCalls(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'moneyText') hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

// RTL-1b-3: every amount app-wide goes through ONE helper — `moneyText` (text, features/rtl/money.ts) or `<Money>` (the
// <bdi> element, components/Bidi.tsx). Those two files are the only ones under app/, components/, features/ allowed to
// touch formatMoneyMinor; a bare call anywhere else prints the Arabic locale's own shape, unisolated, on an ar page.
const MONEY_HELPERS = ['features/rtl/money.ts', 'components/Bidi.tsx'];
describe('money app-wide goes through the one helper (RTL-1b-3)', () => {
  it('the formatMoneyMinor scanner finds calls and imports (also aliased / namespaced); ignores comments and strings', () => {
    expect(formatMoneyMinorUses('a.tsx', "import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';\nconst A = () => <b>{formatMoneyMinor(m, 'INR', lang)}</b>;"))
      .toEqual(['a.tsx:1 import', 'a.tsx:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { formatMoneyMinor as f } from 'x';\nconst s = i18n.formatMoneyMinor(m);")).toEqual(['a.ts:1 import', 'a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "// formatMoneyMinor(m)\nconst s = 'formatMoneyMinor(';\nconst t = moneyText(m, 'INR', lang);")).toEqual([]);
  });
  it('no formatMoneyMinor anywhere under app/, components/, features/ outside the helper (was 200 calls in 102 files at 2f55aa37)', () => {
    const scoped = SOURCES.filter((p) => ['app', 'components', 'features'].some((d) => p.startsWith(join(SRC, d) + '/')));
    expect(scoped.length).toBeGreaterThan(500);
    const hits = scoped.filter((p) => !MONEY_HELPERS.includes(relative(SRC, p)))
      .flatMap((p) => formatMoneyMinorUses(relative(SRC, p), readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('the helper files hold exactly one call each: moneyText (through moneyLang, isolated under rtl) and <Money>', () => {
    const money = readFileSync(join(SRC, 'features', 'rtl', 'money.ts'), 'utf8');
    expect(formatMoneyMinorUses('features/rtl/money.ts', money).filter((h) => h.endsWith('call'))).toHaveLength(1);
    expect(money).toContain('const text = formatMoneyMinor(minor, currency, moneyLang(lang));');
    expect(money).toContain('return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;');
    const bidi = readFileSync(join(SRC, 'components', 'Bidi.tsx'), 'utf8');
    expect(formatMoneyMinorUses('components/Bidi.tsx', bidi).filter((h) => h.endsWith('call'))).toHaveLength(1);
    expect(bidi).toContain("export { moneyLang, moneyText } from '../features/rtl/money';");
  });
  it('the swap happened: at least 200 moneyText( calls under app/ (the 200 formatMoneyMinor calls of 2f55aa37)', () => {
    const app = SOURCES.filter((p) => p.startsWith(join(SRC, 'app') + '/'));
    expect(app.flatMap((p) => moneyTextCalls(relative(SRC, p), readFileSync(p, 'utf8'))).length).toBeGreaterThanOrEqual(200);
  });
});
