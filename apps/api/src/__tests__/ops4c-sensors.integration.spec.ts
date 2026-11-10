// apps/api/src/__tests__/ops4c-sensors.integration.spec.ts · PC-56 OPS-4c · THE SENSORS, LIVE. The real AppModule over HTTP (listening ONCE on
// 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS + 0201, the device ingest over raw HTTP with a real HMAC on the kv_ingest pool, the
// cold-chain watch job on a kv_relay pool. No migration (238).
// FLAGS: `logistics`, `cold_chain_device_ingest` and `digital_twin` are seeded OFF and switched ON for THIS organisation only (an allow-list
// fixture, `rules.tenant_ids`), restored in afterAll — every cold-chain route answers 404 otherwise, the ingest refuses, and the soil pod's
// registry lives behind `digital_twin`.
//
// Brief §C (survey §7's ops4c items), verbatim:
//   • a signed reading from a registered logger appears in the fleet and resets its silence;
//   • a MANUAL reading carrying the cooler's `iot_device_ref` does NOT appear as a device heard from and does NOT satisfy `device_silent`
//     (red at 2184d57c: the fleet and the rule grouped that typed reference);
//   • a device reading with `recorded_at` 2 h ahead → COLD_CHAIN_DEVICE_TIME; a manual reading with a body time → refused;
//   • `twin_devices.last_reading_at` stays NULL for a soil pod;
//   • absence → 404: GET …/devices/:id/battery, …/calibration, POST …/sync;
//   • plus: a logger falling silent while a person keeps typing → the silence stands and the alert fires (the canon's own law, W404:41).
// Run under TZ=Asia/Kolkata and TZ=UTC: every time here is the database's or the server's clock, never the process's local day.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { signIngest } from '../modules/logistics/domain/logistics-ops';
import { ColdChainWatchJob } from '../modules/logistics/jobs/logistics-ops.jobs';
import { OpsAlertRepository } from '../modules/logistics/repositories/ops-alert.repository';
import { BmcReadingService } from '../modules/dairy/services/bmc-reading.service';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;

run('PC-56 OPS-4c · the sensors (integration, real AppModule over HTTP, signed ingest)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let base = ''; let cache: CacheService;
  const T = randomUUID();
  let ADM = ''; let tok = '';
  let cooler = ''; let logger = ''; let key = ''; let pod = '';
  const SERIAL = `LOG-4C-${randomUUID().slice(0, 6)}`;
  const COOLER_REF = `COOLER-REF-${randomUUID().slice(0, 6)}`;   // the cooler's typed sensor reference — a label, not a device
  let seq = 1;
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const api = async (method: string, path: string, body?: unknown, idemKey?: string) => {
    const res = await fetch(`${base}/v1/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'x-tenant-id': T, ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, data: json.data, code: json.error?.code ?? null, raw: JSON.stringify(json) };
  };
  const ingest = async (body: Record<string, unknown>, device = logger) => {
    const raw = JSON.stringify(body); const ts = String(Math.floor(Date.now() / 1000)); const nonce = `n${randomUUID().replace(/-/g, '')}`;
    const res = await fetch(`${base}/v1/ingest/cold-chain/readings`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-kv-device': device,
      'x-kv-timestamp': ts, 'x-kv-nonce': nonce, 'x-kv-signature': signIngest(key, ts, nonce, raw) } });
    const json = await res.json().catch(() => ({})) as { error?: { code?: string } };
    return { status: res.status, code: json.error?.code ?? null };
  };
  const reading = (tempC: number, minutesFromNow = 0) => ({ tempC, recordedAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(), sequenceNo: seq++ });
  /** The logger was last heard twenty minutes ago (the server's receipt clock, and the registry's copy of it — what the job reads). */
  const quietFor20 = async () => {
    await admin.query(`UPDATE cold_chain_logs SET server_recorded_at = server_recorded_at - interval '20 minutes' WHERE tenant_id=$1 AND device_id=$2 AND recorded_at >= now() - interval '2 days'`, [T, logger]);
    await admin.query(`UPDATE twin_devices SET last_reading_at = last_reading_at - interval '20 minutes' WHERE id=$1`, [logger]);
  };
  const fleet = async () => (await api('GET', 'logistics/cold-chain/devices')).data as Array<Record<string, unknown>>;
  const silent15 = () => app.get(OpsAlertRepository).silentDevices(T, 15);
  const typeByHand = (tempC: string) => app.get(BmcReadingService).record(T, { userId: ADM, canManage: true } as never, { deviceRef: COOLER_REF, tempC });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    await admin.query(`ALTER ROLE kv_ingest WITH LOGIN PASSWORD 'dev'`);   // same statement as db/local/local-login-roles.sql
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2 });
    process.env.INGEST_DATABASE_URL = as('kv_ingest');

    await makeTenant(admin, T, `OPS4C ${T.slice(0, 4)}`);
    ADM = await makeUser(admin);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin' ON CONFLICT DO NOTHING`, [ADM, T]);
    // the flags under test: seeded OFF, ON for THIS organisation only (allow-list), restored in afterAll
    for (const flag of ['logistics', 'cold_chain_device_ingest', 'digital_twin']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [flag])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([flag, false]);
      backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [flag, JSON.stringify({ tenant_ids: [T] })]);
    }
    // a cooler at a centre, carrying a typed sensor reference (the fixture superuser, as the dairy desk would register it)
    const mcc = (await q1(`INSERT INTO mcc_centres (tenant_id, code, default_name) VALUES ($1, $2, 'Test centre') RETURNING id`, [T, `MCC-4C-${T.slice(0, 4)}`])).id;
    cooler = (await q1(`INSERT INTO bmc_units (tenant_id, mcc_id, capacity_litres, target_temp_c, iot_device_ref) VALUES ($1, $2, 2000, 4.0, $3) RETURNING id`, [T, mcc, COOLER_REF])).id;

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cache = app.get<CacheService>(CACHE_SERVICE);
    for (const f of ['logistics', 'cold_chain_device_ingest', 'digital_twin']) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
    const perms = (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'tenant_admin'`)).rows.map((x) => x.permission_code as string);
    tok = mintToken(app, { userId: ADM, tenantId: T, perms, roles: ['tenant_admin'] });

    // a registered logger, its key bound to the cooler (shown once)
    const reg = await api('POST', 'logistics/cold-chain/loggers', { serial: SERIAL, label: 'Cooler logger' }, idem());
    expect(reg.status).toBe(201);
    logger = reg.data.id;
    const k = await api('POST', `logistics/cold-chain/loggers/${logger}/keys`, { subjectType: 'bmc_unit', subjectId: cooler, reason: 'Logger mounted on the test cooler' }, idem());
    expect(k.data.keyShown).toBe(true);
    key = k.data.key;
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id=$1`, [T]).catch(() => undefined);
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    for (const f of ['logistics', 'cold_chain_device_ingest', 'digital_twin']) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache?.del(c).catch(() => undefined);
    await app?.close().catch(() => undefined); await relayPool?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  it('a MANUAL reading carrying the cooler\'s sensor reference does NOT appear as a device heard from (the fleet is the registered loggers\' signed readings)', async () => {
    const typed = await typeByHand('4.0');
    expect(typed).toMatchObject({ unitId: cooler, tempC: '4.0' });   // the dairy desk's answer (it does not name the source; the row below does)
    // the row a person typed carries the cooler's reference as a label — and no device (0201's ck_ccl_source)
    expect(await q1(`SELECT source, device_id, device_ref FROM cold_chain_logs WHERE tenant_id=$1 AND subject_id=$2 AND recorded_at >= now() - interval '1 hour' ORDER BY id DESC LIMIT 1`, [T, cooler]))
      .toEqual({ source: 'manual', device_id: null, device_ref: COOLER_REF });
    const f = await fleet();
    expect(JSON.stringify(f)).not.toContain(COOLER_REF);                  // red at 2184d57c: `{ deviceRef: COOLER-REF-… }` was a "sensor heard from"
    expect(f.find((r) => r.deviceId === logger)).toBeUndefined();        // the logger has sent nothing signed yet
    // and its registry row: never heard from
    expect((await q1(`SELECT last_reading_at FROM twin_devices WHERE id=$1`, [logger])).last_reading_at).toBeNull();
  });

  it('a SIGNED reading from the registered logger appears in the fleet (its serial, the server\'s receipt time)', async () => {
    const ok = await ingest(reading(4.2));
    expect(ok).toMatchObject({ status: 201 });
    const row = (await fleet()).find((r) => r.deviceId === logger);
    expect(row).toMatchObject({ deviceId: logger, serial: SERIAL, readings24h: 1, breaches24h: 0, lastTempC: '4.20' });
    expect(Object.keys(row as object)).not.toContain('deviceRef');
    const srv = await q1(`SELECT server_recorded_at FROM cold_chain_logs WHERE tenant_id=$1 AND device_id=$2 ORDER BY id DESC LIMIT 1`, [T, logger]);
    expect(row!.lastSeen).toBe(new Date(srv.server_recorded_at).toISOString());
    // the overview names the cooler's logger by its serial and labels the latest reading's source
    const ov = await api('GET', 'logistics/cold-chain/subjects');
    expect(ov.data.items.find((x: any) => x.subjectId === cooler)).toMatchObject({ device: { id: logger, serial: SERIAL }, now: { source: 'device' } });   // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('a manual reading does NOT satisfy device_silent: the logger quiet for 20 minutes stays silent while a person types (red at 2184d57c)', async () => {
    await quietFor20();
    await typeByHand('4.1');                                              // a person types against the cooler, NOW
    await api('POST', 'logistics/cold-chain/readings', { subjectType: 'bmc_unit', subjectId: cooler, tempC: 4.1, deviceRef: SERIAL });   // and one typed with the logger's own serial
    const rows = await silent15();
    const mine = rows.find((r) => r.deviceId === logger);
    expect(mine).toBeDefined();                                          // red at 2184d57c: the rule never saw the logger at all
    expect(mine!.serial).toBe(SERIAL);
    expect(mine!.silentMinutes).toBeGreaterThanOrEqual(19);
    expect(JSON.stringify(rows)).not.toContain(COOLER_REF);
    // the fleet still dates the logger by its last SIGNED reading — twenty minutes ago — not by the typing
    const f = (await fleet()).find((r) => r.deviceId === logger)!;
    expect(Date.now() - Date.parse(String(f.lastSeen))).toBeGreaterThanOrEqual(19 * 60_000);
  });

  it('THE CANON\'S LAW (W404:41): the logger falls silent while a person keeps typing → the silence stands and the alert fires', async () => {
    const rule = await api('POST', 'logistics/cold-chain/alert-rules', { kind: 'device_silent', ruleName: 'Logger quiet 15 min', threshold: { silentMinutes: 15 }, recipientUserIds: [ADM] });
    expect(rule.status).toBe(201);
    // the server's own silence (the watch job reads twin_devices.last_reading_at, which only a signed reading writes)
    expect(await app.get(ColdChainWatchJob).sweep(relayPool, [T])).toMatchObject({ silences: 1, failed: 0 });
    for (const t of ['4.0', '3.9', '4.2']) await typeByHand(t);          // a person keeps typing
    expect(Number((await q1(`SELECT count(*)::int n FROM cold_chain_device_silences WHERE device_id=$1 AND resolved_at IS NULL`, [logger])).n)).toBe(1);
    const ev = await api('POST', 'logistics/cold-chain/alert-rules/evaluate');
    expect(ev.data.fired).toBeGreaterThanOrEqual(1);
    const fired = await q1(`SELECT subject_ref, detail FROM ops_fired_alerts WHERE tenant_id=$1 AND kind='device_silent' AND rule_id IS NOT NULL ORDER BY fired_at DESC LIMIT 1`, [T]);
    expect(fired.subject_ref).toBe(SERIAL);
    expect(fired.detail).toMatchObject({ deviceId: logger, thresholdMinutes: 15 });
    // the logger's page reads the silence the server flagged
    const lg = await api('GET', 'logistics/cold-chain/loggers');
    expect(lg.data.silences.find((s: any) => s.deviceId === logger && s.resolvedAt === null)).toBeDefined();   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(typeof lg.data.silenceMinutes).toBe('number');
  });

  it('a SIGNED reading resets the silence: the server resolves it, and the rule no longer finds the logger', async () => {
    expect((await ingest(reading(4.0))).status).toBe(201);
    expect(Number((await q1(`SELECT count(*)::int n FROM cold_chain_device_silences WHERE device_id=$1 AND resolved_at IS NULL`, [logger])).n)).toBe(0);
    expect((await silent15()).find((r) => r.deviceId === logger)).toBeUndefined();
    expect((await q1(`SELECT last_reading_at > now() - interval '1 minute' AS fresh FROM twin_devices WHERE id=$1`, [logger])).fresh).toBe(true);
  });

  it('a device reading timed 2 h ahead → COLD_CHAIN_DEVICE_TIME; a manual reading with a body time → refused by name', async () => {
    expect(await ingest(reading(4.0, 120))).toEqual({ status: 422, code: 'COLD_CHAIN_DEVICE_TIME' });
    const before = Number((await q1(`SELECT count(*)::int n FROM cold_chain_logs WHERE tenant_id=$1 AND recorded_at > now() + interval '1 minute'`, [T])).n);
    expect(before).toBe(0);
    const manual = await api('POST', 'logistics/cold-chain/readings', { subjectType: 'bmc_unit', subjectId: cooler, tempC: 4.0, recordedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(manual.status).toBe(422);
    expect(manual.raw).toContain('VALIDATION_FAILED'); expect(manual.raw).toMatch(/recordedAt/);
  });

  it('a soil pod is registered only: no key, no signed reading, its last_reading_at stays NULL', async () => {
    const r = await api('POST', 'twin/devices', { kind: 'soil_pod', serial: `POD-4C-${T.slice(0, 4)}` }, idem());
    expect(r.status).toBe(201);
    pod = r.data.id;
    // a key is refused (only a cold-chain logger takes one) …
    const k = await api('POST', `logistics/cold-chain/loggers/${pod}/keys`, { subjectType: 'bmc_unit', subjectId: cooler, reason: 'Trying to key a soil pod' }, idem());
    expect(k.status).toBe(404);
    // … the ingest answers as for any unknown device …
    expect((await ingest(reading(20.0), pod)).code).toBe('INGEST_SIGNATURE_INVALID');
    // … and the database refuses a device reading from it even from the fixture superuser
    await expect(admin.query(`INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, source, device_id) VALUES ($1,'bmc_unit',$2, 20, now(), 'device', $3)`, [T, cooler, pod]))
      .rejects.toThrow(/COLD_CHAIN_DEVICE_UNKNOWN/);
    expect((await q1(`SELECT last_reading_at FROM twin_devices WHERE id=$1`, [pod])).last_reading_at).toBeNull();
    const ov = await api('GET', 'twin/overview');
    expect(ov.data.devices).toMatchObject({ soilPods: 1, weatherMasts: 0, readings: 'none' });
    expect((await fleet()).find((x) => x.deviceId === pod)).toBeUndefined();
  });

  it('absence → 404: no battery, calibration or sync route exists (a real route answers, as the positive control)', async () => {
    expect((await api('GET', 'logistics/cold-chain/loggers')).status).toBe(200);
    for (const [m, p] of [
      ['GET', `logistics/cold-chain/devices/${logger}/battery`], ['GET', `logistics/cold-chain/devices/${logger}/calibration`], ['POST', `logistics/cold-chain/devices/${logger}/sync`],
      ['GET', `logistics/cold-chain/loggers/${logger}/battery`], ['GET', `logistics/cold-chain/loggers/${logger}/calibration`], ['POST', `logistics/cold-chain/loggers/${logger}/sync`],
      ['GET', `twin/devices/${pod}/battery`], ['POST', `twin/devices/${pod}/sync`],
    ] as const) expect([m, p, (await api(m, p, m === 'POST' ? {} : undefined, m === 'POST' ? idem() : undefined)).status]).toEqual([m, p, 404]);
  });
});
