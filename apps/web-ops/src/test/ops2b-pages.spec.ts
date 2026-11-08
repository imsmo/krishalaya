// apps/web-ops/src/test/ops2b-pages.spec.ts · PC-56 OPS-2b — SOURCE ASSERTIONS for the receipts-and-quality pages:
//   E11 · the READLESS assertion: W375's page and view import no API client, call no SDK method and fetch nothing — with the POSITIVE CONTROL FIRST:
//         the same pattern fires on W376's page (which reads), so an empty result cannot pass silently;
//   reads · W376 reads `nwrs({ box: 'all' … })` only; the drill-in reads `nwr(id)` (+ its booking, for the unit); W372 reads the booking, its assays
//         and `warehouses({ box: 'mine' … })`; W373 the booking's assays; each chain state is checked BEFORE any read;
//   Q4-A / Q9-A · no receipts source names `valuationMinor` or `holderUserId` (and the SDK type carries neither);
//   Q3-A · no web-ops source calls `issueNwr`, `releaseNwr` or `releaseBooking`, and no cancel button calls `cancelNwr` (cancel is not offered);
//   E7 · inputs: W372 the record form only; W376 the page-size GET select only; W373, W375 and the drill-in zero; E3 · no arithmetic near an amount.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.warehousing\.|@krishalaya\/sdk-js['"];?\s*$/m;
const P = { assay: 'app/warehouse/assay/page.tsx', assayAct: 'app/warehouse/assay/actions.ts', record: 'app/warehouse/assay/certificate/page.tsx',
  issue: 'app/warehouse/enwr/issue/page.tsx', registry: 'app/warehouse/enwr/registry/page.tsx', receipt: 'app/warehouse/enwr/[id]/page.tsx' };
const VIEWS = ['components/ops2/AssayViews.tsx', 'components/ops2/EnwrViews.tsx', 'features/ops2/receipts.ts'];
const ALL_2B = [...Object.values(P), ...VIEWS];
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const calls = (src: string) => Array.from(code(src).matchAll(/\.warehousing\.(\w+)\(/g)).map((m) => m[1]);

describe('PC-56 OPS-2b · E11 · W375 reads nothing (positive control first)', () => {
  it('CONTROL: the pattern fires on W376\'s page, which DOES read', () => {
    expect(READS.test(code(read(P.registry)))).toBe(true);
  });
  it('then finds nothing in W375\'s page, the views or the chain component', () => {
    for (const rel of [P.issue, 'components/ops2/EnwrViews.tsx', 'components/ops2/AssayViews.tsx', 'components/ops2/Ops2Chain.tsx'])
      expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-2b · the reads, exactly', () => {
  it('W376 reads nwrs({ box: \'all\' … }) and nothing else; its export chain is checked before the read', () => {
    const page = code(read(P.registry));
    expect(page).toMatch(/opsClient\(\)\.warehousing\.nwrs\(\{ box: 'all',/);
    expect(calls(read(P.registry))).toEqual(['nwrs']);
    expect(page.indexOf("chain2State('enwr_export'")).toBeLessThan(page.indexOf('opsClient()'));
  });
  it('the drill-in reads nwr(id) and its booking (for the unit) only; W373 the booking\'s assays only; W372 booking, assays and box=mine', () => {
    expect(calls(read(P.receipt))).toEqual(['nwr', 'booking']);
    expect(calls(read(P.record))).toEqual(['assays']);
    expect(code(read(P.assay))).toMatch(/w\.warehouses\(\{ box: 'mine',/);
    expect(Array.from(code(read(P.assay)).matchAll(/\bw\.(\w+)\(/g)).map((m) => m[1])).toEqual(['booking', 'assays', 'warehouses']);
    expect(code(read(P.record)).indexOf("chain2State('assay_export'")).toBeLessThan(code(read(P.record)).indexOf('opsClient()'));
    const a = code(read(P.assay));
    for (const st of ["act === 'success'", "act === 'failure'"]) expect([st, a.indexOf(st) < a.indexOf('opsClient()')]).toEqual([st, true]);
  });
  it('the assay act calls recordAssay only, and the booking is an id (parseId) — never a name', () => {
    expect(calls(read(P.assayAct))).toEqual(['recordAssay']);
    expect(code(read(P.assayAct))).toMatch(/parseId\(/);
  });
});

describe('PC-56 OPS-2b · Q4-A / Q9-A / Q3-A / Q5-A', () => {
  it('no receipts or assay source names a valuation or a holder', () => {
    for (const rel of ALL_2B) expect([rel, /valuationMinor|holderUserId|valuation\b|depositorUserId/i.test(code(read(rel)))]).toEqual([rel, false]);
    // PC-56 OPS-2a · NAMED UPDATE: `app/warehouse/page.tsx` is gone (`/warehouse` answers a 307 to W370); its successor W370 and the drill-in's new
    // view are checked instead — the same rule over more files.
    for (const rel of ['app/warehouse/dashboard/page.tsx', 'app/warehouse/[id]/page.tsx', 'components/ops2/IntakeViews.tsx', 'features/ops2/intake.ts'])
      expect([rel, /valuationMinor|holderUserId/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the SDK type of a receipt carries neither a value nor a holder', () => {
    const sdk = fs.readFileSync(path.join(SRC, '..', '..', '..', 'packages', 'sdk-js', 'src', 'resources', 'warehousing.ts'), 'utf8');
    const t = /export interface NwrReceipt \{([^}]*)\}/.exec(sdk)?.[1] ?? '';
    expect(t.length).toBeGreaterThan(0);
    expect(/valuationMinor|holderUserId/.test(t)).toBe(false);
    expect(/async (issueNwr|releaseNwr)\(/.test(sdk)).toBe(false);
  });
  it('no web-ops source calls issueNwr, releaseNwr, releaseBooking or cancelNwr', () => {
    for (const f of walk(SRC).filter((x) => /\.(ts|tsx)$/.test(x) && !x.includes(`${path.sep}test`)))
      expect([path.relative(SRC, f), /\b(issueNwr|releaseNwr|releaseBooking|cancelNwr)\s*\(/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
});

describe('PC-56 OPS-2b · E7 inputs, E3, sidebar', () => {
  it('W373, W375 and the drill-in have zero inputs; W376 one select (the page size) in a GET form; W372 the record form only', () => {
    for (const rel of [P.record, P.issue, P.receipt]) expect([rel, /<input|<select|<textarea|<form|<button/.test(code(read(rel)))]).toEqual([rel, false]);
    const enwr = code(read('components/ops2/EnwrViews.tsx'));
    expect([(enwr.match(/<select/g) ?? []).length, (enwr.match(/<input|<textarea/g) ?? []).length, (enwr.match(/<form/g) ?? []).length]).toEqual([1, 0, 1]);
    expect(enwr).toMatch(/<form method="get" action=\{ENWR_REGISTRY_PAGE\}/);
    const assay = code(read('components/ops2/AssayViews.tsx'));
    expect([(assay.match(/<form/g) ?? []).length, (assay.match(/<select/g) ?? []).length, (assay.match(/<textarea/g) ?? []).length]).toEqual([1, 0, 1]);
    expect(Array.from(assay.matchAll(/name="(\w+)"/g)).map((m) => m[1])).toEqual(['booking', 'assayerName', 'paramsText', 'validUntil']);
  });
  it('E3: no arithmetic and no money formatter in any 2b source', () => {
    for (const rel of ALL_2B) expect([rel, /formatMoney|×|\bBigInt\s*\(|\bNumber\s*\(|parseFloat|Math\./.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the sidebar links W372, W375, W376 (never W373, reached from W372), and every sidebar link is a built page', () => {
    const hrefs = Array.from(read('components/Sidebar.tsx').matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of ['/warehouse/assay', '/warehouse/enwr/registry', '/warehouse/enwr/issue']) expect(hrefs).toContain(h);
    expect(hrefs).not.toContain('/warehouse/assay/certificate');
    for (const h of hrefs) expect([h, fs.existsSync(path.join(SRC, 'app', h, 'page.tsx'))]).toEqual([h, true]);
  });
  // PC-56 OPS-2a · NAMED UPDATE: the drill-in's markup moved into `BookingDetailView` (components/ops2/IntakeViews.tsx); the page and the view are
  // checked together — the same three absences and the same assay link.
  it('the booking page no longer offers the issue form, the assay form or a release button', () => {
    const b = code(read('app/warehouse/[id]/page.tsx')) + code(read('components/ops2/IntakeViews.tsx'));
    expect(/issueNwrAction|recordAssayAction|name="enwrNo"|name="valuationMajor"|name="assayerName"/.test(b)).toBe(false);
    expect(b).toMatch(/assayHref\(b\.id\)/);
    expect(/export async function (issueNwrAction|recordAssayAction)/.test(read('app/warehouse/actions.ts'))).toBe(false);
  });
});
