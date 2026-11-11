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
