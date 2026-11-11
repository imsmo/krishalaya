// apps/web-gov/src/test/gov5-sources.spec.ts · PC-56 GOV-5a — SOURCE ASSERTIONS (brief §E, survey E1–E3):
//   • E1: ONE route — app/mgnrega holds page.tsx only (no /mgnrega/dashboard, /job-cards, /demand, /musters, /musters/[id], /wages, /audit,
//     no MGNREGA route of any other shape anywhere under app/);
//   • E2: /mgnrega reads NOTHING — no SDK call at all (the gate is the shell's gov.me()), never a labour / MGNREGA SDK method; no Server
//     Action, no form, input, button, select, textarea, table or image;
//   • no money helper, no `amount`, no rupee sign, no minor units; no job-card, worker, household, attendance, worksite, wage or demand field
//     read in the view or the page;
//   • E3: web-gov's residue features/mgnrega/program.ts and its spec are deleted; nothing names them or their builders;
//   • the gate; GOV_NAV carries /mgnrega; the GOV-1a 307 for /mgnrega is gone.
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
const GOV5_FILES = [...walk(path.join(SRC, 'features', 'gov5')), ...walk(path.join(SRC, 'components', 'gov5')), ...walk(path.join(SRC, 'app', 'mgnrega'))];
const VIEW_AND_PAGE = ['components/gov5/MgnregaViews.tsx', 'app/mgnrega/page.tsx'];
/** The SDK's MGNREGA methods (packages/sdk-js/src/resources/labour.ts) and the labour resource itself. */
const MGNREGA_SDK = /\.labour\.|registerJobCard|myJobCards|\.jobCards\(|MgnregaWork|mgnregaWorks|recordMgnrega|mgnregaDemands|transitionMgnrega|mgnregaSummary|exportMgnrega|mgnregaCardLedger|labour\/mgnrega/;

describe('PC-56 GOV-5a · E1 — one route', () => {
  it('the gov5 files are the ones GOV-5a built; app/mgnrega holds page.tsx only', () => {
    expect([...GOV5_FILES].sort()).toEqual(['app/mgnrega/page.tsx', 'components/gov5/MgnregaViews.tsx', 'features/gov5/refusals.ts']);
    expect(walk(path.join(SRC, 'app', 'mgnrega'))).toEqual(['app/mgnrega/page.tsx']);
  });
  it('the canon\'s other addresses have no route: /mgnrega/dashboard, /job-cards, /demand, /musters, /musters/[id], /wages, /audit — and no route anywhere is named for them', () => {
    for (const rel of ['dashboard', 'job-cards', 'demand', 'demands', 'musters', 'musters/[id]', 'works', 'works/[id]', 'wages', 'audit'])
      expect([rel, fs.existsSync(path.join(SRC, 'app', 'mgnrega', rel))]).toEqual([rel, false]);
    for (const rel of walk(path.join(SRC, 'app'))) {
      if (rel === 'app/mgnrega/page.tsx') continue;
      expect([rel, /mgnrega|job-?cards?|muster|demand|wage|works?\/|social-?audit|panchayat|ranking|leaderboard/i.test(rel)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 GOV-5a · E2 — /mgnrega reads nothing and writes nothing', () => {
  it('no SDK call in any gov5 file: no govClient, no .gov., no fetch or raw request; never a labour / MGNREGA method', () => {
    for (const rel of GOV5_FILES) {
      const c = code(read(rel));
      expect([rel, /govClient|tenantClient|\.gov\.|fetch\(|\.request\(|api-client/.test(c)]).toEqual([rel, false]);
      expect([rel, MGNREGA_SDK.test(c)]).toEqual([rel, false]);
    }
    expect(code(read('app/mgnrega/page.tsx'))).toMatch(/await requireGov\('\/mgnrega'\)/);
  });
  it('no Server Action, no form, input, button, select or textarea, no image, no table, in any gov5 file', () => {
    for (const rel of GOV5_FILES) {
      expect([rel, /'use server'|"use server"|action=\{|formAction|<form|<input|<button|<select|<textarea/.test(code(read(rel)))]).toEqual([rel, false]);
      expect([rel, /<img|<svg|<Image|<video|<table|<tr\b|<td\b|<ol\b|<iframe/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('no money helper, no `amount`, no rupee sign, no minor units in any gov5 file; no MGNREGA field read in the view or the page', () => {
    for (const rel of GOV5_FILES) expect([rel, /formatMoneyMinor|parseMajorToMinor|from '[^']*\/money'|amount|₹|minor_?units|Minor\b|wageMinor|sanctioned/i.test(code(read(rel)))]).toEqual([rel, false]);
    for (const rel of VIEW_AND_PAGE)
      expect([rel, /\.(jobCard\w*|cardNo|job_card_no|daysUsed\w*|days_used_fy|worker\w*|household\w*|attendance|attended|dayFraction|muster\w*|worksite|siteNote|site_note|workCode|demand\w*|dueBy|wage\w*|rank\w*|leaderboard|panchayat\w*|userId)\b/i.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the view takes only `t` and `me` (and the chain its id and state): no prop could carry a card, a worker, a day or a wage', () => {
    const v = code(read('components/gov5/MgnregaViews.tsx'));
    expect(v).toMatch(/export function MgnregaView\(\{ t, me \}: \{ t: Tr; me: GovMe \| null \}\)/);
    expect(v).toMatch(/export function Gov5Chain\(\{ t, chain, state \}: \{ t: Tr; chain: Chain5Id; state: string \}\)/);
    expect([...v.matchAll(/\bme\.(\w+)/g)].map((m) => m[1])).toEqual(['authority']);
    expect([...v.matchAll(/\.map\(/g)].length).toBe(3);   // the statements, the "does not do" items, the refusals — all from the registry
  });
  it('the chains are answered before nothing else is read: the page renders a chain or the view, and makes no other call', () => {
    const p = code(read('app/mgnrega/page.tsx'));
    expect([...p.matchAll(/await (\w+)\(/g)].map((m) => m[1])).toEqual(['requireGov']);
  });
});

describe('PC-56 GOV-5a · E3 — web-gov\'s MGNREGA residue is gone', () => {
  it('features/mgnrega/program.ts and test/mgnrega.spec.ts are deleted; no source names them or their builders', () => {
    expect(fs.existsSync(path.join(SRC, 'features', 'mgnrega'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'test', 'mgnrega.spec.ts'))).toBe(false);
    const all = [...walk(path.join(SRC, 'features')), ...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'lib')), ...walk(path.join(SRC, 'test')), ...walk(path.join(SRC, 'test-render'))].filter((r) => r !== 'test/gov5-sources.spec.ts');   // (this spec names them to look for them)
    for (const rel of all) expect([rel, /features\/mgnrega|buildDemand|buildDemandTransition|demandUrgency|ledgerClaim|capView|isDemandStatus/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('GOV_NAV carries /mgnrega ("MGNREGA"); the GOV-1a 307 for /mgnrega is gone', () => {
    const shell = code(read('components/gov1/GovShell.tsx'));
    expect(shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);'))).toMatch(/\{ href: '\/mgnrega', labelKey: 'gov5\.nav\.mgnrega' \}/);
    const cfg = code(fs.readFileSync(path.join(SRC, '..', 'next.config.js'), 'utf8'));
    expect(cfg).not.toMatch(/mgnrega/);
  });
});
