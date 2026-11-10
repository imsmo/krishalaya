// apps/web-ops/src/test/ops4a-pages.spec.ts · PC-56 OPS-4a · THE HIRE — SOURCE ASSERTIONS and the pure helpers.
//   E11  · the READLESS assertion with its POSITIVE CONTROL FIRST: the pattern fires on /chc/dashboard and /chc/bookings (which read), then finds
//          nothing in /chc/insights (W409 reads nothing);
//   Q3-A · no web-ops source (and no `ops4` server action — there is none) calls settleRental, quoteRental, startRental, completeRental,
//          confirmRental or confirmRentalUsage;
//   THE NO-RENTER-APP FACT (lead decision, brief §D): NO client anywhere in the monorepo calls `confirmRentalUsage` — so no renter can confirm
//          hours, and the pages say so. When a renter app lands this assertion turns red, and "No app for renters to confirm hours exists on this
//          platform yet, …" must go with it;
//   E1   · every `equipment.rentals(` call in every client names its `box`;
//   E3   · no client money math in any 4a source: no sum, product, difference, percentage, `Number(`, `parseFloat`, `Math.`, `reduce(`;
//   E2   · the 307s mirror OPS4A_REDIRECTS; the sidebar's Machinery group holds the three built routes and never the unbuilt maintenance page;
//          the W406 edges are drawn; the chain states are answered BEFORE any read;
//   the pure helpers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CHC, OPS4A_REDIRECTS, asMaintenance, atText, bookingsHref, chcState, countByStatus, cursorParam, idParam, qtyText, statusParam } from '../features/ops4/chc';

const SRC = path.join(__dirname, '..');
const APPS = path.join(SRC, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const READS = /opsClient\s*\(|lib\/api-client|\bfetch\s*\(|\.equipment\.|\.lookups\./m;
const P = { dash: 'app/chc/dashboard/page.tsx', detail: 'app/chc/equipment-detail/page.tsx', bookings: 'app/chc/bookings/page.tsx', insights: 'app/chc/insights/page.tsx' };
const ALL_4A = [...Object.values(P), 'components/ops4/ChcViews.tsx', 'components/ops4/Ops4Chain.tsx', 'features/ops4/chc.ts'];
const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' || e.name === '.expo' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));
/** Every client source in the monorepo — every app but the API itself — outside tests. */
const CLIENT_FILES = fs.readdirSync(APPS).filter((a) => a !== 'api' && a !== 'admin-api' && a !== 'worker')
  .flatMap((a) => walk(path.join(APPS, a, 'src')))
  .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/[\\/](__tests__|test|test-render|tests)[\\/]|\.(spec|test)\.[jt]sx?$/.test(f));

describe('PC-56 OPS-4a · E11 · the readless assertion (positive control first)', () => {
  it('CONTROL: the pattern fires on /chc/dashboard and /chc/bookings, which DO read', () => {
    expect(READS.test(code(read(P.dash)))).toBe(true);
    expect(READS.test(code(read(P.bookings)))).toBe(true);
  });
  it('then finds nothing in /chc/insights (W409 reads nothing)', () => {
    expect(READS.test(code(read(P.insights)))).toBe(false);
    expect(/SdkError|cookies\(/.test(code(read(P.insights)))).toBe(false);
  });
});

describe('PC-56 OPS-4a · Q3-A · this console only reads machine hire', () => {
  it('no web-ops source calls an owner or renter hire act; no server action exists for the hire pages', () => {
    // NAMED UPDATE (PC-56 OPS-4b): `recordMaintenance` is now called by EXACTLY ONE source — the W408 server action (the REAL "Record a maintenance
    // entry", owner-only and recorded in the API since the 4b first commit) — and that is the only server action under app/chc. Every hire act,
    // rate, status and asset write stays absent everywhere; recordMaintenance stays absent everywhere else (pinned again in ops4b-pages.spec.ts).
    const MAINT_ACTION = path.join('app', 'chc', 'maintenance', 'actions.ts');
    for (const f of SRC_FILES) {
      const src = code(fs.readFileSync(f, 'utf8'));
      expect([path.relative(SRC, f), /\.(settleRental|quoteRental|startRental|completeRental|confirmRental|confirmRentalUsage|cancelRental|setRate|setAssetStatus|registerAsset)\(/.test(src)]).toEqual([path.relative(SRC, f), false]);
      if (path.relative(SRC, f) !== MAINT_ACTION) expect([path.relative(SRC, f), /\.recordMaintenance\(/.test(src)]).toEqual([path.relative(SRC, f), false]);
    }
    expect(/\.recordMaintenance\(/.test(code(read(MAINT_ACTION)))).toBe(true);
    expect(SRC_FILES.filter((f) => /[\\/]app[\\/]chc[\\/]/.test(f) && /^\s*['"]use server['"]/m.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f))).toEqual([MAINT_ACTION]);
    expect(fs.existsSync(path.join(SRC, 'app', 'chc', 'actions.ts'))).toBe(false);
  });
  it('THE NO-RENTER-APP FACT: no client in the monorepo calls confirmRentalUsage (or the confirm-usage route) — positive control: the SDK defines it', () => {
    expect(CLIENT_FILES.length).toBeGreaterThan(200);
    const sdk = fs.readFileSync(path.join(APPS, '..', 'packages', 'sdk-js', 'src', 'resources', 'equipment.ts'), 'utf8');
    expect(/async confirmRentalUsage\(/.test(sdk) && /\/confirm-usage/.test(sdk)).toBe(true);   // the control: the pattern's target exists
    const callers = CLIENT_FILES.filter((f) => /\.confirmRentalUsage\s*\(|\/confirm-usage\b/.test(code(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(APPS, f));
    expect(callers).toEqual([]);
    // and no client requests or confirms a hire either (survey C-4): the renter's whole side has no screen
    const renterSide = CLIENT_FILES.filter((f) => /\.equipment\.(requestRental|confirmRental)\(|['"`]equipment\/rentals['"`]\s*,\s*\{[^}]*method:\s*['"]POST/.test(code(fs.readFileSync(f, 'utf8'))));
    expect(renterSide).toEqual([]);
  });
  it('E1: every `equipment.rentals(` call in every client names its box', () => {
    const calls = CLIENT_FILES.flatMap((f) => Array.from(code(fs.readFileSync(f, 'utf8')).matchAll(/\.equipment\.rentals\(([^)]*)\)/g)).map((m) => [path.relative(APPS, f), m[1]]));
    // NAMED UPDATE (PC-56 OPS-5b, E16): OW-6's `/insights` (which read the latest 50 hires) is retired — W369 reads dairy insights only — so the
    // callers are three: web-ops the hire dashboard and the hires; mobile the owner's hires. Every one still must name its box (the loop below).
    expect(calls.length).toBeGreaterThanOrEqual(3);   // web-ops: the hire dashboard, the hires; mobile: the owner's hires
    for (const [f, args] of calls) expect([f, /\bbox\s*:\s*'(owner|renter|all)'/.test(args)]).toEqual([f, true]);
  });
});

describe('PC-56 OPS-4a · E3 · no client money math', () => {
  it('no sum, product, difference, percentage, Number(, parseFloat, Math., reduce( in any 4a source', () => {
    for (const rel of ALL_4A) {
      const src = code(read(rel));
      expect([rel, /Math\.|Number\(|parseFloat|parseInt|toFixed|\.reduce\(|BigInt\(/.test(src)]).toEqual([rel, false]);
      expect([rel, /['"`][^'"`\n]*%[^'"`\n]*['"`]/.test(src)]).toEqual([rel, false]);
      // no server figure is added, subtracted, multiplied or divided
      expect([rel, /(Minor|Quantity|engineHours|hpRating|count)\s*[-+*/]\s*[\w(]|[\w)]\s*[-+*/]\s*\w*(Minor|Quantity)\b/.test(src)]).toEqual([rel, false]);
    }
  });
  it('money goes through the formatter from the server\'s minor string only; the renter id is never printed', () => {
    const v = code(read('components/ops4/ChcViews.tsx'));
    expect(Array.from(v.matchAll(/formatMoneyMinor\(([^,]+),/g)).map((m) => m[1])).toEqual(['minor']);
    expect(/renterUserId|ownerUserId|operatorUserId|taskDesc/.test(v)).toBe(false);
  });
});

describe('PC-56 OPS-4a · E2 · the 307s, the sidebar, the edges, the chain order', () => {
  it('next.config.js redirects() carries OPS4A_REDIRECTS as 307s (permanent: false); the OW-3 pages are gone', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    const r = (await cfg.redirects()).filter((x) => x.source.startsWith('/equipment'));
    expect(r).toEqual(OPS4A_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    for (const p of Object.values(P)) expect([p, fs.existsSync(path.join(SRC, p))]).toEqual([p, true]);
  });
  // NAMED UPDATE (PC-56 OPS-4b): /chc/maintenance is BUILT now (W408), so it joins the group — the rule "built routes only" is unchanged.
  it('the sidebar: a Machinery group of the four built routes; never /equipment', () => {
    const nav = read('components/Sidebar.tsx');
    const hrefs = Array.from(nav.matchAll(/href: '([^']+)'/g)).map((m) => m[1]);
    expect(hrefs.filter((h) => h.startsWith('/chc'))).toEqual([CHC.dashboard, CHC.bookings, '/chc/maintenance', CHC.insights]);
    expect(hrefs).not.toContain('/equipment');
    expect(fs.existsSync(path.join(SRC, 'app', 'chc', 'maintenance', 'page.tsx'))).toBe(true);
    expect(nav).toMatch(/href: '\/chc\/dashboard', labelKey: 'nav\.chcDashboard', group: 'nav\.chcGroup'/);
  });
  it('W406 is drawn from each machine row (W405) and each hire\'s machine (W407); the dashboard tile points at the hire dashboard', () => {
    const v = read('components/ops4/ChcViews.tsx');
    expect((v.match(/href=\{`\$\{CHC\.detail\}\?id=\$\{encodeURIComponent\(/g) ?? []).length).toBe(2);
    expect(read('app/dashboard/page.tsx')).toContain("{ key: 'chc', href: '/chc/dashboard' }");
  });
  it('the chain states are answered BEFORE any read on every page', () => {
    for (const [p, chain] of [[P.dash, 'chc_act'], [P.bookings, 'chc_act'], [P.detail, 'equipment_act']] as const) {
      const src = code(read(p));
      expect([p, src.indexOf(`chain4State('${chain}'`) > -1 && src.indexOf(`chain4State('${chain}'`) < src.indexOf('opsClient()')]).toEqual([p, true]);
    }
  });
  it('the detail page finds the machine in the signed-in person\'s OWN list (box=mine) — never by the open asset route', () => {
    const src = code(read(P.detail));
    expect(src).toContain("c.equipment.assets({ box: 'mine', cursor, limit: DASH_LIMIT })");
    expect(/\.equipment\.asset\(/.test(src)).toBe(false);
  });
  // [lead QA, OPS-4a] the lead's mutant read `/chc/bookings` with `box: 'renter'` (the caller's OWN hires as a renter — survey F-5)
  // and every spec stayed green: "names its box" is not "names the RIGHT box". The hire pages read hires on her machines only.
  it('the hire pages read hires on the signed-in person\'s machines (box=owner) — never her own hires as a renter', () => {
    for (const p of [P.bookings, P.dash]) {
      const calls = code(read(p)).match(/\.equipment\.rentals\(\{[^}]*\}/g) ?? [];
      expect([p, calls.length > 0, calls.every((c) => /box: 'owner'/.test(c))]).toEqual([p, true, true]);
    }
  });
});

describe('PC-56 OPS-4a · the pure helpers', () => {
  it('states: 404 → off (the flag), anything else → error', () => {
    expect([chcState('ok'), chcState(404), chcState(403), chcState(500), chcState('failed')]).toEqual(['ok', 'off', 'error', 'error', 'error']);
  });
  it('quantities printed as the server sent them; nothing else', () => {
    expect([qtyText('6.00'), qtyText('6'), qtyText('6.5'), qtyText(null), qtyText('1e3')]).toEqual(['6.00', null, null, null, null]);
  });
  it('the count is a tally of rows by the server\'s status, all seven in order', () => {
    const c = countByStatus([{ status: 'requested' }, { status: 'requested' }, { status: 'settled' }, { status: 'disputed' }] as never);
    expect(c.map((x) => [x.status, x.count])).toEqual([['requested', 2], ['quoted', 0], ['confirmed', 0], ['in_progress', 0], ['completed', 0], ['settled', 1], ['cancelled', 0]]);
  });
  it('params: a known status, a short cursor, a uuid — anything else dropped', () => {
    expect([statusParam('settled'), statusParam('disputed'), statusParam(['quoted'])]).toEqual(['settled', undefined, 'quoted']);
    expect([cursorParam('MjAyNi0xMQ=='), cursorParam('a b'), cursorParam(undefined)]).toEqual(['MjAyNi0xMQ==', undefined, undefined]);
    expect([idParam('0192d2c4-0000-7000-8000-000000000001'), idParam('x')]).toEqual(['0192d2c4-0000-7000-8000-000000000001', null]);
    expect([bookingsHref(undefined), bookingsHref('settled', 'abc')]).toEqual(['/chc/bookings', '/chc/bookings?status=settled&cursor=abc']);
  });
  it('instants as the server\'s own date and minute, labelled UTC; maintenance rows as typed', () => {
    expect([atText('2027-03-10T19:00:00.000Z'), atText('2027-03-10'), atText(null)]).toEqual(['2027-03-10 19:00 UTC', null, null]);
    expect(asMaintenance([{ id: 'm1', logType: 'service', costMinor: '250000', notes: '', engineHoursAt: '1200.5', performedOn: '2026-11-01' }, { nope: 1 }]))
      .toEqual([{ id: 'm1', logType: 'service', costMinor: '250000', notes: null, engineHoursAt: '1200.5', performedOn: '2026-11-01' }]);
  });
});
