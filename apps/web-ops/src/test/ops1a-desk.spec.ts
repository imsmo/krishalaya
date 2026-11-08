// apps/web-ops/src/test/ops1a-desk.spec.ts · PC-56 OPS-1a — SOURCE ASSERTIONS for the two money lines the ops console gave up:
//   Q2-A: no web-ops server action (or page) calls a milk-bill APPROVE or PAY route — the SDK's `approveBill` / `payBill`, or a raw
//         `milk-bills/…/approve|pay` path; PREVIEW (a state step, no ledger posting) stays and is the only bill act on /dairy.
//   Q3-A: no web-ops action calls the storage-booking RELEASE (`releaseBooking`, or a raw `/release` path); the booking page has no release act.
// With POSITIVE CONTROLS: the scanner sees the SDK's own definitions of the three methods (so it would see a call if one were there), and it
// sees `previewBill(` in the dairy actions.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['test', 'test-render', 'i18n'].includes(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const FORBIDDEN = /\.(approveBill|payBill|releaseBooking)\s*\(|milk-bills\/[^'"`]*\/(approve|pay)\b|storage-bookings\/[^'"`]*\/release\b/;

describe('PC-56 OPS-1a · the ops console approves, pays and releases nothing', () => {
  const files = walk(SRC);
  it('scans the whole app (app/, components/, features/, lib/)', () => {
    expect(files.some((f) => f.endsWith(path.join('app', 'dairy', 'actions.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('app', 'warehouse', 'actions.ts')))).toBe(true);
    expect(files.length).toBeGreaterThan(40);
  });
  it('no file calls approveBill / payBill / releaseBooking or a raw approve / pay / release path', () => {
    for (const f of files) expect([path.relative(SRC, f), FORBIDDEN.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
  it('positive control: the same pattern finds the SDK\'s own calls, and the dairy actions still preview', () => {
    const sdk = fs.readFileSync(path.join(SRC, '..', '..', '..', 'packages', 'sdk-js', 'src', 'resources', 'dairy.ts'), 'utf8');
    expect(/milk-bills\/[^'"`]*\/(approve|pay)\b/.test(sdk)).toBe(true);
    expect(FORBIDDEN.test('await d.payBill(id, key)')).toBe(true);
    expect(FORBIDDEN.test('await w.releaseBooking(id, key)')).toBe(true);
    const dairy = fs.readFileSync(path.join(SRC, 'app', 'dairy', 'actions.ts'), 'utf8');
    expect(/\.previewBill\(/.test(dairy)).toBe(true);
    expect(/export async function (billLifecycleAction|approveBillAction|payBillAction)/.test(dairy)).toBe(false);
  });
  it('/dairy offers no approve / pay button and points to /payout; the superseded keys are gone ×3', () => {
    const page = fs.readFileSync(path.join(SRC, 'app', 'dairy', 'page.tsx'), 'utf8');
    expect(/dairy\.act\.(approve|pay)|canApprove|canPay/.test(page)).toBe(false);
    expect(page).toContain('href="/payout"');
    for (const lang of ['en', 'hi', 'gu']) {
      const cat = fs.readFileSync(path.join(SRC, 'i18n', `${lang}.ts`), 'utf8');
      for (const k of ['dairy.act.approve', 'dairy.act.pay', 'dairy.ok.approve', 'dairy.ok.pay', 'wh.actRelease', 'wh.releaseHint', 'wh.ok.release']) expect([lang, k, cat.includes(`'${k}':`)]).toEqual([lang, k, false]);
    }
  });
  // PC-56 OPS-2a · NAMED UPDATE (survey E2): the warehouse section's head is now `/warehouse/dashboard` (W370) — `/warehouse` answers a 307 there and
  // is no page, so no sidebar entry may link it. The rule is unchanged: the withdrawal page sits under the warehouse section, the payout under Dairy.
  it('the sidebar links /payout under Dairy and /warehouse/withdrawal under Warehouse', () => {
    const nav = fs.readFileSync(path.join(SRC, 'components', 'Sidebar.tsx'), 'utf8');
    const order = ['/warehouse/dashboard\'', '/warehouse/withdrawal', '/dairy\'', '/payout'].map((h) => nav.indexOf(`href: '${h.replace(/'$/, '')}'`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order[1]).toBe(nav.indexOf("href: '/warehouse/withdrawal'")); expect(order[0] < order[1] && order[2] < order[3]).toBe(true);
  });
});
