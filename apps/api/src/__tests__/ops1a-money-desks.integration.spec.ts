// apps/api/src/__tests__/ops1a-money-desks.integration.spec.ts · PC-56 OPS-1a — THE MONEY DESKS, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures
// (no `makeCategory` / `makeProduct` — the known two-type parameter trap; a category and a product of its own). `dairy` and `warehousing` stay OFF in the seed and are switched
// ON for THIS organisation only (an allow-list), restored in afterAll.
//
// What it proves (brief §C; founder 1a-1 Q2-A, 1a-2 Q3-A, 2026-11-05):
//   (1) `GET /v1/dairy/milk-bills?box=all` returns the bill's server amounts — gross / deductions / net as minor-unit strings, the status
//       verbatim — exactly what /payout prints; the bill's own read (`GET …/:id`) answers the same figures; no cycle total is in the list.
//       **TODAY'S TRUTH PINNED — THE OPEN DOOR (founder question, not changed by this wave):** ONE person holding `dairy.manage` +
//       `settlement.close` (tenant_admin holds both in the seed) previews, approves AND pays one bill over the per-bill routes, alone:
//       one `milk_payment` txn keyed `milkbill:<id>`; a second pay with a new Idempotency-Key is refused (409) and moves nothing more.
//   (2) Q3-A: `POST /v1/warehousing/storage-bookings/:id/release` by the warehouse's own operator → 409 STORAGE_RELEASE_AWAITS_DEPOSITOR with
//       the founder's sentence; the booking stays `stored`; no ledger txn, no `storage_fee` row, no audit row, no idempotency record — searched
//       by the booking id; by the depositor (no warehouse.manage) → the existing 403; a replay with the SAME key → the same refusal; no key → 400.
//   (3) absence → 404: send-to-desk, bill-cycle submit, request-release, partial-release, the NWR NOC.
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
import { platform, PlatformAccount, TenantAccount, userMain } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const SENTENCE = 'A release cannot be made here yet: the storage fee would leave the depositor\'s wallet without her confirming it. Nothing was released or charged.';
const FLAGS = ['dairy', 'warehousing'] as const;

run('PC-56 OPS-1a · the money desks (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID();
  let desk = ''; let farmer = ''; let operator = ''; let depositor = ''; let otherManager = '';
  let billId = ''; let bookingId = ''; let membershipId = '';
  const T: Record<string, string> = {};
  let depositorBalance: () => Promise<bigint> = async () => -1n;
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];

  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': A });
  const post = (token: string, path: string, key: string | null = randomUUID()) => request(http).post(path).set(key ? { ...H(token), 'idempotency-key': key } : H(token)).send({});
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  async function role(userId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, A, code]);
  }
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${A}`]) await cache.del(c);
  }
  const bookingMoney = async () => ({
    txns: await n(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_id = $1 OR idempotency_key = $2`, [bookingId, `storagefee:${bookingId}`]),
    entries: await n(`SELECT count(*)::int n FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id WHERE t.reference_id = $1`, [bookingId]),
    audit: await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1`, [bookingId]),
    outbox: await n(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'warehousing.booking_released'`, [bookingId]),
    idem: await n(`SELECT count(*)::int n FROM idempotency_keys WHERE endpoint LIKE '%warehousing.booking.release%' AND user_id = $1`, [operator]),
    booking: (await admin.query(`SELECT status, released_at FROM storage_bookings WHERE id = $1`, [bookingId])).rows[0],
  });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops desk 1a ${A.slice(0, 4)}`);
    [desk, farmer, operator, depositor, otherManager] = await Promise.all(Array.from({ length: 5 }, () => makeUser(admin)));
    await role(desk, 'tenant_admin'); await role(farmer, 'farmer'); await role(operator, 'tenant_admin'); await role(depositor, 'farmer'); await role(otherManager, 'tenant_admin');

    // dairy fixture: a centre, one member, one DRAFT bill with server amounts (no deductions — the common path)
    const mccId = randomUUID(); membershipId = randomUUID(); billId = randomUUID();
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, 'C-OPS1A', 'Test centre', true)`, [mccId, A]);
    await admin.query(`INSERT INTO dairy_memberships (id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, is_active) VALUES ($1, $2, $3, $4, 'M-1A-01', 'weekly', true)`, [membershipId, A, farmer, mccId]);
    await admin.query(`INSERT INTO milk_bills (id, tenant_id, membership_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status)
      VALUES ($1, $2, $3, current_date - 9, current_date, 158.40, 1046210, 0, 1046210, 'draft')`, [billId, A, membershipId]);

    // warehouse fixture: the operator's own warehouse (a fee-bearing rate), the depositor's booking, STORED
    const categoryId = randomUUID(); const code = `ops1a_${A.replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1, $2, 'Test Category', $3::ltree, 1, true)`, [categoryId, code, code]);
    const productId = randomUUID();   // own insert (fixtures.ts makeProduct binds $3 as two types — the same trap as makeCategory)
    await ensureUnitCurrency(admin, 'quintal');
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
      VALUES ($1, $2, 'Test Product', 'quintal', NULL, true, to_tsvector('simple', 'Test Product'))`, [productId, categoryId]);
    const warehouseId = randomUUID(); bookingId = randomUUID();
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Test warehouse', 5000, true, $3)`, [warehouseId, A, operator]);
    await admin.query(`INSERT INTO storage_bookings (id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, status, stored_at, created_by)
      VALUES ($1, $2, $3, $4, $5, 100, 'quintal', 'stored', now() - interval '40 days', $4)`, [bookingId, A, warehouseId, depositor, productId]);

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual([['dairy', false], ['warehousing', false]]);   // seeded OFF
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [A] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    // the cooperative's own wallet, funded so a payment can move (fixture only — through the wallet port, never a ledger INSERT)
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    await uow.run(A, (tx) => wallet.post(tx, { tenantId: A, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: { kind: 'tenant', tenantId: A, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: 50_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -50_000_000n }] }), { userId: 'system' });
    // the depositor's own wallet, funded too: the refusal must hold when the fee COULD be taken (a broke depositor would refuse by balance)
    await uow.run(A, (tx) => wallet.post(tx, { tenantId: A, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: userMain(depositor), amountMinor: 10_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -10_000_000n }] }), { userId: 'system' });
    depositorBalance = async () => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [depositor])).rows[0]?.b ?? '0');

    T.desk = mintToken(app, { userId: desk, tenantId: A, roles: ['tenant_admin'], perms: ['dairy.manage', 'settlement.close'] });
    T.op = mintToken(app, { userId: operator, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage'] });
    T.other = mintToken(app, { userId: otherManager, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage'] });
    T.dep = mintToken(app, { userId: depositor, tenantId: A, roles: ['farmer'], perms: ['warehouse.store'] });
  }, 120_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) the bills list answers the server amounts /payout prints; the bill read agrees; TODAY one person previews, approves AND pays one bill alone (the open door, pinned)', async () => {
    const list = await get(T.desk, '/v1/dairy/milk-bills?box=all&limit=25');
    expect(list.status).toBe(200);
    const row = (list.body.data as Array<Record<string, unknown>>).find((b) => b.id === billId);
    expect(row).toMatchObject({ membershipId, grossMinor: '1046210', deductionsMinor: '0', netMinor: '1046210', status: 'draft', totalLitres: '158.400' });
    expect(Object.keys(list.body.meta ?? {}).sort()).toEqual(['nextCursor', 'request_id', 'timestamp']);                // no total, no count, no cycle sum: the page can print none
    const one = await get(T.desk, `/v1/dairy/milk-bills/${billId}`);
    expect([one.status, one.body.data.grossMinor, one.body.data.netMinor, one.body.data.status]).toEqual([200, '1046210', '1046210', 'draft']);

    // ── THE OPEN DOOR (founder question; this wave does NOT change it): the per-bill routes let ONE person do all three acts. ──
    expect((await post(T.desk, `/v1/dairy/milk-bills/${billId}/preview`, null)).status).toBe(201);
    expect((await post(T.desk, `/v1/dairy/milk-bills/${billId}/approve`, null)).status).toBe(201);   // no previewer ≠ approver on the per-bill path
    // the member's dispute window is real and enforced at pay; the fixture moves it into the past (what payday looks like)
    await admin.query(`UPDATE milk_bills SET dispute_window_ends = now() - interval '1 minute' WHERE id = $1`, [billId]);
    const paid = await post(T.desk, `/v1/dairy/milk-bills/${billId}/pay`);
    expect([paid.status, paid.body.data?.status]).toEqual([201, 'paid']);
    const pays = () => n(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1 AND reference_id = $2`, [`milkbill:${billId}`, billId]);
    expect(await pays()).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE action = 'dairy.bill.paid' AND entity_id = $1 AND actor_user_id = $2`, [billId, desk])).toBe(1);
    const again = await post(T.desk, `/v1/dairy/milk-bills/${billId}/pay`);              // a NEW key: refused (already paid), nothing more moves
    expect(again.status).toBe(409);
    expect(await pays()).toBe(1);
  });

  it('(2) Q3-A: the operator\'s release → 409 by name, the booking stays stored, NOTHING moves or is written; depositor → 403; same-key replay → the same 409', async () => {
    const before = await bookingMoney(); const balBefore = await depositorBalance();
    expect(before.booking.status).toBe('stored'); expect(balBefore).toBe(10_000_000n);
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {                                                           // the operator, then a replay with the SAME key
      const r = await post(T.op, `/v1/warehousing/storage-bookings/${bookingId}/release`, key);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'STORAGE_RELEASE_AWAITS_DEPOSITOR', SENTENCE]);
      expect(r.body.data).toBeUndefined();
    }
    const other = await post(T.other, `/v1/warehousing/storage-bookings/${bookingId}/release`);   // a manage-holder who is NOT the operator: refused the same
    expect([other.status, other.body.error?.code]).toEqual([409, 'STORAGE_RELEASE_AWAITS_DEPOSITOR']);
    const dep = await post(T.dep, `/v1/warehousing/storage-bookings/${bookingId}/release`);        // the depositor holds no warehouse.manage: the existing 403
    expect(dep.status).toBe(403);
    const nokey = await post(T.op, `/v1/warehousing/storage-bookings/${bookingId}/release`, null);  // the Idempotency-Key check still comes first
    expect(nokey.status).toBe(400);
    const after = await bookingMoney();
    expect(after).toEqual(before);
    expect(await depositorBalance()).toBe(balBefore);                                          // her wallet is untouched
    expect(after).toMatchObject({ txns: 0, entries: 0, audit: 0, outbox: 0, booking: { status: 'stored', released_at: null } });
    expect(await n(`SELECT count(*)::int n FROM ledger_transactions t JOIN lookup_values l ON l.id = t.txn_type_id WHERE l.code = 'storage_fee' AND t.tenant_id = $1`, [A])).toBe(0);
    // the booking's other operator acts are untouched by the refusal: the read still answers it, stored
    const read = await get(T.op, `/v1/warehousing/storage-bookings/${bookingId}`);
    expect([read.status, read.body.data?.status]).toEqual([200, 'stored']);
  });

  it('(3) absence → 404: no send-to-desk, no cycle submit, no request-release, no partial release, no NOC', async () => {
    for (const [token, path] of [
      [T.desk, `/v1/dairy/milk-bills/${billId}/send-to-desk`],
      [T.desk, `/v1/dairy/bill-cycles/${randomUUID()}/submit`],
      [T.dep, `/v1/warehousing/storage-bookings/${bookingId}/request-release`],
      [T.op, `/v1/warehousing/storage-bookings/${bookingId}/partial-release`],
      [T.op, `/v1/warehousing/nwr/${randomUUID()}/noc`],
    ] as const) {
      const r = await post(token, path);
      expect([path, r.status]).toEqual([path, 404]);
    }
    expect((await bookingMoney()).booking.status).toBe('stored');
  });
});
