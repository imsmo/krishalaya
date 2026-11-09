// apps/web-ops/src/test/ops3b-pages.spec.ts · PC-56 OPS-3b — SOURCE ASSERTIONS for `/bmc` (W366) and its two chains:
//   E2  · the page reads exactly `counterCentres()` and `bmcMonitor({ hours })` (+ `bmcMonitor({ unitId, hours })` for the SHOWN cooler's series);
//         its chain states that read nothing are checked BEFORE any read; the action's one write is `recordBmcReading({ unitId, tempC })` — no
//         `recordedAt` (OPS3-B17); the sidebar links `/bmc` and the page exists;
//   E3  · no client math on /bmc: no `%`, average, variance, `Math.`, `Number(`, `parseFloat`, arithmetic on a figure, and the tile's fill ratio is
//         never read;
//   Q12-A · no web-ops source calls a cooler SETTING (band, level, compressor, retire, register, call) — this console reads the cooler and records
//         manual readings only;
//   E7  · the only visible input is the manual reading's temperature;
//   the pure helpers: the temperature pattern IS the API's (read from its file), custody filtering, the page state, the kept answer checked on the
//   way back in.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bmcState, coolersFor, decodeReading, encodeReading, parseTemp, pickCooler } from '../features/ops3/bmc';
import { pourFailureReason } from '../features/ops3/counter';

const SRC = path.join(__dirname, '..');
const API = path.join(SRC, '..', '..', 'api', 'src', 'modules', 'dairy');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const PAGE = 'app/bmc/page.tsx'; const ACTION = 'app/bmc/actions.ts'; const VIEW = 'components/ops3/BmcViews.tsx'; const FEAT = 'features/ops3/bmc.ts';
const ALL_3B = [PAGE, ACTION, VIEW, FEAT];
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const tile = (unitId: string, mccId: string) => ({ unitId, mccId }) as never;

describe('PC-56 OPS-3b · E2 · the reads and the one write, exactly', () => {
  it('the page reads mccs/mine and the monitor only (the series by the shown cooler\'s id); nothing else', () => {
    const page = code(read(PAGE));
    expect(Array.from(page.matchAll(/c\.dairy\.(\w+)\(([^)]*)\)/g)).map((m) => `${m[1]}(${m[2]})`)).toEqual([
      'counterCentres()', 'bmcMonitor({ hours: SERIES_HOURS })', 'bmcMonitor({ unitId: cooler.unitId, hours: SERIES_HOURS })']);
    expect(/c\.(request|warehousing|catalogue|wallet|payouts)\b/.test(page)).toBe(false);
    expect(/\.dairy\.(listMemberships|recordCollection|listBmcUnits|getBmcUnit)/.test(page)).toBe(false);
  });
  it('the chain states that read nothing (act, failure, success) are answered BEFORE the first read', () => {
    const page = code(read(PAGE));
    for (const st of ["chain3State('bmc_act'", "form === 'failure'", "form === 'success'"]) expect([st, page.indexOf(st) > -1 && page.indexOf(st) < page.indexOf('opsClient()')]).toEqual([st, true]);
  });
  it('the action\'s one write: recordBmcReading({ unitId, tempC }) — no recordedAt, no key, no other dairy call', () => {
    const act = code(read(ACTION));
    expect(Array.from(act.matchAll(/\.dairy\.(\w+)\(([^)]*)\)/g)).map((m) => `${m[1]}(${m[2]})`)).toEqual(['recordBmcReading({ unitId: unit, tempC })']);
    expect(/recordedAt\s*:|recordedAt\s*=/.test(act.replace(/recordedAt: String\(rec\.recordedAt\)/, ''))).toBe(false);
    expect(act.indexOf("redirect(`${BMC}?form=success")).toBeGreaterThan(act.indexOf('cookies().set('));
  });
  it('the sidebar links /bmc in the Dairy group, and the page exists', () => {
    const nav = read('components/Sidebar.tsx');
    expect(nav).toMatch(/href: '\/bmc', labelKey: 'nav\.bmc', sub: true/);
    expect(fs.existsSync(path.join(SRC, 'app', 'bmc', 'page.tsx'))).toBe(true);
  });
});

describe('PC-56 OPS-3b · E3 · no client math on /bmc', () => {
  it('no %, average, variance, Math., Number(, parseFloat, toFixed; the fill ratio is never read; no arithmetic on a figure', () => {
    for (const rel of ALL_3B) {
      const src = code(read(rel));
      expect([rel, /fillPct/.test(src)]).toEqual([rel, false]);
      expect([rel, /Math\.|Number\(|parseFloat|parseInt|toFixed|\baverage\b|\bavg\b|variance/i.test(src)]).toEqual([rel, false]);
      expect([rel, /['"`][^'"`\n]*%[^'"`\n]*['"`]/.test(src)]).toEqual([rel, false]);
      // no figure from a tile, a point or the reading is added, subtracted, multiplied or divided
      expect([rel, /(tempC|capacityLitres|volumeLitres|readings24h|breaches24h|ageMinutes|minC|maxC)\s*[-+*/]\s*[\w(]/.test(src)]).toEqual([rel, false]);
    }
  });
});

describe('PC-56 OPS-3b · Q12-A · this console reads the cooler and records manual readings only', () => {
  it('no web-ops source calls a cooler setting or a dispatch', () => {
    for (const f of walk(path.join(SRC, 'app')).concat(walk(path.join(SRC, 'components')), walk(path.join(SRC, 'features'))).filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = code(fs.readFileSync(f, 'utf8'));
      expect([path.relative(SRC, f), /\.(setBmcBand|reportBmcLevel|stateBmcCompressor|retireBmcUnit|registerBmcUnit|callBmcOperator|previewBmcCall|previewBmcUnit)\(/.test(src)]).toEqual([path.relative(SRC, f), false]);
      // no method call and no route path names a dispatch, a tanker or a manifest (a refusal's key or marker may NAME the act)
      expect([path.relative(SRC, f), /\.\w*(dispatch|tanker|manifest)\w*\s*\(|['"`][^'"`]*\/(dispatch|tankers?|manifests?)\b/i.test(src)]).toEqual([path.relative(SRC, f), false]);
    }
  });
  it('E7: the only visible input in the 3b views is the manual reading\'s temperature', () => {
    const view = read(VIEW);
    const visibleInputs = Array.from(view.matchAll(/<input\b[^>]*>/g)).map((m) => m[0]).filter((x) => !/type="hidden"/.test(x));
    expect(visibleInputs.length).toBe(1); expect(visibleInputs[0]).toContain('name="tempC"');
    expect(/<select|<textarea|type="file"/.test(view)).toBe(false);
  });
});

describe('PC-56 OPS-3b · the pure helpers', () => {
  it('the temperature pattern IS the API\'s (bmc.dto.ts), and the value is kept as typed', () => {
    const dto = fs.readFileSync(path.join(API, 'dto', 'bmc.dto.ts'), 'utf8');
    expect(dto).toContain("const tempC = z.string().regex(/^-?\\d{1,3}(\\.\\d)?$/");
    expect(read(FEAT)).toContain('const TEMP = /^-?\\d{1,3}(\\.\\d)?$/;');
    expect([parseTemp('3.8'), parseTemp('-2'), parseTemp('3.85'), parseTemp('abc'), parseTemp('1234'), parseTemp(' 4.0 ')]).toEqual(['3.8', '-2', null, null, null, '4.0']);
  });
  it('custody filtering: the custody centres\' coolers only; no custody → the organisation\'s, labelled', () => {
    const tiles = [tile('u1', 'c1'), tile('u2', 'c2')];
    expect(coolersFor(tiles, [{ id: 'c1' } as never])).toEqual({ scope: 'custody', tiles: [tiles[0]] });
    expect(coolersFor(tiles, [])).toEqual({ scope: 'organisation', tiles });
    expect(pickCooler([tiles[0]], 'u2')).toBe(tiles[0]);   // a cooler not shown is never picked by its id
  });
  it('the page state: dairy off (404 on mine), monitor off (404 on the monitor), forbidden, error, ok', () => {
    expect([bmcState(404, 'ok'), bmcState('ok', 404), bmcState(403, 'ok'), bmcState('ok', 403), bmcState('ok', 500), bmcState('failed', 'ok'), bmcState('ok', 'ok')])
      .toEqual(['off', 'monitorOff', 'forbidden', 'forbidden', 'error', 'error', 'ok']);
  });
  it('L1 on the counter: the API\'s custody refusal of a pour is named "custody" on the pos chain, not a generic permission refusal', () => {
    expect([pourFailureReason(403, 'DAIRY_CENTRE_NOT_IN_CUSTODY'), pourFailureReason(403, 'FORBIDDEN')]).toEqual(['custody', 'forbidden']);
  });
  it('the kept answer is checked on the way back in: a tampered one shows nothing', () => {
    const ok = { unitId: '0192d2c4-b0b0-7000-8000-0000000000a1', tempC: '5.2', verdict: 'above_band' as const, recordedAt: '2026-11-09T03:10:44.000Z', band: { minC: '2.0', maxC: '4.5' } };
    expect(decodeReading(encodeReading(ok))).toEqual(ok);
    expect(decodeReading(encodeReading({ ...ok, verdict: 'fine' as never }))).toBeNull();
    expect(decodeReading(encodeReading({ ...ok, tempC: '5.25' }))).toBeNull();
    expect(decodeReading('not-base64')).toBeNull();
  });
});
