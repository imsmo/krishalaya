// modules/logistics/__tests__/ops4c-sensors.spec.ts · PC-56 OPS-4c · THE SENSORS — the first commit's unit proof (OPS4-B8 / E13, survey C-12).
//   THE FLEET  · `ColdChainLogRepository.deviceFleet` reads the logger registry joined to its SIGNED readings (`source='device'`, by
//                `device_id`) — never `device_ref` (the label only a MANUAL reading writes); spy on the SQL and on the row shape.
//   THE SILENCE· `OpsAlertRepository.silentDevices` likewise; the minutes arithmetic of TENANT-6d-5 is unchanged; the gap is measured from
//                `server_recorded_at` (when the server received the reading).
//   THE ALERT  · `device_silent` names the LOGGER by its serial, from the repository's rows — never a typed reference.
//   ABSENCE    · no battery, calibration, cadence or sync route exists on any logistics or twin controller.
//   MANUAL     · a manual reading is written `source = 'manual'` at the database's `now()` — it carries no device id (0201's CHECK
//                ck_ccl_source ties `device_id` to `source = 'device'`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ColdChainLogRepository } from '../repositories/cold-chain-log.repository';
import { OpsAlertRepository } from '../repositories/ops-alert.repository';
import { OpsAlertService } from '../services/ops-alert.service';

function spyReplica(rows: unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const replica = { forTenant: (_t: string) => ({ query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows }; } }) };
  return { replica, calls };
}
const flat = (sql: string) => sql.replace(/\s+/g, ' ');
const MIG = path.join(__dirname, '../../../../../../DB/migrations/0201_logistics_ops.sql');

describe('PC-56 OPS-4c · E13 · the fleet reads SIGNED readings only', () => {
  it('joins the logger registry to its own device readings by device_id, source = device; never device_ref', async () => {
    const at = new Date('2026-11-10T02:00:00Z');
    const { replica, calls } = spyReplica([{ device_id: 'd-1', serial: 'LOG-1', label: null, last_seen: at, readings_24h: 3, breaches_24h: 0, last_temp_c: '4.20' }]);
    const out = await new ColdChainLogRepository(replica as never).deviceFleet('t1');
    expect(out).toEqual([{ deviceId: 'd-1', serial: 'LOG-1', label: null, lastSeen: at.toISOString(), readings24h: 3, breaches24h: 0, lastTempC: '4.20' }]);
    const q = flat(calls[0].sql);
    expect(q).toContain('FROM twin_devices d');
    expect(q).toContain("d.kind_code = 'cold_chain_logger'");
    expect(q).toContain('l.device_id = d.id');
    expect(q).toContain("l.source = 'device'");
    expect(q).toContain('l.tenant_id = d.tenant_id');
    expect(q).toContain('d.tenant_id=$1');
    expect(q).toContain('MAX(l.server_recorded_at) AS last_seen');
    expect(q).toMatch(/GROUP BY d\.id/);
    expect(q).not.toMatch(/device_ref/);                       // the typed label is retired from the fleet
    expect(calls[0].params).toEqual(['t1']);
    expect(Object.keys(out[0])).not.toContain('deviceRef');
  });
});

describe('PC-56 OPS-4c · E13 · the device_silent evidence reads SIGNED readings only', () => {
  it('registered loggers, source = device, by device_id, measured from server_recorded_at, in MINUTES; never device_ref', async () => {
    const at = new Date('2026-11-10T02:00:00Z');
    const { replica, calls } = spyReplica([{ device_id: 'd-1', serial: 'LOG-1', last_seen: at, silent_minutes: 20 }]);
    const out = await new OpsAlertRepository(replica as never).silentDevices('t1', 15);
    expect(out).toEqual([{ deviceId: 'd-1', serial: 'LOG-1', lastSeen: at.toISOString(), silentMinutes: 20 }]);
    const q = flat(calls[0].sql);
    expect(q).toContain("l.source = 'device'");
    expect(q).toContain('l.device_id = d.id');
    expect(q).toContain("d.kind_code = 'cold_chain_logger' AND d.status = 'registered'");
    expect(q).toContain("HAVING MAX(l.server_recorded_at) < now() - ($2 || ' minutes')::interval");
    expect(q).toContain('/ 60)::int AS silent_minutes');
    expect(q).not.toMatch(/device_ref/);
    expect(q).not.toMatch(/subject_id|subject_type/);           // a manual reading on the logger's subject never counts
    expect(calls[0].params).toEqual(['t1', '15']);
  });
});

describe('PC-56 OPS-4c · E13 · the alert names the logger', () => {
  it('device_silent: subjectRef is the logger\'s serial; the body says "Logger … has not reported for N min"', async () => {
    const repo = {
      activeRulesForTenant: jest.fn(async () => [{ id: 'r-1', kind: 'device_silent', ruleName: 'silence', threshold: { silentMinutes: 15 }, recipientUserIds: ['op-1'], channelHint: null, cooldownMinutes: 5 }]),
      silentDevices: jest.fn(async () => [{ deviceId: 'd-9', serial: 'LOG-9', lastSeen: '2026-11-10T02:00:00.000Z', silentMinutes: 25 }]),
      recordFired: jest.fn(async () => true),
      touchEvaluated: jest.fn(async () => undefined),
    };
    const outbox = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    await new OpsAlertService(uow as never, outbox as never, repo as never).evaluateTenant('t1');
    const [, ev] = outbox.write.mock.calls[0] as unknown as [unknown, { payload: Record<string, any> }];
    expect(ev.payload.subjectRef).toBe('LOG-9');
    expect(ev.payload.body).toBe('Logger LOG-9 has not reported for 25 min (last signed reading received 2026-11-10T02:00:00.000Z).');
    expect(ev.payload.detail).toMatchObject({ deviceId: 'd-9', silentMinutes: 25, thresholdMinutes: 15 });
    expect(/Sensor /.test(ev.payload.body)).toBe(false);
  });
});

describe('PC-56 OPS-4c · absence: no battery, calibration, cadence or sync route', () => {
  const dirs = ['../controllers/v1', '../../twin/controllers/v1'].map((d) => path.join(__dirname, d));
  it('no controller decorator path names battery, calibration, cadence or sync (positive control: the loggers route is found)', () => {
    const decorators = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.ts')).flatMap((f) =>
      Array.from(fs.readFileSync(path.join(d, f), 'utf8').matchAll(/@(Get|Post|Put|Patch|Delete|Controller)\(([^)]*)\)/g)).map((m) => m[2])));
    expect(decorators.some((p) => /'loggers'/.test(p))).toBe(true);
    for (const p of decorators) expect([p, /batter|calibrat|cadence|sync/i.test(p)]).toEqual([p, false]);
  });
  it('no column for a battery level or a calibration date exists in any migration', () => {
    const dir = path.dirname(MIG);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      expect([f, /\bbattery\w*\s+(smallint|integer|numeric|int|text|varchar)|calibrat\w*_(at|on|due)\b/i.test(sql)]).toEqual([f, false]);
    }
  });
});

describe('PC-56 OPS-4c · a manual reading carries no device', () => {
  it('insertManual writes source = manual at the database\'s now(), never a device id; 0201 ties device_id to source = device', () => {
    const src = fs.readFileSync(path.join(__dirname, '../repositories/cold-chain-log.repository.ts'), 'utf8');
    const ins = flat(src.slice(src.indexOf('async insertManual'), src.indexOf('async listForSubject')));
    expect(ins).toContain("VALUES ($1,$2,$3,$4,$5,$6, now(), 'manual')");
    expect(ins).not.toMatch(/device_id/);
    expect(flat(fs.readFileSync(MIG, 'utf8'))).toContain("CHECK (source IN ('device', 'manual') AND ((source = 'device') = (device_id IS NOT NULL)))");
  });
});
