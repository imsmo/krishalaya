// apps/api/src/__tests__/ops2a-intake.integration.spec.ts · PC-56 OPS-2a — INTAKE, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures (no
// `makeCategory` / `makeProduct` — the known two-type parameter trap; the ops1a / ops2b / ops2c shape). `warehousing` stays OFF in the seed and is
// switched ON for THIS organisation (and B, for the platform-global case) only — an allow-list in the flag's rules: the fixture, not the product —
// restored in afterAll; the seeded OFF state is asserted first. The tenant administrators' tokens carry `booking.manage` ON PURPOSE: it is the
// labour permission that was the warehousing escape (survey F-5), and every refusal below must hold although they hold it.
//
// What it proves (brief §C = survey §7 `ops2a-intake` items 1–5, plus D1–D3 and the platform-global warehouse; founder Q6-A, Q11-A, Q12-A; D1–D3):
//   (1) B3/B4: confirm, store and cancel by a tenant_admin who is NOT the warehouse's operator → 403 by name, nothing written; by the operator →
//       each writes exactly ONE audit row. Cancel by an unrelated farmer → 403.
//   (2) `GET …/storage-bookings?box=warehouse&warehouseId=` by the operator → that warehouse's bookings (other depositors' included; no name field);
//       `box=depositor` (the API default — what the old console sent) → the operator's OWN deposits only (today's truth, pinned).
//   (3) F-4: after `store` the quantity equals the requested quantity; `POST …/:id/store` with a body `{ quantity }` → the body is IGNORED (201,
//       the quantity unchanged) — what the code does, pinned.
//   (4) `pg_attribute`: no weigh / tare / gross / bay / stack / pest / location column on the warehousing tables, no such table anywhere (the
//       survey's "on any table" is false — dairy weighs milk — so the probe's control is dairy's `weight_kg`; a recorded deviation).
//   (5) Absence → 404: weighments, stacks, pest checks; `POST …/storage-bookings` by a `warehouse.manage`-only caller → 403 (the "New booking"
//       refusal at the API).
//   (D1) a non-operator administrator PATCHing the rate → 403 WAREHOUSE_REASSIGN_ONLY, rate unchanged, no audit row; the operator → 200, one row.
//   (D2) a non-operator administrator PATCHing ONLY `operatorUserId` → to a member 200 + one audit row before/after; to a non-member 422 (B6).
//   (D3) the operator's cancel without a reason → 400 BOOKING_CANCEL_REASON_REQUIRED, booking unchanged, no audit row; with one → one row carrying
//       it; the depositor's own cancel without a reason → 201, one row; an unrelated farmer → 403 BOOKING_CANCEL_NOT_PERMITTED.
//   (NULL) a platform-global (NULL-tenant) warehouse: `PATCH` from tenant A by an administrator, and by its own operator from his tenant → 404
//       WAREHOUSE_NOT_FOUND, the row unchanged (it can never be edited or reassigned cross-tenant); a booking at it is confirmed only by its operator.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const OPERATOR_ONLY = 'Only this warehouse\'s named operator can do this. Nothing was changed.';
const REASSIGN_ONLY = 'Only this warehouse\'s named operator can change its storage rate or its details. Another administrator can only reassign the operator. Nothing was saved.';
const REASON = 'The warehouse operator\'s cancel needs a reason of 1 to 500 characters, and no reason may be longer. Nothing was changed.';
const NOT_PERMITTED = 'Only the depositor herself or this warehouse\'s named operator can cancel this booking. Nothing was changed.';

run('PC-56 OPS-2a · intake (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  let operator = ''; let otherAdmin = ''; let depositor = ''; let farmer2 = ''; let newOp = ''; let outsider = ''; let globalOp = '';
  let warehouseId = ''; let globalWh = ''; let productId = '';
  const T: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const H = (token: string, tenant = A) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const role = (userId: string, tenant: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenant, code]);
  const booking = async (wh: string, dep: string, status: 'requested' | 'confirmed' | 'stored', qty = '62.6') => {
    const id = randomUUID();
    await admin.query(`INSERT INTO storage_bookings (id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, status, stored_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6::numeric, 'quintal', $7::text, $8::timestamptz, $4)`, [id, A, wh, dep, productId, qty, status, status === 'stored' ? new Date() : null]);
    return id;
  };
  const bk = async (id: string) => (await admin.query(`SELECT status::text AS status, quantity::text AS quantity FROM storage_bookings WHERE id = $1`, [id])).rows[0] as { status: string; quantity: string };
  const audits = (id: string, action: string) => admin.query(`SELECT actor_user_id, old_value, new_value, reason FROM audit_log WHERE entity_id = $1 AND action = $2 ORDER BY created_at`, [id, action]);
  const post = (token: string, path: string, body: object = {}) => request(http).post(path).set(H(token)).send(body);
  const patch = (token: string, id: string, body: object, tenant = A) => request(http).patch(`/v1/warehousing/warehouses/${id}`).set(H(token, tenant)).send(body);
  const whRow = async (id: string) => (await admin.query(`SELECT operator_user_id, rate_per_qtl_month_minor::text AS rate, default_name FROM warehouses WHERE id = $1`, [id])).rows[0];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops 2a ${A.slice(0, 4)}`); await makeTenant(admin, B, `Ops 2a B ${B.slice(0, 4)}`);
    [operator, otherAdmin, depositor, farmer2, newOp, outsider, globalOp] = await Promise.all(Array.from({ length: 7 }, () => makeUser(admin)));
    await role(operator, A, 'tenant_admin'); await role(otherAdmin, A, 'tenant_admin'); await role(newOp, A, 'tenant_admin');
    await role(depositor, A, 'farmer'); await role(farmer2, A, 'farmer'); await role(globalOp, B, 'tenant_admin');
    // `outsider` is a real user with NO role in A — the B6 non-member.

    const categoryId = randomUUID(); const code = `ops2a_${A.replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1, $2, 'Test Category', $3::ltree, 1, true)`, [categoryId, code, code]);
    productId = randomUUID();
    await ensureUnitCurrency(admin, 'quintal');
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
      VALUES ($1, $2, 'Test Product', 'quintal', NULL, true, to_tsvector('simple', 'Test Product'))`, [productId, categoryId]);
    warehouseId = randomUUID(); globalWh = randomUUID();
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Test warehouse', 900, true, $3)`, [warehouseId, A, operator]);
    // FIXTURE: a platform-global warehouse (tenant_id NULL — "independent WDRA", 0010:132), operated by a person of ANOTHER organisation.
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, NULL, $2, 'Test global warehouse', 800, true, $2)`, [globalWh, globalOp]);

    for (const key of ['warehousing']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([key, false]);   // seeded OFF
      backups.push(b);
    }
    // FIXTURE: `warehousing` ON for A and B only (rules.tenant_ids), so the routes under test answer; restored in afterAll.
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'warehousing'`, [JSON.stringify({ tenant_ids: [A, B] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:warehousing', 'flagstale:warehousing', 'flags:all', `flagctx:${A}`, `flagctx:${B}`]) await cache.del(c);

    const ADMIN_PERMS = ['warehouse.manage', 'booking.manage'];   // tenant_admin's two (0004) — the labour one is the old escape
    T.op = mintToken(app, { userId: operator, tenantId: A, roles: ['tenant_admin'], perms: ADMIN_PERMS });
    T.admin = mintToken(app, { userId: otherAdmin, tenantId: A, roles: ['tenant_admin'], perms: ADMIN_PERMS });
    T.dep = mintToken(app, { userId: depositor, tenantId: A, roles: ['farmer'], perms: ['warehouse.store'] });
    T.f2 = mintToken(app, { userId: farmer2, tenantId: A, roles: ['farmer'], perms: ['warehouse.store'] });
    T.globalOp = mintToken(app, { userId: globalOp, tenantId: B, roles: ['tenant_admin'], perms: ADMIN_PERMS });
  }, 120_000);

  afterAll(async () => {
    for (const b of backups) {
      try { await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) B3/B4: confirm / store / cancel by a non-operator administrator → 403 by name, nothing written; by the operator → ONE audit row each; an unrelated farmer → 403', async () => {
    const id = await booking(warehouseId, depositor, 'requested');
    for (const [path, body, code, msg] of [['confirm', {}, 'WAREHOUSE_OPERATOR_ONLY', OPERATOR_ONLY], ['cancel', { reason: 'test reason' }, 'BOOKING_CANCEL_NOT_PERMITTED', NOT_PERMITTED]] as const) {
      const r = await post(T.admin, `/v1/warehousing/storage-bookings/${id}/${path}`, body);
      expect([path, r.status, r.body.error?.code, r.body.error?.message]).toEqual([path, 403, code, msg]);
    }
    const farmer = await post(T.f2, `/v1/warehousing/storage-bookings/${id}/cancel`, { reason: 'not mine' });
    expect([farmer.status, farmer.body.error?.code]).toEqual([403, 'BOOKING_CANCEL_NOT_PERMITTED']);
    expect((await bk(id)).status).toBe('requested');
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1`, [id])).toBe(0);

    const c = await post(T.op, `/v1/warehousing/storage-bookings/${id}/confirm`);
    expect([c.status, c.body.data?.status]).toEqual([201, 'confirmed']);
    expect((await audits(id, 'warehousing.booking.confirmed')).rows).toEqual([{ actor_user_id: operator, old_value: { status: 'requested' }, new_value: { status: 'confirmed' }, reason: null }]);
    const notOpStore = await post(T.admin, `/v1/warehousing/storage-bookings/${id}/store`);
    expect([notOpStore.status, notOpStore.body.error?.code, notOpStore.body.error?.message]).toEqual([403, 'WAREHOUSE_OPERATOR_ONLY', OPERATOR_ONLY]);
    expect([(await bk(id)).status, (await audits(id, 'warehousing.booking.stored')).rows.length]).toEqual(['confirmed', 0]);
    const s = await post(T.op, `/v1/warehousing/storage-bookings/${id}/store`);
    expect([s.status, s.body.data?.status]).toEqual([201, 'stored']);
    expect((await audits(id, 'warehousing.booking.stored')).rows).toEqual([{ actor_user_id: operator, old_value: { status: 'confirmed' }, new_value: { status: 'stored' }, reason: null }]);

    const id2 = await booking(warehouseId, depositor, 'confirmed');
    const x = await post(T.op, `/v1/warehousing/storage-bookings/${id2}/cancel`, { reason: 'Goods did not arrive' });
    expect([x.status, x.body.data?.status]).toEqual([201, 'cancelled']);
    expect((await audits(id2, 'warehousing.booking.cancelled')).rows.length).toBe(1);
  });

  it('(2) box=warehouse&warehouseId= by the operator → that warehouse\'s bookings (others\' included, no name); box=depositor (the default) → his OWN deposits only', async () => {
    const theirs = await booking(warehouseId, farmer2, 'requested');
    const ownDeposit = await booking(warehouseId, operator, 'requested');    // the operator's own deposit — what the old console showed him
    const w = await request(http).get(`/v1/warehousing/storage-bookings?box=warehouse&warehouseId=${warehouseId}&limit=100`).set(H(T.op));
    expect(w.status).toBe(200);
    const ids = (w.body.data as Array<{ id: string }>).map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([theirs, ownDeposit]));
    for (const row of w.body.data as Array<Record<string, unknown>>) {
      expect(Object.keys(row).sort()).toEqual(['createdAt', 'depositorUserId', 'id', 'productId', 'quantity', 'releasedAt', 'status', 'storedAt', 'unitCode', 'warehouseId']);   // an id, never a name
    }
    const dflt = await request(http).get('/v1/warehousing/storage-bookings?limit=100').set(H(T.op));
    expect([dflt.status, (dflt.body.data as Array<{ id: string }>).map((b) => b.id)]).toEqual([200, [ownDeposit]]);
    const asDep = await request(http).get('/v1/warehousing/storage-bookings?box=depositor&limit=100').set(H(T.op));
    expect((asDep.body.data as Array<{ id: string }>).map((b) => b.id)).toEqual([ownDeposit]);
    expect((await request(http).get(`/v1/warehousing/storage-bookings?box=warehouse&warehouseId=${warehouseId}`).set(H(T.f2))).status).toBe(403);
  });

  it('(3) F-4: store records no weight — the quantity stays the requested one, and a `{ quantity }` body on store is ignored (pinned)', async () => {
    const id = await booking(warehouseId, depositor, 'confirmed', '62.6');
    const r = await post(T.op, `/v1/warehousing/storage-bookings/${id}/store`, { quantity: '1.000' });
    expect([r.status, r.body.data?.status, r.body.data?.quantity]).toEqual([201, 'stored', '62.600']);
    expect(await bk(id)).toEqual({ status: 'stored', quantity: '62.600' });
  });

  // DEVIATION (survey §7 item 4 says "on any table"): that premise is FALSE platform-wide — the dairy module records a real `milk_collections.weight_kg`
  // and money tables carry `gross_minor` (pinned below as the CONTROL, so the probe is proven to see a match). What is true, and pinned: no
  // warehousing table carries a weight, tare, gross, place, stack, pest or location column, and no table anywhere is a weighment / stack / pest object.
  it('(4) no weight / tare / gross / bay / stack / pest / location column on the four warehousing tables, and no such table anywhere (control: the probe sees dairy\'s weight_kg)', async () => {
    const COL = `a.attname ~* 'weigh|tare|gross|stack|pest|(^|_)bays?(_|$)|location|quarantin'`;
    const control = await admin.query(`SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'milk_collections' AND a.attnum > 0 AND NOT a.attisdropped AND ${COL}`);
    expect(control.rows.length).toBeGreaterThan(0);
    const cols = await admin.query(`SELECT c.relname AS t, a.attname AS col FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname IN ('warehouses', 'storage_bookings', 'nwr_receipts', 'assay_reports') AND a.attnum > 0 AND NOT a.attisdropped AND ${COL} ORDER BY 1, 2`);
    expect(cols.rows).toEqual([]);
    const tables = await admin.query(`SELECT relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND relname ~* 'weigh|tare|stack|pest|(^|_)bays?(_|$)|quarantin' ORDER BY 1`);
    expect(tables.rows).toEqual([]);
  });

  it('(5) absence → 404: weighments, stacks, pest checks; a warehouse.manage-only caller cannot request a booking (403 — "New booking" at the API)', async () => {
    for (const p of ['/v1/warehousing/weighments', '/v1/warehousing/stacks', '/v1/warehousing/pest-checks']) {
      const r = await request(http).post(p).set({ ...H(T.op), 'idempotency-key': randomUUID() }).send({});
      expect([p, r.status]).toEqual([p, 404]);
    }
    const before = await n(`SELECT count(*)::int n FROM storage_bookings WHERE tenant_id = $1`, [A]);
    const desk = await request(http).post('/v1/warehousing/storage-bookings').set({ ...H(T.op), 'idempotency-key': randomUUID() })
      .send({ warehouseId, productId, quantity: '10.000', unitCode: 'quintal' });
    expect(desk.status).toBe(403);
    expect(await n(`SELECT count(*)::int n FROM storage_bookings WHERE tenant_id = $1`, [A])).toBe(before);
  });

  it('(D1) the rate: a non-operator administrator → 403 WAREHOUSE_REASSIGN_ONLY, rate unchanged, no audit row; the operator → 200, ONE row', async () => {
    const rows = () => audits(warehouseId, 'warehousing.warehouse.updated');
    const before = (await rows()).rows.length;
    for (const body of [{ ratePerQtlMonthMinor: '1' }, { defaultName: 'Renamed' }, { operatorUserId: newOp, ratePerQtlMonthMinor: '1' }]) {
      const r = await patch(T.admin, warehouseId, body);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([403, 'WAREHOUSE_REASSIGN_ONLY', REASSIGN_ONLY]);
    }
    expect(await whRow(warehouseId)).toEqual({ operator_user_id: operator, rate: '900', default_name: 'Test warehouse' });
    expect((await rows()).rows.length).toBe(before);
    const ok = await patch(T.op, warehouseId, { ratePerQtlMonthMinor: '1100' });
    expect([ok.status, ok.body.data?.ratePerQtlMonthMinor]).toEqual([200, '1100']);
    const after = (await rows()).rows;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ actor_user_id: operator, old_value: { ratePerQtlMonthMinor: '900' }, new_value: { ratePerQtlMonthMinor: '1100' } });
  });

  it('(D2) reassignment: a non-operator administrator sends ONLY operatorUserId — to a member 200 + one row before/after; to a non-member 422', async () => {
    const rows = () => audits(warehouseId, 'warehousing.warehouse.updated');
    const before = (await rows()).rows.length;
    const bad = await patch(T.admin, warehouseId, { operatorUserId: outsider });
    expect([bad.status, bad.body.error?.code]).toEqual([422, 'WAREHOUSE_OPERATOR_NOT_A_MEMBER']);
    expect([(await whRow(warehouseId)).operator_user_id, (await rows()).rows.length]).toEqual([operator, before]);
    const ok = await patch(T.admin, warehouseId, { operatorUserId: newOp });
    expect([ok.status, ok.body.data?.operatorUserId]).toEqual([200, newOp]);
    const all = (await rows()).rows;
    expect(all.length).toBe(before + 1);
    expect(all[all.length - 1]).toMatchObject({ actor_user_id: otherAdmin, old_value: { operatorUserId: operator }, new_value: { operatorUserId: newOp, fields: ['operatorUserId'] } });
    // the former operator is now an administrator who is NOT the operator: the rate is no longer his (D1), reassignment still is (D2) — hand it back
    expect((await patch(T.op, warehouseId, { ratePerQtlMonthMinor: '5' })).body.error?.code).toBe('WAREHOUSE_REASSIGN_ONLY');
    expect((await patch(T.op, warehouseId, { operatorUserId: operator })).status).toBe(200);
    expect((await whRow(warehouseId)).operator_user_id).toBe(operator);
  });

  it('(D3) cancel: the operator without a reason → 400 by name, nothing written; with one → one row carrying it; the depositor\'s own without one → 201, one row; another farmer → 403', async () => {
    const a = await booking(warehouseId, depositor, 'requested');
    for (const body of [{}, { reason: '' }, { reason: '   ' }]) {
      const r = await post(T.op, `/v1/warehousing/storage-bookings/${a}/cancel`, body);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([400, 'BOOKING_CANCEL_REASON_REQUIRED', REASON]);
    }
    expect((await post(T.op, `/v1/warehousing/storage-bookings/${a}/cancel`, { reason: 'x'.repeat(501) })).body.error?.code).toBe('BOOKING_CANCEL_REASON_REQUIRED');
    expect([(await bk(a)).status, (await audits(a, 'warehousing.booking.cancelled')).rows.length]).toEqual(['requested', 0]);
    const ok = await post(T.op, `/v1/warehousing/storage-bookings/${a}/cancel`, { reason: 'Depositor asked by phone' });
    expect([ok.status, ok.body.data?.status]).toEqual([201, 'cancelled']);
    expect((await audits(a, 'warehousing.booking.cancelled')).rows).toEqual([{ actor_user_id: operator, old_value: { status: 'requested' },
      new_value: { status: 'cancelled', cancelledBy: 'operator' }, reason: 'Depositor asked by phone' }]);
    // a replay (no Idempotency-Key on this route — none was decided): the state machine refuses it, nothing more is written
    const again = await post(T.op, `/v1/warehousing/storage-bookings/${a}/cancel`, { reason: 'Depositor asked by phone' });
    expect([again.status, again.body.error?.code]).toEqual([409, 'STORAGE_BOOKING_ILLEGAL_TRANSITION']);
    expect((await audits(a, 'warehousing.booking.cancelled')).rows.length).toBe(1);

    const b = await booking(warehouseId, depositor, 'confirmed');
    expect((await post(T.f2, `/v1/warehousing/storage-bookings/${b}/cancel`, {})).status).toBe(403);
    const hers = await post(T.dep, `/v1/warehousing/storage-bookings/${b}/cancel`, {});
    expect([hers.status, hers.body.data?.status]).toEqual([201, 'cancelled']);
    expect((await audits(b, 'warehousing.booking.cancelled')).rows).toEqual([{ actor_user_id: depositor, old_value: { status: 'confirmed' },
      new_value: { status: 'cancelled', cancelledBy: 'depositor' }, reason: null }]);
  });

  it('(NULL) a platform-global warehouse is never edited or reassigned from a tenant (404, row unchanged); a booking at it is its operator\'s alone', async () => {
    const before = await whRow(globalWh);
    for (const [token, tenant, body] of [[T.admin, A, { operatorUserId: otherAdmin }], [T.op, A, { ratePerQtlMonthMinor: '1' }], [T.globalOp, B, { operatorUserId: globalOp }], [T.globalOp, B, { ratePerQtlMonthMinor: '1' }]] as const) {
      const r = await patch(token, globalWh, body, tenant);
      expect([r.status, r.body.error?.code]).toEqual([404, 'WAREHOUSE_NOT_FOUND']);
    }
    expect(await whRow(globalWh)).toEqual(before);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1`, [globalWh])).toBe(0);
    // it is visible to browse (0014 RLS: NULL tenant is everyone's to read), so a booking in A can name it — and only ITS operator may confirm it
    const id = await booking(globalWh, depositor, 'requested');
    const notOp = await post(T.op, `/v1/warehousing/storage-bookings/${id}/confirm`);
    expect([notOp.status, notOp.body.error?.code]).toEqual([403, 'WAREHOUSE_OPERATOR_ONLY']);
    expect((await bk(id)).status).toBe('requested');
  });
});
