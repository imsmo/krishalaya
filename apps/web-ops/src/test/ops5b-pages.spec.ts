// apps/web-ops/src/test/ops5b-pages.spec.ts · PC-56 OPS-5b · THE ORGANISATION'S MILK, IN NUMBERS — SOURCE ASSERTIONS, the premises, the pure helpers.
//   READS · POSITIVE CONTROL FIRST: W369 reads `dairy.insights`, the job page `exportsPlane.get` (+ `auth.me` for "requester as you"); the ONE
//           server action calls only `dairy.enqueueInsightsExport`; the download route mints the link BEFORE it opens the download, and is a POST.
//   E16   · OW-6 retired: NO web-ops source calls `tenancy.analytics` (the GMV / payouts block, its 'INR' fallback and the unused `topSellers`
//           read are gone with it); no ops5 source calls any dairy write.
//   §D    · nothing computed in the view: no arithmetic, no Number / BigInt / Math / reduce in InsightsViews.tsx; money only through formatMoneyMinor
//           with the read's own currency — never an 'INR' literal in a 5b source.
//   Q2/Q4 · the premises read from the API's code: the insights read filters by organisation only (no centre); the read and the export carry no
//           member column; the export plane records the request and the link (and logs the fetch).
//   E1    · `/insights` in the Dairy group, not top-level; the chain states answered BEFORE any read.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  crossSite, downloadErrorOf, exportErrorOf, exportHref, exportJobState, exportTransport, jobParam, kgText, rateMinor, requesterKey, shaGroups, transportState, windowParam,
} from '../features/ops5/insights';

const SRC = path.join(__dirname, '..');
const API = path.join(SRC, '..', '..', 'api', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const P = { page: 'app/insights/page.tsx', action: 'app/insights/actions.ts', route: 'app/insights/exports/[id]/download/route.ts' };
const OPS5B = [...Object.values(P), 'components/ops5/InsightsViews.tsx', 'features/ops5/insights.ts'];
const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));

describe('PC-56 OPS-5b · reads and the one act (positive control first)', () => {
  it('CONTROL: W369 reads the insights; the job page reads the job and who you are; the action enqueues; the route mints, then opens the download', () => {
    expect(code(read(P.page))).toMatch(/opsClient\(\)\.dairy\.insights\(\{ window: w \}\)/);
    expect(code(read(P.page))).toMatch(/opsClient\(\)\.exportsPlane\.get\(jobId\)/);
    expect(code(read(P.page))).toMatch(/opsClient\(\)\.auth\.me\(\)/);
    const calls = Array.from(code(read(P.action)).matchAll(/opsClient\(\)\.(\w+)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`);
    expect([...new Set(calls)]).toEqual(['dairy.enqueueInsightsExport']);
    const r = code(read(P.route));
    expect(r.indexOf('.exportsPlane.mintLink(')).toBeGreaterThan(0);
    expect(r.indexOf('.exportsPlane.mintLink(')).toBeLessThan(r.indexOf('.exportsPlane.openDownload('));
    expect(/export async function POST\(/.test(r)).toBe(true);
    expect(/export (async )?function (GET|PUT|PATCH|DELETE)\b/.test(r)).toBe(false);   // a prefetch never mints a link or logs a fetch
  });
  it('E16: NO web-ops source calls tenancy.analytics (OW-6 retired); the OW-6 snapshot helper is gone', () => {
    expect(SRC_FILES.length).toBeGreaterThan(50);
    for (const f of SRC_FILES) expect([path.relative(SRC, f), /tenancy\.analytics\b|\.analytics\(\)/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
    expect(fs.existsSync(path.join(SRC, 'features', 'insights', 'summarise.ts'))).toBe(false);
    // the control: the SDK still has the read (it is the organisation's console's)
    expect(/async analytics\(/.test(fs.readFileSync(path.join(SRC, '..', '..', '..', 'packages', 'sdk-js', 'src', 'resources', 'tenancy.ts'), 'utf8'))).toBe(true);
  });
  it('no ops5 source (5a or 5b) calls tenancy.analytics or any dairy write; 5b reads only the insights, enqueues only the export', () => {
    const OPS5_ALL = [...OPS5B, 'components/ops5/AlertViews.tsx', 'components/ops5/Ops5Chain.tsx', 'features/ops5/alerts.ts', 'features/ops5/refusals.ts', 'app/iot/alert-rules/actions.ts'];
    for (const f of OPS5_ALL) {
      const c = code(read(f));
      expect([f, /tenancy\.analytics/.test(c)]).toEqual([f, false]);
      const dairyCalls = Array.from(c.matchAll(/\.dairy\.(\w+)\(/g)).map((m) => m[1]);
      expect([f, dairyCalls.filter((m) => m !== 'insights' && m !== 'enqueueInsightsExport')]).toEqual([f, []]);
    }
  });
});

describe('PC-56 OPS-5b · §D nothing computed in the page; money in its own currency', () => {
  it('InsightsViews.tsx holds no arithmetic and no number parsing — every figure is the server\'s', () => {
    const c = code(read('components/ops5/InsightsViews.tsx'));
    expect(/Number\(|BigInt\(|parseInt|parseFloat|Math\.|\.reduce\(|toFixed|\.length\s*[-+*/]/.test(c)).toBe(false);
    const stripped = c.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""').replace(/\b[a-z]+(?:-[a-z0-9]+)+=/g, 'attr=').replace(/<\/?[A-Za-z]/g, '<x');
    const ops = stripped.split('\n').filter((l) => /[\w)\]]\s*[+*%-]\s*[\w(]|[\w)\]]\s+\/\s+[\w(]/.test(l));
    expect(ops).toEqual([]);
  });
  it('no 5b source carries an \'INR\' (or any currency) literal; money goes through formatMoneyMinor with the read\'s currencyCode', () => {
    for (const f of OPS5B) expect([f, /['"`](INR|USD|JPY)['"`]|₹/.test(code(read(f)))]).toEqual([f, false]);
    const v = code(read('components/ops5/InsightsViews.tsx'));
    expect(Array.from(v.matchAll(/formatMoneyMinor\(([^)]*)\)/g)).map((m) => m[1])).toEqual(['minor, currency, lang']);
    expect(v).toMatch(/const cur = v\.currencyCode;/);
  });
});

describe('PC-56 OPS-5b · the premises of Q2-A, Q4-A and E10, read from the API', () => {
  const repo = fs.readFileSync(path.join(API, 'modules', 'dairy', 'repositories', 'dairy-insights.repository.ts'), 'utf8');
  it('Q4-A: every pour query is the organisation\'s (tenant_id), none filters a centre; every pour belongs to a centre (mcc_id NOT NULL)', () => {
    const sql = Array.from(repo.matchAll(/`([\s\S]*?)`/g)).map((m) => m[1]).filter((s) => /FROM milk_collections/.test(s));
    expect(sql.length).toBeGreaterThanOrEqual(4);
    for (const s of sql) { expect(s).toMatch(/tenant_id\s*=\s*\$1/); expect(/mcc_id|centre/i.test(s)).toBe(false); }
    const mig = fs.readFileSync(path.join(SRC, '..', '..', '..', 'db', 'migrations', '0009_livestock_dairy.sql'), 'utf8');
    expect(mig).toMatch(/CREATE TABLE milk_collections \([\s\S]*?mcc_id\s+uuid NOT NULL/);
  });
  it('Q2-A: the read carries no member — no membership id or name leaves the repository; the export file\'s header names no person', () => {
    expect(/membership_id\s+AS|AS\s+membership|full_name|display_name|member_code/i.test(repo)).toBe(false);
    const exp = fs.readFileSync(path.join(API, 'modules', 'dairy', 'domain', 'dairy-insights-export.ts'), 'utf8');
    expect(exp).toMatch(/INSIGHTS_EXPORT_HEADER = \['section', 'metric', 'value', 'unit', 'basis', 'note'\] as const/);
  });
  it('E10: the plane records the request and the link, and logs every fetch; the route is dairy.manage', () => {
    const svc = fs.readFileSync(path.join(API, 'core', 'exports-plane', 'export-plane.service.ts'), 'utf8');
    expect(svc).toMatch(/action: 'exports\.enqueued'/); expect(svc).toMatch(/action: 'exports\.link_minted'/);
    expect(svc).toMatch(/const refuse = async[\s\S]*?await this\.log\(/);
    const ctl = fs.readFileSync(path.join(API, 'modules', 'dairy', 'controllers', 'v1', 'dairy-insights.controller.ts'), 'utf8');
    expect((ctl.match(/@RequirePermissions\(DairyPermissions\.Manage\)/g) ?? []).length).toBe(2);
  });
});

describe('PC-56 OPS-5b · E1 nav and the chain order', () => {
  it('`/insights` sits in the Dairy group (after the cooler), never top-level', () => {
    const s = code(read('components/Sidebar.tsx'));
    const hrefs = Array.from(s.matchAll(/\{ href: '([^']+)'[^}]*\}/g)).map((m) => [m[1], /sub: true/.test(m[0])] as const);
    const i = hrefs.findIndex(([h]) => h === '/insights');
    expect(hrefs.filter(([h]) => h === '/insights')).toHaveLength(1);
    expect(hrefs[i]).toEqual(['/insights', true]);
    expect(hrefs[i - 1][0]).toBe('/bmc');
  });
  it('W369 answers its chain states BEFORE any read (the re-read first, then the job, then the page)', () => {
    const c = code(read(P.page));
    const firstRead = c.indexOf('opsClient()');
    expect(c.indexOf("chain5State('insights_act'")).toBeGreaterThan(0);
    expect(c.indexOf("chain5State('insights_act'")).toBeLessThan(firstRead);
    expect(c.indexOf('.exportsPlane.get(')).toBeLessThan(c.indexOf('.dairy.insights('));
  });
  it('both chains return to W369 with the window on screen (Back and the re-read are `insightsHref(w)`, never another page)', () => {
    const c = code(read(P.page));
    expect(c).toMatch(/const back = insightsHref\(w\);/);
    expect(c).toMatch(/<Ops5Chain t=\{t\} chain="insights_act" state=\{act\} page=\{back\} \/>/);
    expect(c).toMatch(/<Ops5Chain t=\{t\} chain="insights_export" state=\{state\} page=\{back\}>/);
    expect((c.match(/page=\{/g) ?? []).length).toBe(2);
  });
});

describe('PC-56 OPS-5b · the pure helpers', () => {
  it('window: the server\'s three, else 90', () => {
    expect(['30', '90', '180', '7', undefined, ['180'], '365'].map(windowParam)).toEqual([30, 90, 180, 90, 90, 180, 90]);
  });
  it('kg by moving the decimal point (exact), the rate to whole minor units half-up (the organisation console\'s rule); anything else → null', () => {
    expect(['1234567', '0', '5', '1000', '-2500', 'x', 12, '1.5'].map(kgText)).toEqual(['1234.567', '0.000', '0.005', '1.000', '-2.500', null, null, null]);
    expect(['471249', '471250', '49', '50', '-150', '0', 'x'].map(rateMinor)).toEqual(['4712', '4713', '0', '1', '-2', '0', null]);
  });
  it('the job\'s state is the plane\'s; another dataset is not this page\'s; transport answers by name', () => {
    const j = (status: string, datasetCode = 'dairy.insights') => ({ status, datasetCode } as never);
    expect(['queued', 'running', 'ready', 'expired', 'failed'].map((s) => exportJobState(j(s)))).toEqual(['queued', 'queued', 'ready', 'expired', 'failed']);
    expect(exportJobState(j('ready', 'traceability.lot_record'))).toBe('notFound');
    expect([exportTransport(404, 'EXPORT_PLANE_DISABLED'), exportTransport(404, 'EXPORT_JOB_NOT_FOUND'), exportTransport(404, null), exportTransport(403, null), exportTransport(500, null), exportTransport('failed', null)])
      .toEqual(['off', 'notFound', 'off', 'forbidden', 'error', 'error']);
    expect([transportState(404), transportState(403), transportState(500), transportState('failed')]).toEqual(['off', 'forbidden', 'error', 'error']);
    expect([exportErrorOf(404, 'EXPORT_PLANE_DISABLED'), exportErrorOf(403, 'FORBIDDEN'), exportErrorOf(409, null), exportErrorOf('failed', null)]).toEqual(['off', 'forbidden', 'failed', 'failed']);
    expect(['EXPORT_NOT_READY', 'refused_file_expired', 'EXPORT_FILE_EXPIRED', 'refused_bad_signature', 'cross_site', null].map(downloadErrorOf)).toEqual(['notReady', 'expired', 'expired', 'link', 'failed', 'failed']);
  });
  it('requester as you — or another person, or not known; never the id', () => {
    expect([requesterKey('u1', 'u1'), requesterKey('u2', 'u1'), requesterKey('u1', null), requesterKey(null, 'u1')])
      .toEqual(['ops5.ins.export.requester.you', 'ops5.ins.export.requester.another', 'ops5.ins.export.requester.unknown', 'ops5.ins.export.requester.unknown']);
  });
  it('addresses, ids and the sha256 in groups', () => {
    const ID = '0192D2C4-E5B0-7000-8000-000000000001';
    expect(jobParam(ID)).toBe(ID.toLowerCase()); expect(jobParam('../x')).toBeNull(); expect(jobParam(undefined)).toBeNull();
    expect(exportHref('abc', 30)).toBe('/insights?export=abc&window=30');
    expect(shaGroups('0123456789abcdef01')).toBe('01234567 89abcdef 01'); expect(shaGroups(null)).toBe('');
  });
});

// [lead QA, OPS-5b] a lead mutant deleting the download route's cross-site refusal passed every web-ops spec (397 + 540): nothing pinned it.
// Now the rule is a pure helper with its cases, and the route must refuse a cross-site POST BEFORE it mints a link (a mint is audited).
describe('PC-56 OPS-5b · the download refuses a cross-site POST before any mint (lead QA)', () => {
  it('crossSite: another host or a non-URL Origin is cross-site; the same host or no Origin is not', () => {
    expect(crossSite('https://evil.example', 'ops.krishalaya.test')).toBe(true);
    expect(crossSite('not a url', 'ops.krishalaya.test')).toBe(true);
    expect(crossSite('https://ops.krishalaya.test', 'ops.krishalaya.test')).toBe(false);
    expect(crossSite(null, 'ops.krishalaya.test')).toBe(false);
  });
  it('the route answers cross_site through crossSite before mintLink', () => {
    const src = code(read(P.route));
    const refuse = src.search(/if \(crossSite\(req\.headers\.get\('origin'\), host\)\) return back\('cross_site'\);/);
    expect(refuse).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(src.indexOf('mintLink('));
  });
});
