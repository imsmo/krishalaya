// apps/web-ops/src/test/ops2a-pages.spec.ts · PC-56 OPS-2a — SOURCE ASSERTIONS for the intake pages:
//   E2  · `/warehouse` answers a REAL 307 to /warehouse/dashboard (next.config.js `redirects()` carries OPS2A_REDIRECTS, permanent: false) and the
//         OW-2 page is gone; the sidebar links only built pages, Intake (dashboard, weighbridge, assay, stacking) · Receipts · Money & insight;
//   E11 · the READLESS assertion with its POSITIVE CONTROL FIRST: the pattern fires on W370's page (which reads), then finds nothing in W371, W374
//         (and still W375, W379) or in the intake views;
//   E1  · W370 reads through `readDashboard` only: `warehouses({ box: 'mine' })`, then `bookings({ box: 'warehouse', warehouseId })`;
//   Q9-A· no intake source names `depositorUserId` (and the SDK booking type does not carry it);
//   E3  · no arithmetic, count or total in any intake source ("of N", `.length` printed, `reduce`, a money formatter);
//   E7  · inputs: W370 the GET status select only; the drill-in the operator's acts + the REQUIRED cancel reason; W371 / W374 zero.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OPS2A_REDIRECTS } from '../features/ops2/intake';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.warehousing\.|\.catalogue\.|@krishalaya\/sdk-js['"];?\s*$/m;
const P = { dash: 'app/warehouse/dashboard/page.tsx', weigh: 'app/warehouse/weighbridge/page.tsx', stack: 'app/warehouse/stacking/page.tsx', detail: 'app/warehouse/[id]/page.tsx',
  actions: 'app/warehouse/actions.ts' };
const VIEWS = 'components/ops2/IntakeViews.tsx'; const FEAT = 'features/ops2/intake.ts';
const ALL_2A = [...Object.values(P), VIEWS, FEAT];

describe('PC-56 OPS-2a · E2 · the 307, the old page, the sidebar', () => {
  it('next.config.js redirects() carries OPS2A_REDIRECTS as a 307 (permanent: false); the OW-2 page is gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const r = await cfg.redirects();
    expect(r.filter((x) => x.source === '/warehouse')).toEqual(OPS2A_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    expect(OPS2A_REDIRECTS).toEqual([{ source: '/warehouse', destination: '/warehouse/dashboard' }]);
    expect(fs.existsSync(path.join(SRC, 'app', 'warehouse', 'page.tsx'))).toBe(false);
    for (const p of ['dashboard', 'weighbridge', 'stacking', '[id]', 'enwr/registry']) expect([p, fs.existsSync(path.join(SRC, 'app', 'warehouse', p, 'page.tsx'))]).toEqual([p, true]);
  });
  it('the sidebar: every link a built page, never `/warehouse`; Intake → Receipts → Money & insight in canon order with Stacking under Intake', () => {
    const nav = read('components/Sidebar.tsx');
    const hrefs = Array.from(nav.matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of hrefs) expect([h, fs.existsSync(path.join(SRC, 'app', h, 'page.tsx'))]).toEqual([h, true]);
    expect(hrefs).not.toContain('/warehouse');
    const wh = hrefs.filter((h) => h.startsWith('/warehouse'));
    expect(wh).toEqual(['/warehouse/dashboard', '/warehouse/weighbridge', '/warehouse/assay', '/warehouse/stacking', '/warehouse/enwr/issue', '/warehouse/enwr/registry',
      '/warehouse/withdrawal', '/warehouse/billing', '/warehouse/insights']);
    // NAMED UPDATE (PC-56 OPS-3c): the Dairy group joins AFTER the three warehouse groups (/dairy · /payout · /rates); the warehouse order is unchanged.
    // NAMED UPDATE (PC-56 OPS-4a): the Machinery group (the built hire pages) joins between the warehouse groups and Dairy, where OW-3's
    // `/equipment` entry stood; the warehouse order is unchanged.
    expect(Array.from(nav.matchAll(/group: '([^']+)'/g)).map((m) => m[1])).toEqual(['nav.whGroupIntake', 'nav.whGroupReceipts', 'nav.whGroupMoney', 'nav.chcGroup', 'nav.dairyGroup']);
    expect(/https?:\/\//.test(code(nav))).toBe(false);   // no cross-app link
  });
});

describe('PC-56 OPS-2a · E11 · W371 and W374 read nothing (positive control first)', () => {
  it('CONTROL: the pattern fires on W370\'s page, which DOES read', () => {
    expect(READS.test(code(read(P.dash)))).toBe(true);
  });
  it('then finds nothing in W371, W374 (and W375, W379) or in the intake views', () => {
    for (const rel of [P.weigh, P.stack, 'app/warehouse/enwr/issue/page.tsx', 'app/warehouse/insights/page.tsx', VIEWS, 'components/ops2/Ops2Chain.tsx'])
      expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-2a · E1 · the dashboard\'s reads, exactly', () => {
  it('the page reads only through readDashboard, its chain states checked BEFORE any read', () => {
    const page = code(read(P.dash));
    expect(page).toMatch(/readDashboard\(/);
    expect(Array.from(page.matchAll(/c\.(warehousing|catalogue)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`)).toEqual(['warehousing.warehouses', 'warehousing.bookings', 'catalogue.product']);
    for (const st of ["chain2State('wh_form'", "chain2State('wh_act'"]) expect([st, page.indexOf(st) > -1 && page.indexOf(st) < page.indexOf('opsClient()')]).toEqual([st, true]);
  });
  it('readDashboard asks for box mine, then box warehouse with the warehouse id', () => {
    const f = code(read(FEAT));
    expect(f).toMatch(/io\.warehouses\(\{ box: 'mine', limit: 100 \}\)/);
    expect(f).toMatch(/io\.bookings\(\{ box: 'warehouse', warehouseId: w\.id,/);
  });
  it('the drill-in reads the booking, the warehouses the person operates (box mine) and the commodity\'s name; the act calls confirm / store / cancel only', () => {
    expect(Array.from(code(read(P.detail)).matchAll(/c\.(warehousing|catalogue)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`)).toEqual(['warehousing.booking', 'warehousing.warehouses', 'catalogue.product']);
    expect(code(read(P.detail))).toMatch(/warehouses\(\{ box: 'mine', limit: 100 \}\)/);
    expect(Array.from(code(read(P.actions)).matchAll(/\bw\.(\w+)\(/g)).map((m) => m[1])).toEqual(['confirmBooking', 'storeBooking', 'cancelBooking']);
    expect(code(read(P.actions))).toMatch(/cancelBooking\(id, String\(formData\.get\('reason'\)/);
  });
});

describe('PC-56 OPS-2a · Q9-A / E3 / E7', () => {
  it('no intake source names a depositor id, a holder or a valuation; the SDK booking type carries no depositor id and none of the never-returned fields', () => {
    for (const rel of ALL_2A) expect([rel, /depositorUserId|holderUserId|valuationMinor/.test(code(read(rel)))]).toEqual([rel, false]);
    const sdk = fs.readFileSync(path.join(SRC, '..', '..', '..', 'packages', 'sdk-js', 'src', 'resources', 'warehousing.ts'), 'utf8');
    const t = /export interface StorageBooking \{([^}]*)\}/.exec(sdk)?.[1] ?? '';
    expect(t.length).toBeGreaterThan(0);
    expect(/depositorUserId|feeMinor|productName|warehouseName|expectedArrival/.test(t)).toBe(false);
    expect(sdk).toMatch(/async bookings\(params: \{ box\?: BookingBox; warehouseId\?: string;/);
  });
  it('E3: no sum, count, total or money formatter in any intake source', () => {
    for (const rel of ALL_2A) expect([rel, /\.reduce\(|formatMoney|×|\bBigInt\s*\(|\bNumber\s*\(|parseFloat|Math\.|\{[^{}]*\.length\s*\}|\bof \{|Page \d|count/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('E7: W371 and W374 have zero inputs; W370 one select in a GET form; the drill-in the act buttons + the REQUIRED reason', () => {
    for (const rel of [P.weigh, P.stack, P.dash]) expect([rel, /<input|<select|<textarea|<form|<button/.test(code(read(rel)))]).toEqual([rel, false]);
    const v = code(read(VIEWS));
    const dash = v.slice(v.indexOf('export function WhDashboardView'), v.indexOf('export function WeighbridgeView'));
    expect([(dash.match(/<select/g) ?? []).length, (dash.match(/<input|<textarea/g) ?? []).length, (dash.match(/<form/g) ?? []).length]).toEqual([1, 0, 1]);
    expect(dash).toMatch(/<form method="get" action=\{DASHBOARD_PAGE\}/);
    const honest = v.slice(v.indexOf('export function WeighbridgeView'), v.indexOf('export interface BookingDetailViewProps'));
    expect(/<input|<select|<textarea|<form|<button/.test(honest)).toBe(false);
    const detail = v.slice(v.indexOf('export function BookingDetailView'));
    expect(Array.from(detail.matchAll(/name="(\w+)"/g)).map((m) => m[1])).toEqual(['id', 'kind', 'id', 'kind', 'reason']);
    expect(detail).toMatch(/<input id="wh-reason" name="reason" className="kv-input" required minLength=\{1\} maxLength=\{500\} \/>/);
    expect(/←/.test(detail)).toBe(false);
  });
});
