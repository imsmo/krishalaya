// apps/web-ops/src/test/ops3c-pages.spec.ts · PC-56 OPS-3c — SOURCE ASSERTIONS for `/rates` (W368) and its chains:
//   E11 · the READLESS assertion with its POSITIVE CONTROL FIRST: the pattern fires on `/rates` (which reads), then still finds nothing in the
//         existing honest pages (W371, W374, W375, W379) or in the 3c views;
//   E2  · the page reads exactly `dairy.listRateCards({ activeOnly: true })` and `GET config/flags`, its chain states checked BEFORE any read;
//         the sidebar's Dairy group links built routes only (no `/pos/*`, no `/bmc`);
//   E3  · no client money math: no line that touches an amount multiplies, adds, subtracts, divides or converts it; the money formatter is given
//         only the server's minor strings;
//   Q1-A· no web-ops server action (or any web-ops source) calls `createRateCard` or `approveRateCard`;
//   E14 · one weight-unit word (`kg`); the premium switch's name equals the API's constant (read from its file).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BONUS_SLABS_FLAG, WEIGHT_UNIT } from '../features/ops3/rates';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.dairy\.|\.warehousing\.|\.catalogue\.|@krishalaya\/sdk-js['"];?\s*$/m;
const PAGE = 'app/rates/page.tsx'; const VIEW = 'components/ops3/RatesView.tsx'; const CHAIN = 'components/ops3/Ops3Chain.tsx'; const FEAT = 'features/ops3/rates.ts';
const ALL_3C = [PAGE, VIEW, CHAIN, FEAT];
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

describe('PC-56 OPS-3c · E11 · the readless assertion (positive control first)', () => {
  it('CONTROL: the pattern fires on /rates, which DOES read', () => {
    expect(READS.test(code(read(PAGE)))).toBe(true);
  });
  it('then finds nothing in the honest pages (W371, W374, W375, W379) or in the 3c views', () => {
    for (const rel of ['app/warehouse/weighbridge/page.tsx', 'app/warehouse/stacking/page.tsx', 'app/warehouse/enwr/issue/page.tsx', 'app/warehouse/insights/page.tsx', VIEW, CHAIN, FEAT])
      expect([rel, READS.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-3c · E2 · the reads, exactly; the chains first; the sidebar', () => {
  it('the page reads listRateCards({ activeOnly: true }) and config/flags — nothing else of the platform', () => {
    const page = code(read(PAGE));
    expect(Array.from(page.matchAll(/c\.dairy\.(\w+)\(([^)]*)\)/g)).map((m) => `${m[1]}(${m[2]})`)).toEqual(['listRateCards({ activeOnly: true })']);
    expect(Array.from(page.matchAll(/c\.request<.*?>\('(\w+)', '([^']+)'\)/g)).map((m) => `${m[1]} ${m[2]}`)).toEqual(['GET config/flags']);
    expect(/c\.(warehousing|catalogue|wallet|payouts)\./.test(page)).toBe(false);
  });
  it('the chains are checked BEFORE the read (a chain state never reads)', () => {
    const page = code(read(PAGE));
    for (const st of ["chain3State('rate_export'", "chain3State('rate_act'"]) expect([st, page.indexOf(st) > -1 && page.indexOf(st) < page.indexOf('opsClient()')]).toEqual([st, true]);
  });
  it('the sidebar: a Dairy group of built routes only — /dairy, /payout, /rates, then the four counter pages (OPS-3a), then /bmc (OPS-3b — a NAMED UPDATE)', () => {
    const nav = read('components/Sidebar.tsx');
    const hrefs = Array.from(nav.matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    for (const h of hrefs) expect([h, fs.existsSync(path.join(SRC, 'app', h, 'page.tsx'))]).toEqual([h, true]);
    const i = hrefs.indexOf('/dairy');
    expect(hrefs.slice(i, i + 3)).toEqual(['/dairy', '/payout', '/rates']);
    expect(nav).toMatch(/href: '\/dairy', labelKey: 'nav\.dairy', group: 'nav\.dairyGroup'/);
    // NAMED UPDATE (PC-56 OPS-3a): the counter is BUILT, so the group gains its four opened pages, right after /rates; the cooler (/bmc) is not.
    expect(hrefs.slice(i + 3, i + 7)).toEqual(['/pos/home', '/pos/collect', '/pos/shift-close', '/pos/exceptions']);
    expect(hrefs.filter((h) => /^\/pos\b/.test(h))).toEqual(['/pos/home', '/pos/collect', '/pos/shift-close', '/pos/exceptions']);
    // NAMED UPDATE (PC-56 OPS-3b): the cooler is BUILT, so the group gains `/bmc` right after the counter pages — once.
    expect(hrefs.slice(i + 7, i + 8)).toEqual(['/bmc']);
    expect(hrefs.filter((h) => /^\/bmc\b/.test(h))).toEqual(['/bmc']);
    for (const rel of ALL_3C) expect([rel, /['"`]\/(pos|bmc)\b/.test(code(read(rel)))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-3c · E3 · no client money math on W368', () => {
  it('no line that touches an amount multiplies, adds, subtracts, divides or converts it; no "×" anywhere', () => {
    for (const rel of ALL_3C) {
      for (const line of code(read(rel)).split('\n').filter((l) => /Minor|formatMoney|rate/i.test(l) && !/^import /.test(l))) {
        expect([rel, line.trim(), /\*|×|\bBigInt\s*\(|\bNumber\s*\(|parseFloat|parseInt|Math\.|\w\s*[+-]\s*\w*Minor|Minor\w*\s*[+\-/]\s*\w|\d+n\b/.test(line)]).toEqual([rel, line.trim(), false]);
      }
      expect([rel, /×|\bBigInt\b|\breduce\s*\(/.test(code(read(rel)))]).toEqual([rel, false]);
    }
  });
  it('the view gives the money formatter only the server\'s minor strings', () => {
    const v = code(read(VIEW));
    expect(Array.from(v.matchAll(/formatMoneyMinor\((.*?), 'INR', lang\)/g)).map((m) => m[1])).toEqual(['minor', 'String(s.bonusMinorPerLitre)']);
    expect((v.match(/formatMoneyMinor\(/g) ?? []).length).toBe(2);   // exactly the two calls
  });
});

describe('PC-56 OPS-3c · Q1-A · this console never changes a rate', () => {
  it('no web-ops source (server actions included) calls createRateCard or approveRateCard', () => {
    const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));
    expect(files.length).toBeGreaterThan(50);
    const actions = files.filter((f) => /[\\/]actions\.ts$/.test(f));
    expect(actions.length).toBeGreaterThan(5);
    for (const f of files) expect([path.relative(SRC, f), /createRateCard|approveRateCard|rate-cards\/[^'"`]*approve/.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
  it('zero inputs: no <input>, <select>, <textarea>, <form> or <button> in any 3c source', () => {
    for (const rel of ALL_3C) expect([rel, /<input|<select|<textarea|<form|<button/.test(read(rel))]).toEqual([rel, false]);
  });
});

describe('PC-56 OPS-3c · E14 · one weight word; the premium switch is the API\'s', () => {
  it('WEIGHT_UNIT is kg; the 3c sources say litre nowhere outside comments', () => {
    expect(WEIGHT_UNIT).toBe('kg');
    for (const rel of ALL_3C) expect([rel, /litre|liter/i.test(code(read(rel)).replace(/baseRatePerLitreMinor|bonusMinorPerLitre/g, ''))]).toEqual([rel, false]);
  });
  it('BONUS_SLABS_FLAG equals the API\'s BONUS_SLABS_FLAG (read from its file)', () => {
    const api = fs.readFileSync(path.join(SRC, '..', '..', 'api', 'src', 'modules', 'dairy', 'domain', 'milk-quality.flags.ts'), 'utf8');
    expect(/export const BONUS_SLABS_FLAG = '([^']+)'/.exec(api)?.[1]).toBe(BONUS_SLABS_FLAG);
  });
});
