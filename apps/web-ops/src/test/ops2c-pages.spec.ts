// apps/web-ops/src/test/ops2c-pages.spec.ts · PC-56 OPS-2c — SOURCE ASSERTIONS for the money-of-storage pages:
//   E11 · the READLESS assertion: W379's page and view import no API client, call no SDK method and fetch nothing — with the POSITIVE CONTROL
//         FIRST: the same pattern fires on W378's page (which reads), so an empty result cannot pass silently;
//   F-9 · W378 reads `warehouses({ box: 'mine' … })` — the operator's own warehouses, never the API default;
//   E3  · NO CLIENT MONEY MATH: no `*`, `×`, `=`-assignment, `+`/`-` arithmetic, BigInt / Number / parseFloat near an amount in any W378 source;
//   E7  · zero inputs in every 2c source; E2 · the sidebar links only built routes; E14 · the fee unit constant equals the API's.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { STORAGE_FEE_UNIT } from '../features/ops2/billing';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
// code lines only: comments dropped, and a TYPE-ONLY import (no runtime, so never a read) dropped too
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
/** A read (or write) of the platform from a page or view — the 1b/1c pattern plus the warehousing resource. */
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.warehousing\.|@krishalaya\/sdk-js['"];?\s*$/m;
const W378 = ['app/warehouse/billing/page.tsx', 'components/ops2/BillingView.tsx', 'features/ops2/billing.ts'];
const ALL_2C = [...W378, 'app/warehouse/insights/page.tsx', 'components/ops2/InsightsView.tsx', 'components/ops2/Ops2Chain.tsx', 'features/ops2/refusals.ts'];

describe('PC-56 OPS-2c · E11 · W379 reads nothing (positive control first)', () => {
  it('CONTROL: the pattern fires on W378\'s page, which DOES read', () => {
    expect(READS.test(code(read('app/warehouse/billing/page.tsx')))).toBe(true);
  });
  it('then finds nothing in W379\'s page, its view or the chain component', () => {
    for (const rel of ['app/warehouse/insights/page.tsx', 'components/ops2/InsightsView.tsx', 'components/ops2/Ops2Chain.tsx', 'components/ops2/BillingView.tsx'])
      expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-2c · F-9 · W378 reads the operator\'s OWN warehouses', () => {
  it('the one read is warehouses({ box: \'mine\' … }) — and the page reads nothing else of the platform', () => {
    const page = code(read('app/warehouse/billing/page.tsx'));
    expect(page).toMatch(/opsClient\(\)\.warehousing\.warehouses\(\{ box: 'mine',/);
    expect(Array.from(page.matchAll(/\.warehousing\.(\w+)\(/g)).map((m) => m[1])).toEqual(['warehouses']);
    expect(/\.bookings\(|\.nwrs\(|\.booking\(/.test(page)).toBe(false);
  });
  it('the chains are checked BEFORE the read (a chain state never reads)', () => {
    const page = code(read('app/warehouse/billing/page.tsx'));
    expect(page.indexOf("chain2State('storage_export'")).toBeLessThan(page.indexOf('opsClient()'));
    expect(page.indexOf("chain2State('storage_act'")).toBeLessThan(page.indexOf('opsClient()'));
  });
});

describe('PC-56 OPS-2c · E3 · no client money math on W378', () => {
  it('no line that touches an amount multiplies, adds, subtracts, divides or converts it', () => {
    for (const rel of W378) {
      for (const line of code(read(rel)).split('\n').filter((l) => /Minor|formatMoney|rate/i.test(l))) {
        expect([rel, line.trim(), /\*|×|\bBigInt\s*\(|\bNumber\s*\(|parseFloat|parseInt|Math\.|\w\s*[+-]\s*\w*Minor|Minor\w*\s*[+\-/]\s*\w/.test(line)]).toEqual([rel, line.trim(), false]);
      }
      expect([rel, /×/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('the view prints the rate only through formatMoneyMinor, and nothing else is passed to it', () => {
    const v = code(read('components/ops2/BillingView.tsx'));
    expect(Array.from(v.matchAll(/formatMoneyMinor\(([^)]*)\)/g)).map((m) => m[1])).toEqual(["w.ratePerQtlMonthMinor, 'INR', lang"]);
  });
});

describe('PC-56 OPS-2c · E7 / E2 / E14', () => {
  it('zero inputs: no <input>, <select>, <textarea>, <form> or <button> in any 2c source', () => {
    for (const rel of ALL_2C) expect([rel, /<input|<select|<textarea|<form|<button/.test(code(read(rel)))]).toEqual([rel, false]);
  });
  it('the sidebar links the two new pages, and every sidebar link is a page that exists (built routes only)', () => {
    const hrefs = Array.from(read('components/Sidebar.tsx').matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of ['/warehouse/billing', '/warehouse/insights']) expect(hrefs).toContain(h);
    for (const h of hrefs) expect([h, fs.existsSync(path.join(SRC, 'app', h, 'page.tsx'))]).toEqual([h, true]);
  });
  // NAMED UPDATE (PC-56 OPS-2b): `assay` and `enwr` are built now (W372, W373, W375, W376), so they leave the "not built" list; the rule is unchanged
  // for the three still unbuilt (OPS-2a's dashboard, weighbridge, stacking). W379's assay link is now real (wh-insights.render pins it).
  it('no 2c source links a warehouse route that is not built (dashboard, weighbridge, stacking)', () => {
    for (const rel of ALL_2C.filter((r) => r !== 'features/ops2/refusals.ts')) expect([rel, /href=\{?['"`]\/warehouse\/(dashboard|weighbridge|stacking)/.test(read(rel))]).toEqual([rel, false]);
  });
  it('E14: the web-ops fee unit equals the API\'s one constant (read from its file)', () => {
    const api = fs.readFileSync(path.join(SRC, '..', '..', 'api', 'src', 'modules', 'warehousing', 'domain', 'quantity.ts'), 'utf8');
    const m = /export const STORAGE_FEE_UNIT = '([a-z_]+)' as const;/.exec(api);
    expect(m?.[1]).toBe(STORAGE_FEE_UNIT); expect(STORAGE_FEE_UNIT).toBe('quintal');
  });
});
