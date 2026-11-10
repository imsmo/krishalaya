// apps/web-ops/src/test/ops4c-pages.spec.ts · PC-56 OPS-4c · THE SENSORS — SOURCE ASSERTIONS, the premises, and the pure helpers.
//   READ ONLY · POSITIVE CONTROL FIRST: the three pages DO call the cold-chain reads (`subjects`, `subject`, `loggers`); then: no web-ops source calls
//              setThreshold, issueKey, registerLogger, revokeKey, recordReading (the manual reading), breachAct or decideOffer, and no server action
//              exists under app/iot;
//   Q6-A    · the premises, read from the code: sentence 1's "timed by the server" is FALSE (a signed reading carries the device's own time) — so it is
//              in no value; sentence 2 rests on E13 (the fleet and the silence read `source = 'device'`); sentence 3 on the ingest and the database
//              refusing any device but a cold-chain logger;
//   E2      · `/devices` → 307 `/iot/dashboard` (mirrors OPS4C_REDIRECTS); the fleet page is gone, the alert pages stay; the Sensors group; the chain
//              states answered BEFORE any read; each chain's Back is the page that opened it;
//   E3 / E7 · no sum, no `.reduce(`, no total; the silence threshold is the server's (no literal number in W404's view); the age is the only
//              arithmetic; the hours window is the only input;
//   the pure helpers.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_HOURS, HOURS_WINDOWS, IOT, OPS4C_REDIRECTS, SUBJECT_TYPES, atText, byType, deviceHref, hoursParam, iotState, minutesBefore, sourceKey, statusKey,
  subjectTypeParam, tempText, timeKey, uuidParam,
} from '../features/ops4/iot';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const SRC = path.join(__dirname, '..');
const REPO = path.join(SRC, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/^import type /.test(l)).join('\n');
const P = { dash: 'app/iot/dashboard/page.tsx', device: 'app/iot/device/page.tsx', health: 'app/iot/device-health/page.tsx' };
const ALL_4C = [...Object.values(P), 'components/ops4/IotViews.tsx', 'features/ops4/iot.ts'];
const walk = (dir: string): string[] => !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.name === 'node_modules' || e.name === '.next' || e.name === 'dist' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const SRC_FILES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/[\\/](test|test-render)[\\/]/.test(f));

describe('PC-56 OPS-4c · the three pages are READS (positive control first)', () => {
  it('CONTROL: each page calls its cold-chain read', () => {
    expect(code(read(P.dash))).toMatch(/\.coldChain\.subjects\(\)/);
    expect(code(read(P.dash))).toMatch(/\.coldChain\.loggers\(\)/);
    expect(code(read(P.dash))).toMatch(/\.coldChain\.breaches\(\{ limit: 1 \}\)/);
    expect(code(read(P.device))).toMatch(/\.coldChain\.subject\(type, id, \{ hours \}\)/);
    expect(code(read(P.health))).toMatch(/\.coldChain\.loggers\(\)/);
  });
  it('no web-ops source calls a cold-chain or twin WRITE (threshold, key, logger, manual reading, breach act, buyer decision, device registry)', () => {
    const WRITES = /\b(setThreshold|issueKey|registerLogger|revokeKey|recordReading|breachAct|decideOffer|exportTrail|exportBreaches|registerDevice|retireDevice)\s*\(/;
    for (const f of SRC_FILES) expect([path.relative(SRC, f), WRITES.test(code(fs.readFileSync(f, 'utf8')))]).toEqual([path.relative(SRC, f), false]);
  });
  it('no server action under app/iot; every call the 4c pages make is a GET read', () => {
    for (const f of SRC_FILES.filter((x) => /[\\/]app[\\/]iot[\\/]/.test(x))) expect([path.relative(SRC, f), /^\s*['"]use server['"]/m.test(fs.readFileSync(f, 'utf8'))]).toEqual([path.relative(SRC, f), false]);
    const calls = Object.values(P).flatMap((p) => Array.from(code(read(p)).matchAll(/\.(coldChain|twin)\.(\w+)\(/g)).map((m) => `${m[1]}.${m[2]}`));
    expect([...new Set(calls)].sort()).toEqual(['coldChain.breaches', 'coldChain.loggers', 'coldChain.subject', 'coldChain.subjects', 'twin.overview']);
  });
});

describe('PC-56 OPS-4c · Q6-A, the premises read from the code', () => {
  it('sentence 1 — "timed by the server" is FALSE: a signed reading carries the DEVICE\'s time, bounded by the database; so it is in no value', () => {
    const ingest = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/services/cold-chain-ingest.service.ts'), 'utf8');
    expect(ingest).toContain('recordedAt (the device\'s own time; buffered readings keep it)');
    expect(ingest).toMatch(/VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,'device',\$7,\$8\)`,\s*\[k\.tenant_id, k\.subject_type, k\.subject_id, d\.tempC, d\.humidityPct \?\? null, d\.recordedAt,/);
    const mig = fs.readFileSync(path.join(REPO, 'DB/migrations/0201_logistics_ops.sql'), 'utf8');
    expect(mig).toContain("IF NEW.recorded_at > now() + interval '1 minute' OR NEW.recorded_at < now() - interval '24 hours' THEN");
    expect(mig).toContain('NEW.server_recorded_at := now();');
    for (const cat of [en, hi, gu]) for (const v of Object.values(cat)) expect(/timed by the server/i.test(v)).toBe(false);
  });
  it('sentence 2 — rests on E13: the fleet and the silence read signed readings only', () => {
    const fleet = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/repositories/cold-chain-log.repository.ts'), 'utf8');
    const silent = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/repositories/ops-alert.repository.ts'), 'utf8');
    for (const [name, src, fn] of [['fleet', fleet, 'async deviceFleet'], ['silence', silent, 'async silentDevices']] as const) {
      const q = src.slice(src.indexOf(fn), src.indexOf('}', src.indexOf('return r.rows', src.indexOf(fn))));
      expect([name, q.includes("l.source = 'device'"), q.includes('l.device_id = d.id'), /device_ref/.test(q)]).toEqual([name, true, true, false]);
    }
  });
  it('sentence 3 — the ingest takes only a cold-chain logger, and the database refuses a device reading from any other kind', () => {
    const ingest = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/logistics/services/cold-chain-ingest.service.ts'), 'utf8');
    expect(ingest).toContain("k.device_kind !== 'cold_chain_logger'");
    const mig = fs.readFileSync(path.join(REPO, 'DB/migrations/0201_logistics_ops.sql'), 'utf8');
    expect(mig).toContain("IF d.tenant_id IS DISTINCT FROM NEW.tenant_id OR d.kind_code <> 'cold_chain_logger' THEN");
  });
});

describe('PC-56 OPS-4c · E2 · the 307, the sidebar, the edges, the chain order', () => {
  it('next.config.js redirects() carries OPS4C_REDIRECTS as a 307 (permanent: false); the fleet page is gone; the alert pages stay', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(SRC, '..', 'next.config.js')) as { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    expect((await cfg.redirects()).filter((x) => x.source === '/devices' || x.source.startsWith('/devices/'))).toEqual(OPS4C_REDIRECTS.map((x) => ({ ...x, permanent: false })));
    expect(fs.existsSync(path.join(SRC, 'app/devices/page.tsx'))).toBe(false);
    for (const p of ['app/devices/rules/page.tsx', 'app/devices/alerts/page.tsx', ...Object.values(P)]) expect([p, fs.existsSync(path.join(SRC, p))]).toEqual([p, true]);
    for (const p of ['app/devices/rules/page.tsx', 'app/devices/alerts/page.tsx']) expect([p, /href="\/devices"/.test(read(p))]).toEqual([p, false]);
    expect(read('app/dashboard/page.tsx')).toContain("{ key: 'devices', href: '/iot/dashboard' }");
  });
  it('the sidebar: a Sensors group of the two built sensor routes, then the alert pages; never /devices itself', () => {
    const nav = read('components/Sidebar.tsx');
    expect(nav).toMatch(/\{ href: '\/iot\/dashboard', labelKey: 'nav\.iotDashboard', group: 'nav\.iotGroup' \}/);
    expect(nav).toMatch(/\{ href: '\/iot\/device-health', labelKey: 'nav\.iotHealth', sub: true \}/);
    expect(/href: '\/devices'/.test(nav)).toBe(false);
    expect(/href: '\/iot\/device'[,}]/.test(nav)).toBe(false);   // W401 is reached from a subject, never from the nav
    expect([en['nav.iotGroup'], en['nav.iotDashboard'], en['nav.iotHealth']]).toEqual(['Sensors', 'Sensor dashboard', 'Device health']);
  });
  it('the chain states are answered BEFORE any read; each chain\'s Back is the page that opened it (W404 → W404, never the dashboard)', () => {
    for (const [p, chain] of [[P.dash, 'iot_act'], [P.device, 'iot_act'], [P.health, 'device_act']] as const) {
      const s = code(read(p));
      expect([p, s.indexOf(`chain4State('${chain}'`) > -1 && s.indexOf(`chain4State('${chain}'`) < s.indexOf('opsClient()')]).toEqual([p, true]);
    }
    expect(code(read(P.health))).toMatch(/<Ops4Chain t=\{t\} chain="device_act" state=\{act\} page=\{IOT\.health\} \/>/);
    expect(code(read(P.dash))).toMatch(/<Ops4Chain t=\{t\} chain="iot_act" state=\{act\} page=\{IOT\.dashboard\} \/>/);
    expect(code(read(P.device))).toMatch(/<Ops4Chain t=\{t\} chain="iot_act" state=\{act\} page=\{type && id \? deviceHref\(type, id, hours\) : IOT\.device\} \/>/);
    expect(IOT).toEqual({ dashboard: '/iot/dashboard', device: '/iot/device', health: '/iot/device-health' });
  });
});

describe('PC-56 OPS-4c · E3 / E7 · nothing summed; the threshold is the server\'s; one input', () => {
  it('no sum, total, reduce, percentage or parse in any 4c source; the only arithmetic is the age (one Math.floor, in minutesBefore)', () => {
    for (const rel of ALL_4C) {
      const src = code(read(rel));
      expect([rel, /\.reduce\(|parseFloat|parseInt|toFixed|BigInt\(|\.length\s*[-+*/]|[-+*/]\s*\w+\.length\b/.test(src)]).toEqual([rel, false]);
      expect([rel, /['"`][^'"`\n]*%[^'"`\n]*['"`]/.test(src)]).toEqual([rel, false]);
    }
    const iot = code(read('features/ops4/iot.ts'));
    expect((iot.match(/Math\./g) ?? []).length).toBe(1);
    expect(iot.slice(iot.indexOf('export function minutesBefore'))).toMatch(/^[^]*?Math\.floor\(\(readAtMs - at\) \/ 60_000\)/);
    expect(/Math\./.test(code(read('components/ops4/IotViews.tsx')))).toBe(false);
  });
  it('the silence threshold is never written in the page: W404\'s view and page carry no minutes literal, and read `silenceMinutes`', () => {
    const v = code(read('components/ops4/IotViews.tsx'));
    const health = v.slice(v.indexOf('export function IotHealthView'));
    expect(/\b1[05]\b|\b30\b|COLD_CHAIN_SILENCE/.test(health)).toBe(false);
    expect(health).toMatch(/t\.t\('ops4\.iot\.health\.threshold', \{ minutes: silenceMinutes \}\)/);
    expect(code(read(P.health))).toMatch(/silenceMinutes = typeof r\.silenceMinutes === 'number' \? r\.silenceMinutes : null/);
  });
  it('a reading\'s source decides its words in ONE place; the view never labels a reading without it', () => {
    const v = code(read('components/ops4/IotViews.tsx'));
    expect(/'ops4\.iot\.source\.(device|manual)'/.test(v)).toBe(false);   // only via sourceKey()
    expect((v.match(/sourceKey\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('no person: the logger\'s typed label, a breach note, an issuer or a typed device reference is never read into the view', () => {
    const v = code(read('components/ops4/IotViews.tsx'));
    expect(/\.label\b(?!\))/.test(v.replace(/r\.label|detail\.label/g, ''))).toBe(false);
    expect(/actionNote|outcomeReason|issuedBy|deviceRef|setBy|\.reason\b/.test(v)).toBe(false);
  });
});

describe('PC-56 OPS-4c · the pure helpers', () => {
  const ID = '0192d2c4-c001-7000-8000-000000000c01';
  it('the GET filters: a known window (else 48), a known subject type, a uuid', () => {
    expect([hoursParam('6'), hoursParam('168'), hoursParam('7'), hoursParam(undefined), hoursParam(['24', '6'])]).toEqual([6, 168, DEFAULT_HOURS, 48, 24]);
    expect(HOURS_WINDOWS).toEqual([6, 24, 48, 168]);
    expect([subjectTypeParam('vaccine_box'), subjectTypeParam('soil_pod'), subjectTypeParam(undefined)]).toEqual(['vaccine_box', null, null]);
    expect([uuidParam(ID), uuidParam('x'), uuidParam(undefined)]).toEqual([ID, null, null]);
    expect(SUBJECT_TYPES).toEqual(['bmc_unit', 'shipment', 'warehouse_chamber', 'vaccine_box']);
  });
  it('W401\'s address keeps the subject (and a non-default window)', () => {
    expect(deviceHref('bmc_unit', ID)).toBe(`/iot/device?type=bmc_unit&id=${ID}`);
    expect(deviceHref('shipment', ID, 24)).toBe(`/iot/device?type=shipment&id=${ID}&hours=24`);
    expect(deviceHref('shipment', ID, 48)).toBe(`/iot/device?type=shipment&id=${ID}`);
  });
  it('the source words: "from the logger" ONLY for device; "typed by a person" for manual; never guessed', () => {
    expect([sourceKey('device'), sourceKey('manual'), sourceKey(null), sourceKey('DEVICE')]).toEqual(['ops4.iot.source.device', 'ops4.iot.source.manual', 'ops4.iot.source.unknown', 'ops4.iot.source.unknown']);
    expect([en['ops4.iot.source.device'], en['ops4.iot.source.manual']]).toEqual(['from the logger', 'typed by a person']);
    expect([timeKey('device'), timeKey('manual')]).toEqual(['ops4.iot.time.device', 'ops4.iot.time.manual']);
    expect([en['ops4.iot.time.device'], en['ops4.iot.time.manual'], en['ops4.iot.received']]).toEqual(['the device\'s time {at}', 'the time the person recorded it {at}', 'received by the server {at}']);
  });
  it('the age in whole minutes before the read; never negative; null without a time', () => {
    const at = Date.parse('2026-11-10T03:00:00.000Z');
    expect([minutesBefore('2026-11-10T02:48:00.000Z', at), minutesBefore('2026-11-10T02:59:59.000Z', at), minutesBefore('2026-11-10T03:05:00.000Z', at), minutesBefore(null, at), minutesBefore('x', at)])
      .toEqual([12, 0, null, null, null]);
  });
  it('states; the server\'s statuses; temperatures and times as sent; grouping without counting', () => {
    expect([iotState('ok'), iotState(404), iotState(403), iotState(500), iotState('failed')]).toEqual(['ok', 'off', 'forbidden', 'error', 'error']);
    expect([statusKey('silent'), statusKey('online')]).toEqual(['ops4.iot.status.silent', 'ops4.iot.status.unknown']);
    expect([tempText('4.20'), tempText(-18), tempText('4.2.1'), tempText(null)]).toEqual(['4.20', '-18', null, null]);
    expect([atText('2026-11-10T02:48:00.000Z'), atText('2026-11-10T08:18:00+05:30')]).toEqual(['2026-11-10 02:48 UTC', null]);
    expect(byType([{ subjectType: 'shipment', n: 1 }, { subjectType: 'bmc_unit', n: 2 }, { subjectType: 'soil_pod', n: 3 }]))
      .toEqual([{ type: 'bmc_unit', rows: [{ subjectType: 'bmc_unit', n: 2 }] }, { type: 'shipment', rows: [{ subjectType: 'shipment', n: 1 }] }]);
  });
});
