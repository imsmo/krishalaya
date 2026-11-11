// apps/web-gov/src/test/gov3-sources.spec.ts · PC-56 GOV-3a — SOURCE ASSERTIONS (brief §E, survey E1–E3):
//   • E1: ONE route — app/dbt holds page.tsx only (no /dbt/triggers, /dbt/batches/[id], /dbt/recon, /dbt/bounces, /dbt/insights);
//   • E2: /dbt reads ONLY gov.overview(); no Server Action, no 'use server', no form, input, button, select or textarea in a gov3 file;
//   • E3: no formatMoneyMinor, no money module, no `amount`, no rupee sign in any gov3 file; the dead DBT helpers and features/money.ts are gone;
//   • the view prints only the `approved` and `disbursed` counts of the read (no other status, no computed figure); the gate; GOV_NAV /dbt.
//   • GOV-3b: `/dbt/recon`, `/dbt/recon/[id]`, `/dbt/bounces` have no route; the sections take no data; no bank / PFMS / farmer identifier is
//     read or named in a view or the page; the 3b chains open only by `?do=` (no form, no button — the E2 assertions above cover them).
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [path.relative(SRC, p)];
  });
}
const GOV3_FILES = [...walk(path.join(SRC, 'features', 'gov3')), ...walk(path.join(SRC, 'components', 'gov3')), ...walk(path.join(SRC, 'app', 'dbt'))];

describe('PC-56 GOV-3a · E1 — one route', () => {
  it('the gov3 files are the ones this wave built; app/dbt holds page.tsx only', () => {
    expect([...GOV3_FILES].sort()).toEqual(['app/dbt/page.tsx', 'components/gov3/DbtViews.tsx', 'features/gov3/refusals.ts']);
    expect(walk(path.join(SRC, 'app', 'dbt'))).toEqual(['app/dbt/page.tsx']);
  });
  it('GOV-3b · W341, W342, W343 have no address of their own: /dbt/recon, /dbt/recon/[id], /dbt/bounces do not exist (not found)', () => {
    for (const rel of ['app/dbt/recon', 'app/dbt/recon/[id]', 'app/dbt/bounces', 'app/dbt/recon/page.tsx', 'app/dbt/bounces/page.tsx'])
      expect([rel, fs.existsSync(path.join(SRC, rel))]).toEqual([rel, false]);
    const app = walk(path.join(SRC, 'app'));
    expect(app.filter((r) => /recon|bounce|pfms|return/i.test(r))).toEqual([]);
  });
});

describe('PC-56 GOV-3b · Q3-A — no bank, PFMS or farmer identifier in the page or the view', () => {
  it('neither the page nor the view reads or names an account, IFSC, bank or PFMS reference, or a farmer\'s name or village', () => {
    for (const rel of ['app/dbt/page.tsx', 'components/gov3/DbtViews.tsx'])
      expect([rel, /account|ifsc|bankRef|bank_ref|pfmsRef|pfms_ref|utr\b|farmerName|village|userId|user_id|••/i.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the sections take no data: Gov3Sections\' only prop is the translator', () => {
    const v = code(read('components/gov3/DbtViews.tsx'));
    expect(v).toMatch(/export function Gov3Sections\(\{ t \}: \{ t: Tr \}\)/);
    expect(v).toMatch(/<Gov3Sections t=\{t\} \/>/);
  });
});

describe('PC-56 GOV-3a · E3 / Q1-A — no money in a gov3 file', () => {
  it('no formatMoneyMinor, no money module, no `amount`, no rupee sign, no minor units in any gov3 file (code and strings)', () => {
    for (const rel of GOV3_FILES) expect([rel, /formatMoneyMinor|parseMajorToMinor|from '[^']*\/money'|amount|₹|minor_?units|Minor\b/i.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the dead DBT helpers are gone: features/money.ts deleted; no source names canRecordDbt or buildDbt', () => {
    expect(fs.existsSync(path.join(SRC, 'features', 'money.ts'))).toBe(false);
    const all = [...walk(path.join(SRC, 'features')), ...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'lib'))];
    for (const rel of all) expect([rel, /canRecordDbt|buildDbt/.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 GOV-3a · E2 — /dbt reads only the overview; nothing here writes', () => {
  it('the page calls gov.overview() and nothing else; no fetch, no raw request, no tenant client', () => {
    const src = code(read('app/dbt/page.tsx'));
    expect([...src.matchAll(/\.gov\.(\w+)\(/g)].map((m) => m[1])).toEqual(['overview']);
    expect([...src.matchAll(/\.gov\.(\w+)\.(\w+)\(/g)]).toEqual([]);
    for (const rel of GOV3_FILES) expect([rel, /fetch\(|\.request\(|tenantClient|\.schemes\./.test(code(read(rel)))]).toEqual([rel, false]);
    expect(GOV3_FILES.filter((r) => r !== 'app/dbt/page.tsx').some((r) => /govClient|\.gov\./.test(code(read(r))))).toBe(false);
  });
  it('no Server Action, no form, input, button, select or textarea, no image, in any gov3 file', () => {
    for (const rel of GOV3_FILES) {
      expect([rel, /'use server'|"use server"|action=\{|formAction|<form|<input|<button|<select|<textarea/.test(code(read(rel)))]).toEqual([rel, false]);
      expect([rel, /<img|<svg|<Image/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('the view prints only the read\'s `approved` and `disbursed` counts, as given — never another status, never a computed figure', () => {
    const v = code(read('components/gov3/DbtViews.tsx'));
    expect([...new Set([...v.matchAll(/byStatus\.(\w+)/g)].map((m) => m[1]))].sort()).toEqual(['approved', 'disbursed']);
    expect(v).not.toMatch(/\.reduce\(|Math\.|toFixed|\s[+\-*/]\s*\d|\)\s*[+*/]\s*\(/);
    expect(v).toMatch(/DISBURSED_KEY/); expect(v).not.toMatch(/'gov2\.status\./);
  });
  it('the page passes the gate; GOV_NAV carries /dbt', () => {
    expect(code(read('app/dbt/page.tsx'))).toMatch(/await requireGov\('\/dbt'\)/);
    const shell = code(read('components/gov1/GovShell.tsx'));
    expect(shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);'))).toMatch(/\{ href: '\/dbt', labelKey: 'gov3\.nav\.dbt' \}/);
  });
});
