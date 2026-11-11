// apps/web-gov/src/test/gov2-sources.spec.ts · PC-56 GOV-2b — SOURCE ASSERTIONS (brief §C, survey E7):
//   • Q1-A: no money helper and no `amount` in ANY gov2 file (features/gov2, components/gov2, app/schemes) — code, comments stripped;
//   • Q5-A: no write from a gov2 page — the only SDK calls are `gov.schemes.{list,get,versions,diff}`; no Server Action, no 'use server', no
//     form, input or button in a gov2 component; no actions file under app/schemes;
//   • a draft's content is never read: the only `draft` a gov2 view touches is the read's `newerDraftExists` fact;
//   • the rules formatter converts nothing (no hectare, no conversion factor, no rounding);
//   • every gov2 page passes the gate; GOV_NAV gains /schemes; no image in a gov2 component.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(d.name) ? [path.relative(SRC, p)] : [];
  });
}
const GOV2_FILES = [...walk(path.join(SRC, 'features', 'gov2')), ...walk(path.join(SRC, 'components', 'gov2')), ...walk(path.join(SRC, 'app', 'schemes'))];
const PAGES = ['app/schemes/page.tsx', 'app/schemes/[id]/page.tsx'];

describe('PC-56 GOV-2b · Q1-A — no money in a gov2 file', () => {
  it('the gov2 files are the ones this wave built', () => {
    expect(GOV2_FILES.sort()).toEqual(['app/schemes/[id]/page.tsx', 'app/schemes/page.tsx', 'components/gov2/Gov2Chain.tsx', 'components/gov2/SchemesViews.tsx',
      'features/gov2/refusals.ts', 'features/gov2/rules-format.ts', 'features/gov2/schemes.ts']);
  });
  it('no formatMoneyMinor, no money module, no `amount`, no rupee sign in any gov2 file\'s code', () => {
    for (const rel of GOV2_FILES) expect([rel, /formatMoneyMinor|from '[^']*\/money'|amount|₹|minor_?units/i.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 GOV-2b · Q5-A — the authority reads; nothing here writes', () => {
  it('the pages call only gov.schemes.{list,get,versions,diff}; never applications, members, act or any write', () => {
    for (const rel of PAGES) {
      const src = code(read(rel));
      const calls = [...src.matchAll(/\.gov\.(\w+)\.(\w+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
      expect([rel, calls.every((c) => ['schemes.list', 'schemes.get', 'schemes.versions', 'schemes.diff'].includes(c))]).toEqual([rel, true]);
      expect([rel, calls.length > 0]).toEqual([rel, true]);
      expect([rel, /\.(act|request|approve|remove|create|update|publish|save|post|put|patch|delete)\(|\.request\(\s*'(POST|PUT|PATCH|DELETE)'|fetch\(/i.test(src)]).toEqual([rel, false]);
    }
  });
  it('no Server Action anywhere in the gov2 files; no actions file under app/schemes', () => {
    for (const rel of GOV2_FILES) expect([rel, /'use server'|"use server"|action=\{|formAction/.test(read(rel))]).toEqual([rel, false]);
    expect(GOV2_FILES.filter((r) => /actions\.ts$/.test(r))).toEqual([]);
  });
  it('no form, input, button, select or textarea in a gov2 component; no image', () => {
    for (const rel of GOV2_FILES.filter((r) => r.startsWith('components/gov2/'))) {
      expect([rel, /<form|<input|<button|<select|<textarea/.test(code(read(rel)))]).toEqual([rel, false]);
      expect([rel, /<img|<svg|<Image/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('a draft\'s content is never read: the only draft a gov2 view or page touches is the `newerDraftExists` fact', () => {
    for (const rel of [...PAGES, 'components/gov2/SchemesViews.tsx', 'features/gov2/schemes.ts']) {
      const hits = (code(read(rel)).match(/\.\s*draft\w*|\[\s*'draft\w*'\s*\]/gi) ?? []).filter((h) => !/newerDraftExists/.test(h));
      expect([rel, hits]).toEqual([rel, []]);
    }
  });
  it('the rules formatter converts and rounds nothing', () => {
    const src = code(read('features/gov2/rules-format.ts'));
    expect(src).not.toMatch(/hectare|0\.40\d|2\.47\d|\*\s*[0-9.]+|\/\s*[0-9.]+|toFixed|Math\.(round|floor|ceil)/i);
  });
});

describe('PC-56 GOV-2b · the gate and the nav', () => {
  it('every gov2 page passes the gate', () => {
    expect(code(read('app/schemes/page.tsx'))).toMatch(/await requireGov\('\/schemes'\)/);
    expect(code(read('app/schemes/[id]/page.tsx'))).toMatch(/await requireGov\(/);
  });
  it('GOV_NAV gains /schemes (and not /applications — GOV-2c); "Define a scheme" is not a nav link', () => {
    const shell = code(read('components/gov1/GovShell.tsx'));
    const nav = shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);'));
    expect([...nav.matchAll(/href: '([^']+)'/g)].map((m) => m[1])).toEqual(['/dashboard', '/schemes', '/access']);
    expect(nav).not.toMatch(/define/i);
  });
});
