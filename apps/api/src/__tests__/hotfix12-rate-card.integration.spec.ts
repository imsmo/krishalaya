// apps/api/src/__tests__/hotfix12-rate-card.integration.spec.ts · PC-56 HOTFIX-12 — NO RATE CHANGE WITHOUT A SECOND PERSON AND A RECORD, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, migration 0234.
// `dairy` is seeded OFF and switched ON for THESE two organisations only (an allow-list fixture), restored in afterAll. Own fixtures.
//
// Founder Q1-A + Q1-sub (2026-11-08): every new card recorded; a second person approves it before it prices anything (the creator
// cannot); it starts on the tenant's TOMORROW at the earliest (founder follow-up 2026-11-08: today is refused, no day is ever split);
// one card in force per milk type; members told in their own language when it
// is approved (push / in-app, never SMS); cards that existed when the rule shipped keep pricing. Brief §C's eight cases:
//   (1) create → one audit row; the card prices nothing until approved (the old card prices that day's pour)
//   (2) the creator approving → 403 by name; a second person → 201, audit row, predecessor closed the day before
//   (3) a backdated create → refused, nothing written; approving after the start has passed → refused
//   (4) a same-start overlap → RATE_CARD_OVERLAP, nothing written (and the database's exclusion refuses it too)
//   (5) the database, as kv_app: self-approval, un-approval, editing an approved card, reopening a closed one → refused
//   (6) a pre-rule card still prices                     (7) the member notice: her language, push + in-app, no SMS
//   (8) a same-key replay → the same response, no second row
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { NotificationService } from '../modules/communication/services/notification.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy'] as const;

run('PC-56 HOTFIX-12 · a second person and a record on every milk rate card (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let appPool: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID(); const T2 = randomUUID();
  let A = ''; let B = ''; let fCow = ''; let fBuf = ''; let fCow2 = ''; let E = ''; let F = ''; let fT2 = '';
  let mcc1 = ''; let mcc2 = ''; let memCow = ''; let memBuf = ''; let memT2 = '';
  let today = ''; let yesterday = ''; let tomorrow = ''; let plus5 = '';
  let oldCow = ''; let legacyT2 = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];

  const H = (token: string, tenant: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const post = (token: string, path: string, body: object = {}, key: string | null = randomUUID(), tenant: string = T1) =>
    request(http).post(path).set(key ? { ...H(token, tenant), 'idempotency-key': key } : H(token, tenant)).send(body);
  const get = (token: string, path: string, tenant: string = T1) => request(http).get(path).set(H(token, tenant));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const card = async (id: string) => (await admin.query(
    `SELECT created_by, approved_by, approved_at, approved_before_rule, effective_from::text AS f, effective_to::text AS t, rate_per_kg_fat_minor::text AS fat FROM milk_rate_cards WHERE id = $1`, [id])).rows[0];
  const audits = (id: string, action: string) => n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = $2`, [id, action]);
  const outbox = (id: string, type: string) => n(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type = $2`, [id, type]);
  const cardBody = (o: object = {}) => ({ defaultName: `Cow Dec ${randomUUID().slice(0, 6)}`, animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '75000', ratePerKgSnfMinor: '35000', effectiveFrom: tomorrow, ...o });
  const pour = (mem: string, shift: 'morning' | 'evening', tenant: string = T1, token: string = tok.A) =>
    post(token, '/v1/dairy/collections', { membershipId: mem, shift, collectedOn: today, weightKg: '10.000', fatPct: '6.00', snfPct: '9.00' }, randomUUID(), tenant);
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T1}`, `flagctx:${T2}`]) await cache.del(c);
  }
  /** kv_app, in a session that names a person — exactly what the unit of work does — rolled back whatever happens. */
  async function asKvApp(userId: string, tenant: string, sql: string, params: unknown[]): Promise<{ code?: string; message?: string }> {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [tenant, userId]);
      await c.query(sql, params);
      return {};
    } catch (e) { return { code: (e as { code?: string }).code, message: (e as Error).message }; }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL }); appPool = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, T1, `HF12 desk ${T1.slice(0, 4)}`);
    await makeTenant(admin, T2, `HF12 legacy ${T2.slice(0, 4)}`);
    [A, B, fCow, fBuf, fCow2, E, F, fT2] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET language_code = 'gu' WHERE id = $1`, [fCow]);
    await admin.query(`UPDATE users SET language_code = 'hi' WHERE id = $1`, [fCow2]);
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    for (const u of [A, B]) await role(u, T1, 'tenant_admin');
    for (const u of [fCow, fBuf, fCow2]) await role(u, T1, 'farmer');
    await role(E, T2, 'tenant_admin'); await role(F, T2, 'tenant_admin'); await role(fT2, T2, 'farmer');
    const d = (await admin.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') t, to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'YYYY-MM-DD') y, to_char((now() AT TIME ZONE 'Asia/Kolkata')::date + 5, 'YYYY-MM-DD') p, to_char((now() AT TIME ZONE 'Asia/Kolkata')::date + 1, 'YYYY-MM-DD') m`)).rows[0];
    today = d.t; yesterday = d.y; tomorrow = d.m; plus5 = d.p;

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));   // seeded OFF
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T1, T2] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    const manage = ['dairy.manage'];
    tok.A = mintToken(app, { userId: A, tenantId: T1, roles: ['tenant_admin'], perms: manage });
    tok.B = mintToken(app, { userId: B, tenantId: T1, roles: ['tenant_admin'], perms: manage });
    tok.fCow = mintToken(app, { userId: fCow, tenantId: T1, roles: ['farmer'], perms: [] });
    tok.E = mintToken(app, { userId: E, tenantId: T2, roles: ['tenant_admin'], perms: manage });

    // Centres and members through the real routes (the enrolment opens each member's route).
    mcc1 = (await post(tok.A, '/v1/dairy/mccs', { code: 'HF12-1', defaultName: 'HF12 centre' })).body.data.id;
    mcc2 = (await post(tok.E, '/v1/dairy/mccs', { code: 'HF12-2', defaultName: 'HF12 legacy centre' }, randomUUID(), T2)).body.data.id;
    const enrol = async (token: string, tenant: string, farmer: string, mcc: string, code: string, animal: string) =>
      (await post(token, '/v1/dairy/mccs/memberships', { farmerUserId: farmer, mccId: mcc, memberCode: code, paymentCycle: 'weekly', defaultAnimalType: animal }, randomUUID(), tenant)).body.data.id as string;
    memCow = await enrol(tok.A, T1, fCow, mcc1, 'HF12-C1', 'cow');
    memBuf = await enrol(tok.A, T1, fBuf, mcc1, 'HF12-B1', 'buffalo');
    await enrol(tok.A, T1, fCow2, mcc1, 'HF12-C2', 'cow');
    memT2 = await enrol(tok.E, T2, fT2, mcc2, 'HF12-L1', 'buffalo');

    // THE CARDS THAT EXISTED WHEN THE RULE SHIPPED (founder Q1-sub). A from-empty database has none when 0234 runs, so these
    // stand for them: admin-realm rows carrying exactly the stamp 0234's UPDATE writes on every existing row.
    const legacy = (tenant: string, animal: string, fat: number) => admin.query(
      `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, effective_from, is_active, approved_before_rule, approved_at)
       VALUES ($1, $2, $3, 'two_axis', $4, 30000, CURRENT_DATE - 30, true, true, now()) RETURNING id`, [tenant, `Legacy ${animal}`, animal, fat]);
    oldCow = (await legacy(T1, 'cow', 70000)).rows[0].id;
    legacyT2 = (await legacy(T2, 'buffalo', 71000)).rows[0].id;
  }, 180_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await appPool?.end(); await admin?.end();
  }, 40_000);

  let N = ''; let createKey = ''; let createBody: unknown = null;
  it('(1) a card starting TODAY is refused at create; A creates a cow card starting tomorrow → 201, awaiting a second person, ONE audit row with the whole card; it prices NOTHING — the old card prices the pour', async () => {
    // Founder follow-up (2026-11-08): tomorrow at the earliest — a start of today is refused by name and writes nothing.
    const todayName = `Today ${randomUUID().slice(0, 6)}`;
    const t = await post(tok.A, '/v1/dairy/rate-cards', cardBody({ defaultName: todayName, effectiveFrom: today }));
    expect([t.status, t.body.error?.code, t.body.error?.message]).toEqual([422, 'RATE_CARD_BACKDATED',
      `A milk rate card can start tomorrow at the earliest. This card starts on ${today}; today is ${today} for your organisation.`]);
    expect(await n(`SELECT count(*)::int n FROM milk_rate_cards WHERE default_name = $1`, [todayName])).toBe(0);
    createKey = randomUUID();
    const body = cardBody({ defaultName: 'Cow two-axis HF12' });
    const r = await post(tok.A, '/v1/dairy/rate-cards', body, createKey);
    expect(r.status).toBe(201);
    N = r.body.data.id; createBody = r.body.data;
    expect(r.body.data).toMatchObject({ approvalState: 'awaiting_second_person', approvedAt: null, createdByYou: true, approvedByYou: false, effectiveFrom: tomorrow });
    expect(JSON.stringify(r.body.data)).not.toContain(A);                       // no person id on the wire
    expect(await card(N)).toMatchObject({ created_by: A, approved_by: null, approved_at: null, approved_before_rule: false });
    expect(await audits(N, 'dairy.rate_card.created')).toBe(1);
    const a = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE entity_id = $1 AND action = 'dairy.rate_card.created'`, [N])).rows[0];
    expect(a.actor_user_id).toBe(A);
    expect(a.new_value).toMatchObject({ id: N, defaultName: 'Cow two-axis HF12', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '75000', ratePerKgSnfMinor: '35000',
      baseRatePerLitreMinor: null, bonusSlabs: [], effectiveFrom: tomorrow, effectiveTo: null, isActive: true, approvalState: 'awaiting_second_person', createdBy: A });
    // It prices nothing: the morning pour is priced by the card that existed before.
    const p = await pour(memCow, 'morning');
    expect([p.status, p.body.data?.rateCardId]).toEqual([201, oldCow]);
    // …and the member's "active" list does not show it.
    const list = await get(tok.fCow, '/v1/dairy/rate-cards?animalType=cow');
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([oldCow]);
  });

  it('(2) A approves her own card → 403 RATE_CARD_SECOND_PERSON_REQUIRED, nothing written; B approves → 201, stamped, one audit row, the old card closed ON TODAY and today\'s pours stay on it', async () => {
    const r = await post(tok.A, `/v1/dairy/rate-cards/${N}/approve`);
    expect([r.status, r.body.error?.code]).toEqual([403, 'RATE_CARD_SECOND_PERSON_REQUIRED']);
    expect(await card(N)).toMatchObject({ approved_by: null, approved_at: null });
    expect((await card(oldCow)).t).toBeNull();
    expect(await audits(N, 'dairy.rate_card.approved')).toBe(0);
    expect(await outbox(N, 'dairy.rate_card_approved')).toBe(0);

    const ok = await post(tok.B, `/v1/dairy/rate-cards/${N}/approve`);
    expect([ok.status, ok.body.data?.approvalState, ok.body.data?.approvedByYou, ok.body.data?.createdByYou]).toEqual([201, 'approved', true, false]);
    const c = await card(N);
    expect(c).toMatchObject({ created_by: A, approved_by: B });
    expect(c.approved_at).toBeInstanceOf(Date);
    expect((await card(oldCow)).t).toBe(today);                                  // closed AT APPROVAL, ON TODAY — the day before the new card starts
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = 'dairy.rate_card.approved' AND actor_user_id = $2`, [N, B])).toBe(1);
    // NO DAY IS SPLIT (founder follow-up 2026-11-08): a pour recorded today AFTER the approval is still priced by the old card,
    // so every one of today's pours carries the card that is in force for the whole of today.
    const p = await pour(memCow, 'evening');
    expect([p.status, p.body.data?.rateCardId]).toEqual([201, oldCow]);
    expect(await n(`SELECT count(*)::int n FROM milk_collections WHERE membership_id = $1 AND collected_on = $2::date AND rate_card_id = $3`, [memCow, today, oldCow])).toBe(2);
    expect(await n(`SELECT count(*)::int n FROM milk_collections WHERE collected_on = $1::date AND rate_card_id = $2`, [today, N])).toBe(0);
    // The two cards meet at midnight and never overlap: old [.., today], new [tomorrow, ..).
    expect(await card(N)).toMatchObject({ f: tomorrow, t: null });
  });

  it('(3) a backdated create → 422 RATE_CARD_BACKDATED, nothing written; approving a card whose start is today or past → 422 RATE_CARD_BACKDATED', async () => {
    const name = `Backdated ${randomUUID().slice(0, 6)}`;
    const r = await post(tok.A, '/v1/dairy/rate-cards', cardBody({ defaultName: name, effectiveFrom: yesterday }));
    expect([r.status, r.body.error?.code]).toEqual([422, 'RATE_CARD_BACKDATED']);
    expect(await n(`SELECT count(*)::int n FROM milk_rate_cards WHERE default_name = $1`, [name])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'dairy.rate_card.created' AND new_value->>'defaultName' = $2`, [T1, name])).toBe(0);

    const late = (await post(tok.A, '/v1/dairy/rate-cards', cardBody({ animalType: 'buffalo', effectiveFrom: tomorrow }))).body.data.id;
    // The clock passing, for one row: the admin realm moves its start back (the only realm 0234's guard exempts) — first to
    // TODAY (the founder's follow-up: today is refused at approval too), then to yesterday.
    for (const start of [today, yesterday]) {
      await admin.query(`UPDATE milk_rate_cards SET effective_from = $2::date WHERE id = $1`, [late, start]);
      const ap = await post(tok.B, `/v1/dairy/rate-cards/${late}/approve`);
      expect([start, ap.status, ap.body.error?.code]).toEqual([start, 422, 'RATE_CARD_BACKDATED']);
      expect(await card(late)).toMatchObject({ approved_by: null, approved_at: null });
      // …and the DATABASE refuses the same approval written directly, as kv_app in B's own session.
      const db = await asKvApp(B, T1, `UPDATE milk_rate_cards SET approved_by = $2, approved_at = now() WHERE id = $1`, [late, B]);
      expect([start, db.code, /starts tomorrow at the earliest/.test(db.message ?? '')]).toEqual([start, '23514', true]);
    }
  });

  let X = ''; let Y = '';
  it('(4) two buffalo cards starting the same day: the second approval → 409 RATE_CARD_OVERLAP, nothing written; the database\'s exclusion refuses it too', async () => {
    X = (await post(tok.A, '/v1/dairy/rate-cards', cardBody({ animalType: 'buffalo', effectiveFrom: plus5, defaultName: 'Buffalo X' }))).body.data.id;
    Y = (await post(tok.A, '/v1/dairy/rate-cards', cardBody({ animalType: 'buffalo', effectiveFrom: plus5, defaultName: 'Buffalo Y' }))).body.data.id;
    expect((await post(tok.B, `/v1/dairy/rate-cards/${X}/approve`)).status).toBe(201);
    const r = await post(tok.B, `/v1/dairy/rate-cards/${Y}/approve`);
    expect([r.status, r.body.error?.code, r.body.error?.details?.clashWith]).toEqual([409, 'RATE_CARD_OVERLAP', [X]]);
    expect(await card(Y)).toMatchObject({ approved_by: null, approved_at: null });
    expect((await card(X)).t).toBeNull();
    expect(await audits(Y, 'dairy.rate_card.approved')).toBe(0);
    expect(await outbox(Y, 'dairy.rate_card_approved')).toBe(0);
    const db = await asKvApp(B, T1, `UPDATE milk_rate_cards SET approved_by = $2, approved_at = now() WHERE id = $1`, [Y, B]);
    expect([db.code, /ex_rate_card_one_in_force/.test(db.message ?? '')]).toEqual(['23P01', true]);
  });

  it('(5) the database, as kv_app: approved_by = created_by → CHECK; un-approving, re-pricing or reopening an approved card → the guard; a row born approved → the guard', async () => {
    // Self-approval in the creator's own session: the guard lets the session person through, the CHECK refuses the row.
    const self = await asKvApp(A, T1, `UPDATE milk_rate_cards SET approved_by = created_by, approved_at = now() WHERE id = $1`, [Y]);
    expect([self.code, /ck_rate_card_approver_ne_creator/.test(self.message ?? '')]).toEqual(['23514', true]);
    // Naming a colleague as approver from the creator's session → refused (an approval names the person approving).
    const proxy = await asKvApp(A, T1, `UPDATE milk_rate_cards SET approved_by = $2, approved_at = now() WHERE id = $1`, [Y, B]);
    expect([proxy.code, /in their own session/.test(proxy.message ?? '')]).toEqual(['23514', true]);
    const unApprove = await asKvApp(B, T1, `UPDATE milk_rate_cards SET approved_by = NULL, approved_at = NULL WHERE id = $1`, [N]);
    expect([unApprove.code, /an approval is final/.test(unApprove.message ?? '')]).toEqual(['23514', true]);
    const reprice = await asKvApp(B, T1, `UPDATE milk_rate_cards SET rate_per_kg_fat_minor = 1 WHERE id = $1`, [N]);
    expect([reprice.code, /prices, dates and state are frozen/.test(reprice.message ?? '')]).toEqual(['23514', true]);
    const redate = await asKvApp(B, T1, `UPDATE milk_rate_cards SET effective_from = effective_from + 1 WHERE id = $1`, [N]);
    expect(redate.code).toBe('23514');
    const deactivate = await asKvApp(B, T1, `UPDATE milk_rate_cards SET is_active = false WHERE id = $1`, [N]);
    expect(deactivate.code).toBe('23514');
    // Closing an approved card INTO THE PAST (before today) would re-write a priced day → refused.
    const backClose = await asKvApp(B, T1, `UPDATE milk_rate_cards SET effective_to = $2::date WHERE id = $1`, [oldCow, yesterday]);
    expect([backClose.code, /never closed in the past/.test(backClose.message ?? '')]).toEqual(['23514', true]);
    const reopen = await asKvApp(B, T1, `UPDATE milk_rate_cards SET effective_to = NULL WHERE id = $1`, [oldCow]);
    expect([reopen.code, /only ever closed earlier/.test(reopen.message ?? '')]).toEqual(['23514', true]);
    const legacyFlip = await asKvApp(B, T1, `UPDATE milk_rate_cards SET approved_before_rule = true, approved_at = now() WHERE id = $1`, [Y]);
    expect(legacyFlip.code).toBe('23514');
    const born = await asKvApp(A, T1, `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, effective_from, created_by, approved_by, approved_at)
      VALUES ($1, 'born approved', 'mixed', 'fat_pooled', 1, CURRENT_DATE + 1, $2, $3, now())`, [T1, A, B]);
    expect([born.code, /born awaiting a second person/.test(born.message ?? '')]).toEqual(['23514', true]);
    const anon = await asKvApp(A, T1, `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, effective_from)
      VALUES ($1, 'no creator', 'mixed', 'fat_pooled', 1, CURRENT_DATE + 1)`, [T1]);
    expect(anon.code).toBe('23514');
    // Every refused write left the rows as they were.
    expect(await card(N)).toMatchObject({ created_by: A, approved_by: B, fat: '75000', f: tomorrow });
    // No grant was added: kv_app holds table INSERT + UPDATE and no DELETE (0079), and no column-level ACL on the new columns.
    const acl = (await admin.query(`SELECT has_table_privilege('kv_app','milk_rate_cards','DELETE') d, (SELECT count(*)::int FROM pg_attribute WHERE attrelid='milk_rate_cards'::regclass AND attname IN ('approved_by','approved_at','approved_before_rule') AND attacl IS NOT NULL) c, has_table_privilege('kv_app','milk_rate_cards','UPDATE') u`)).rows[0];
    expect([acl.d, acl.c, acl.u]).toEqual([false, 0, true]);
  });

  it('(6) a card that existed when the rule shipped keeps pricing; the list names it; 0234 stamps every existing row so', async () => {
    const p = await pour(memT2, 'morning', T2, tok.E);
    expect([p.status, p.body.data?.rateCardId]).toEqual([201, legacyT2]);
    const list = await get(tok.E, '/v1/dairy/rate-cards?activeOnly=false', T2);
    expect(list.body.data.find((c: { id: string }) => c.id === legacyT2)).toMatchObject({ approvalState: 'approved_before_rule', createdByYou: false, approvedByYou: false });
    const sql = readFileSync(join(__dirname, '../../../../db/migrations/0234_hotfix12_rate_card_second_person.sql'), 'utf8');
    expect(sql).toContain('SET approved_before_rule = true, approved_at = now()');
    // A buffalo pour in T1, where no buffalo card is approved and in force today → the existing refusal, unchanged.
    const none = await pour(memBuf, 'morning');
    expect([none.status, none.body.error?.code]).toEqual([422, 'NO_ACTIVE_RATE_CARD']);
  });

  it('(7) the members are told: one approval event naming the cow members (not the buffalo member, not staff); the fan-out writes push + in-app in HER language, no SMS, no amount', async () => {
    const ev = (await admin.query(`SELECT id, payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'dairy.rate_card_approved'`, [N])).rows;
    expect(ev.length).toBe(1);
    expect([...ev[0].payload.recipientUserIds].sort()).toEqual([fCow, fCow2].sort());
    expect(ev[0].payload).toMatchObject({ rateCardId: N, cardName: 'Cow two-axis HF12', effectiveFrom: `${tomorrow.slice(8, 10)}/${tomorrow.slice(5, 7)}/${tomorrow.slice(0, 4)}`, predecessorIds: [oldCow] });
    const cat = (await admin.query(`SELECT priority, default_channels FROM notification_events WHERE code = 'dairy.rate_card_approved'`)).rows[0];
    expect(cat).toEqual({ priority: 'important', default_channels: ['push', 'inapp'] });
    expect(await n(`SELECT count(*)::int n FROM notification_templates WHERE event_code = 'dairy.rate_card_approved' AND channel = 'sms'`)).toBe(0);

    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const notifications = app.get(NotificationService, { strict: false });
    await uow.run(T1, (tx) => notifications.fanout(tx, { tenantId: T1, eventCode: 'dairy.rate_card_approved', recipients: ev[0].payload.recipientUserIds, payload: ev[0].payload, dedupeKey: ev[0].id }), { userId: 'system' });
    const rows = (await admin.query(`SELECT n.user_id, n.channel, n.language_code, n.status, v.body
        FROM notifications n LEFT JOIN notification_template_versions v ON v.id = n.template_version_id
       WHERE n.event_code = 'dairy.rate_card_approved' AND n.tenant_id = $1 ORDER BY n.user_id, n.channel`, [T1])).rows;
    const of = (u: string) => rows.filter((r: { user_id: string }) => r.user_id === u);
    expect(of(fCow).map((r: { channel: string }) => r.channel).sort()).toEqual(['inapp', 'push']);
    expect(of(fCow).every((r: { language_code: string }) => r.language_code === 'gu')).toBe(true);
    expect(of(fCow2).every((r: { language_code: string }) => r.language_code === 'hi')).toBe(true);
    expect(of(fBuf)).toEqual([]);
    expect(rows.some((r: { channel: string }) => r.channel === 'sms')).toBe(false);
    // The words she gets are the seeded Gujarati version (served, not `no_template`), and they carry only the two variables.
    const inapp = of(fCow).find((r: { channel: string }) => r.channel === 'inapp');
    expect(inapp?.body).toContain('{{cardName}}');
    expect(inapp?.body).toContain('{{effectiveFrom}}');
    expect(inapp?.body).toContain('રેટ કાર્ડ');
    expect(inapp?.body).not.toMatch(/\d|₹/u);
  });

  it('(8) replay with the same Idempotency-Key → the same response, no second row, no second audit row, no second event', async () => {
    const again = await post(tok.A, '/v1/dairy/rate-cards', cardBody({ defaultName: 'Cow two-axis HF12' }), createKey);
    expect(again.status).toBe(201);
    expect(again.body.data).toEqual(createBody);
    expect(await n(`SELECT count(*)::int n FROM milk_rate_cards WHERE default_name = 'Cow two-axis HF12'`)).toBe(1);
    expect(await audits(N, 'dairy.rate_card.created')).toBe(1);
    // The approval, replayed by its approver with its own key, answers the same approval and moves nothing again.
    const key = randomUUID();
    const Z = (await post(tok.A, '/v1/dairy/rate-cards', cardBody({ animalType: 'mixed', effectiveFrom: plus5 }))).body.data.id;
    const first = await post(tok.B, `/v1/dairy/rate-cards/${Z}/approve`, {}, key);
    const second = await post(tok.B, `/v1/dairy/rate-cards/${Z}/approve`, {}, key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.data).toEqual(first.body.data);
    expect(await audits(Z, 'dairy.rate_card.approved')).toBe(1);
    expect(await outbox(Z, 'dairy.rate_card_approved')).toBe(1);
    // A NEW key on the approved card → 409 by name.
    const third = await post(tok.B, `/v1/dairy/rate-cards/${Z}/approve`);
    expect([third.status, third.body.error?.code]).toEqual([409, 'RATE_CARD_ALREADY_APPROVED']);
    // No key → 400.
    expect((await post(tok.B, `/v1/dairy/rate-cards/${Z}/approve`, {}, null)).status).toBe(400);
  });

  it('(9) the migration, from empty: three columns, the CHECKs, the guard, the exclusion over btree_gist (already installed), the RLS policy count untouched by it', async () => {
    const cols = (await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_name='milk_rate_cards' AND column_name IN ('created_by','approved_by','approved_at','approved_before_rule') ORDER BY 1`)).rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toEqual(['approved_at', 'approved_before_rule', 'approved_by', 'created_by']);
    const cons = (await admin.query(`SELECT conname, contype FROM pg_constraint WHERE conrelid='milk_rate_cards'::regclass AND conname IN ('ck_rate_card_approver_ne_creator','ck_rate_card_approval_stamp','ex_rate_card_one_in_force','fk_milk_rate_cards_created_by') ORDER BY 1`)).rows;
    expect(cons).toEqual([{ conname: 'ck_rate_card_approval_stamp', contype: 'c' }, { conname: 'ck_rate_card_approver_ne_creator', contype: 'c' }, { conname: 'ex_rate_card_one_in_force', contype: 'x' }, { conname: 'fk_milk_rate_cards_created_by', contype: 'f' }]);
    expect(await n(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='milk_rate_cards'::regclass AND tgname='milk_rate_cards_hf12_guard'`)).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM pg_extension WHERE extname='btree_gist'`)).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM pg_policies WHERE tablename = 'milk_rate_cards'`)).toBeGreaterThan(0);
  });
});
