// apps/api/src/__tests__/ops4b-records.integration.spec.ts · PC-56 OPS-4b · THE RECORDS: UPKEEP AND ANIMALS, LIVE. The real AppModule over HTTP
// (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. No migration (238).
// FLAGS: `equipment` and `livestock` are seeded OFF and switched ON for THESE two organisations only (an allow-list fixture, `rules.tenant_ids`),
// restored in afterAll — every equipment / livestock route answers 404 otherwise, and the rules under test live behind them.
//
// Brief §C, verbatim:
//   • owner B records on owner A's machine → MAINTENANCE_NOT_YOUR_MACHINE, no row, no audit, no idempotency row; an administrator likewise refused;
//   • performedOn = the organisation's tomorrow → MAINTENANCE_DATE_IN_FUTURE (the IST/UTC boundary pair at 23:30 IST is pinned on the SQL
//     `tenantDay` here with fixed instants, and on the service in ops4b-records.spec.ts under a fixed clock);
//   • no key → 400; own entry → 201 + exactly one audit row; replay → same id, no second row;
//   • the entry leaves the machine's `status` unchanged;
//   • logs read by a stranger → 404; alerts by a non-admin owner list only their machines;
//   • owner cancels without a reason → CANCEL_REASON_REQUIRED, nothing written; with one → audited with it; the renter cancels without one → allowed;
//   • an administrator edits or retires another person's animal → refused, row unchanged; the owner → allowed;
//   • a tag registered in tenant A, then from tenant B → 409, and the body carries no tenant, owner or "exists" word;
//   • absence → 404: `POST /v1/livestock/animals/:id/transfer`, `GET /v1/livestock/animals/by-tag/:tag`.
// The organisations are in India (`makeTenant` → country 'IN' → Asia/Kolkata). The wave runs this file under TZ=Asia/Kolkata and under TZ=UTC: the
// day is SQL's, never the process's.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { MaintenanceRepository } from '../modules/equipment/repositories/maintenance.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

run('PC-56 OPS-4b · upkeep and animals (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID(); const T2 = randomUUID();
  let A = ''; let B = ''; let R = ''; let ADM = ''; let F = ''; let F2 = '';
  let machineA = ''; let machineB = ''; let speciesId = '';
  const tok: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const H = (token: string, t = T1) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': t });
  const post = (token: string, path: string, body: object = {}, key: string | null = randomUUID(), t = T1) =>
    request(http).post(path).set(key ? { ...H(token, t), 'idempotency-key': key } : H(token, t)).send(body);
  const patch = (token: string, path: string, body: object) => request(http).patch(path).set(H(token)).send(body);
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const logsOn = (asset: string) => n(`SELECT count(*)::int n FROM equipment_maintenance_logs WHERE asset_id = $1`, [asset]);
  const auditsBy = (action: string, actor: string) => n(`SELECT count(*)::int n FROM audit_log WHERE action = $1 AND actor_user_id = $2`, [action, actor]);
  const idemRow = (key: string) => n(`SELECT count(*)::int n FROM idempotency_keys WHERE key = $1`, [key]);
  const orgDay = async (offsetDays: number) => (await admin.query(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text d`, [offsetDays])).rows[0].d as string;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T1, `OPS4B ${T1.slice(0, 4)}`); await makeTenant(admin, T2, `OPS4B2 ${T2.slice(0, 4)}`);
    [A, B, R, ADM, F, F2] = await Promise.all(Array.from({ length: 6 }, () => makeUser(admin)));
    const role = (u: string, code: string, t = T1) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    await role(A, 'equipment_owner'); await role(B, 'equipment_owner'); await role(R, 'farmer'); await role(ADM, 'tenant_admin'); await role(F, 'farmer'); await role(F2, 'farmer', T2);

    for (const key of ['equipment', 'livestock']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([key, false]);   // seeded OFF
      backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [key, JSON.stringify({ tenant_ids: [T1, T2] })]);
    }

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:equipment', 'flagstale:equipment', 'flag:livestock', 'flagstale:livestock', 'flags:all', `flagctx:${T1}`, `flagctx:${T2}`]) await cache.del(c);

    tok.A = mintToken(app, { userId: A, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage'] });
    tok.B = mintToken(app, { userId: B, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage'] });
    tok.R = mintToken(app, { userId: R, tenantId: T1, roles: ['farmer'], perms: ['equipment.rent'] });
    // an administrator who ALSO holds the owner's and the farmer's permissions — every escape this wave removes would let them through
    tok.ADM = mintToken(app, { userId: ADM, tenantId: T1, roles: ['tenant_admin'], perms: ['booking.manage', 'equipment.manage', 'equipment.rent', 'animal.manage'] });
    tok.F = mintToken(app, { userId: F, tenantId: T1, roles: ['farmer'], perms: ['animal.manage'] });
    tok.F2 = mintToken(app, { userId: F2, tenantId: T2, roles: ['farmer'], perms: ['animal.manage'] });

    const categoryId = (await admin.query(`SELECT id FROM categories ORDER BY id LIMIT 1`)).rows[0].id;
    const mk = async (t: string) => { const a = await post(t, '/v1/equipment/assets', { categoryId, hpRating: 45 }); expect(a.status).toBe(201); return a.body.data.id as string; };
    machineA = await mk(tok.A); machineB = await mk(tok.B);
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/rates`, { rateBasis: 'per_hour', rateMinor: '15000', includesOperator: true, includesFuel: false, effectiveFrom: '2026-01-01' }, null)).status).toBe(201);
    speciesId = (await admin.query(`SELECT id FROM animal_species WHERE code='cattle'`)).rows[0].id;
  }, 180_000);

  afterAll(async () => {
    for (const b of backups) {
      try { await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ══ upkeep ══
  it('owner B records on owner A\'s machine → 403 MAINTENANCE_NOT_YOUR_MACHINE: no row, no audit row, no idempotency row; an administrator likewise', async () => {
    for (const [t, who] of [[tok.B, B], [tok.ADM, ADM]] as const) {
      const key = randomUUID();
      const r = await post(t, `/v1/equipment/assets/${machineA}/maintenance-logs`, { logType: 'breakdown', costMinor: '500000', performedOn: '2026-01-02' }, key);
      expect([r.status, r.body.error?.code]).toEqual([403, 'MAINTENANCE_NOT_YOUR_MACHINE']);
      expect(await idemRow(key)).toBe(0);
      expect(await auditsBy('equipment.maintenance.recorded', who)).toBe(0);
    }
    expect(await logsOn(machineA)).toBe(0);
  });

  it('performedOn = the organisation\'s tomorrow → 400 MAINTENANCE_DATE_IN_FUTURE, nothing written; its today → recorded', async () => {
    const tomorrow = await orgDay(1); const today = await orgDay(0);
    const key = randomUUID();
    const r = await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { logType: 'service', performedOn: tomorrow }, key);
    expect([r.status, r.body.error?.code, r.body.error?.details?.today]).toEqual([400, 'MAINTENANCE_DATE_IN_FUTURE', today]);
    expect([await idemRow(key), await logsOn(machineA)]).toEqual([0, 0]);
    const ok = await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { logType: 'inspection', performedOn: today });
    expect([ok.status, ok.body.data.performedOn]).toEqual([201, today]);
  });

  it('THE IST/UTC PAIR on the SQL day: 18:00 UTC on 10 Nov is 10 Nov for the organisation (23:30 IST); 18:45 UTC is already 11 Nov (00:15 IST)', async () => {
    const repo = app.get(MaintenanceRepository);
    expect(await repo.tenantDay(T1, '2026-11-10T18:00:00.000Z')).toBe('2026-11-10');
    expect(await repo.tenantDay(T1, '2026-11-10T18:45:00.000Z')).toBe('2026-11-11');
  });

  it('no Idempotency-Key → 400; own entry → 201 with the server\'s id and the entry + exactly ONE audit row; a replay → the same id, no second row', async () => {
    const n0 = await logsOn(machineA);
    const body = { logType: 'repair', costMinor: '411100', engineHoursAt: '1200.5', notes: 'fan belt', performedOn: '2026-01-05' };
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, body, null)).status).toBe(400);
    expect(await logsOn(machineA)).toBe(n0);
    const key = randomUUID();
    const a = await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, body, key);
    expect(a.status).toBe(201);
    expect(a.body.data).toEqual({ id: expect.any(String), assetId: machineA, logType: 'repair', costMinor: '411100', notes: 'fan belt', engineHoursAt: '1200.5', performedOn: '2026-01-05' });
    const b = await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, body, key);
    expect([b.status, b.body.data.id]).toEqual([201, a.body.data.id]);
    expect(await logsOn(machineA)).toBe(n0 + 1);
    const rows = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE entity_id = $1 AND action = 'equipment.maintenance.recorded'`, [a.body.data.id])).rows;
    expect(rows.length).toBe(1); expect(rows[0].actor_user_id).toBe(A); expect(rows[0].new_value.costMinor).toBe('411100');
    // a stray field and a non-day are refused by the strict body
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { ...body, assetId: machineB })).status).toBe(422);
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { ...body, performedOn: '2026-02-31' })).status).toBe(422);
  });

  it('an entry — even a breakdown — leaves the machine\'s status unchanged, and the machine can still be hired', async () => {
    const st = async () => (await admin.query(`SELECT status FROM equipment_assets WHERE id = $1`, [machineA])).rows[0].status;
    expect(await st()).toBe('active');
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { logType: 'breakdown', performedOn: '2026-01-06' })).status).toBe(201);
    expect(await st()).toBe('active');
    const h = await post(tok.R, '/v1/equipment/rentals', { assetId: machineA, rateBasis: 'per_hour', estQuantity: '2.00', scheduledAt: '2027-02-01T05:00:00.000Z' });
    expect(h.status).toBe(201);
  });

  it('the logs: a stranger → 404, an administrator → 404, the owner → 200; alerts: a non-admin owner sees only her machines', async () => {
    expect((await get(tok.B, `/v1/equipment/assets/${machineA}/maintenance-logs`)).status).toBe(404);
    expect((await get(tok.ADM, `/v1/equipment/assets/${machineA}/maintenance-logs`)).status).toBe(404);
    const own = await get(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`);
    expect(own.status).toBe(200); expect(own.body.data.length).toBeGreaterThan(0);
    // [lead QA, OPS-4b] machine A is given a REAL alert first (its latest entry a breakdown → needs_attention), so "B never sees A's"
    // is not vacuous: a lead mutant serving every caller the organisation's view (alerts(tenantId, null)) passed this spec while A had no alert.
    expect((await post(tok.A, `/v1/equipment/assets/${machineA}/maintenance-logs`, { logType: 'breakdown', performedOn: await orgDay(0) })).status).toBe(201);
    const alertsB = await get(tok.B, '/v1/equipment/assets/maintenance/alerts');
    expect(alertsB.status).toBe(200);
    const ids = (alertsB.body.data as Array<{ assetId: string }>).map((x) => x.assetId);
    expect(ids).toContain(machineB);          // no service on record → service_due
    expect(ids).not.toContain(machineA);
    const alertsAdm = await get(tok.ADM, '/v1/equipment/assets/maintenance/alerts');
    // the administrator owns no machine and sees both — machine A's alert exists (the positive control for B's line above)
    expect((alertsAdm.body.data as Array<{ assetId: string }>).map((x) => x.assetId)).toEqual(expect.arrayContaining([machineA, machineB]));
  });

  // ══ the owner's cancel needs a reason ══
  it('the owner cancels without a reason → 400 CANCEL_REASON_REQUIRED, nothing written; with one → cancelled and audited with it; the renter without one → allowed', async () => {
    const mkHire = async () => (await post(tok.R, '/v1/equipment/rentals', { assetId: machineA, rateBasis: 'per_hour', estQuantity: '1.00', scheduledAt: '2027-02-02T05:00:00.000Z' })).body.data.id as string;
    const h1 = await mkHire();
    const key = randomUUID();
    const r = await post(tok.A, `/v1/equipment/rentals/${h1}/cancel`, {}, key);
    expect([r.status, r.body.error?.code]).toEqual([400, 'CANCEL_REASON_REQUIRED']);
    expect((await admin.query(`SELECT status FROM equipment_bookings WHERE id = $1`, [h1])).rows[0].status).toBe('requested');
    expect([await idemRow(key), await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = 'equipment.booking.cancelled'`, [h1])]).toEqual([0, 0]);
    expect((await post(tok.ADM, `/v1/equipment/rentals/${h1}/cancel`, {})).body.error?.code).toBe('CANCEL_REASON_REQUIRED');   // the administrator too
    const ok = await post(tok.A, `/v1/equipment/rentals/${h1}/cancel`, { reason: 'engine fault' });
    expect([ok.status, ok.body.data.status]).toEqual([201, 'cancelled']);
    const rows = (await admin.query(`SELECT new_value FROM audit_log WHERE entity_id = $1 AND action = 'equipment.booking.cancelled'`, [h1])).rows;
    expect(rows.length).toBe(1); expect(rows[0].new_value.reason).toBe('engine fault');
    const h2 = await mkHire();
    const mine = await post(tok.R, `/v1/equipment/rentals/${h2}/cancel`, {});
    expect([mine.status, mine.body.data.status]).toEqual([201, 'cancelled']);
  });

  // ══ animals ══
  it('an administrator edits or retires another person\'s animal → 403, the row unchanged; the owner → allowed', async () => {
    const reg = await post(tok.F, '/v1/livestock/animals', { speciesId, name: 'Gauri' });
    expect(reg.status).toBe(201);
    const id = reg.body.data.id as string;
    const row = async () => (await admin.query(`SELECT name, status FROM animals WHERE id = $1`, [id])).rows[0];
    const e = await patch(tok.ADM, `/v1/livestock/animals/${id}`, { name: 'Changed' });
    expect([e.status, e.body.error?.code]).toEqual([403, 'LIVESTOCK_FORBIDDEN']);
    const rt = await post(tok.ADM, `/v1/livestock/animals/${id}/retire`, { reason: 'sold' }, null);
    expect([rt.status, rt.body.error?.code]).toEqual([403, 'LIVESTOCK_FORBIDDEN']);
    expect(await row()).toEqual({ name: 'Gauri', status: 'active' });
    // the administrator's READ is unchanged (recorded in the wave report)
    expect((await get(tok.ADM, `/v1/livestock/animals/${id}`)).status).toBe(200);
    expect((await patch(tok.F, `/v1/livestock/animals/${id}`, { name: 'Gauri II' })).status).toBe(200);
    expect((await post(tok.F, `/v1/livestock/animals/${id}/retire`, { reason: 'sold' }, null)).status).toBe(201);
    expect(await row()).toEqual({ name: 'Gauri II', status: 'sold' });
  });

  it('a tag registered in organisation A, then from organisation B → 409 PASHU_AADHAAR_EXISTS, and the body names no tenant, owner, animal or "exists"', async () => {
    const tag = String(100000000000 + Math.floor(Math.random() * 899999999999)).slice(0, 12);
    expect((await post(tok.F, '/v1/livestock/animals', { speciesId, pashuAadhaar: tag })).status).toBe(201);
    const r = await post(tok.F2, '/v1/livestock/animals', { speciesId, pashuAadhaar: tag }, randomUUID(), T2);
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'PASHU_AADHAAR_EXISTS', 'This tag number cannot be registered.']);
    // the code stays PASHU_AADHAAR_EXISTS (brief: "same 409, same code"); everything ELSE in the body is checked for a leak
    const body = JSON.stringify({ ...r.body, error: { ...r.body.error, code: undefined } });
    expect(r.body.error?.details ?? {}).toEqual({});
    for (const leak of [T1, F, 'exist', 'already', 'owner', 'tenant', 'animal']) expect([leak, body.toLowerCase().includes(leak.toLowerCase())]).toEqual([leak, false]);
    // the same words from the SAME organisation (nothing distinguishes whose tag it is)
    const same = await post(tok.F, '/v1/livestock/animals', { speciesId, pashuAadhaar: tag });
    expect([same.status, same.body.error?.message]).toEqual([409, 'This tag number cannot be registered.']);
  });

  it('absence → 404: no ownership transfer route, no look-up-by-tag route', async () => {
    const reg = await post(tok.F, '/v1/livestock/animals', { speciesId });
    expect((await post(tok.F, `/v1/livestock/animals/${reg.body.data.id}/transfer`, { toUserId: F })).status).toBe(404);
    expect((await get(tok.F, '/v1/livestock/animals/by-tag/123456789012')).status).toBe(404);
  });
});
