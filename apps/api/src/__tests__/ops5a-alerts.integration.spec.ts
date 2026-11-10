// apps/api/src/__tests__/ops5a-alerts.integration.spec.ts · PC-56 OPS-5a · THE ALERTS, LIVE — the 5a first commit (no migration) over the real
// AppModule over HTTP (listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS + 0201 (the database opens a breach and writes its own
// alert row, rule_id NULL) + 0237 (the second-person wall), the device ingest over raw HTTP with a real HMAC on the kv_ingest pool.
// FLAGS: `logistics` and `cold_chain_device_ingest` are seeded OFF and switched ON for THIS organisation only (an allow-list fixture,
// `rules.tenant_ids`), restored in afterAll — every cold-chain route answers 404 otherwise.
//
// Survey §7 `ops5a-alerts`, VERBATIM where it still applies, ADJUSTED to HOTFIX-14 (named):
//   create/edit without a key → 400; edit → one audit_log row with before/after and reason; `channelHint: null` clears; the 201st rule's threshold
//   edit → 200; feed acknowledge → audit row; acknowledging a breach's alert row → ALERT_ACK_ON_ITS_OWN_FILE, the row unchanged; a manual reading
//   with a typed `deviceRef` out of band → the breach rule's alert `subject_ref` is the subject's short reference, never the typed label (E4);
//   the cooler monitor with one paused and one active rule → recipients of the active only (E5 — ADJUSTED: a pause is a PROPOSAL since HOTFIX-14,
//   so it takes two people here); `maintenance_due` judges the organisation's day (E9 — ADJUSTED: the survey's "at 23:30 UTC" needs a clock this
//   spec cannot move, so the organisation's zone and the database session's zone are set 25 hours apart — Pacific/Kiritimati (+14) and
//   Pacific/Pago_Pago (−11) — whose calendar days ALWAYS differ, so `CURRENT_DATE` and the organisation's day disagree at any hour of the run);
//   absence → 404: `POST …/alerts/:id/escalate`, `POST …/breaches/:id/close` (`GET …/alert-rules/:id/versions` DROPPED: Q3 is A — HOTFIX-14).
// Plus (brief §E): "run the rules now" writes an audit row (E6); W402's last change — when and whether it was you (never an id); W403's read.
// Run under TZ=Asia/Kolkata and TZ=UTC: every time here is the database's or the server's clock.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { signIngest } from '../modules/logistics/domain/logistics-ops';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { READ_REPLICA, ReadReplicaProvider } from '../core/database/read-replica.provider';
import { OpsAlertRepository } from '../modules/logistics/repositories/ops-alert.repository';
import { DairyBmcReadModel } from '../modules/dairy/read-models/dairy-bmc.read-model';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;
const FLAGS = ['logistics', 'cold_chain_device_ingest'];
const WHY = 'Cooler alerts for the test centre';
const TYPED = 'Testperson cooler sensor';   // a label a PERSON types on a manual reading — free text that may carry a name
const ORG_ZONE = 'Pacific/Kiritimati';       // UTC+14
const SESSION_ZONE = 'Pacific/Pago_Pago';    // UTC−11 — 25 h behind: its calendar day is ALWAYS earlier than the organisation's
const short = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();

run('PC-56 OPS-5a · the alerts (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let admin: Pool; let base = ''; let cache: CacheService; let dbName = '';
  const T = randomUUID(); const TK = randomUUID();
  let tkCountry: string | null = null; let kiInserted = false;
  let A = ''; let B = ''; let M = '';
  const tok: Record<string, string> = {};
  let cooler = ''; let logger = ''; let key = '';
  let breachRule = ''; let silentRule = '';
  let seq = 1;
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const api = async (who: 'A' | 'B', method: string, path: string, body?: unknown, idemKey?: string) => {
    const res = await fetch(`${base}/v1/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok[who]}`, 'x-tenant-id': T, ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({})) as { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, data: json.data, code: json.error?.code ?? null };
  };
  const ingest = async (tempC: number, minutesFromNow: number) => {
    const raw = JSON.stringify({ tempC, recordedAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(), sequenceNo: seq++ });
    const ts = String(Math.floor(Date.now() / 1000)); const nonce = `n${randomUUID().replace(/-/g, '')}`;
    const res = await fetch(`${base}/v1/ingest/cold-chain/readings`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-kv-device': logger,
      'x-kv-timestamp': ts, 'x-kv-nonce': nonce, 'x-kv-signature': signIngest(key, ts, nonce, raw) } });
    return res.status;
  };
  const audits = (entityType: string, id: string) => admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY created_at, id`, [T, entityType, id]).then((r) => r.rows);
  const create = (who: 'A' | 'B', body: Record<string, unknown>) => api(who, 'POST', 'logistics/cold-chain/alert-rules', { reason: WHY, ...body }, idem());
  const patch = (who: 'A' | 'B', id: string, body: Record<string, unknown>, k = idem()) => api(who, 'PATCH', `logistics/cold-chain/alert-rules/${id}`, { reason: WHY, ...body }, k);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    // E9 fixture: every NEW session of this test database runs 25 h behind the organisation's zone — set BEFORE the app opens its pools.
    dbName = (await q1(`SELECT current_database() AS d`)).d;
    await admin.query(`ALTER DATABASE "${dbName.replace(/"/g, '')}" SET timezone TO '${SESSION_ZONE}'`);
    await admin.query(`ALTER ROLE kv_ingest WITH LOGIN PASSWORD 'dev'`);   // same statement as db/local/local-login-roles.sql
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    process.env.INGEST_DATABASE_URL = as('kv_ingest');

    await makeTenant(admin, T, `O5A ${T.slice(0, 4)}`); await makeTenant(admin, TK, `O5A-zone ${TK.slice(0, 4)}`);
    // [lead QA, OPS-5a] the KI row leaked into the shared test database and turned TENANT-6e-1's "a currency scale for every seeded
    // country" red in group A; the organisation's own country and whether this spec inserted KI are kept so afterAll puts both back.
    tkCountry = (await q1(`SELECT country_code FROM tenants WHERE id=$1`, [TK])).country_code;
    kiInserted = ((await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active) VALUES ('KI', 'Kiribati', 'AUD', '+686', $1, false) ON CONFLICT (code) DO NOTHING`, [ORG_ZONE])).rowCount ?? 0) === 1;
    expect((await q1(`SELECT timezone FROM countries WHERE code='KI'`)).timezone).toBe(ORG_ZONE);
    await admin.query(`UPDATE tenants SET country_code='KI' WHERE id=$1`, [TK]);
    A = await makeUser(admin); B = await makeUser(admin); M = await makeUser(admin);
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    await role(A, T, 'tenant_admin'); await role(B, T, 'tenant_admin'); await role(M, T, 'farmer'); await role(A, TK, 'tenant_admin');
    for (const flag of FLAGS) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [flag])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([flag, false]);
      backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [flag, JSON.stringify({ tenant_ids: [T] })]);
    }
    const mcc = (await q1(`INSERT INTO mcc_centres (tenant_id, code, default_name) VALUES ($1, $2, 'Test centre') RETURNING id`, [T, `MCC-5A-${T.slice(0, 4)}`])).id;
    cooler = (await q1(`INSERT INTO bmc_units (tenant_id, mcc_id, capacity_litres, target_temp_c) VALUES ($1, $2, 2000, 4.0) RETURNING id`, [T, mcc])).id;

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cache = app.get<CacheService>(CACHE_SERVICE);
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
    const perms = (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'tenant_admin'`)).rows.map((x) => x.permission_code as string);
    tok.A = mintToken(app, { userId: A, tenantId: T, perms, roles: ['tenant_admin'] });
    tok.B = mintToken(app, { userId: B, tenantId: T, perms, roles: ['tenant_admin'] });

    const reg = await api('A', 'POST', 'logistics/cold-chain/loggers', { serial: `LOG-5A-${randomUUID().slice(0, 6)}`, label: 'Cooler logger' }, idem());
    expect(reg.status).toBe(201);
    logger = reg.data.id;
    const k = await api('A', 'POST', `logistics/cold-chain/loggers/${logger}/keys`, { subjectType: 'bmc_unit', subjectId: cooler, reason: 'Logger mounted on the test cooler' }, idem());
    key = k.data.key;
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id IN ($1,$2)`, [T, TK]).catch(() => undefined);
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache?.del(c).catch(() => undefined);
    if (dbName) await admin?.query(`ALTER DATABASE "${dbName.replace(/"/g, '')}" RESET timezone`).catch(() => undefined);
    if (tkCountry) await admin?.query(`UPDATE tenants SET country_code=$2 WHERE id=$1`, [TK, tkCountry]).catch(() => undefined);
    if (kiInserted) await admin?.query(`DELETE FROM countries WHERE code='KI'`).catch(() => undefined);
    await app?.close().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  it('(1) create and edit WITHOUT a key → 400, nothing written; a create → 201 and one audit row; an edit → one audit row with before, after and the reason', async () => {
    const noKey = await api('A', 'POST', 'logistics/cold-chain/alert-rules', { kind: 'cold_chain_breach', ruleName: 'No key', recipientUserIds: [A], reason: WHY });
    expect(noKey.status).toBe(400);
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rules WHERE tenant_id=$1`, [T])).toBe(0);
    const r = await create('A', { kind: 'cold_chain_breach', ruleName: 'Cooler readings out of band', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [A] });
    expect([r.status, r.data.status]).toEqual([201, 'applied']);
    breachRule = r.data.id;
    const editNoKey = await api('A', 'PATCH', `logistics/cold-chain/alert-rules/${breachRule}`, { recipientUserIds: [A, B], reason: WHY });
    expect(editNoKey.status).toBe(400);
    const e = await patch('A', breachRule, { recipientUserIds: [A, B] });   // a person added: louder, applied at once
    expect([e.status, e.data.status]).toEqual([200, 'applied']);
    const au = (await audits('ops_alert_rule', breachRule)).filter((x) => x.action === 'logistics.alert_rule_updated');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: A, reason: WHY, old_value: { recipientUserIds: [A] }, new_value: { recipientUserIds: [A, B] } });
  });

  it('(2) `channelHint: null` CLEARS the hint; the 201st rule\'s threshold edit → 200 (found by id)', async () => {
    expect((await patch('B', breachRule, { channelHint: 'sms' })).status).toBe(200);
    expect((await q1(`SELECT channel_hint FROM ops_alert_rules WHERE id=$1`, [breachRule])).channel_hint).toBe('sms');
    expect((await patch('B', breachRule, { channelHint: null })).status).toBe(200);
    expect((await q1(`SELECT channel_hint FROM ops_alert_rules WHERE id=$1`, [breachRule])).channel_hint).toBeNull();
    const old = (await q1(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, is_active, created_at) VALUES ($1,'cold_chain_breach','The oldest rule','{"windowHours":6,"minBreaches":5}'::jsonb,$2::jsonb, false, now() - interval '30 days') RETURNING id`, [T, JSON.stringify([A])])).id;
    await admin.query(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, is_active, created_at) SELECT $1, 'maintenance_due', 'Filler ' || g, '{"alert":"any"}'::jsonb, $2::jsonb, false, now() - interval '1 day' FROM generate_series(1, 200) g`, [T, JSON.stringify([A])]);
    // the 200 fillers are newer than `old`, so `old` is the 201st rule by the list's own order (created_at DESC, LIMIT 200)
    const r = await patch('A', old, { threshold: { windowHours: 6, minBreaches: 2 } });
    expect([r.status, r.data?.status]).toEqual([200, 'applied']);
  });

  it('(3) W402\'s read: each rule carries its LAST recorded change — what, when, and whether it was the reader; no person id in it', async () => {
    const asA = await api('A', 'GET', 'logistics/cold-chain/alert-rules');
    const asB = await api('B', 'GET', 'logistics/cold-chain/alert-rules');
    const ra = asA.data.find((r: any) => r.id === breachRule); const rb = asB.data.find((r: any) => r.id === breachRule);   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ra.lastChange).toMatchObject({ action: 'updated' });
    expect(Object.keys(ra.lastChange).sort()).toEqual(['action', 'at', 'byYou']);
    expect(JSON.stringify(ra.lastChange)).not.toContain(A);
    expect(JSON.stringify(ra.lastChange)).not.toContain(B);
    // the last change to `breachRule` was B's (channelHint cleared in (2)) — so B reads byYou, A does not
    expect([ra.lastChange.byYou, rb.lastChange.byYou]).toEqual([false, true]);
    // a rule touched only by the evaluator never shows a change: `updated_at` is not the source
    const filler = asA.data.find((r: any) => r.ruleName === 'Filler 1');   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (filler) expect(filler.lastChange).toBeNull();
  });

  it('(4) E4 · a MANUAL reading typed with a device label, out of band → the breach rule\'s alert names the SUBJECT by its short reference, never the typed label; "run now" is recorded (E6)', async () => {
    for (const t of [9.4, 9.7]) {
      const rd = await api('A', 'POST', 'logistics/cold-chain/readings', { subjectType: 'bmc_unit', subjectId: cooler, tempC: t, deviceRef: TYPED });
      expect(rd.status).toBe(201);
    }
    expect(await n(`SELECT count(*)::int n FROM cold_chain_logs WHERE tenant_id=$1 AND subject_id=$2 AND source='manual' AND is_breach AND device_ref=$3`, [T, cooler, TYPED])).toBe(2);
    expect(await n(`SELECT count(*)::int n FROM cold_chain_breaches WHERE tenant_id=$1`, [T])).toBe(0);   // a typed reading never opens a breach
    const ev = await api('A', 'POST', 'logistics/cold-chain/alert-rules/evaluate');
    expect(ev.status).toBe(201);
    expect(ev.data.fired).toBeGreaterThanOrEqual(1);
    const fired = (await admin.query(`SELECT id, subject_type, subject_ref, detail FROM ops_fired_alerts WHERE tenant_id=$1 AND rule_id=$2`, [T, breachRule])).rows;
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ subject_type: 'bmc_unit', subject_ref: short(cooler) });
    expect(fired[0].detail).toMatchObject({ breaches: 2, subjectId: cooler });
    const out = await q1(`SELECT payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_type='ops_alert' AND aggregate_id=$2`, [T, fired[0].id]);
    expect(out.payload.subjectRef).toBe(short(cooler));
    expect(out.payload.body).toContain('from the logger or typed by a person');
    expect(out.payload.body).toContain(short(cooler));
    expect(JSON.stringify(out.payload)).not.toContain('Testperson');
    expect(JSON.stringify(fired[0])).not.toContain('Testperson');
    // E6: the run is recorded with the person who ran it
    const runs = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE tenant_id=$1 AND action='logistics.alert_rules_evaluated_now'`, [T])).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ actor_user_id: A, new_value: { fired: ev.data.fired } });
  });

  it('(5) B3 · the feed\'s acknowledge of a RULE\'s alert is KEYED and RECORDED; a replay answers the same; a second acknowledge → 409', async () => {
    const f = await q1(`SELECT id FROM ops_fired_alerts WHERE tenant_id=$1 AND rule_id=$2`, [T, breachRule]);
    const noKey = await api('A', 'POST', `logistics/cold-chain/alerts/${f.id}/acknowledge`, {});
    expect(noKey.status).toBe(400);
    expect((await q1(`SELECT acknowledged_at FROM ops_fired_alerts WHERE id=$1`, [f.id])).acknowledged_at).toBeNull();
    const k = idem();
    const ack = await api('A', 'POST', `logistics/cold-chain/alerts/${f.id}/acknowledge`, {}, k);
    expect([ack.status, ack.data]).toEqual([201, { id: f.id, acknowledged: true }]);
    expect(await q1(`SELECT acknowledged_by FROM ops_fired_alerts WHERE id=$1`, [f.id])).toEqual({ acknowledged_by: A });
    const au = await audits('ops_fired_alert', f.id);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: 'logistics.alert_acknowledged', actor_user_id: A, new_value: { acknowledged: true, ruleId: breachRule } });
    const replay = await api('A', 'POST', `logistics/cold-chain/alerts/${f.id}/acknowledge`, {}, k);
    expect([replay.status, replay.data]).toEqual([201, { id: f.id, acknowledged: true }]);
    expect(await audits('ops_fired_alert', f.id)).toHaveLength(1);
    const again = await api('B', 'POST', `logistics/cold-chain/alerts/${f.id}/acknowledge`, {}, idem());
    expect(again.status).toBe(409);
  });

  let breachId = '';
  it('(6) B3 · a BREACH\'s own alert (rule_id NULL) → ALERT_ACK_ON_ITS_OWN_FILE (409); the row and the breach unchanged; nothing recorded', async () => {
    expect(await ingest(9.5, -6)).toBe(201);
    expect(await ingest(9.8, -3)).toBe(201);
    const b = await q1(`SELECT id, alert_id, alert_state, alert_recipients FROM cold_chain_breaches WHERE tenant_id=$1 AND subject_id=$2`, [T, cooler]);
    expect(b).toMatchObject({ alert_state: 'alerted', alert_recipients: 2 });
    breachId = b.id;
    const row = await q1(`SELECT id, rule_id, acknowledged_at, detail FROM ops_fired_alerts WHERE id=$1`, [b.alert_id]);
    expect([row.rule_id, row.detail.breachId]).toEqual([null, breachId]);
    const r = await api('A', 'POST', `logistics/cold-chain/alerts/${row.id}/acknowledge`, {}, idem());
    expect([r.status, r.code]).toEqual([409, 'ALERT_ACK_ON_ITS_OWN_FILE']);
    expect((await q1(`SELECT acknowledged_at, acknowledged_by FROM ops_fired_alerts WHERE id=$1`, [row.id]))).toEqual({ acknowledged_at: null, acknowledged_by: null });
    expect((await q1(`SELECT acknowledged_at FROM cold_chain_breaches WHERE id=$1`, [breachId])).acknowledged_at).toBeNull();
    expect(await audits('ops_fired_alert', row.id)).toHaveLength(0);
    // the feed still lists it as unacknowledged — it is acknowledged on its own file
    const feed = await api('A', 'GET', 'logistics/cold-chain/alerts/feed?unacknowledgedOnly=true&limit=200');
    expect(feed.data.some((x: any) => x.id === row.id)).toBe(true);   // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('(7) W403\'s read: the breach file carries its own facts — alerted, how many told, the acts it still offers; no buyer identity on the wire', async () => {
    const r = await api('A', 'GET', `logistics/cold-chain/breaches/${breachId}`);
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: breachId, subjectType: 'bmc_unit', subjectRef: short(cooler), alert: { state: 'alerted', recipients: 2 }, acknowledgedAt: null });
    expect(r.data.acts).toEqual(expect.arrayContaining(['acknowledge', 'record_action']));
    expect(Object.keys(r.data.buyer).sort()).toEqual(['decidedAt', 'decision', 'disputeId', 'offerState', 'offeredAt', 'reason']);
  });

  it('(8) E5 · the cooler monitor counts the people of ACTIVE rules only: one rule paused (by two people — HOTFIX-14) → its person is no longer counted', async () => {
    const s = await create('A', { kind: 'device_silent', ruleName: 'Logger quiet', threshold: { silentMinutes: 30 }, recipientUserIds: [M] });
    expect(s.status).toBe(201);
    silentRule = s.data.id;
    const monitor = app.get(DairyBmcReadModel, { strict: false });
    const before = await monitor.view(T, { userId: A, canManage: true });
    expect(before.alerting.recipients).toBe(3);                   // A, B (breach rule) + M (silence rule)
    const p = await patch('A', silentRule, { isActive: false });
    expect([p.status, p.data.status]).toEqual([202, 'proposed']);
    expect((await monitor.view(T, { userId: A, canManage: true })).alerting.recipients).toBe(3);   // a proposal changes nothing yet
    const c = await api('B', 'POST', `logistics/cold-chain/alert-rules/changes/${p.data.changeId}/confirm`, {}, idem());
    expect(c.status).toBe(201);
    expect((await q1(`SELECT is_active FROM ops_alert_rules WHERE id=$1`, [silentRule])).is_active).toBe(false);
    const after = await monitor.view(T, { userId: A, canManage: true });
    expect([after.alerting.recipients, after.alerting.silentRules]).toEqual([2, 0]);
  });

  it('(9) E9 · maintenance_due judges the ORGANISATION\'s day, never the database session\'s CURRENT_DATE', async () => {
    const replica = app.get<ReadReplicaProvider>(READ_REPLICA);
    const z = (await replica.forTenant(TK).query(`SELECT current_setting('TimeZone') AS tz, CURRENT_DATE::text AS session_day,
      (now() AT TIME ZONE $1)::date::text AS org_day`, [ORG_ZONE])).rows[0] as { tz: string; session_day: string; org_day: string };
    expect(z.tz).toBe(SESSION_ZONE);                              // precondition: the app's own sessions run in the far-behind zone
    expect(z.session_day < z.org_day).toBe(true);                 // precondition: the two days disagree NOW — the probe has teeth
    const cat = (await q1(`SELECT id FROM categories ORDER BY created_at LIMIT 1`)).id;
    const asset = async (daysAgo: number) => {
      const id = (await q1(`INSERT INTO equipment_assets (tenant_id, owner_user_id, category_id, status) VALUES ($1,$2,$3,'active') RETURNING id`, [TK, A, cat])).id;
      await admin.query(`INSERT INTO equipment_maintenance_logs (asset_id, tenant_id, log_type, performed_on) VALUES ($1,$2,'service', (now() AT TIME ZONE $3)::date - $4::int)`, [id, TK, ORG_ZONE, daysAgo]);
      return id as string;
    };
    const due = await asset(366); const notYet = await asset(365);
    const rows = await app.get(OpsAlertRepository).maintenanceAlerts(TK, 'any');
    expect(rows.find((r) => r.assetId === due)).toMatchObject({ alert: 'service_due' });   // a year and a day ago by the organisation's day
    expect(rows.find((r) => r.assetId === notYet)).toBeUndefined();                       // exactly a year: not yet due
  });

  it('(10) absence → 404: no escalation route, no breach "close" route', async () => {
    const f = await q1(`SELECT id FROM ops_fired_alerts WHERE tenant_id=$1 AND rule_id=$2`, [T, breachRule]);
    expect((await api('A', 'POST', `logistics/cold-chain/alerts/${f.id}/escalate`, {}, idem())).status).toBe(404);
    expect((await api('A', 'POST', `logistics/cold-chain/breaches/${breachId}/close`, {}, idem())).status).toBe(404);
    // the existing routes answer (positive control): the breach act route exists for its own acts
    expect((await api('A', 'GET', `logistics/cold-chain/breaches/${breachId}`)).status).toBe(200);
  });
});
