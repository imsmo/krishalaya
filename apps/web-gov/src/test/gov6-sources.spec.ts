// apps/web-gov/src/test/gov6-sources.spec.ts · PC-56 GOV-6a — SOURCE ASSERTIONS (brief §E, survey E1, E2, E4):
//   • E1: NO new route — no app/analytics, app/reports (nor any route named for analytics, reports, insight, audit or a regulator); GOV_NAV
//     unchanged; W333 and W357 are sections of /dashboard;
//   • E2: no new SDK call — no gov6 file calls the SDK at all; /dashboard's reads are unchanged (requireGov + ONE govClient().gov.overview()),
//     and the gov6 chains are answered BEFORE that read;
//   • E4: no arithmetic on overview numbers — the sections are given only the translator (never the overview), name no count field, and hold
//     no division, sum, rounding or percentage; no money helper, no rupee sign;
//   • no Server Action, form, input, button, table or image in a gov6 file; no write, schedule, publish or export act.
// PC-56 GOV-6b (named update + additions): the gov6 files grow by ONE view (components/gov6/AccessSections.tsx); /audit, /regulator/* and
// /registers have no route and no redirect; /access's reads are unchanged (requireGov + ONE govClient().gov.members.list()) and the 6b
// chains are answered before that read; the /access sections are given only `t`; NO audit read anywhere in web-gov (no audit route, SDK
// audit resource, `audit_read_log`, `scheme_application_events`); no regulator, partner or outside-body client.
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
const GOV6_FILES = [...walk(path.join(SRC, 'features', 'gov6')), ...walk(path.join(SRC, 'components', 'gov6'))];
const VIEW = 'components/gov6/DashboardSections.tsx';

describe('PC-56 GOV-6a · E1 — no new route', () => {
  it('the gov6 files are the ones GOV-6a built (a registry and a view; no app/ directory of its own)', () => {
    // NAMED UPDATE, GOV-6b: + the /access sections' view
    expect([...GOV6_FILES].sort()).toEqual(['components/gov6/AccessSections.tsx', 'components/gov6/DashboardSections.tsx', 'features/gov6/refusals.ts']);
  });
  it('the canon addresses have no route: /analytics, /reports (and /audit, /regulator/*, /insight) — and no route anywhere is named for them', () => {
    for (const rel of ['analytics', 'reports', 'report', 'insight', 'insights', 'audit', 'regulator', 'registers', 'access/audit', 'access/record', 'access/outside', 'transparency', 'data-room', 'exports', 'regulator/home', 'regulator/lending', 'regulator/insurance', 'regulator/exports', 'dashboard/analytics', 'dashboard/reports'])
      expect([rel, fs.existsSync(path.join(SRC, 'app', rel))]).toEqual([rel, false]);
    for (const rel of walk(path.join(SRC, 'app'))) expect([rel, /analytic|reports?\b|insight|audit|regulat|funnel|publish|schedul|export/i.test(rel)]).toEqual([rel, false]);
    expect(walk(path.join(SRC, 'app', 'dashboard'))).toEqual(['app/dashboard/page.tsx']);
  });
  it('GOV_NAV is unchanged (no analytics or reports entry); no link anywhere to /analytics or /reports', () => {
    const shell = code(read('components/gov1/GovShell.tsx'));
    expect([...shell.slice(shell.indexOf('GOV_NAV'), shell.indexOf(']);')).matchAll(/href: '([^']+)'/g)].map((m) => m[1]))
      .toEqual(['/dashboard', '/schemes', '/applications', '/dbt', '/verification', '/mgnrega', '/access']);
    for (const rel of [...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'features'))])
      expect([rel, /href[=:]\s*["'{`]*\/(analytics|reports?|insight)\b/.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 GOV-6a · E2 — no new SDK call; /dashboard\'s reads unchanged', () => {
  it('no SDK call in any gov6 file: no govClient, no .gov., no fetch or raw request; never an admin-api path or the audit route', () => {
    for (const rel of GOV6_FILES) {
      const c = code(read(rel));
      expect([rel, /govClient|tenantClient|anonClient|\.gov\.|fetch\(|\.request\(|api-client|@krishalaya\/sdk-js/.test(c)]).toEqual([rel, false]);
      expect([rel, /audit\/entries|admin-api|\/v1\/(reports|audit|insights|admin)/.test(c)]).toEqual([rel, false]);
    }
  });
  it('/dashboard awaits requireGov and ONE govClient().gov.overview() — nothing else; the gov6 chains return before that read', () => {
    const p = code(read('app/dashboard/page.tsx'));
    expect([...p.matchAll(/await ([\w.]+(?:\(\)[\w.]+)*)\(/g)].map((m) => m[1])).toEqual(['requireGov', 'govClient().gov.overview']);
    expect((p.match(/govClient\(/g) ?? []).length).toBe(1);
    expect(p.indexOf('chain6For(searchParams)')).toBeGreaterThan(-1);
    expect(p.indexOf('return <Gov6Chain')).toBeLessThan(p.indexOf('govClient()'));
    expect(p).not.toMatch(/\.(post|patch|put|delete)\(|schedule|publish|export\w*\(/i);
  });
});

describe('PC-56 GOV-6a · E4 — no arithmetic on overview numbers; no money', () => {
  it('the sections take only `t` (never the overview), and DashboardViews hands them nothing else', () => {
    const v = code(read(VIEW));
    expect(v).toMatch(/export function Gov6DashboardSections\(\{ t \}: \{ t: Tr \}\)/);
    expect(v).toMatch(/export function Gov6Chain\(\{ t, chain, state \}: \{ t: Tr; chain: Chain6Id; state: string \}\)/);
    const dv = code(read('components/gov1/DashboardViews.tsx'));
    expect((dv.match(/<Gov6DashboardSections\b[^>]*\/>/g) ?? [])).toEqual(['<Gov6DashboardSections t={t} />']);
  });
  it('no gov6 file names an overview field or a count, and holds no division, sum, rounding or percentage', () => {
    for (const rel of GOV6_FILES) {
      const c = code(read(rel));
      const bare = c.replace(/<\/?[a-z][^>]*>/g, '').replace(/'(?:[^'\\\n]|\\.)*'|`[^`]*`|"[^"\n]*"/g, "''");   // (the registry's canon quotes may NAME the overview; code may not touch it)
      expect([rel, /overview|GovOverview|byStatus|byScheme|totals|queues|oldestDays|computedAt|\.count\b|\.total\b/.test(bare)]).toEqual([rel, false]);
      expect([rel, /[^/*]\/\s*[A-Za-z0-9_(.]|\*\s*100|\.reduce\(|toFixed|Math\.|percent|\+\s*\d|\d\s*\+|\+=|Number\(|parseInt|parseFloat/i.test(bare)]).toEqual([rel, false]);
    }
  });
  it('no money helper, no `amount`, no rupee sign, no minor units in any gov6 file', () => {
    for (const rel of GOV6_FILES) expect([rel, /formatMoneyMinor|parseMajorToMinor|from '[^']*\/money'|amount|₹|minor_?units|Minor\b/i.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('no Server Action, form, input, button, select, textarea, table or image in any gov6 file; no write, schedule, publish or export act', () => {
    for (const rel of GOV6_FILES) {
      const c = code(read(rel));
      expect([rel, /'use server'|"use server"|action=\{|formAction|<form|<input|<button|<select|<textarea/.test(c)]).toEqual([rel, false]);
      expect([rel, /<img|<svg|<Image|<video|<table|<tr\b|<td\b|<iframe|download=/.test(c)]).toEqual([rel, false]);
      if (rel !== 'features/gov6/refusals.ts') expect([rel, /schedul\w*\(|publish\w*\(|export\w*\(|\.post\(|\.patch\(|\.put\(|method:\s*'(POST|PATCH|PUT|DELETE)'/i.test(c.replace(/export (function|const|type|interface) /g, ''))]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 GOV-6b · E1 / E2 — /access: no new route, no new read, no audit read', () => {
  it('/audit, /regulator/* and /registers answer not found: no route, no redirect; no link to them anywhere', () => {
    const cfg = code(fs.readFileSync(path.join(SRC, '..', 'next.config.js'), 'utf8'));
    expect(cfg).not.toMatch(/registers|regulator|audit|redirects\(/);
    for (const rel of [...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'features'))])
      expect([rel, /href[=:]\s*["'{`]*\/(audit|regulator|registers|transparency)\b/.test(code(read(rel)))]).toEqual([rel, false]);
    expect(walk(path.join(SRC, 'app', 'access'))).toEqual(['app/access/actions.ts', 'app/access/page.tsx']);
  });
  it('/access awaits requireGov and ONE govClient().gov.members.list() — unchanged; the gov6 chains are answered (with the gov4 ones) before that read', () => {
    const p = code(read('app/access/page.tsx'));
    expect([...p.matchAll(/await ([\w.]+(?:\(\)[\w.]+)*)\(/g)].map((m) => m[1])).toEqual(['requireGov', 'govClient().gov.members.list']);
    expect((p.match(/govClient\(/g) ?? []).length).toBe(1);
    expect(p).toMatch(/chain6For\(searchParams, 'access'\)/);
    expect(p.indexOf('return <Gov6Chain')).toBeGreaterThan(-1);
    expect(p.indexOf('return <Gov6Chain')).toBeLessThan(p.indexOf('govClient()'));
    expect(p.indexOf('return <Gov4Chain')).toBeLessThan(p.indexOf('return <Gov6Chain'));
  });
  it('the /access sections take only `t`, and AccessView hands them nothing else', () => {
    expect(code(read('components/gov6/AccessSections.tsx'))).toMatch(/export function Gov6AccessSections\(\{ t \}: \{ t: Tr \}\)/);
    expect((code(read('components/gov1/AccessViews.tsx')).match(/<Gov6AccessSections\b[^>]*\/>/g) ?? [])).toEqual(['<Gov6AccessSections t={t} />']);
  });
  it('NO audit read anywhere in web-gov: no audit route, SDK audit resource, record table, or outside-body client', () => {
    const all = [...walk(path.join(SRC, 'features')), ...walk(path.join(SRC, 'components')), ...walk(path.join(SRC, 'app')), ...walk(path.join(SRC, 'lib'))];
    for (const rel of all) {
      // (the PURE refusal registries — features/*/refusals.ts — may NAME a table in their `why` strings; their code may not touch one)
      const c = /^features\/[a-z0-9]+\/refusals\.ts$/.test(rel) ? code(read(rel)).replace(/'(?:[^'\\\n]|\\.)*'|`[^`]*`|"[^"\n]*"/g, "''") : code(read(rel));
      expect([rel, /audit\/entries|\/v1\/audit|\.audit\.|auditEntries|auditor\.|audit_read_log|audit_log|scheme_application_events|readLog|recordedReads/.test(c)]).toEqual([rel, false]);
      expect([rel, /partnerClient|regulatorClient|\.partner\.|\.regulator\.|\/v1\/partner|admin-api|\/v1\/reports/.test(c)]).toEqual([rel, false]);
    }
  });
});
