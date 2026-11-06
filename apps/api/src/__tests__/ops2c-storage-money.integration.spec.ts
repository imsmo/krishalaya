// apps/api/src/__tests__/ops2c-storage-money.integration.spec.ts · PC-56 OPS-2c — THE MONEY OF STORAGE, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures (no
// `makeCategory` / `makeProduct` — the known two-type parameter trap; a category and a product of its own, the ops1a shape). `warehousing` stays
// OFF in the seed and is switched ON for THIS organisation only (an allow-list in the flag's rules — the fixture, not the product), restored in
// afterAll; the seeded OFF state is itself asserted first.
//
// What it proves (brief §C = survey §7 items 1–5; founder Q1-A, Q2-A, Q8-A, 2026-11-06):
//   (1) B4 / B6: `PATCH /v1/warehousing/warehouses/:id` with a new rate → exactly ONE `audit_log` row with the old and new rate; with a new
//       operator → ONE row with the old and new operator; naming an operator who is not a member of the tenant → 422
//       WAREHOUSE_OPERATOR_NOT_A_MEMBER and NOTHING written (the row unchanged, no audit, no outbox) — on update AND on listing (no warehouse,
//       no idempotency record).
//   (2) B5: `POST …/storage-bookings` with `unitCode: 'kg'` → 422 STORAGE_UNIT_NOT_QUINTAL; no booking, no outbox row, no idempotency record;
//       a replay with the same key → the same refusal; `quintal` → 201, and B23's exact string "6260.125" round-trips through the database.
//   (3) Today's truth (Q8-A): `POST …/:id/release` → 409 STORAGE_RELEASE_AWAITS_DEPOSITOR; no `storage_fee` ledger row in the tenant; the
//       operator's and the depositor's balances unchanged.
//   (4) `GET …/warehouses?box=mine` returns the operator's own warehouses only, `ratePerQtlMonthMinor` a digit string (what W378 prints); the
//       default box (no `box`, what the SDK sent before OPS-2c) is NOT "mine" — it also returns another operator's warehouse (F-9, pinned).
//   (5) Absence → 404: no billing read, no billing run, no insights read, no fee preview.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { platform, PlatformAccount, userMain } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const RELEASE = 'A release cannot be made here yet: the storage fee would leave the depositor\'s wallet without her confirming it. Nothing was released or charged.';
const UNIT = 'Storage is booked in quintals only, because the storage fee is computed on the quantity in quintals. Nothing was booked.';
const MEMBER = 'The person named as the warehouse operator is not an active member of this organisation. Nothing was saved.';

run('PC-56 OPS-2c · the money of storage (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID();
  let operator = ''; let operator2 = ''; let depositor = ''; let outsider = ''; let otherOp = '';
  let warehouseId = ''; let otherWarehouseId = ''; let productId = ''; let storedId = '';
  const T: Record<string, string> = {};
  let backup: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown } | undefined;

  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': A });
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const role = (userId: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, A, code]);
  const balance = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const whAudit = () => admin.query(`SELECT action, old_value, new_value, actor_user_id FROM audit_log WHERE entity_id = $1 AND action = 'warehousing.warehouse.updated' ORDER BY created_at`, [warehouseId]);
  const whRow = async () => (await admin.query(`SELECT operator_user_id, rate_per_qtl_month_minor::text AS rate FROM warehouses WHERE id = $1`, [warehouseId])).rows[0];
  const whOutbox = () => n(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'warehousing.warehouse_updated'`, [warehouseId]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops 2c ${A.slice(0, 4)}`);
    [operator, operator2, depositor, outsider, otherOp] = await Promise.all(Array.from({ length: 5 }, () => makeUser(admin)));
    await role(operator, 'tenant_admin'); await role(operator2, 'tenant_admin'); await role(depositor, 'farmer'); await role(otherOp, 'tenant_admin');
    // `outsider` is a real user with NO role in this tenant — the non-member B6 refuses.

    const categoryId = randomUUID(); const code = `ops2c_${A.replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1, $2, 'Test Category', $3::ltree, 1, true)`, [categoryId, code, code]);
    productId = randomUUID();
    await ensureUnitCurrency(admin, 'quintal');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('kg','Kilogram','mass',true) ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
      VALUES ($1, $2, 'Test Product', 'quintal', NULL, true, to_tsvector('simple', 'Test Product'))`, [productId, categoryId]);
    warehouseId = randomUUID(); otherWarehouseId = randomUUID(); storedId = randomUUID();
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Test warehouse', 900, true, $3)`, [warehouseId, A, operator]);
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Other warehouse', 700, true, $3)`, [otherWarehouseId, A, otherOp]);
    await admin.query(`INSERT INTO storage_bookings (id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, status, stored_at, created_by)
      VALUES ($1, $2, $3, $4, $5, 100, 'quintal', 'stored', now() - interval '40 days', $4)`, [storedId, A, warehouseId, depositor, productId]);

    backup = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'warehousing'`)).rows[0];
    expect([backup?.key, backup?.is_enabled]).toEqual(['warehousing', false]);   // seeded OFF
    // FIXTURE: `warehousing` ON for this organisation only (rules.tenant_ids), so the routes under test answer; restored in afterAll.
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'warehousing'`, [JSON.stringify({ tenant_ids: [A] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:warehousing', 'flagstale:warehousing', 'flags:all', `flagctx:${A}`]) await cache.del(c);
    // the depositor's wallet funded (fixture only, through the wallet port): the release refusal must hold when the fee COULD be taken
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    await uow.run(A, (tx) => wallet.post(tx, { tenantId: A, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: userMain(depositor), amountMinor: 10_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -10_000_000n }] }), { userId: 'system' });

    T.op = mintToken(app, { userId: operator, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage'] });
    T.op2 = mintToken(app, { userId: operator2, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage'] });
    T.dep = mintToken(app, { userId: depositor, tenantId: A, roles: ['farmer'], perms: ['warehouse.store'] });
  }, 120_000);

  afterAll(async () => {
    try { if (backup) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [backup.key, backup.is_enabled, backup.rollout_pct, JSON.stringify(backup.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) B4 / B6: one audit row per update with the rate / operator before → after; a non-member operator is refused by name and nothing is written', async () => {
    const patch = (token: string, body: object) => request(http).patch(`/v1/warehousing/warehouses/${warehouseId}`).set(H(token)).send(body);
    const rate = await patch(T.op, { ratePerQtlMonthMinor: '1200' });
    expect([rate.status, rate.body.data?.ratePerQtlMonthMinor]).toEqual([200, '1200']);
    let rows = (await whAudit()).rows;
    expect(rows.length).toBe(1);
    expect([rows[0].actor_user_id, rows[0].old_value, rows[0].new_value]).toEqual([operator, { ratePerQtlMonthMinor: '900' }, { ratePerQtlMonthMinor: '1200', fields: ['ratePerQtlMonthMinor'] }]);

    // a non-member operator: refused BY NAME, nothing written (the row, the audit and the outbox are unchanged)
    const outboxBefore = await whOutbox();
    const bad = await patch(T.op, { operatorUserId: outsider, ratePerQtlMonthMinor: '5' });
    expect([bad.status, bad.body.error?.code, bad.body.error?.message]).toEqual([422, 'WAREHOUSE_OPERATOR_NOT_A_MEMBER', MEMBER]);
    expect(await whRow()).toEqual({ operator_user_id: operator, rate: '1200' });
    expect((await whAudit()).rows.length).toBe(1);
    expect(await whOutbox()).toBe(outboxBefore);
    const ghost = await patch(T.op, { operatorUserId: randomUUID() });           // a UUID that is nobody at all
    expect([ghost.status, ghost.body.error?.code]).toEqual([422, 'WAREHOUSE_OPERATOR_NOT_A_MEMBER']);

    // an operator change to a member: ONE more row, old/new operator only
    const reassign = await patch(T.op, { operatorUserId: operator2 });
    expect([reassign.status, reassign.body.data?.operatorUserId]).toEqual([200, operator2]);
    rows = (await whAudit()).rows;
    expect(rows.length).toBe(2);
    expect([rows[1].old_value, rows[1].new_value]).toEqual([{ operatorUserId: operator }, { operatorUserId: operator2, fields: ['operatorUserId'] }]);
    // hand it back (the new operator acts), so the release case below runs against the first operator — one more row, again old/new operator
    expect((await patch(T.op2, { operatorUserId: operator })).status).toBe(200);
    expect((await whAudit()).rows.length).toBe(3);

    // listing with a non-member operator: refused by name; no warehouse, no idempotency record
    const key = randomUUID();
    const list = await request(http).post('/v1/warehousing/warehouses').set({ ...H(T.op), 'idempotency-key': key }).send({ defaultName: 'Refused warehouse', operatorUserId: outsider });
    expect([list.status, list.body.error?.code]).toEqual([422, 'WAREHOUSE_OPERATOR_NOT_A_MEMBER']);
    expect(await n(`SELECT count(*)::int n FROM warehouses WHERE tenant_id = $1 AND default_name = 'Refused warehouse'`, [A])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE $1`, [`%::${key}`])).toBe(0);
  });

  it('(2) B5: a kg booking → 422 STORAGE_UNIT_NOT_QUINTAL, nothing written or remembered, a replay refused the same; quintal → 201 and "6260.125" exact', async () => {
    const key = randomUUID();
    const book = (unitCode: string, k: string, quantity = '62.600') => request(http).post('/v1/warehousing/storage-bookings').set({ ...H(T.dep), 'idempotency-key': k }).send({ warehouseId, productId, quantity, unitCode });
    const bookings = () => n(`SELECT count(*)::int n FROM storage_bookings WHERE tenant_id = $1 AND depositor_user_id = $2`, [A, depositor]);
    const outbox = () => n(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1 AND event_type = 'warehousing.booking_requested'`, [A]);
    const [b0, o0] = [await bookings(), await outbox()];
    for (let i = 0; i < 2; i++) {
      const r = await book('kg', key);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([422, 'STORAGE_UNIT_NOT_QUINTAL', UNIT]);
    }
    expect([await bookings(), await outbox()]).toEqual([b0, o0]);
    expect(await n(`SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE $1`, [`%::${key}`])).toBe(0);

    const ok = await book('quintal', randomUUID(), '6260.125');
    expect([ok.status, ok.body.data?.unitCode, ok.body.data?.quantity, ok.body.data?.status]).toEqual([201, 'quintal', '6260.125', 'requested']);
    expect((await admin.query(`SELECT quantity::text q, unit_code FROM storage_bookings WHERE id = $1`, [ok.body.data.id])).rows[0]).toEqual({ q: '6260.125', unit_code: 'quintal' });
    const read = await request(http).get(`/v1/warehousing/storage-bookings/${ok.body.data.id}`).set(H(T.dep));
    expect([read.status, read.body.data?.quantity]).toEqual([200, '6260.125']);   // B23: back out of the database through the string parse
    expect([await bookings(), await outbox()]).toEqual([b0 + 1, o0 + 1]);
  });

  it('(3) today\'s truth (Q8-A): release → 409 by name; no storage_fee row in the tenant; both balances unchanged', async () => {
    const [depBefore, opBefore] = [await balance(depositor), await balance(operator)];
    expect(depBefore).toBe(10_000_000n);
    const r = await request(http).post(`/v1/warehousing/storage-bookings/${storedId}/release`).set({ ...H(T.op), 'idempotency-key': randomUUID() }).send({});
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'STORAGE_RELEASE_AWAITS_DEPOSITOR', RELEASE]);
    expect(await n(`SELECT count(*)::int n FROM ledger_transactions t JOIN lookup_values l ON l.id = t.txn_type_id WHERE l.code = 'storage_fee' AND t.tenant_id = $1`, [A])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_id = $1 OR idempotency_key = $2`, [storedId, `storagefee:${storedId}`])).toBe(0);
    expect([await balance(depositor), await balance(operator)]).toEqual([depBefore, opBefore]);
    expect((await admin.query(`SELECT status FROM storage_bookings WHERE id = $1`, [storedId])).rows[0].status).toBe('stored');
  });

  it('(4) GET …/warehouses?box=mine: the operator\'s own warehouses only, the rate a digit string; the default box is not "mine" (F-9)', async () => {
    const mine = await request(http).get('/v1/warehousing/warehouses?box=mine').set(H(T.op));
    expect(mine.status).toBe(200);
    const items = mine.body.data as Array<Record<string, unknown>>;
    expect(items.map((w) => w.id)).toEqual([warehouseId]);
    expect(items[0]).toMatchObject({ id: warehouseId, defaultName: 'Test warehouse', operatorUserId: operator, ratePerQtlMonthMinor: '1200' });
    expect(/^\d+$/.test(String(items[0].ratePerQtlMonthMinor))).toBe(true);
    expect(Object.keys(mine.body.meta ?? {}).sort()).toEqual(['nextCursor', 'request_id', 'timestamp']);   // no total for the page to print
    const dflt = await request(http).get('/v1/warehousing/warehouses').set(H(T.op));
    expect(dflt.status).toBe(200);
    expect((dflt.body.data as Array<{ id: string }>).map((w) => w.id)).toEqual(expect.arrayContaining([warehouseId, otherWarehouseId]));   // another operator's too
  });

  it('(5) absence → 404: no billing read, no billing run, no insights read, no fee preview', async () => {
    for (const [method, path] of [
      ['get', '/v1/warehousing/billing'],
      ['post', '/v1/warehousing/billing/runs'],
      ['get', '/v1/warehousing/insights'],
      ['post', `/v1/warehousing/storage-bookings/${storedId}/fee-preview`],
    ] as const) {
      const r = await (method === 'get' ? request(http).get(path).set(H(T.op)) : request(http).post(path).set({ ...H(T.op), 'idempotency-key': randomUUID() }).send({}));
      expect([path, r.status]).toEqual([path, 404]);
    }
  });
});
