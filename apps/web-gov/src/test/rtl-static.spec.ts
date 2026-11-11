import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
// apps/web-gov/src/test/rtl-static.spec.ts · PC-56 RTL-1f — the STATIC RTL backstop for the whole government console (web-tenant's RTL-1b /
// web-ops's RTL-1e rtl-static.spec, adapted). A render test sees only the pages it mounts; this reads EVERY non-test source with the
// TypeScript parser (comments and strings outside JSX are not counted — the refusal ledgers' "(→ W349)" canon notes are data, never rendered):
//   • 0 bare "→"/"←" in JSX (U+2192/U+2190 are NOT Bidi_Mirrored) — 0 at aead5db3 too ("count them": 0): pinned;
//   • no `.toLocaleString(` call anywhere — 0 at aead5db3: pinned;
//   • no `new Intl.*(…)` at all — 0 at aead5db3 (counts are `String(n)`, instants `atUtc`): pinned;
//   • NO money: no `formatMoneyMinor` import or call, no money helper, no "₹" in any source under app/, components/, features/, lib/ (the gov
//     realm reads no amount — 0 at aead5db3, the brief's "if there are truly none, pin 0 and skip the helper");
//   • the codes, masked phones and instants isolated by `ltrText` / `ltrOrNull` (features/rtl/span.ts), named site by site;
//   • globals.css stays logical-only, with the RTL-1f rules (banner, the draft tag) in place;
//   • the shell: the root layout hands the machine-draft banner to GovShell, which draws it after the skip link and above the shell; the
//     switcher offers the preview language with its draft tag.
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
/** Every use of the package's `formatMoneyMinor` — an import of that name (also aliased, from any module), a bare or a member call — as
 *  `file:line kind`. The gov console has no money helper, so there is no exempt binding. */
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
  it('formatMoneyMinor: the import and the call are found, aliased or as a member; comments and strings ignored', () => {
    expect(formatMoneyMinorUses('a.tsx', "import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';\nconst A = () => <b>{formatMoneyMinor(m, 'INR', lang)}</b>;"))
      .toEqual(['a.tsx:1 import', 'a.tsx:2 call']);
    expect(formatMoneyMinorUses('a.ts', "import { formatMoneyMinor as f } from 'x';\nconst s = i18n.formatMoneyMinor(m);")).toEqual(['a.ts:1 import', 'a.ts:2 call']);
    expect(formatMoneyMinorUses('a.ts', "// formatMoneyMinor(m)\nconst s = 'formatMoneyMinor(';")).toEqual([]);
  });
});

describe('web-gov: arrows, counts and digits (rtl-safe)', () => {
  it('0 bare "→"/"←" in JSX across every gov source (0 at aead5db3 — pinned)', () => {
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(SOURCES.flatMap((p) => bareJsxArrows(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no source calls toLocaleString( (0 at aead5db3 — pinned)', () => {
    expect(SOURCES.flatMap((p) => toLocaleStringCalls(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no `new Intl.*(…)` in any source (0 at aead5db3 — pinned)', () => {
    expect(SOURCES.flatMap((p) => newIntl(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
});

describe('no money anywhere in the gov console (RTL-1f: pin 0, no helper)', () => {
  const scoped = SOURCES.filter((p) => ['app', 'components', 'features', 'lib'].some((d) => p.startsWith(join(SRC, d) + '/')));
  const rel = (p: string) => relative(SRC, p);
  it('no import or call of formatMoneyMinor under app/, components/, features/ or lib/ (0 at aead5db3)', () => {
    expect(scoped.length).toBeGreaterThan(50);
    expect(scoped.flatMap((p) => formatMoneyMinorUses(rel(p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('no money helper exists and no source prints a rupee sign or imports a money module', () => {
    expect(existsSync(join(SRC, 'features', 'rtl', 'money.ts'))).toBe(false);
    const code = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(scoped.filter((p) => /₹|from '[^']*\/money'|formatNumber\(/.test(code(p))).map(rel)).toEqual([]);
  });
});

describe('codes, masked phones and instants inside Arabic text are isolated (ltrText / ltrOrNull)', () => {
  const SITES: Array<[string, string]> = [
    ['components/gov1/LoginViews.tsx', "t.t('gov1.login.codeSent', { phone: phoneMasked ? ltrText(phoneMasked, lang) : '' })"],
    ['components/gov1/LoginViews.tsx', '<CodeForm t={p.t} phoneMasked={p.phoneMasked} actions={p.actions} lang={p.lang} />'],
    ['components/gov1/DashboardViews.tsx', "t.t('gov1.dash.computedAt', { at: ltrOrNull(atUtc(o.computedAt), lang) ?? t.t('common.dash') })"],
    ['components/gov3/DbtViews.tsx', "t.t('gov1.dash.computedAt', { at: ltrOrNull(atUtc(o.computedAt), lang) ?? t.t('common.dash') })"],
    ['components/gov2/ApplicationsViews.tsx', '{`${s.name} (${ltrText(s.code, lang)})`}'],
    ['components/gov2/ApplicationsViews.tsx', '<td>{`${a.scheme.name} (${ltrText(a.scheme.code, lang)})`}</td>'],
    ['components/gov2/ApplicationsViews.tsx', '<td>{dash(t, ltrOrNull(atUtc(a.submittedAt), lang))}</td>'],
    ['components/gov2/ApplicationsViews.tsx', '<td>{dash(t, ltrOrNull(atUtc(a.decidedAt), lang))}</td>'],
    ['components/gov1/AccessViews.tsx', "ends: ltrOrNull(atUtc(me.person.accessEndsAt), lang) ?? t.t('common.dash')"],
    ['components/gov1/AccessViews.tsx', "t.t('gov1.access.removedOn', { at: ltrOrNull(atUtc(m.removedAt), lang) ?? '' })"],
    ['components/gov1/AccessViews.tsx', "return ltrOrNull(atUtc(m.expiresAt), lang) ?? t.t('common.dash');"],
    ['app/login/page.tsx', 'lang={getLang()}'],
    ['app/dashboard/page.tsx', 'overview={overview} lang={getLang()} />'],
    ['app/dbt/page.tsx', 'overview={overview} lang={getLang()} />'],
    ['app/applications/page.tsx', 'nextCursor={nextCursor} lang={getLang()} />'],
    ['app/access/page.tsx', 'rows={rows} lang={getLang()} />'],
  ];
  it.each(SITES)('%s: %s', (f, needle) => { expect(readFileSync(join(SRC, f), 'utf8')).toContain(needle); });
  it('the helper isolates only under a preview language', () => {
    const span = readFileSync(join(SRC, 'features', 'rtl', 'span.ts'), 'utf8');
    expect(span).toContain('return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(s) : s;');
    expect(span).toContain('return s === null ? null : ltrText(s, lang);');
  });
});

describe('the shell and the stylesheet', () => {
  it('globals.css is logical-only and carries the RTL-1f rules', () => {
    const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const PHYS = /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|(?:^|[\s;{])float\s*:\s*(?:left|right)/m;
    expect(css.split('\n').filter((l) => PHYS.test(l))).toEqual([]);
    expect(css).toContain('.kv-md-banner { margin-block-end: 12px;');
    expect(css).toContain('.kv-locale__draft {');
  });
  it('the root layout draws the banner for a preview language and hands it to GovShell, which draws it after the skip link, above the shell; the switcher offers the preview with its draft tag', () => {
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('const draftBanner = PREVIEW_LANGUAGES.includes(lang.code) ? (');
    expect(layout).toContain('banner={draftBanner}>{children}</GovShell>');
    const shell = readFileSync(join(SRC, 'components', 'gov1', 'GovShell.tsx'), 'utf8');
    expect(shell).toMatch(/<a href="#main" className="kv-skip">\{skipLabel\}<\/a>\s*\{banner \?\? null\}\s*<div className="kv-shell"/);
    const sw = readFileSync(join(SRC, 'components', 'LocaleSwitcher.tsx'), 'utf8');
    expect(sw).toContain('const PREVIEW = COMING_SOON_LANGUAGES.filter((l) => PREVIEW_LANGUAGES.includes(l.code));');
    expect(sw).toContain('<span className="kv-locale__draft">({draftLabel})</span>');
    expect(readFileSync(join(SRC, 'components', 'Sidebar.tsx'), 'utf8')).toContain("draftLabel={t.t('lang.draft')}");
  });
});
