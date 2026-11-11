import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { resolveLanguage } from '@krishalaya/i18n';
import { rangeArrow } from '../features/rtl/arrow';
// apps/web-admin/src/test/rtl-static.spec.ts · PC-56 RTL-1g — the STATIC RTL backstop for the god-mode console (the RTL-1b…1f
// rtl-static specs, adapted to an ENGLISH-ONLY realm: 07_RTL Q3, lead's call — web-admin gets no `ar` catalogue and no switcher; it is
// made RTL-SAFE, not translated). It reads EVERY non-test source with the TypeScript parser (comments are not counted):
//   • 0 "→"/"←" glyphs in any string or JSX text outside features/rtl/arrow.ts — STRICTER than the other apps' "in JSX" rule, because
//     one of the 15 sites at 93aa6915 was a DataTable cell function (schemes-registry/calendar), which a JSX-only scan does not see;
//     the 15 sites now take the arrow from `rangeArrow(getAdminDir())`, pinned file by file;
//   • globals.css stays logical-only: no physical left/right property and no asymmetric four-value margin/padding shorthand
//     (`.kv-timeline__item` was the last one: border-left + "0.35rem 0 0.75rem 0.85rem" at 93aa6915);
//   • English-only is PINNED: one catalogue (en.ts), one registration, no `ar.ts`, no switcher, no /api/lang route, no language cookie.
const SRC = join(__dirname, '..');
const isTest = (p: string) => /\/(test|test-render)\//.test(p) || /\.(spec|test)\.tsx?$/.test(p);
const isCatalogue = (p: string) => /\/i18n\/[a-z]{2}\.ts$/.test(p);
function walk(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p, out); } else out.push(p);
  }
  return out;
}
const ALL = walk(SRC);
const SOURCES = ALL.filter((p) => /\.tsx?$/.test(p) && !isTest(p) && !isCatalogue(p));
const ARROW_HOME = join(SRC, 'features', 'rtl', 'arrow.ts');
const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const ARROW = /[→←]/;

/** Every JSX text or string/template piece (anywhere — in JSX, a cell function or a constant) carrying a horizontal arrow, as
 *  `file:line text`. Comments are trivia to the parser and never seen. */
export function arrowGlyphs(file: string, text: string): string[] {
  const sf = parse(file, text);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && ARROW.test(n.getText())) hits.push(`${file}:${lineOf(sf, n)} ${n.getText().trim().slice(0, 60)}`);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && ARROW.test(n.text)) {
      hits.push(`${file}:${lineOf(sf, n)} ${n.text.slice(0, 60)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}
const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const PHYS = /(?:^|[\s;{])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|(?:^|[\s;{])float\s*:\s*(?:left|right)|(?:^|[\s;{])clear\s*:\s*(?:left|right)/m;
/** Every margin/padding shorthand with four values whose right (2nd) and left (4th) differ — a physical asymmetry in disguise. */
export function asymmetricShorthands(css: string): string[] {
  const hits: string[] = [];
  for (const m of stripCssComments(css).matchAll(/(?:^|[\s;{])((?:margin|padding)\s*:\s*([^;}]+))/g)) {
    const parts = m[2].trim().replace(/\s*!important$/, '').split(/\s+(?![^(]*\))/);
    if (parts.length === 4 && parts[1] !== parts[3]) hits.push(m[1].trim());
  }
  return hits;
}
const physicalLines = (css: string) => stripCssComments(css).split('\n').filter((l) => PHYS.test(l));

describe('the scanners themselves (so a pass below means something)', () => {
  it('arrows: JSX text, JSX expressions, template strings and cell functions found; comments ignored', () => {
    expect(arrowGlyphs('a.tsx', 'const A = () => <a>← Back</a>;')).toHaveLength(1);
    expect(arrowGlyphs('a.tsx', "const A = () => <p>{x}{' → '}{y}</p>;")).toHaveLength(1);
    expect(arrowGlyphs('a.tsx', 'const A = () => <p>{`${a} → ${b}`}</p>;')).toHaveLength(1);
    expect(arrowGlyphs('a.tsx', 'const cols = [{ cell: (r) => (r.w ? `${r.w.opens} → ${r.w.closes}` : d) }];')).toHaveLength(1);
    expect(arrowGlyphs('a.tsx', '// a → b\n/* c ← d */\nconst A = () => <p>{x}{` ${arrow} `}{y}</p>;')).toEqual([]);
  });
  it('css: physical properties and asymmetric four-value shorthands found; logical ones and comments ignored', () => {
    expect(physicalLines('.a {\n  border-left: 3px solid red;\n}')).toHaveLength(1);
    expect(physicalLines('.a { padding-right: 1px; }\n.b { text-align: left; }\n.c { left: 0; }')).toHaveLength(3);
    expect(physicalLines('/* border-left: 1px */\n.a { border-inline-start: 3px solid red; padding-inline-start: 1rem; text-align: start; }')).toEqual([]);
    expect(asymmetricShorthands('.a { padding: 0.35rem 0 0.75rem 0.85rem; }')).toEqual(['padding: 0.35rem 0 0.75rem 0.85rem']);
    expect(asymmetricShorthands('.a { margin: 0 4px 0 4px; padding: 1px 2px; margin: 0 0 0.35rem; }\n/* padding: 1px 2px 3px 4px */')).toEqual([]);
  });
});

describe('the direction-aware arrow (features/rtl/arrow.ts)', () => {
  it('points from the first value to the second: "→" in ltr, "←" in rtl', () => {
    expect(rangeArrow('ltr')).toBe('→');
    expect(rangeArrow('rtl')).toBe('←');
  });
  it("the admin direction is the en LanguageDef's ('ltr'), read the same way the root layout reads <html dir>", () => {
    expect(resolveLanguage('en').dir).toBe('ltr');
    const lib = readFileSync(join(SRC, 'lib', 'i18n.ts'), 'utf8');
    expect(lib).toContain('export function getAdminDir(): LanguageDir {\n  return resolveLanguage(ADMIN_LANG).dir;\n}');
    expect(readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')).toContain('const lang = resolveLanguage(ADMIN_LANG);');
    // so every page's arrow under the only language this realm serves is the "→" it printed at 93aa6915 (en byte-identical)
    expect(rangeArrow(resolveLanguage('en').dir)).toBe('→');
  });
});

describe('web-admin: arrows (rtl-safe)', () => {
  it('0 "→"/"←" glyphs in any non-comment string or JSX text outside features/rtl/arrow.ts (15 sites at 93aa6915)', () => {
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES.filter((p) => p !== ARROW_HOME).flatMap((p) => arrowGlyphs(relative(SRC, p), readFileSync(p, 'utf8')))).toEqual([]);
  });
  it('the glyph lives once, in features/rtl/arrow.ts', () => {
    expect(arrowGlyphs('features/rtl/arrow.ts', readFileSync(ARROW_HOME, 'utf8'))).toHaveLength(4);
  });
  // The 15 converted sites (14 files), each taking the page direction's arrow.
  const SITES: Array<[string, string]> = [
    ['app/ai-models/[id]/rollout/page.tsx', '{` ${arrow} `}{a.proposedStatus}'],
    ['app/ai-models/overview/page.tsx', '{` ${arrow} `}{a.proposedStatus}'],
    ['app/catalogue/translations/queue/page.tsx', '{r.sourceText ?? r.field}{` ${arrow} `}{r.text.slice(0, 40)}'],
    ['app/cells/changes/page.tsx', '<code>{diffText(d.from)}</code>{` ${arrow} `}<code>{diffText(d.to)}</code>'],
    ['app/cells/migrations/[id]/page.tsx', "`${j.windowStart.slice(0, 16).replace('T', ' ')} ${arrow} ${(j.windowEnd ?? '').slice(11, 16)}`"],
    ['app/cells/residency/attestation/page.tsx', '{a.windowFrom.slice(0, 10)}{` ${arrow} `}{a.windowTo.slice(0, 10)}'],
    ['app/cells/residency/log/page.tsx', "<td>{r.fromCountry ?? '—'}{` ${arrow} `}{r.toCountry ?? '—'}</td>"],
    ['app/plans/[id]/page.tsx', "{l.from ?? t.t('plans.diffAbsent')}{` ${arrow} `}{l.to ?? t.t('plans.diffAbsent')}"],
    ['app/recon/runs/[id]/page.tsx', "{(run.periodStart ?? t.t('common.dash'))}{` ${arrow} `}{(run.periodEnd ?? t.t('common.dash'))}"],
    ['app/recon/settlements/page.tsx', '{meta.run.periodStart}{` ${arrow} `}{meta.run.periodEnd} ·'],
    ['app/schemes-registry/calendar/page.tsx', '`${r.applicationWindow.opens} ${arrow} ${r.applicationWindow.closes}`'],
    ['app/schemes-registry/schemes/[id]/page.tsx', '`${win.opens} ${arrow} ${win.closes}'],
    ['app/settings/[key]/page.tsx', '{show(h.oldValue)}{` ${arrow} `}{show(h.newValue)}'],
    ['app/tenants/[id]/subscription/page.tsx', "t.t('common.dash')}{` ${arrow} `}{sub.periodEnd ? formatDate(sub.periodEnd)"],
    ['app/tenants/[id]/subscription/page.tsx', '{a.endsOn ? ` ${arrow} ${formatDate(a.endsOn)}` : \'\'}'],
  ];
  it.each(SITES)('%s: %s', (f, needle) => {
    const src = readFileSync(join(SRC, f), 'utf8');
    expect(src).toContain(needle);
    expect(src).toContain('const arrow = rangeArrow(getAdminDir());');
  });
});

describe('the stylesheet is logical-only', () => {
  const css = readFileSync(join(SRC, 'styles', 'globals.css'), 'utf8');
  it('no physical left/right property (border-left, padding-left, text-align: left, left:, float, clear)', () => {
    expect(physicalLines(css)).toEqual([]);
  });
  it('no asymmetric four-value margin/padding shorthand', () => {
    expect(asymmetricShorthands(css)).toEqual([]);
  });
  it('the timeline rule sits on the inline-start side, same values as before', () => {
    const rule = stripCssComments(css).match(/\.kv-timeline__item \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('border-inline-start: 3px solid var(--kv-border, #d8ddd6);');
    expect(rule![1]).toContain('padding: 0.35rem 0 0.75rem;');
    expect(rule![1]).toContain('padding-inline-start: 0.85rem;');
  });
});

describe('English-only by design (07_RTL Q3) — pinned', () => {
  it('one catalogue: i18n/ holds en.ts only (no ar.ts, no hi/gu)', () => {
    expect(readdirSync(join(SRC, 'i18n')).sort()).toEqual(['en.ts']);
    expect(existsSync(join(SRC, 'i18n', 'ar.ts'))).toBe(false);
  });
  it('one registration: the Translator is bound to en and registers en only', () => {
    const lib = readFileSync(join(SRC, 'lib', 'i18n.ts'), 'utf8');
    expect(lib).toContain("export const ADMIN_LANG = 'en';");
    expect(lib.match(/\.register\(/g)).toHaveLength(1);
    expect(lib).toContain("return new Translator(ADMIN_LANG).register('en', en);");
  });
  it('no switcher, no language route, no language cookie, no preview plumbing anywhere', () => {
    expect(ALL.filter((p) => /LocaleSwitcher|LanguageSwitcher|LangSwitch/i.test(p)).map((p) => relative(SRC, p))).toEqual([]);
    expect(existsSync(join(SRC, 'app', 'api', 'lang'))).toBe(false);
    expect(existsSync(join(SRC, 'app', 'language'))).toBe(false);
    const code = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(SOURCES.filter((p) => /['"`]kv[a-z]*_lang['"`]|\bLANG_COOKIE\b|resolveServable|PREVIEW_LANGUAGES|COMING_SOON_LANGUAGES|LIVE_LANGUAGES|\.register\('(?!en')/.test(code(p))).map((p) => relative(SRC, p))).toEqual([]);
  });
});
