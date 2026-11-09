// apps/api/src/__tests__/ops3b-tank.integration.spec.ts · PC-56 OPS-3b — THE TANK, LIVE (brief §C; L1, the lead's custody decision of 2026-11-09;
// founder Q12-A / Q13-A, 2026-11-08). The real AppModule over HTTP (supertest, listening ONCE on 127.0.0.1 — the HOTFIX-5 pin), real Postgres + RLS
// as kv_app, a database built from EMPTY by the harness. FLAGS: `dairy` and `dairy_bmc_monitor` are seeded OFF and switched ON for THIS organisation
// only (an allow-list fixture: `rules.tenant_ids = [T]`, rollout 0), restored in afterAll — the cooler's routes need both. Every token carries what
// the database grants (`RoleCacheService.effectiveAccess` → `TokenService.mintAccessToken`). Centres, custody, members and coolers through the real
// routes; the rate card by two people (HOTFIX-12's helper).
//   (1) L1 · a POUR: a collect-only person WITHOUT custody of the member's centre → 403 DAIRY_CENTRE_NOT_IN_CUSTODY, nothing written (no pour, review,
//       outbox or idempotency row); the replay the same; with custody → 201
//   (2) L1 · a MANUAL READING: a cooler at a centre the person does not hold → 403 by name, no cold-chain row; at their centre → 201
//   (3) L1 · the ROLL: another centre → 403 by name; `box=mcc` with no centre and `box=all` → NARROWED to custody centres; a read-only person with
//       no custody → 403 / an empty roll
//   (4) a dairy.manage holder (no custody at all) acts everywhere: a pour, a reading and the roll at any centre
//   (5) the manual reading: recorded at the SERVER's time (`source = manual`, recorded_at = the database's clock at write), and NEVER opens a breach
//       — two consecutive out-of-band manual readings, no `cold_chain_breaches` row
//   (6) `recordedAt` from the client is REFUSED by name (422 VALIDATION_FAILED naming the key, the strict DTO), and nothing is written
//   (7) absence → 404: a tanker dispatch route and a manifest route
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
// The fixture switches ON exactly what the cooler page needs: the module and the monitor (both seeded OFF).
const FLAGS = ['dairy', 'dairy_bmc_monitor'] as const;

run('PC-56 OPS-3b · the tank (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let appPool: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  let roleCache: RoleCacheService; let tokens: TokenService;
  const T = randomUUID();
  let A1 = ''; let A2 = ''; let C = ''; let N = ''; let R = ''; let F1 = ''; let F2 = '';
  let mcc1 = ''; let mcc2 = ''; let mem1 = ''; let mem2 = ''; let unit1 = ''; let unit2 = ''; let today = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];
  const suffix = T.slice(0, 8).replace(/-/g, '');
  const roleCodes = [`ops3b_counter_${suffix}`, `ops3b_reader_${suffix}`];
  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T });
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const post = (token: string, path: string, body: object = {}, key: string = randomUUID()) => request(http).post(path).set({ ...H(token), 'idempotency-key': key }).send(body);
  const reading = (token: string, body: object) => request(http).post('/v1/dairy/bmc/readings').set(H(token)).send(body);
  const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, T, code]);
  async function login(u: string): Promise<string> {
    await roleCache.invalidate(u, T);
    const a = await roleCache.effectiveAccess(u, T);
    return tokens.mintAccessToken({ sub: u, tid: T, sid: 'ops3b', roles: a.roles, perms: a.permissions });
  }
  const pourBody = (membershipId: string, shift: 'morning' | 'evening', extra: object = {}) =>
    ({ membershipId, shift, collectedOn: today, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50', ...extra });
  const counts = async (key: string) => (await admin.query(
    `SELECT (SELECT count(*)::int FROM milk_collections WHERE tenant_id = $1) AS pours,
            (SELECT count(*)::int FROM milk_quality_reviews WHERE tenant_id = $1) AS reviews,
            (SELECT count(*)::int FROM outbox_events WHERE tenant_id = $1 AND aggregate_type IN ('milk_collection', 'milk_quality_review')) AS outbox,
            (SELECT count(*)::int FROM idempotency_keys WHERE key LIKE '%' || $2 || '%') AS keys`, [T, key])).rows[0];
  const logs = async (unitId: string) => (await admin.query(`SELECT count(*)::int AS n FROM cold_chain_logs WHERE tenant_id = $1 AND subject_type = 'bmc_unit' AND subject_id = $2`, [T, unitId])).rows[0].n as number;
  const refusedCustody = (r: { status: number; body: any }, mccId: string) =>   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect([r.status, r.body?.error?.code, r.body?.error?.details]).toEqual([403, 'DAIRY_CENTRE_NOT_IN_CUSTODY', { mccId }]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL }); appPool = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, T, `OPS3b dairy ${T.slice(0, 4)}`);
    [A1, A2, C, N, R, F1, F2] = await Promise.all(Array.from({ length: 7 }, () => makeUser(admin)));
    // Custom roles (roles are data — Law 6): the counter (ONLY dairy.collect) and a reader (ONLY dairy.read). C and N are both counter people;
    // only C holds custody.
    for (const [code, perm] of [[roleCodes[0], 'dairy.collect'], [roleCodes[1], 'dairy.read']]) {
      await admin.query(`INSERT INTO roles (code, default_name, scope) VALUES ($1, $1, 'tenant')`, [code]);
      await admin.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, $2 FROM roles WHERE code = $1`, [code, perm]);
    }
    await role(A1, 'tenant_admin'); await role(A2, 'tenant_admin');
    await role(C, roleCodes[0]); await role(N, roleCodes[0]); await role(R, roleCodes[1]);
    for (const f of [F1, F2]) await role(f, 'dairy_farmer');

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    roleCache = app.get(RoleCacheService); tokens = app.get(TokenService);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
    for (const [k, u] of Object.entries({ A1, A2, C, N, R })) tok[k] = await login(u);

    today = await tenantTodayForTest(admin, T);
    // Two centres through the REAL route: the first opens a custody row naming C (6d-2); the second names nobody.
    const c1 = await post(tok.A1, '/v1/dairy/mccs', { code: 'C-OPS3B-1', defaultName: 'OPS3b centre one', operatorUserId: C, operatorReason: 'counter custody for the live spec' });
    const c2 = await post(tok.A1, '/v1/dairy/mccs', { code: 'C-OPS3B-2', defaultName: 'OPS3b centre two' });
    expect([c1.status, c2.status]).toEqual([201, 201]); mcc1 = c1.body.data.id; mcc2 = c2.body.data.id;
    const enrol = async (u: string, mccId: string, code: string) => {
      const r = await post(tok.A1, '/v1/dairy/mccs/memberships', { farmerUserId: u, mccId, memberCode: code });
      expect(r.status).toBe(201); return r.body.data.id as string;
    };
    mem1 = await enrol(F1, mcc1, 'TB-001'); mem2 = await enrol(F2, mcc2, 'TB-900');
    const cards = app.get(MilkRateCardService);
    const from = (await admin.query(`SELECT ($1::date - 30)::text AS d`, [today])).rows[0].d as string;
    await approvedCardForTest(cards, admin, T, { userId: A1, canManage: true }, { defaultName: 'OPS3b mixed', animalType: 'mixed', pricingModel: 'two_axis',
      ratePerKgFatMinor: '64900', ratePerKgSnfMinor: '21700', effectiveFrom: from }, { checkerUserId: A2 });
    // A cooler at each centre (the administrator registers them; a cooler's centre is bmc_units.mcc_id, NOT NULL).
    const u1 = await post(tok.A1, '/v1/dairy/bmc', { mccId: mcc1, capacityLitres: '2000' });
    const u2 = await post(tok.A1, '/v1/dairy/bmc', { mccId: mcc2, capacityLitres: '1000' });
    expect([u1.status, u2.status]).toEqual([201, 201]); unit1 = u1.body.data.id; unit2 = u2.body.data.id;
    expect((await admin.query(`SELECT count(*)::int AS n FROM bmc_units WHERE tenant_id = $1 AND mcc_id IS NULL`, [T])).rows[0].n).toBe(0);
  }, 240_000);

  afterAll(async () => {
    try {
      await admin.query(`DELETE FROM user_tenant_roles WHERE role_id IN (SELECT id FROM roles WHERE code = ANY($1))`, [roleCodes]);
      await admin.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code = ANY($1))`, [roleCodes]);
      await admin.query(`DELETE FROM roles WHERE code = ANY($1)`, [roleCodes]);
    } catch { /* teardown only — ops3p (7) pins the catalogue's exact dairy grants in the same run */ }
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await appPool?.end(); await admin?.end();
  }, 40_000);

  it('(1) L1 · a pour: no custody of her centre → DAIRY_CENTRE_NOT_IN_CUSTODY, nothing written, the replay the same; with custody → 201', async () => {
    const before = await counts('none');
    const key = randomUUID();
    for (let i = 0; i < 2; i++) refusedCustody(await post(tok.N, '/v1/dairy/collections', pourBody(mem1, 'morning', { mccId: mcc1 }), key), mcc1);
    expect(await counts(key)).toEqual({ ...before, keys: 0 });
    // C holds centre one but not centre two: another centre's member is refused, with or without naming a centre
    refusedCustody(await post(tok.C, '/v1/dairy/collections', pourBody(mem2, 'morning')), mcc2);
    refusedCustody(await post(tok.C, '/v1/dairy/collections', pourBody(mem2, 'morning', { mccId: mcc1 })), mcc2);
    // her own centre's member, but naming a centre C does not hold
    refusedCustody(await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', { mccId: mcc2 })), mcc2);
    expect(await counts('none')).toEqual({ ...before, keys: 0 });
    const okKey = randomUUID();
    const ok = await post(tok.C, '/v1/dairy/collections', pourBody(mem1, 'morning', { mccId: mcc1 }), okKey);
    expect([ok.status, ok.body.data.mccId]).toEqual([201, mcc1]);
    expect((await counts(okKey)).keys).toBe(1);   // POSITIVE CONTROL for the "no idempotency row" assertions above
  });

  it('(2) L1 · a manual reading: a cooler at a centre you do not hold → 403 by name, no cold-chain row; at your centre → 201', async () => {
    const [b1, b2] = [await logs(unit1), await logs(unit2)];
    refusedCustody(await reading(tok.N, { unitId: unit1, tempC: '3.8' }), mcc1);
    refusedCustody(await reading(tok.C, { unitId: unit2, tempC: '3.8' }), mcc2);
    expect([await logs(unit1), await logs(unit2)]).toEqual([b1, b2]);
    const ok = await reading(tok.C, { unitId: unit1, tempC: '3.8' });
    expect([ok.status, ok.body.data?.unitId, ok.body.data?.tempC]).toEqual([201, unit1, '3.8']);
    expect(await logs(unit1)).toBe(b1 + 1);
  });

  it('(3) L1 · the roll: another centre → 403 by name; no centre, or box=all → narrowed to custody; a reader with no custody → nothing', async () => {
    refusedCustody(await get(tok.C, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc2}`), mcc2);
    refusedCustody(await get(tok.N, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}`), mcc1);
    refusedCustody(await get(tok.R, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}`), mcc1);
    const mine = await get(tok.C, `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mcc1}`);
    expect([mine.status, (mine.body.data as Array<{ id: string }>).map((m) => m.id)]).toEqual([200, [mem1]]);
    for (const q of ['box=mcc', 'box=all']) {
      const r = await get(tok.C, `/v1/dairy/mccs/memberships/list?${q}`);
      expect([q, r.status, (r.body.data as Array<{ id: string }>).map((m) => m.id)]).toEqual([q, 200, [mem1]]);
      for (const who of ['N', 'R']) {
        const e = await get(tok[who], `/v1/dairy/mccs/memberships/list?${q}`);
        expect([q, who, e.status, e.body.data]).toEqual([q, who, 200, []]);
      }
    }
  });

  it('(4) dairy.manage (no custody at all) acts everywhere: a pour, a reading and the roll at any centre', async () => {
    expect((await get(tok.A1, '/v1/dairy/mccs/mine')).body.data.centres).toEqual([]);
    const p = await post(tok.A1, '/v1/dairy/collections', pourBody(mem2, 'evening', { mccId: mcc2 }));
    expect([p.status, p.body.data.mccId]).toEqual([201, mcc2]);
    expect((await reading(tok.A1, { unitId: unit2, tempC: '4.0' })).status).toBe(201);
    for (const [q, ids] of [[`box=mcc&mccId=${mcc2}`, [mem2]], [`box=mcc&mccId=${mcc1}`, [mem1]], ['box=all', [mem1, mem2].sort()]] as const) {
      const r = await get(tok.A1, `/v1/dairy/mccs/memberships/list?${q}`);
      expect([q, r.status, (r.body.data as Array<{ id: string }>).map((m) => m.id).sort()]).toEqual([q, 200, ids]);
    }
  });

  it('(5) the manual reading is recorded at the SERVER\'s time and never opens a breach — even two out of band in a row', async () => {
    const t0 = (await admin.query(`SELECT now() AS n`)).rows[0].n as Date;
    const hot1 = await reading(tok.C, { unitId: unit1, tempC: '9.9' });
    const hot2 = await reading(tok.C, { unitId: unit1, tempC: '9.8' });
    expect([hot1.status, hot1.body.data.verdict, hot2.status, hot2.body.data.verdict]).toEqual([201, 'above_band', 201, 'above_band']);
    const t1 = (await admin.query(`SELECT now() AS n`)).rows[0].n as Date;
    const rows = (await admin.query(`SELECT source, recorded_at, server_recorded_at, is_breach FROM cold_chain_logs WHERE tenant_id = $1 AND id = ANY($2::bigint[]) ORDER BY recorded_at`,
      [T, [hot1.body.data.id, hot2.body.data.id]])).rows;
    expect(rows.map((r) => [r.source, r.is_breach])).toEqual([['manual', true], ['manual', true]]);   // an excursion on the reading, labelled manual
    for (const r of rows) {
      expect(new Date(r.recorded_at).getTime()).toBe(new Date(r.server_recorded_at).getTime());
      expect(new Date(r.recorded_at).getTime() >= t0.getTime() - 1000 && new Date(r.recorded_at).getTime() <= t1.getTime() + 1000).toBe(true);
    }
    expect(new Date(hot1.body.data.recordedAt).getTime()).toBe(new Date(rows[0].recorded_at).getTime());
    expect((await admin.query(`SELECT count(*)::int AS n FROM cold_chain_breaches WHERE tenant_id = $1 AND subject_type = 'bmc_unit' AND subject_id = $2`, [T, unit1])).rows[0].n).toBe(0);
  });

  it('(6) `recordedAt` from the client is REFUSED by name (the strict DTO) and nothing is written', async () => {
    const b = await logs(unit1);
    const r = await reading(tok.C, { unitId: unit1, tempC: '3.9', recordedAt: '2026-01-01T00:00:00Z' });
    // the strict DTO's refusal is the validation pipe's 422 (VALIDATION_FAILED), naming the key
    expect([r.status, r.body?.error?.code]).toEqual([422, 'VALIDATION_FAILED']);
    expect(JSON.stringify(r.body?.error?.details)).toContain('recordedAt');
    expect(await logs(unit1)).toBe(b);
  });

  it('(7) absence → 404: no tanker dispatch and no manifest route exists', async () => {
    expect((await post(tok.A1, `/v1/dairy/bmc/${unit1}/dispatch`, {})).status).toBe(404);
    expect((await post(tok.A1, '/v1/dairy/tankers/dispatch', {})).status).toBe(404);
    expect((await get(tok.A1, '/v1/dairy/tankers')).status).toBe(404);
    expect((await get(tok.A1, '/v1/dairy/manifests')).status).toBe(404);
    expect((await post(tok.A1, '/v1/dairy/manifests', {})).status).toBe(404);
  });
});
