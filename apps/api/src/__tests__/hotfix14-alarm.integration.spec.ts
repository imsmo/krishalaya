// apps/api/src/__tests__/hotfix14-alarm.integration.spec.ts · PC-56 HOTFIX-14 · NOBODY SILENCES THE ALARM ALONE, LIVE.
// OPS-5 Q3-A, applied by the lead on 2026-11-10 under the founder's instruction of that day. The real AppModule over HTTP (listening ONCE on
// 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS + 0201 (the database opens a breach and reads the ACTIVE breach rules' recipients) +
// 0237 (the change table, its CHECKs and both guards), the device ingest over raw HTTP with a real HMAC on the kv_ingest pool.
// FLAGS: `logistics` and `cold_chain_device_ingest` are seeded OFF and switched ON for THIS organisation only (an allow-list fixture,
// `rules.tenant_ids`), restored in afterAll — every cold-chain route answers 404 otherwise, and the signed ingest refuses.
//
// Survey §7, red-today probe 1: A pauses the only cold_chain_breach rule; two signed out-of-band readings → the breach is `no_recipient`, no
// `logistics.cold_chain_breach` outbox row — and now the pause is RECORDED WITH ITS AUTHORS (it took two people).
// Survey §7, red-today probe 2 (F-10): a rule naming a user of ANOTHER organisation → the spine writes her a notification (today's truth,
// unchanged here) — so the API now refuses such a rule (ALERT_RECIPIENT_NOT_MEMBER).
// Survey §7 `hotfix14-alarm`, verbatim: A proposes a pause → the rule stays active, one change row, one audit row; A confirms →
// ALERT_RULE_CONFIRMER_IS_PROPOSER, nothing changes; B confirms → paused, audit row names B; a breach after B's confirmation →
// no_recipient (the rule did what two people agreed); removing a recipient / raising minBreaches / lengthening cooldown → proposals;
// adding a recipient / a new rule / resuming → applied at once, recorded; a second open proposal on one rule → refused; kv_app direct
// `UPDATE ops_alert_rules SET is_active=false` → trigger refused; kv_app DELETE on the change table → 42501.
// Plus (brief §E): keys required, a reason on every change, the CHECK proved in the admin realm, the rule moved since the proposal, the
// 201st rule found by id, `channelHint: null` clears, the feed's limit bounded, a withdrawal, DELETE of a rule refused for kv_app and kv_relay.
// Run under TZ=Asia/Kolkata and TZ=UTC: every time here is the database's or the server's clock, never the process's local day.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { signIngest } from '../modules/logistics/domain/logistics-ops';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { NotificationService } from '../modules/communication/services/notification.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;
const FLAGS = ['logistics', 'cold_chain_device_ingest'];
const WHY = 'Cooler sent away for repair this week';

run('PC-56 HOTFIX-14 · nobody silences the alarm alone (integration, real AppModule over HTTP, 0237)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let base = ''; let cache: CacheService;
  const T = randomUUID(); const T2 = randomUUID();
  let A = ''; let B = ''; let M = ''; let F = '';
  const tok: Record<string, string> = {};
  let cooler = ''; let logger = ''; let key = '';
  let breachRule = '';
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
  /** A statement as kv_app, in a session of THIS organisation and person — the error code (or the guard's first words) it was refused with. */
  const asRole = async (role: 'kv_app' | 'kv_relay', userId: string | null, sql: string, p: unknown[] = []): Promise<string> => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
      await c.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [T, userId ?? '']);
      const r = await c.query(sql, p); return `ok:${r.rowCount}`;
    } catch (e) { return `${(e as { code?: string }).code}`; }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  };
  const rule = (id: string) => q1(`SELECT is_active, recipient_user_ids, threshold, cooldown_minutes, channel_hint, created_by, updated_by FROM ops_alert_rules WHERE id=$1`, [id]);
  const audits = (id: string) => admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE tenant_id=$1 AND entity_type='ops_alert_rule' AND entity_id=$2 ORDER BY created_at, id`, [T, id]).then((r) => r.rows);
  const create = (who: 'A' | 'B', body: Record<string, unknown>) => api(who, 'POST', 'logistics/cold-chain/alert-rules', { reason: WHY, ...body }, idem());
  const patch = (who: 'A' | 'B', id: string, body: Record<string, unknown>, k = idem()) => api(who, 'PATCH', `logistics/cold-chain/alert-rules/${id}`, { reason: WHY, ...body }, k);
  const confirm = (who: 'A' | 'B', changeId: string) => api(who, 'POST', `logistics/cold-chain/alert-rules/changes/${changeId}/confirm`, {}, idem());
  const withdraw = (who: 'A' | 'B', changeId: string) => api(who, 'POST', `logistics/cold-chain/alert-rules/changes/${changeId}/withdraw`, {}, idem());

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    await admin.query(`ALTER ROLE kv_ingest WITH LOGIN PASSWORD 'dev'`);   // same statement as db/local/local-login-roles.sql
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2 });
    process.env.INGEST_DATABASE_URL = as('kv_ingest');

    await makeTenant(admin, T, `HF14 ${T.slice(0, 4)}`); await makeTenant(admin, T2, `HF14-other ${T2.slice(0, 4)}`);
    A = await makeUser(admin); B = await makeUser(admin); M = await makeUser(admin); F = await makeUser(admin);
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    await role(A, T, 'tenant_admin'); await role(B, T, 'tenant_admin'); await role(M, T, 'farmer'); await role(F, T2, 'farmer');   // F belongs to ANOTHER organisation
    for (const flag of FLAGS) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [flag])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([flag, false]);
      backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [flag, JSON.stringify({ tenant_ids: [T] })]);
    }
    const mcc = (await q1(`INSERT INTO mcc_centres (tenant_id, code, default_name) VALUES ($1, $2, 'Test centre') RETURNING id`, [T, `MCC-14-${T.slice(0, 4)}`])).id;
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

    const reg = await api('A', 'POST', 'logistics/cold-chain/loggers', { serial: `LOG-14-${randomUUID().slice(0, 6)}`, label: 'Cooler logger' }, idem());
    expect(reg.status).toBe(201);
    logger = reg.data.id;
    const k = await api('A', 'POST', `logistics/cold-chain/loggers/${logger}/keys`, { subjectType: 'bmc_unit', subjectId: cooler, reason: 'Logger mounted on the test cooler' }, idem());
    key = k.data.key;
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id IN ($1,$2)`, [T, T2]).catch(() => undefined);
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache?.del(c).catch(() => undefined);
    await app?.close().catch(() => undefined); await relayPool?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  it('a NEW rule applies at once (201), keyed, recorded: its author written, one audit row with the rule and the reason; without a key → 400; without a reason → REASON_REQUIRED', async () => {
    const noKey = await api('A', 'POST', 'logistics/cold-chain/alert-rules', { kind: 'cold_chain_breach', ruleName: 'No key', recipientUserIds: [A], reason: WHY });
    expect(noKey.status).toBe(400);
    const noWhy = await api('A', 'POST', 'logistics/cold-chain/alert-rules', { kind: 'cold_chain_breach', ruleName: 'No reason', recipientUserIds: [A] }, idem());
    expect([noWhy.status, noWhy.code]).toEqual([422, 'REASON_REQUIRED']);
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rules WHERE tenant_id=$1`, [T])).toBe(0);
    const r = await create('A', { kind: 'cold_chain_breach', ruleName: 'Cooler breaches', threshold: { windowHours: 6, minBreaches: 2 }, recipientUserIds: [A, B] });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ status: 'applied' });
    breachRule = r.data.id;
    expect(await rule(breachRule)).toMatchObject({ is_active: true, created_by: A, updated_by: A });
    const au = await audits(breachRule);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: 'logistics.alert_rule_created', actor_user_id: A, reason: WHY, old_value: null });
    expect(au[0].new_value).toMatchObject({ kind: 'cold_chain_breach', isActive: true, recipientUserIds: [A, B] });
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rule_changes WHERE rule_id=$1`, [breachRule])).toBe(0);   // a create is never a proposal
  });

  it('F-10 (red-today probe 2): a rule naming a user of ANOTHER organisation — the spine writes her a notification (today\'s truth), so the API refuses it by name', async () => {
    // today's truth, through the database (the admin realm) — the spine checks no membership
    const foreign = (await q1(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids) VALUES ($1,'maintenance_due','Foreign probe','{"alert":"any"}'::jsonb,$2::jsonb) RETURNING id`, [T, JSON.stringify([F])])).id;
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const notifications = app.get(NotificationService, { strict: false });
    const evId = randomUUID();
    await uow.run(T, (tx) => notifications.fanout(tx, { tenantId: T, eventCode: 'ops.alert_fired', recipients: [F], payload: { title: 'Equipment maintenance due', body: 'probe', recipientUserIds: [F], ruleId: foreign }, dedupeKey: evId }), { userId: 'system' });
    expect(await n(`SELECT count(*)::int n FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND event_code='ops.alert_fired'`, [T, F])).toBeGreaterThan(0);
    await admin.query(`UPDATE ops_alert_rules SET is_active=false WHERE id=$1`, [foreign]);   // the probe rule goes quiet (admin realm)
    // the API: create and edit both refuse a non-member, before anything is written
    const c = await create('A', { kind: 'cold_chain_breach', ruleName: 'Foreign person', recipientUserIds: [A, F] });
    expect([c.status, c.code]).toEqual([422, 'ALERT_RECIPIENT_NOT_MEMBER']);
    const e = await patch('A', breachRule, { recipientUserIds: [A, B, F] });
    expect([e.status, e.code]).toEqual([422, 'ALERT_RECIPIENT_NOT_MEMBER']);
    expect((await rule(breachRule)).recipient_user_ids).toEqual([A, B]);
  });

  let pauseChange = '';
  it('(1) A proposes a PAUSE → 202, the rule stays ACTIVE, one change row, one audit row; a replay of the same key answers the same', async () => {
    const k = idem();
    const p = await patch('A', breachRule, { isActive: false }, k);
    expect(p.status).toBe(202);
    expect(p.data).toMatchObject({ id: breachRule, status: 'proposed', changes: [{ field: 'isActive', direction: 'quieter' }] });
    pauseChange = p.data.changeId;
    expect((await rule(breachRule)).is_active).toBe(true);
    const rows = (await admin.query(`SELECT state, proposed_by, reason, before->>'isActive' b, after->>'isActive' a FROM ops_alert_rule_changes WHERE rule_id=$1`, [breachRule])).rows;
    expect(rows).toEqual([{ state: 'proposed', proposed_by: A, reason: WHY, b: 'true', a: 'false' }]);
    const au = (await audits(breachRule)).filter((x) => x.action === 'logistics.alert_rule_change_proposed');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: A, reason: WHY });
    const again = await patch('A', breachRule, { isActive: false }, k);
    expect([again.status, again.data.changeId]).toEqual([202, pauseChange]);
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rule_changes WHERE rule_id=$1`, [breachRule])).toBe(1);
    const list = await api('A', 'GET', `logistics/cold-chain/alert-rules/${breachRule}/changes`);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: pauseChange, state: 'proposed', proposedByYou: true });
    const rules = await api('B', 'GET', 'logistics/cold-chain/alert-rules');
    expect(rules.data.find((r: any) => r.id === breachRule).openChange).toMatchObject({ id: pauseChange, proposedByYou: false });   // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('(2) a second OPEN proposal on the same rule → ALERT_RULE_CHANGE_ALREADY_OPEN, nothing written', async () => {
    const p = await patch('B', breachRule, { cooldownMinutes: 600 });
    expect([p.status, p.code]).toEqual([409, 'ALERT_RULE_CHANGE_ALREADY_OPEN']);
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rule_changes WHERE rule_id=$1`, [breachRule])).toBe(1);
  });

  it('(3) A confirms her own proposal → ALERT_RULE_CONFIRMER_IS_PROPOSER (403); nothing changes', async () => {
    const c = await confirm('A', pauseChange);
    expect([c.status, c.code]).toEqual([403, 'ALERT_RULE_CONFIRMER_IS_PROPOSER']);
    expect((await rule(breachRule)).is_active).toBe(true);
    expect((await q1(`SELECT state, confirmed_by FROM ops_alert_rule_changes WHERE id=$1`, [pauseChange]))).toEqual({ state: 'proposed', confirmed_by: null });
  });

  it('(4) the database is the wall: kv_app cannot pause the rule directly, cannot confirm its own proposal, cannot write a pre-confirmed change, cannot DELETE a change', async () => {
    expect(await asRole('kv_app', B, `UPDATE ops_alert_rules SET is_active=false WHERE id=$1`, [breachRule])).toBe('23514');                         // the guard (0237.5)
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET recipient_user_ids='[]'::jsonb WHERE id=$1`, [breachRule])).toBe('23514');
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET threshold='{"windowHours":6,"minBreaches":1000}'::jsonb WHERE id=$1`, [breachRule])).toBe('23514');
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET cooldown_minutes=10080 WHERE id=$1`, [breachRule])).toBe('23514');
    // [lead QA, HOTFIX-14] the wall's window and subject clauses had no direct probe: a lead mutant flipping 0237's window
    // comparison (a SHORTER window let through) passed this spec 17/17. A shorter window counts fewer readings (quieter); a
    // subject filter added narrows the rule (quieter); a longer window is louder and passes (each statement rolled back).
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET threshold='{"windowHours":1,"minBreaches":2}'::jsonb WHERE id=$1`, [breachRule])).toBe('23514');
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET threshold='{"windowHours":6,"minBreaches":2,"subjectType":"reefer"}'::jsonb WHERE id=$1`, [breachRule])).toBe('23514');
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET threshold='{"windowHours":12,"minBreaches":2}'::jsonb WHERE id=$1`, [breachRule])).toBe('ok:1');
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rule_changes SET state='confirmed', confirmed_by=$2, confirmed_at=now() WHERE id=$1`, [pauseChange, A])).toBe('23514');
    expect(await asRole('kv_app', B, `INSERT INTO ops_alert_rule_changes (tenant_id, rule_id, before, after, reason, proposed_by, state, confirmed_by, confirmed_at)
      SELECT $1, $2, ops_alert_rule_state(r), ops_alert_rule_state(r) || '{"isActive":false}'::jsonb, 'Forged confirmation row', $3, 'confirmed', $4, now() FROM ops_alert_rules r WHERE r.id=$2`, [T, breachRule, A, B])).toBe('23514');
    expect(await asRole('kv_app', A, `DELETE FROM ops_alert_rule_changes WHERE id=$1`, [pauseChange])).toBe('42501');
    expect(await asRole('kv_app', A, `DELETE FROM ops_alert_rules WHERE id=$1`, [breachRule])).toBe('42501');                                      // no DELETE grant (0014/0086)
    expect(await asRole('kv_relay', null, `DELETE FROM ops_alert_rules WHERE id=$1`, [breachRule])).toBe('23514');                                  // kv_relay holds DELETE (0018) — the guard refuses it
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET deleted_at=now() WHERE id=$1`, [breachRule])).toBe('23514');
    // a LOUDER direct write passes the guard (it is not the guard's business)
    expect(await asRole('kv_app', A, `UPDATE ops_alert_rules SET cooldown_minutes=30 WHERE id=$1`, [breachRule])).toBe('ok:1');
    expect((await rule(breachRule)).is_active).toBe(true);
  });

  it('(5) the CHECK binds even the admin realm: confirmed_by = proposed_by → 23514 (ck_oarc_confirmer_ne_proposer); a short reason → 23514', async () => {
    await expect(admin.query(`UPDATE ops_alert_rule_changes SET state='confirmed', confirmed_by=proposed_by, confirmed_at=now() WHERE id=$1`, [pauseChange])).rejects.toMatchObject({ code: '23514', constraint: 'ck_oarc_confirmer_ne_proposer' });
    await expect(admin.query(`INSERT INTO ops_alert_rule_changes (tenant_id, rule_id, before, after, reason, proposed_by) VALUES ($1,$2,'{}','{}','too short',$3)`, [T, breachRule, A])).rejects.toMatchObject({ code: '23514', constraint: 'ck_oarc_reason_len' });
  });

  it('(6) B confirms → the rule is PAUSED, the change confirmed by B, the audit row names B (and the proposer A); the rule\'s updated_by is B', async () => {
    const c = await confirm('B', pauseChange);
    expect([c.status, c.data]).toEqual([201, { id: pauseChange, ruleId: breachRule, state: 'confirmed' }]);
    expect(await rule(breachRule)).toMatchObject({ is_active: false, updated_by: B });
    expect(await q1(`SELECT state, proposed_by, confirmed_by FROM ops_alert_rule_changes WHERE id=$1`, [pauseChange])).toEqual({ state: 'confirmed', proposed_by: A, confirmed_by: B });
    const au = (await audits(breachRule)).filter((x) => x.action === 'logistics.alert_rule_change_confirmed');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: B, reason: WHY, new_value: { isActive: false, proposedBy: A } });
    const again = await confirm('B', pauseChange);
    expect([again.status, again.code]).toEqual([409, 'ALERT_RULE_CHANGE_NOT_OPEN']);
    expect(await asRole('kv_app', B, `UPDATE ops_alert_rule_changes SET state='withdrawn', confirmed_by=NULL, confirmed_at=NULL, withdrawn_at=now() WHERE id=$1`, [pauseChange])).toBe('23514');   // final
  });

  it('(7) RED-TODAY PROBE 1: with the only breach rule paused (by two people), two signed out-of-band readings → the breach is no_recipient, no breach notice on the outbox — and the pause is on record with both authors', async () => {
    expect(await ingest(9.5, -6)).toBe(201);
    expect(await ingest(9.8, -3)).toBe(201);
    const b = await q1(`SELECT id, alert_state, alert_recipients FROM cold_chain_breaches WHERE tenant_id=$1 AND subject_id=$2`, [T, cooler]);
    expect(b).toMatchObject({ alert_state: 'no_recipient', alert_recipients: 0 });
    expect(await n(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id=$1 AND event_type='logistics.cold_chain_breach'`, [T])).toBe(0);
    const who = (await audits(breachRule)).filter((x) => x.action.startsWith('logistics.alert_rule_change_')).map((x) => [x.action, x.actor_user_id]);
    expect(who).toEqual([['logistics.alert_rule_change_proposed', A], ['logistics.alert_rule_change_confirmed', B]]);
  });

  it('(8) RESUMING is louder → applied at once (200), recorded, no proposal', async () => {
    const r = await patch('A', breachRule, { isActive: true });
    expect([r.status, r.data.status]).toEqual([200, 'applied']);
    expect(await rule(breachRule)).toMatchObject({ is_active: true, updated_by: A });
    expect((await audits(breachRule)).filter((x) => x.action === 'logistics.alert_rule_updated').pop()).toMatchObject({ actor_user_id: A, reason: WHY, old_value: { isActive: false }, new_value: { isActive: true } });
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rule_changes WHERE rule_id=$1 AND state='proposed'`, [breachRule])).toBe(0);
  });

  it('(9) ADDING a recipient and LOWERING minBreaches → applied at once, recorded', async () => {
    const add = await patch('B', breachRule, { recipientUserIds: [A, B, M] });
    expect([add.status, add.data.status]).toEqual([200, 'applied']);
    expect((await rule(breachRule)).recipient_user_ids).toEqual([A, B, M]);
    const lower = await patch('B', breachRule, { threshold: { windowHours: 6, minBreaches: 1 } });
    expect([lower.status, lower.data.status]).toEqual([200, 'applied']);
    expect((await rule(breachRule)).threshold).toEqual({ windowHours: 6, minBreaches: 1 });
  });

  it('(10) REMOVING a recipient, RAISING minBreaches, LENGTHENING the cooldown → each a proposal (202), the rule untouched until a second person confirms', async () => {
    const before = await rule(breachRule);
    const remove = await patch('A', breachRule, { recipientUserIds: [A, B] });
    expect([remove.status, remove.data.status]).toEqual([202, 'proposed']);
    expect(await rule(breachRule)).toEqual(before);
    expect((await withdraw('A', remove.data.changeId)).data).toMatchObject({ state: 'withdrawn' });
    const raise = await patch('A', breachRule, { threshold: { windowHours: 6, minBreaches: 1000 } });
    expect([raise.status, raise.data.status]).toEqual([202, 'proposed']);
    expect(await rule(breachRule)).toEqual(before);
    expect((await withdraw('A', raise.data.changeId)).status).toBe(201);
    const cool = await patch('B', breachRule, { cooldownMinutes: 10080 });
    expect([cool.status, cool.data.status]).toEqual([202, 'proposed']);
    expect(await rule(breachRule)).toEqual(before);
    // a MIXED change (a person added + a longer cooldown) is a proposal as a whole — nothing of it applies yet
    expect((await withdraw('B', cool.data.changeId)).status).toBe(201);
    const mixed = await patch('A', breachRule, { recipientUserIds: [A, B, M], cooldownMinutes: 120, ruleName: 'Cooler breaches (all)' });
    expect([mixed.status, mixed.data.status]).toEqual([202, 'proposed']);
    expect(await rule(breachRule)).toEqual(before);
    // only the PROPOSER withdraws
    const notMine = await withdraw('B', mixed.data.changeId);
    expect([notMine.status, notMine.code]).toEqual([403, 'ALERT_RULE_WITHDRAW_NOT_PROPOSER']);
    expect((await withdraw('A', mixed.data.changeId)).status).toBe(201);
    expect(await n(`SELECT count(*)::int n FROM ops_alert_rule_changes WHERE rule_id=$1 AND state='withdrawn'`, [breachRule])).toBe(4);
  });

  it('(11) the rule MOVED since the proposal → ALERT_RULE_CHANGED_SINCE_PROPOSAL; nothing is overwritten', async () => {
    const p = await patch('A', breachRule, { cooldownMinutes: 600 });
    expect(p.status).toBe(202);
    const louder = await patch('B', breachRule, { cooldownMinutes: 10 });   // louder, applies at once — the proposal's `before` is now stale
    expect(louder.data.status).toBe('applied');
    const c = await confirm('B', p.data.changeId);
    expect([c.status, c.code]).toEqual([409, 'ALERT_RULE_CHANGED_SINCE_PROPOSAL']);
    expect((await rule(breachRule)).cooldown_minutes).toBe(10);
    expect((await withdraw('A', p.data.changeId)).status).toBe(201);
  });

  it('(12) every edit carries a reason and a key; `channelHint: null` CLEARS the hint (F-11)', async () => {
    const noWhy = await api('A', 'PATCH', `logistics/cold-chain/alert-rules/${breachRule}`, { channelHint: 'sms' }, idem());
    expect([noWhy.status, noWhy.code]).toEqual([422, 'REASON_REQUIRED']);
    const noKey = await api('A', 'PATCH', `logistics/cold-chain/alert-rules/${breachRule}`, { channelHint: 'sms', reason: WHY });
    expect(noKey.status).toBe(400);
    expect((await patch('A', breachRule, { channelHint: 'sms' })).status).toBe(200);
    expect((await rule(breachRule)).channel_hint).toBe('sms');
    expect((await patch('A', breachRule, { channelHint: null })).status).toBe(200);
    expect((await rule(breachRule)).channel_hint).toBeNull();
  });

  it('(13) the 201st rule is found BY ID (F-11: it answered "rule not found" through the 200-row list)', async () => {
    const old = (await q1(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, created_at) VALUES ($1,'cold_chain_breach','The oldest rule','{"windowHours":6,"minBreaches":5}'::jsonb,$2::jsonb, now() - interval '30 days') RETURNING id`, [T, JSON.stringify([A])])).id;
    await admin.query(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, is_active) SELECT $1, 'maintenance_due', 'Filler ' || g, '{"alert":"any"}'::jsonb, $2::jsonb, false FROM generate_series(1, 200) g`, [T, JSON.stringify([A])]);
    const r = await patch('A', old, { threshold: { windowHours: 6, minBreaches: 2 } });
    expect([r.status, r.data?.status]).toEqual([200, 'applied']);
    expect((await rule(old)).threshold).toEqual({ windowHours: 6, minBreaches: 2 });
  });

  it('(14) the feed\'s limit goes through a strict DTO (1..200) — the house ZodQuery answers 422', async () => {
    expect((await api('A', 'GET', 'logistics/cold-chain/alerts/feed?limit=500')).status).toBe(422);
    expect((await api('A', 'GET', 'logistics/cold-chain/alerts/feed?limit=0')).status).toBe(422);
    expect((await api('A', 'GET', 'logistics/cold-chain/alerts/feed?bogus=1')).status).toBe(422);
    const ok = await api('A', 'GET', 'logistics/cold-chain/alerts/feed?limit=5');
    expect(ok.status).toBe(200);
    expect(ok.data.length).toBeLessThanOrEqual(5);
  });

  it('(15) a breach AFTER a resume reaches the people on the active rule (the rule decides again)', async () => {
    expect(await ingest(4.0, -2)).toBe(201);   // back in band: the open breach closes
    expect(await ingest(9.6, -1)).toBe(201);
    expect(await ingest(9.9, 0)).toBe(201);
    const latest = await q1(`SELECT alert_state, alert_recipients FROM cold_chain_breaches WHERE tenant_id=$1 AND subject_id=$2 ORDER BY opened_at DESC LIMIT 1`, [T, cooler]);
    expect(latest).toMatchObject({ alert_state: 'alerted', alert_recipients: 3 });
  });
});
