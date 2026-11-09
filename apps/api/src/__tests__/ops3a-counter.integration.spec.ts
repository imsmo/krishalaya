// apps/api/src/__tests__/ops3a-counter.integration.spec.ts · PC-56 OPS-3a — THE COUNTER, LIVE (survey_ops3 §7 `ops3a-counter` items 1–8, verbatim
// in intent, plus the brief's three). The real AppModule over HTTP (supertest, listening ONCE on 127.0.0.1 — the HOTFIX-5 pin), real Postgres + RLS
// as kv_app, a database built from EMPTY by the harness. `dairy` is seeded OFF and switched ON for THIS organisation only (an allow-list fixture),
// restored in afterAll. Every token carries what the database grants (`RoleCacheService.effectiveAccess` → `TokenService.mintAccessToken`). The
// rate card is created and approved through the REAL service by two people (HOTFIX-12's helper). Centres and custody through the real route.
//   (1) B2: `collectedOn` = the organisation's tomorrow → POUR_DATE_IN_FUTURE; a day inside a LIVE bill of hers → POUR_WINDOW_ALREADY_BILLED; in each
//       case NO milk_collections, milk_quality_reviews, outbox_events or idempotency_keys row; a replay with the same key → the same refusal; today → 201
//       with the server's amountMinor; a VOIDED bill's window is not "billed"
//   (2) ordering: the refusal precedes the idempotency record (proved by its absence on the replay) — the unit ordering spy is ops3a-pour-date.spec.ts
//   (3) immutability: as kv_app, UPDATE weight_kg / fat_pct / snf_pct → 42501, DELETE → 42501; UPDATE milk_bill_id and hold_state → allowed (rolled back)
//   (4) duplicate: the same member / day / shift twice with two keys → DUPLICATE_COLLECTION 409
//   (5) the day sheet: slips, kg and amounts as strings; a HELD pour is inside amountMinor AND in heldMinor; payable + held + rejected = amountMinor
//   (6) the roll: box=mcc&mccId → that centre's members only, keyset, code prefix; a pour for another centre's member, no diversion → POUR_NOT_AT_THIS_CENTRE
//   (7) a void re-bills unchanged (F-4 pinned): record → bill → preview → her dispute → upheld + void → rebuilt with the same gross; the pour's amount untouched
//   (8) absence → 404: correct / reverse / accept a pour, shifts and their close, a slip and a reprint
//   (9) a dairy.collect-only person in custody records through the route the page uses (with the centre's id), under their own id
//  (10) a dairy.read-only person cannot record (403 naming the any-of set)
//  (11) B14: `GET /v1/dairy/mccs/mine` — the custodian gets their centre and the organisation's today; a person holding no custody gets NO centre
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { TokenService } from '../core/auth/token.service';
import { MilkRateCardService } from '../modules/dairy/services/milk-rate-card.service';
import { approvedCardForTest, tenantTodayForTest } from '../modules/dairy/__tests__/helpers/hotfix12-approved-card';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy'] as const;

run('PC-56 OPS-3a · the counter (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let appPool: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  let roleCache: RoleCacheService; let tokens: TokenService;
  const T = randomUUID();
  let A1 = ''; let A2 = ''; let C = ''; let R = ''; let F1 = ''; let F2 = ''; let F3 = ''; let F4 = '';
  let mcc1 = ''; let mcc2 = ''; let mem1 = ''; let mem2 = ''; let mem3 = ''; let memAway = '';
  let today = ''; let tomorrow = ''; let yesterday = ''; let twoAgo = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];
  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T });
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const post = (token: string, path: string, body: object = {}, key: string = randomUUID()) => request(http).post(path).set({ ...H(token), 'idempotency-key': key }).send(body);
  const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, T, code]);
  async function login(u: string): Promise<string> {
    await roleCache.invalidate(u, T);
    const a = await roleCache.effectiveAccess(u, T);
    return tokens.mintAccessToken({ sub: u, tid: T, sid: 'ops3a', roles: a.roles, perms: a.permissions });
  }
  const pourBody = (membershipId: string, shift: 'morning' | 'evening', collectedOn: string, extra: object = {}) =>
    ({ membershipId, shift, collectedOn, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', ...extra });
  const counts = async (key: string) => (await admin.query(
    `SELECT (SELECT count(*)::int FROM milk_collections WHERE tenant_id = $1) AS pours,
            (SELECT count(*)::int FROM milk_quality_reviews WHERE tenant_id = $1) AS reviews,
            (SELECT count(*)::int FROM outbox_events WHERE tenant_id = $1 AND aggregate_type IN ('milk_collection', 'milk_quality_review')) AS outbox,
            (SELECT count(*)::int FROM idempotency_keys WHERE key LIKE '%' || $2 || '%') AS keys`, [T, key])).rows[0];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL }); appPool = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, T, `OPS3a dairy ${T.slice(0, 4)}`);
    [A1, A2, C, R, F1, F2, F3, F4] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    const suffix = T.slice(0, 8).replace(/-/g, '');
    for (const [code, perm] of [[`ops3a_counter_${suffix}`, 'dairy.collect'], [`ops3a_reader_${suffix}`, 'dairy.read']]) {
      await admin.query(`INSERT INTO roles (code, default_name, scope) VALUES ($1, $1, 'tenant')`, [code]);
      await admin.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, $2 FROM roles WHERE code = $1`, [code, perm]);
    }
    await role(A1, 'tenant_admin'); await role(A2, 'tenant_admin');
    await role(C, `ops3a_counter_${suffix}`); await role(R, `ops3a_reader_${suffix}`);
    for (const f of [F1, F2, F3, F4]) await role(f, 'dairy_farmer');

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    roleCache = app.get(RoleCacheService); tokens = app.get(TokenService);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
    for (const [k, u] of Object.entries({ A1, A2, C, R, F1, F2 })) tok[k] = await login(u);

    today = await tenantTodayForTest(admin, T);
    const d = (n: number) => admin.query(`SELECT ($1::date + $2::int)::text AS d`, [today, n]).then((r) => String(r.rows[0].d));
    [tomorrow, yesterday, twoAgo] = await Promise.all([d(1), d(-1), d(-2)]);
    // Two centres through the REAL route — the first opens a custody row naming the collect-only person (6d-2); the second names nobody.
    const c1 = await post(tok.A1, '/v1/dairy/mccs', { code: 'C-OPS3A-1', defaultName: 'OPS3a centre one', operatorUserId: C, operatorReason: 'counter custody for the live spec' });
    const c2 = await post(tok.A1, '/v1/dairy/mccs', { code: 'C-OPS3A-2', defaultName: 'OPS3a centre two' });
    expect([c1.status, c2.status]).toEqual([201, 201]); mcc1 = c1.body.data.id; mcc2 = c2.body.data.id;
    const enrol = async (u: string, mccId: string, code: string) => {
      const r = await post(tok.A1, '/v1/dairy/mccs/memberships', { farmerUserId: u, mccId, memberCode: code });
      expect(r.status).toBe(201); return r.body.data.id as string;
    };
    mem1 = await enrol(F1, mcc1, 'TA-001'); mem2 = await enrol(F2, mcc1, 'TA-002'); mem3 = await enrol(F3, mcc1, 'TB-003'); memAway = await enrol(F4, mcc2, 'TA-900');
    // An approved card for 'mixed' milk (the enrolment default), created and approved through the REAL service by two people, in force from 30 days ago.
    const cards = app.get(MilkRateCardService);
    await approvedCardForTest(cards, admin, T, { userId: A1, canManage: true }, { defaultName: 'OPS3a mixed', animalType: 'mixed', pricingModel: 'two_axis',
      ratePerKgFatMinor: '64900', ratePerKgSnfMinor: '21700', effectiveFrom: (await d(-30)) }, { checkerUserId: A2 });
  }, 240_000);

  afterAll(async () => {
    // this spec's two custom roles are removed again: other live specs in the same run (ops3p (7)) pin the catalogue's exact dairy grants
    try {
      const suffix = T.slice(0, 8).replace(/-/g, '');
      const codes = [`ops3a_counter_${suffix}`, `ops3a_reader_${suffix}`];
      await admin.query(`DELETE FROM user_tenant_roles WHERE role_id IN (SELECT id FROM roles WHERE code = ANY($1))`, [codes]);
      await admin.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = ANY($1))`, [codes]);
      await admin.query(`DELETE FROM roles WHERE code = ANY($1)`, [codes]);
    } catch { /* teardown only */ }
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await appPool?.end(); await admin?.end();
  }, 40_000);

  it('(11) B14: the custodian\'s centre and the organisation\'s today; a person with no custody gets NO centre', async () => {
    const mine = await get(tok.C, '/v1/dairy/mccs/mine');
    expect([mine.status, mine.body.data.today, mine.body.data.centres.map((c: { id: string }) => c.id)]).toEqual([200, today, [mcc1]]);
    // the register, not the column: the custody row is OPEN and names C
    expect((await admin.query(`SELECT count(*)::int AS n FROM mcc_operator_assignments WHERE tenant_id=$1 AND mcc_id=$2 AND operator_user_id=$3 AND ended_at IS NULL`, [T, mcc1, C])).rows[0].n).toBe(1);
    for (const who of ['R', 'A1']) {
      const r = await get(tok[who], '/v1/dairy/mccs/mine');
      expect([who, r.status, r.body.data.centres]).toEqual([who, 200, []]);
    }
    // no dairy permission at all → refused by name
    const f = await get(tok.F1, '/v1/dairy/mccs/mine');
    expect([f.status, f.body?.error?.code]).toEqual([403, 'FORBIDDEN']);
    // `mine` is not swallowed by `:id` (the route-order trap)
    expect((await get(tok.C, `/v1/dairy/mccs/${mcc1}`)).status).toBe(200);
  });

  it('(6) the roll: box=mcc → that centre\'s members only, keyset, by a code prefix; another centre\'s member → POUR_NOT_AT_THIS_CENTRE', async () => {
    const all = await get(tok.C, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}&limit=2`);
    expect(all.status).toBe(200);
    const page1 = (all.body.data as Array<{ id: string; mccId: string }>);
    expect(page1.length).toBe(2); expect(page1.every((m) => m.mccId === mcc1)).toBe(true);
    const next = await get(tok.C, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}&limit=2&cursor=${encodeURIComponent(all.body.meta.nextCursor)}`);
    const ids = [...page1, ...(next.body.data as Array<{ id: string }>)].map((m) => m.id).sort();
    expect(ids).toEqual([mem1, mem2, mem3].sort());
    const ta = await get(tok.C, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}&code=ta`);
    expect((ta.body.data as Array<{ memberCode: string }>).map((m) => m.memberCode).sort()).toEqual(['TA-001', 'TA-002']);   // case-blind prefix; TA-900 is the other centre's
    for (const m of ta.body.data as object[]) expect(Object.keys(m).some((k) => /name|phone|photo/i.test(k))).toBe(false);
    const away = await post(tok.C, '/v1/dairy/collections', pourBody(memAway, 'morning', today, { mccId: mcc1 }));
    expect([away.status, away.body?.error?.code]).toEqual([409, 'POUR_NOT_AT_THIS_CENTRE']);
  });

  it('(1)+(2) B2: tomorrow → POUR_DATE_IN_FUTURE, nothing written, the replay refused the same; today → 201 with the server\'s price', async () => {
    const before = await counts('none');
    const key = randomUUID();
    const r1 = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', tomorrow, { mccId: mcc1 }), key);
    expect([r1.status, r1.body?.error?.code, r1.body?.error?.details]).toEqual([422, 'POUR_DATE_IN_FUTURE', { collectedOn: tomorrow, today }]);
    const r2 = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', tomorrow, { mccId: mcc1 }), key);
    expect([r2.status, r2.body?.error?.code]).toEqual([422, 'POUR_DATE_IN_FUTURE']);
    expect(await counts(key)).toEqual({ ...before, keys: 0 });
    // the organisation's today itself is fine — and the pour is priced by the SERVER, from the approved card
    const okKey = randomUUID();
    const ok = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', today, { mccId: mcc1 }), okKey);
    expect(ok.status).toBe(201);
    // POSITIVE CONTROL for the "no idempotency row" assertions: a recorded pour's key IS found by the same query
    expect((await counts(okKey)).keys).toBe(1);
    expect(ok.body.data.amountMinor).toMatch(/^\d+$/);
    expect(BigInt(ok.body.data.amountMinor) > 0n).toBe(true);
    expect([ok.body.data.weightKg, ok.body.data.fatPct, ok.body.data.snfPct]).toEqual(['10.500', '4.10', '8.50']);
  });

  it('(9)+(10) collect-only records through the page\'s route under their own id; read-only cannot record', async () => {
    const p = await post(tok.C, '/v1/dairy/collections', pourBody(mem2, 'morning', today, { mccId: mcc1 }));
    expect([p.status, p.body.data.mccId]).toEqual([201, mcc1]);
    expect((await admin.query(`SELECT entered_by, mcc_id FROM milk_collections WHERE tenant_id=$1 AND id=$2`, [T, p.body.data.id])).rows).toEqual([{ entered_by: C, mcc_id: mcc1 }]);
    const r = await post(tok.R, '/v1/dairy/collections', pourBody(mem3, 'morning', today, { mccId: mcc1 }));
    expect([r.status, r.body?.error?.code, r.body?.error?.details]).toEqual([403, 'FORBIDDEN', { anyOf: ['dairy.collect', 'dairy.manage'] }]);
  });

  it('(4) the same member / day / shift twice, two keys → DUPLICATE_COLLECTION 409', async () => {
    const d = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', today, { mccId: mcc1 }));
    expect([d.status, d.body?.error?.code]).toEqual([409, 'DUPLICATE_COLLECTION']);
  });

  it('(5) the day sheet: strings; a HELD pour is inside amountMinor and in heldMinor; payable + held + rejected = amountMinor', async () => {
    const held = await post(tok.C, '/v1/dairy/collections', pourBody(mem3, 'evening', today, { mccId: mcc1, waterFlag: true }));
    expect([held.status, held.body.data.holdState]).toEqual([201, 'held']);
    const clean = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'evening', today, { mccId: mcc1 }));
    expect(clean.status).toBe(201);
    const s = await get(tok.R, `/v1/dairy/d2c/mccs/${mcc1}/day-summary?date=${today}`);
    expect(s.status).toBe(200);
    const ev = (s.body.data as Array<Record<string, unknown>>).find((x) => x.shift === 'evening')!;
    for (const k of ['weightKg', 'amountMinor', 'payableMinor', 'heldMinor', 'rejectedMinor']) expect([k, typeof ev[k]]).toEqual([k, 'string']);
    expect([ev.slips, ev.heldPours, ev.rejectedPours, ev.flaggedPours, ev.weightKg]).toEqual([2, 1, 0, 1, '21.000']);
    expect(ev.heldMinor).toBe(held.body.data.amountMinor);
    expect(ev.payableMinor).toBe(clean.body.data.amountMinor);
    expect(BigInt(ev.amountMinor as string)).toBe(BigInt(held.body.data.amountMinor) + BigInt(clean.body.data.amountMinor));   // the held pour is INSIDE the total
    for (const row of s.body.data as Array<Record<string, string>>)
      expect(BigInt(row.payableMinor) + BigInt(row.heldMinor) + BigInt(row.rejectedMinor)).toBe(BigInt(row.amountMinor));
  });

  it('(3) immutability as kv_app: the readings cannot be updated, no pour deleted; milk_bill_id and hold_state can (rolled back)', async () => {
    const id = (await admin.query(`SELECT id, collected_on::text AS d FROM milk_collections WHERE tenant_id=$1 LIMIT 1`, [T])).rows[0];
    const asApp = async (sql: string) => {
      const c = await appPool.connect();
      try {
        await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [T]);
        const r = await c.query(sql, [id.id, id.d]); return { ok: true as const, rows: r.rowCount };
      } catch (e: any) { return { ok: false as const, code: e?.code }; }   // eslint-disable-line @typescript-eslint/no-explicit-any
      finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    };
    for (const col of ['weight_kg = 1', 'fat_pct = 1', 'snf_pct = 1', 'amount_minor = 1'])
      expect([col, await asApp(`UPDATE milk_collections SET ${col} WHERE id=$1 AND collected_on=$2::date`)]).toEqual([col, { ok: false, code: '42501' }]);
    expect(await asApp(`DELETE FROM milk_collections WHERE id=$1 AND collected_on=$2::date`)).toEqual({ ok: false, code: '42501' });
    expect(await asApp(`UPDATE milk_collections SET milk_bill_id = NULL WHERE id=$1 AND collected_on=$2::date`)).toEqual({ ok: true, rows: 1 });
    expect(await asApp(`UPDATE milk_collections SET hold_state = hold_state WHERE id=$1 AND collected_on=$2::date`)).toEqual({ ok: true, rows: 1 });
  });

  it('(1) a day inside a LIVE bill of hers → POUR_WINDOW_ALREADY_BILLED, nothing written; (7) her dispute voids it and the rebuild carries the same money', async () => {
    // a pour two days ago and its bill (one day window)
    const p = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', twoAgo, { mccId: mcc1 }));
    expect(p.status).toBe(201);
    const g = await post(tok.A1, '/v1/dairy/milk-bills/generate', { membershipId: mem1, periodStart: twoAgo, periodEnd: twoAgo });
    expect(g.status).toBe(201); const bill1 = g.body.data;
    // the window is billed (a DRAFT counts): a late pour there is refused by name before anything is written, the replay too
    const before = await counts('none'); const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      const late = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'evening', twoAgo, { mccId: mcc1 }), key);
      expect([late.status, late.body?.error?.code, late.body?.error?.details]).toEqual([422, 'POUR_WINDOW_ALREADY_BILLED', { collectedOn: twoAgo, billPeriodStart: twoAgo, billPeriodEnd: twoAgo }]);
    }
    expect(await counts(key)).toEqual({ ...before, keys: 0 });
    // preview → her dispute → upheld with a void (a second administrator answers)
    expect((await post(tok.A1, `/v1/dairy/milk-bills/${bill1.id}/preview`)).status).toBe(201);
    const disp = await post(tok.F1, `/v1/dairy/milk-bills/${bill1.id}/dispute`, { reason: 'the weight on this pour looks wrong to me' });
    expect(disp.status).toBe(201);
    const res = await post(tok.A2, `/v1/dairy/bill-disputes/${disp.body.data.id}/resolve`, { outcome: 'upheld', note: 'voided so the bill can be rebuilt', voidBill: true });
    expect([res.status]).toEqual([201]);
    expect((await admin.query(`SELECT status, deleted_at IS NOT NULL AS gone FROM milk_bills WHERE id=$1`, [bill1.id])).rows[0]).toEqual({ status: 'voided', gone: true });
    // the rebuild carries the SAME money: the pour was released unchanged — a wrong reading is billed as typed again (F-4, today's truth)
    const g2 = await post(tok.A1, '/v1/dairy/milk-bills/generate', { membershipId: mem1, periodStart: twoAgo, periodEnd: twoAgo });
    expect(g2.status).toBe(201);
    expect([g2.body.data.grossMinor, g2.body.data.id === bill1.id]).toEqual([bill1.grossMinor, false]);
    expect((await admin.query(`SELECT amount_minor::text AS a, milk_bill_id FROM milk_collections WHERE tenant_id=$1 AND id=$2`, [T, p.body.data.id])).rows[0])
      .toEqual({ a: p.body.data.amountMinor, milk_bill_id: g2.body.data.id });
  });

  it('(1) a VOIDED bill\'s window is not "billed": a pour there is accepted', async () => {
    const p = await post(tok.C, '/v1/dairy/collections', pourBody(mem2, 'morning', yesterday, { mccId: mcc1 }));
    expect(p.status).toBe(201);
    const g = await post(tok.A1, '/v1/dairy/milk-bills/generate', { membershipId: mem2, periodStart: yesterday, periodEnd: yesterday });
    expect(g.status).toBe(201);
    expect((await post(tok.A1, `/v1/dairy/milk-bills/${g.body.data.id}/void`, { reason: 'voided for the live spec window probe' })).status).toBe(201);
    const late = await post(tok.C, '/v1/dairy/collections', pourBody(mem2, 'evening', yesterday, { mccId: mcc1 }));
    expect(late.status).toBe(201);
  });

  it('(8) absence → 404: no correction, reversal, acceptance, shift, close, slip or reprint route exists', async () => {
    const pid = (await admin.query(`SELECT id FROM milk_collections WHERE tenant_id=$1 LIMIT 1`, [T])).rows[0].id;
    for (const path of [`/v1/dairy/collections/${pid}/correct`, `/v1/dairy/collections/${pid}/reverse`, `/v1/dairy/collections/${pid}/accept`,
      '/v1/dairy/shifts', `/v1/dairy/shifts/${randomUUID()}/close`, `/v1/dairy/collections/${pid}/reprint`]) {
      expect([path, (await post(tok.A1, path, {})).status]).toEqual([path, 404]);
    }
    expect((await get(tok.A1, `/v1/dairy/collections/${pid}/slip`)).status).toBe(404);
  });
});
