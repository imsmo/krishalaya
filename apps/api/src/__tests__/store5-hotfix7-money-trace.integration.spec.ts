// apps/api/src/__tests__/store5-hotfix7-money-trace.integration.spec.ts · PC-56 HOTFIX-7 — THE COMPLETION DOOR, THE REFUND THAT ISN'T, THE NAMES ON
// REVIEWS, THE PUBLIC TRACE, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the outbox events the
// API wrote are relayed AS kv_relay through the real OutboxDispatcher (production's role — the relay gate's statement), one event at a time
// (`relayById`). Tokens carry the permissions the DATABASE grants (RoleCacheService.effectiveAccess — the login path), so the 0217 revocations
// are what is exercised. Flags are flipped per tenant and restored to their seeded state (Law 10). Own fixtures (never the shared makeCategory).
//
//   (1) B1 / D1 — a COD order delivered → the BUYER completes it (no longer refused) → 0 legs under settle:<id>, the audit row, the metric; a
//       support_agent completes another COD order → the same; an online-paid (wallet) order → exactly ONE zero-sum settle:<id> with the legs the
//       3a spec pinned before HOTFIX-7 (escrow −total · the seller's main +total, split OFF);
//   (2) a COD order disputed → resolved `rejected` by a support_agent → completed → 0 escrow legs;
//   (3) D2 / D3 — `dispute_refunds` OFF → resolve refund_full → 409 DISPUTE_REFUNDS_OFF, the order still `disputed`, the dispute unchanged, the
//       refusal audited; ON → `refunded`, `dispute-refund:<id>` escrow − / source + (a WALLET payment → the buyer's wallet; a SANDBOX gateway
//       payment → `refund_initiated` then `refunded` via the sandbox's instant answer — partial: `partially_refunded`), the remainder re-settled
//       to the seller under `dispute-remainder:<id>`, every txn zero-sum; a replayed event books nothing; a return refund likewise
//       (`return-refund:<id>`); the maker-checker gate needs a SECOND support_agent at the threshold (tenant_admin cannot sign);
//   (4) B3 — an organisation whose country is not IN prices settlement in ITS country (the taxes are asked for 'AE'; no GST leg); a tenant with
//       a NULL country → SETTLEMENT_COUNTRY_UNKNOWN and no legs (the column is NOT NULL since 0002 — the constraint is lifted for the case and
//       restored);
//   (5) D4 — tenant_admin holds neither dispute.resolve nor order.refund (from the DB); `POST disputes/:id/resolve` → 403; support_agent → 201;
//       tenant_admin → `POST orders/:id/complete` on a buyer's order → 403 ORDER_FORBIDDEN;
//   (6) B5 — reviews: a stranger's box=target read and :id read carry no reviewerUserId / orderId / targetId; the author sees orderId, not targetId;
//       the seller (staff) sees reviewerUserId; a moderator everything; public `targetType=buyer` → 422 REVIEW_PUBLIC_BUYER_REFUSED, `seller` →
//       422 REVIEW_PUBLIC_SELLER_REFUSED; `targetType=organisation` lists published reviews with NO uuid and aggregates them;
//   (7) B10 / B25 — the scan: meta keys outside the allow-list absent, a value outside its rule absent, no listingId, the organisation named, no
//       uuid; a TRIAL organisation's lot → 404 TRACE_SCAN_NOT_FOUND; per-tenant traceability OFF → 404 TRACE_NOT_PUBLISHED; the platform kill-
//       switch → TRACE_NOT_PUBLISHED; an unknown token → TRACE_SCAN_NOT_FOUND; the author posting a key outside the allow-list → 422;
//   (8) B24 — trace events page 2 returns the remaining rows (the cursor carries the bigserial id now); three events in ONE millisecond page one by
//       one without a skip; the same for reviews, trace lots, certificates, disputes and returns (two rows in one millisecond);
//   (9) B23 — the two dispute clocks are in SCHEDULED_JOB_REGISTRY at the table's cadence; each tick moves a due dispute once; a second tick moves
//       nothing.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { platform, userMain, PlatformAccount } from '../core/wallet/account-codes';
import { uuidv7 } from '../core/database/uuid.util';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { OutboxHandler } from '../core/outbox/event-envelope';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS } from '../core/jobs/clock-cadence';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { Order } from '../modules/orders/domain/order.entity';
import { OrderItem } from '../modules/orders/domain/order-item.entity';
import { orderNoFor } from '../modules/orders/domain/order-no';
import { OrderRepository } from '../modules/orders/repositories/order.repository';
import { DisputeResolvedHandler as OrdersDisputeResolvedHandler } from '../modules/orders/events/handlers/dispute-resolved.handler';
import { DisputeResolvedHandler as PaymentsDisputeResolvedHandler } from '../modules/payments/events/handlers/dispute-resolved.handler';
import { ReturnRefundedHandler } from '../modules/payments/events/handlers/return-refunded.handler';
import { OrderCompletedHandler } from '../modules/payments/events/handlers/order-completed.handler';
import { OrderCompletedHandler as ReviewsOrderCompletedHandler } from '../modules/reviews/events/handlers/order-completed.handler';
import { PaymentService } from '../modules/payments/services/payment.service';
import { SettlementPricingService } from '../modules/payments/services/settlement-pricing.service';
import { DisputeSellerResponseTimeoutClock, DisputeSlaEscalationClock } from '../modules/disputes/jobs/disputes.cadence-jobs';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PRICE = 615_000n;
type Leg = { owner_kind: string; account_code: string; owner_user_id: string | null; a: string };

run('PC-56 HOTFIX-7 · the completion door, the refund that isn\'t, the names on reviews, the public trace (integration, real AppModule over HTTP, relay as kv_relay)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let uow: UnitOfWork; let wallet: WalletPort;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID(); const TRIAL = randomUUID(); const NOCO = randomUUID();
  const TENANTS = [LIVE, OTHER, TRIAL, NOCO];
  let farmer = ''; let buyer = ''; let buyer2 = ''; let tadmin = ''; let agent = ''; let agent2 = ''; let stranger = ''; let otherBuyer = ''; let otherFarmer = ''; let nocoBuyer = ''; let nocoFarmer = '';
  let liveName = ''; let product = ''; let catId = ''; let listing = ''; let otherListing = ''; let nocoListing = '';
  const T: Record<string, string> = {};
  const touched = ['online_payments', 'commission_split', 'disputes', 'dispute_refunds', 'reviews', 'traceability'];
  const flagCaches = (k: string) => [`flag:${k}`, `flagstale:${k}`, 'flags:all', ...TENANTS.map((t) => `flagctx:${t}`)];

  /** ON for these tenants only (is_enabled, rollout 0, the allow-list), ON for everyone (`'all'`), or OFF (the kill-switch). */
  const setFlag = async (k: string, on: boolean | string[] | 'all') => {
    if (on === false) await admin.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]);
    else if (on === true || on === 'all') await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = jsonb_build_object('tenant_ids', $2::jsonb) WHERE key = $1`, [k, JSON.stringify(on)]);
    for (const c of flagCaches(k)) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  /** a token carrying what the DATABASE grants this person here (the login path) */
  const dbToken = async (userId: string, tenantId: string) => {
    const access = await app.get(RoleCacheService).effectiveAccess(userId, tenantId);
    return { token: mintToken(app, { userId, tenantId, roles: access.roles, perms: access.permissions }), perms: access.permissions };
  };
  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const K = (token: string, tenantId = LIVE) => ({ ...H(token, tenantId), 'idempotency-key': randomUUID() });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const ledgerKey = (k: string) => count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [k]);
  const legsOf = async (k: string) => (await admin.query(
    `SELECT w.owner_kind, w.account_code, w.owner_user_id::text, e.amount_minor::text a FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id
       JOIN wallet_accounts w ON w.id = e.account_id WHERE t.idempotency_key = $1 ORDER BY w.owner_kind::text, w.account_code, e.amount_minor`, [k])).rows as Leg[];
  const sum = (legs: Leg[]) => legs.reduce((s, l) => s + BigInt(l.a), 0n);
  const leg = (legs: Leg[], code: string, user?: string) => legs.filter((l) => l.account_code === code && (user === undefined || l.owner_user_id === user)).reduce((s, l) => s + BigInt(l.a), 0n);
  const orderStatus = async (id: string) => (await q1(`SELECT status::text s FROM orders WHERE id = $1`, [id])).s as string;

  /** relay ONE pending event AS kv_relay through these handlers (production's role; the targeted registry keeps the case about its subject) */
  async function relay(eventType: string, aggregateId: string, handlers: OutboxHandler[]) {
    const row = await q1(`SELECT id::text FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 AND status = 'pending' ORDER BY id DESC LIMIT 1`, [eventType, aggregateId]);
    expect([eventType, aggregateId, row?.id ? 'pending' : 'none']).toEqual([eventType, aggregateId, 'pending']);
    const reg = new OutboxHandlerRegistry(); for (const h of handlers) reg.register(h);
    return new OutboxDispatcher(relayPool, reg, { inc: () => undefined, observe: () => undefined } as never).relayById(row.id);
  }
  /** a REPLAY: the newest event of this type, re-queued, relayed again */
  async function replay(eventType: string, aggregateId: string, handlers: OutboxHandler[]) {
    await admin.query(`UPDATE outbox_events SET status = 'pending', published_at = NULL WHERE id = (SELECT id FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1)`, [eventType, aggregateId]);
    return relay(eventType, aggregateId, handlers);
  }
  const published = (o: { status: string; error?: unknown }) => (o.status === 'failed' ? `failed: ${(o.error as Error)?.message}` : o.status);

  async function placeOrder(tenantId: string, buyerUserId: string, sellerUserId: string, listingId: string, requiresPayment: boolean): Promise<string> {
    const repo = app.get(OrderRepository);
    const id = uuidv7(); const now = new Date();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: now, tenantId, listingId, productId: product, titleSnapshot: 'GG-20 Groundnut hf7',
      quantity: 1, unitCode: 'quintal', unitPriceMinor: PRICE, gstRatePct: null, hsnCode: null, batchId: null });
    const o = Order.place({ id, tenantId, orderNo: `HF7-${id.replace(/-/g, '').slice(-14)}`, checkoutGroupId: null, buyerUserId, sellerUserId, source: 'direct',
      currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment, now });
    void orderNoFor;
    await uow.run(tenantId, (tx) => repo.insertGraph(tx, o, [item]), { userId: buyerUserId });
    await admin.query(`INSERT INTO dispute_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`, [tenantId, id, buyerUserId, sellerUserId]);
    return id;
  }
  const setStatus = (id: string, s: string) => admin.query(`UPDATE orders SET status = $2::order_status WHERE id = $1`, [id, s]);
  async function fund(tenantId: string, userId: string, amount: bigint): Promise<void> {
    await uow.run(tenantId, (tx) => wallet.post(tx, { tenantId, txnType: 'refund', idempotencyKey: `hf7-fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Gateway), amountMinor: -amount }, { account: userMain(userId), amountMinor: amount }] }), { userId: 'system' });
  }
  /** a REAL wallet capture (buyer main → escrow, `walletpay:<orderId>`, the payment row `success`) */
  async function walletPaid(tenantId: string, buyerUserId: string, orderId: string): Promise<string> {
    const r = await uow.run(tenantId, (tx) => app.get(PaymentService).captureOrderFromWalletInTx(tx, { tenantId, buyerUserId, orderId, amountMinor: PRICE, currencyCode: 'INR' }), { userId: buyerUserId });
    return r.paymentId;
  }
  /** a captured SANDBOX gateway payment: the payment row (with the gateway payment id the refund needs) + the capture's legs (escrow + · gateway −) */
  async function gatewayPaid(tenantId: string, buyerUserId: string, orderId: string): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO payments (id, tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key, gateway_payment_id, method)
       SELECT $1, $2, $3, lv.id, 'order', $4, $5, 'INR', 'success', 'sandbox', $6, $7, 'upi' FROM lookup_values lv WHERE lv.type_code = 'payment_purpose' AND lv.tenant_id IS NULL AND lv.code = 'direct_order'`,
      [id, tenantId, buyerUserId, orderId, PRICE.toString(), `hf7-pay-${id}`, `pay_hf7_${id.slice(-12)}`]);
    await uow.run(tenantId, (tx) => wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `hf7-capture:${orderId}`, referenceType: 'payment', referenceId: id, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: PRICE }, { account: platform(PlatformAccount.Gateway), amountMinor: -PRICE }] }), { userId: 'system' });
    return id;
  }
  const raise = async (token: string, orderId: string, tenantId = LIVE) => {
    const r = await request(http).post('/v1/disputes').set(K(token, tenantId)).send({ orderId, reasonCode: 'poor_quality', description: 'hf7: the lot was not as listed' });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.id as string;
  };
  const resolve = (token: string, disputeId: string, body: Record<string, unknown>) => request(http).post(`/v1/disputes/${disputeId}/resolve`).set(K(token)).send(body);
  const complete = (token: string, id: string, tenantId = LIVE) => request(http).post(`/v1/orders/${id}/complete`).set(K(token, tenantId));

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO hf7 ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Emirates Agro hf7 ${OTHER.slice(0, 4)}`);
    await makeTenant(admin, TRIAL, `Trial Coop hf7 ${TRIAL.slice(0, 4)}`); await makeTenant(admin, NOCO, `No Country hf7 ${NOCO.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = ANY($1::uuid[])`, [TENANTS]);
    await admin.query(`UPDATE tenants SET country_code = 'AE' WHERE id = $1`, [OTHER]);
    await admin.query(`UPDATE tenants SET status = 'trial' WHERE id = $1`, [TRIAL]);
    liveName = (await q1(`SELECT display_name FROM tenants WHERE id = $1`, [LIVE])).display_name;
    [farmer, buyer, buyer2, tadmin, agent, agent2, stranger, otherBuyer, otherFarmer, nocoBuyer, nocoFarmer] = await Promise.all(Array.from({ length: 11 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [farmer]);
    await admin.query(`UPDATE users SET full_name = 'Nilesh Shah' WHERE id = $1`, [buyer]);
    await role(farmer, LIVE, 'farmer'); await role(tadmin, LIVE, 'tenant_admin'); await role(agent, LIVE, 'support_agent'); await role(agent2, LIVE, 'support_agent');
    for (const x of [buyer, buyer2, stranger]) await role(x, LIVE, 'customer');
    await role(otherFarmer, OTHER, 'farmer'); await role(otherBuyer, OTHER, 'customer'); await role(nocoFarmer, NOCO, 'farmer'); await role(nocoBuyer, NOCO, 'customer');
    await role(farmer, TRIAL, 'farmer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'chf7' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await q1(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds hf7', $1::text::ltree, 1, true) RETURNING id`, [code])).id;
    product = (await q1(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut hf7', 'quintal', true) RETURNING id`, [catId])).id;
    const mkListing = async (tenantId: string, seller: string) => (await q1(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility, published_at)
       VALUES ($1, $2, $3, $4, 'GG-20 Groundnut hf7', 400, 400, 1, 'quintal', $5, 'INR', 'published', 'public', now()) RETURNING id`, [tenantId, seller, product, catId, PRICE.toString()])).id as string;
    listing = await mkListing(LIVE, farmer); otherListing = await mkListing(OTHER, otherFarmer); nocoListing = await mkListing(NOCO, nocoFarmer);
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE); uow = app.get<UnitOfWork>(UNIT_OF_WORK); wallet = app.get<WalletPort>(WALLET_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2], ['stranger', stranger]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create', 'dispute.raise', 'review.create'] });
    T.otherBuyer = mintToken(app, { userId: otherBuyer, tenantId: OTHER, roles: ['customer'], perms: ['order.create'] });
    T.nocoBuyer = mintToken(app, { userId: nocoBuyer, tenantId: NOCO, roles: ['customer'], perms: ['order.create'] });
    T.farmer = mintToken(app, { userId: farmer, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create', 'trace.manage', 'certificate.submit', 'review.create'] });
    T.agent = (await dbToken(agent, LIVE)).token; T.agent2 = (await dbToken(agent2, LIVE)).token; T.tadmin = (await dbToken(tadmin, LIVE)).token;
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relayPool = new Pool({ connectionString: u.toString(), max: 3, application_name: 'hotfix7-relay' });
    for (const k of touched) await setFlag(k, false);
    await setFlag('disputes', [LIVE]);
    for (const x of [buyer, buyer2]) await fund(LIVE, x, 50_000_000n);
    await fund(OTHER, otherBuyer, 50_000_000n); await fund(NOCO, nocoBuyer, 50_000_000n);
  }, 300_000);
  afterAll(async () => {
    try { for (const k of touched) await admin?.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]); } catch { /* teardown only */ }
    await admin?.query(`DELETE FROM tenant_settings WHERE tenant_id = ANY($1::uuid[])`, [TENANTS]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [TENANTS]).catch(() => undefined);
    await relayPool?.end().catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 60_000);

  const settleOnly = () => [app.get(OrderCompletedHandler), app.get(ReviewsOrderCompletedHandler)];
  const resolutionHandlers = () => [app.get(OrdersDisputeResolvedHandler), app.get(PaymentsDisputeResolvedHandler)];
  const O: Record<string, string> = {};   // orders by case
  const D: Record<string, string> = {};   // disputes by case

  describe('(1) B1 — a pay-on-delivery completion settles NOTHING from escrow, whoever completes it (founder D1)', () => {
    it('the BUYER completes a delivered COD order (no longer refused) → 0 legs under settle:<id>; audit order.settlement_skipped; no line', async () => {
      O.cod1 = await placeOrder(LIVE, buyer, farmer, listing, false); await setStatus(O.cod1, 'delivered');
      const r = await complete(T.buyer, O.cod1);
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(await orderStatus(O.cod1)).toBe('completed');
      const ev = await q1(`SELECT payload FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [O.cod1]);
      expect(ev.payload).toMatchObject({ countryCode: 'IN', totalMinor: PRICE.toString() });   // B3: the organisation's country rides in the event
      expect(published(await relay('orders.order_completed', O.cod1, settleOnly()))).toBe('published');
      expect(await ledgerKey(`settle:${O.cod1}`)).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM settlement_lines WHERE order_id = $1`, [O.cod1])).toBe(0);
      const a = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'order.settlement_skipped' AND entity_id = $1`, [O.cod1])).rows;
      expect(a).toEqual([{ actor_user_id: null, new_value: expect.objectContaining({ reason: 'unfunded_escrow', totalMinor: PRICE.toString() }) }]);
      expect((await q1(`SELECT new_value FROM audit_log WHERE action = 'order.completed' AND entity_id = $1`, [O.cod1])).new_value).toMatchObject({ by: 'buyer', escrowFunded: false });
    }, 120_000);
    it('a SUPPORT AGENT completes another COD order → the same: 0 legs, the skip audited', async () => {
      O.cod2 = await placeOrder(LIVE, buyer2, farmer, listing, false); await setStatus(O.cod2, 'delivered');
      expect((await complete(T.agent, O.cod2)).status).toBe(201);
      expect(published(await relay('orders.order_completed', O.cod2, settleOnly()))).toBe('published');
      expect(await ledgerKey(`settle:${O.cod2}`)).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.settlement_skipped' AND entity_id = $1`, [O.cod2])).toBe(1);
    }, 120_000);
    it('an ONLINE-PAID (wallet) order → exactly ONE settle:<id>, zero-sum, with the legs 3a pinned before HOTFIX-7 (escrow −total · seller main +total, split OFF); a redelivery adds nothing', async () => {
      O.paid = await placeOrder(LIVE, buyer, farmer, listing, true); await walletPaid(LIVE, buyer, O.paid); await setStatus(O.paid, 'delivered');
      expect((await complete(T.buyer, O.paid)).status).toBe(201);
      expect(published(await relay('orders.order_completed', O.paid, settleOnly()))).toBe('published');
      expect(await ledgerKey(`settle:${O.paid}`)).toBe(1);
      const legs = await legsOf(`settle:${O.paid}`);
      expect(sum(legs)).toBe(0n);
      expect(legs.map((l) => [l.owner_kind, l.account_code, l.owner_user_id, l.a])).toEqual([['platform', 'escrow', null, (-PRICE).toString()], ['user', 'main', farmer, PRICE.toString()]]);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.settlement_skipped' AND entity_id = $1`, [O.paid])).toBe(0);
      expect(published(await replay('orders.order_completed', O.paid, settleOnly()))).toBe('published');
      expect(await ledgerKey(`settle:${O.paid}`)).toBe(1);
    }, 120_000);
  });

  describe('(2) a COD order disputed → resolved `rejected` by the platform desk → completed → 0 escrow legs', () => {
    it('rejected → the order completes (the orders handler, as kv_relay) → settle releases nothing', async () => {
      O.codDisp = await placeOrder(LIVE, buyer, farmer, listing, false); await setStatus(O.codDisp, 'delivered');
      D.codDisp = await raise(T.buyer, O.codDisp); await setStatus(O.codDisp, 'disputed');
      const r = await resolve(T.agent, D.codDisp, { resolutionType: 'rejected', note: 'evidence does not support the claim' });
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(published(await relay('disputes.dispute_resolved', D.codDisp, resolutionHandlers()))).toBe('published');
      expect(await orderStatus(O.codDisp)).toBe('completed');
      expect(published(await relay('orders.order_completed', O.codDisp, settleOnly()))).toBe('published');
      expect(await ledgerKey(`settle:${O.codDisp}`)).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key LIKE '%' || $1 || '%'`, [O.codDisp])).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.settlement_skipped' AND entity_id = $1`, [O.codDisp])).toBe(1);
    }, 120_000);
  });

  describe('(3) D2 / D3 — no "refunded" without money; a dispute or return refund goes BACK TO THE SOURCE', () => {
    it('dispute_refunds OFF → refund_full refused 409 DISPUTE_REFUNDS_OFF: the order still `disputed`, the dispute unchanged, the refusal audited', async () => {
      O.wal = await placeOrder(LIVE, buyer, farmer, listing, true); await walletPaid(LIVE, buyer, O.wal); await setStatus(O.wal, 'delivered');
      D.wal = await raise(T.buyer, O.wal); await setStatus(O.wal, 'disputed');
      const before = await q1(`SELECT status::text s, resolution_type FROM disputes WHERE id = $1`, [D.wal]);
      expect(refusal(await resolve(T.agent, D.wal, { resolutionType: 'refund_full', resolutionAmountMinor: PRICE.toString() }))).toEqual([409, 'DISPUTE_REFUNDS_OFF']);
      expect(await orderStatus(O.wal)).toBe('disputed');
      expect(await q1(`SELECT status::text s, resolution_type FROM disputes WHERE id = $1`, [D.wal])).toEqual(before);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'disputes.dispute_resolved' AND aggregate_id = $1`, [D.wal])).toBe(0);
      expect((await q1(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'dispute.refund_refused_flag_off' AND entity_id = $1`, [D.wal]))).toEqual({ actor_user_id: agent, new_value: expect.objectContaining({ refused: 'DISPUTE_REFUNDS_OFF', resolutionType: 'refund_full' }) });
    }, 120_000);
    it('ON → a WALLET payment: `dispute-refund:<id>` escrow −total · the BUYER\'s wallet +total (the source); the payment `refunded`; the order `refunded`; a replay books nothing', async () => {
      await setFlag('dispute_refunds', [LIVE]);
      const r = await resolve(T.agent, D.wal, { resolutionType: 'refund_full', resolutionAmountMinor: PRICE.toString() });
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(published(await relay('disputes.dispute_resolved', D.wal, resolutionHandlers()))).toBe('published');
      const legs = await legsOf(`dispute-refund:${D.wal}`);
      expect(sum(legs)).toBe(0n);
      expect(legs.map((l) => [l.owner_kind, l.account_code, l.owner_user_id, l.a])).toEqual([['platform', 'escrow', null, (-PRICE).toString()], ['user', 'main', buyer, PRICE.toString()]]);
      expect(await ledgerKey(`dispute-remainder:${D.wal}`)).toBe(0);
      expect(await q1(`SELECT status::text s, refunded_minor::text r FROM payments WHERE reference_id = $1`, [O.wal])).toEqual({ s: 'refunded', r: PRICE.toString() });
      expect(await orderStatus(O.wal)).toBe('refunded');
      expect((await q1(`SELECT payload FROM outbox_events WHERE event_type = 'payments.dispute_refunded' AND aggregate_id = $1`, [D.wal])).payload)
        .toMatchObject({ refundedMinor: PRICE.toString(), remainderMinor: '0' });
      const n = await count(`SELECT count(*)::int n FROM ledger_entries`);
      expect(published(await replay('disputes.dispute_resolved', D.wal, resolutionHandlers()))).toBe('published');
      expect(await count(`SELECT count(*)::int n FROM ledger_entries`)).toBe(n);
      expect(await ledgerKey(`dispute-refund:${D.wal}`)).toBe(1);
    }, 120_000);
    it('ON → a SANDBOX gateway payment, refund_partial 200,000 (maker-checker at the threshold: a SECOND support agent signs, tenant_admin cannot): escrow −200,000 · gateway +200,000; the remainder 415,000 → the seller; `refund_initiated` then `partially_refunded`', async () => {
      O.gw = await placeOrder(LIVE, buyer2, farmer, listing, true); const pay = await gatewayPaid(LIVE, buyer2, O.gw); await setStatus(O.gw, 'delivered');
      D.gw = await raise(T.buyer2, O.gw); await setStatus(O.gw, 'disputed');
      // the threshold at 0 → every refund needs a checker (0139); the maker is a support agent, the checker the SECOND support agent
      await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'disputes.refund_checker_threshold_minor', '0'::jsonb)`, [LIVE]);
      try {
        const body = { resolutionType: 'refund_partial', resolutionAmountMinor: '200000' };
        expect(refusal(await resolve(T.agent, D.gw, body))).toEqual([409, 'REFUND_NEEDS_CHECKER']);
        const p = await request(http).post('/v1/refund-approvals').set(K(T.agent)).send({ subjectType: 'dispute', subjectId: D.gw, amountMinor: '200000', resolutionType: 'refund_partial', note: 'hf7: quality below the listed grade on 1/3 of the lot' });
        expect([p.status, p.body.error?.code]).toEqual([201, undefined]);
        const approvalId = p.body.data.id as string;
        expect(refusal(await request(http).post(`/v1/refund-approvals/${approvalId}/decision`).set(K(T.tadmin)).send({ decision: 'approved' }))[0]).toBe(403);   // tenant_admin holds no order.refund
        expect(refusal(await request(http).post(`/v1/refund-approvals/${approvalId}/decision`).set(K(T.agent)).send({ decision: 'approved' }))).toEqual([409, 'REFUND_CHECKER_IS_MAKER']);
        expect((await request(http).post(`/v1/refund-approvals/${approvalId}/decision`).set(K(T.agent2)).send({ decision: 'approved' })).status).toBe(201);
        const r = await resolve(T.agent, D.gw, body);
        expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      } finally { await admin.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'disputes.refund_checker_threshold_minor'`, [LIVE]); }
      expect(published(await relay('disputes.dispute_resolved', D.gw, resolutionHandlers()))).toBe('published');
      const refund = await legsOf(`dispute-refund:${D.gw}`);
      expect(sum(refund)).toBe(0n);
      expect(refund.map((l) => [l.owner_kind, l.account_code, l.a])).toEqual([['platform', 'escrow', '-200000'], ['platform', 'gateway', '200000']]);
      expect(leg(refund, 'main')).toBe(0n);                                            // never the buyer's wallet for a gateway payment
      const rem = await legsOf(`dispute-remainder:${D.gw}`);
      expect(sum(rem)).toBe(0n);
      expect([leg(rem, 'escrow'), leg(rem, 'main', farmer)]).toEqual([-415000n, 415000n]);
      expect(await q1(`SELECT gross_minor::text g, net_minor::text n FROM settlement_lines WHERE order_id = $1`, [O.gw])).toEqual({ g: '415000', n: '415000' });
      expect(await q1(`SELECT status::text s, refunded_minor::text r, gateway_refund_id IS NOT NULL gr FROM payments WHERE id = $1`, [pay])).toEqual({ s: 'partially_refunded', r: '200000', gr: true });
      const audits = (await admin.query(`SELECT action, new_value->>'status' s FROM audit_log WHERE entity_id = $1 AND action IN ('payment.resolution_refunded','payment.refund_processed') ORDER BY created_at, id`, [pay])).rows;
      expect(audits).toEqual([{ action: 'payment.resolution_refunded', s: 'refund_initiated' }, { action: 'payment.refund_processed', s: 'partially_refunded' }]);
      expect(await orderStatus(O.gw)).toBe('partially_refunded');
      // escrow nets to zero for the order: +capture −refund −remainder
      const esc = await q1(`SELECT COALESCE(sum(e.amount_minor),0)::text s FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
                             WHERE w.account_code = 'escrow' AND t.idempotency_key IN ($1,$2,$3)`, [`hf7-capture:${O.gw}`, `dispute-refund:${D.gw}`, `dispute-remainder:${D.gw}`]);
      expect(esc.s).toBe('0');
      const n = await count(`SELECT count(*)::int n FROM ledger_entries`);
      expect(published(await replay('disputes.dispute_resolved', D.gw, resolutionHandlers()))).toBe('published');
      expect(await count(`SELECT count(*)::int n FROM ledger_entries`)).toBe(n);
    }, 180_000);
    it('a RETURN refund likewise: `return-refund:<id>` escrow −100,000 · gateway +100,000; the remainder to the seller; a replay books nothing', async () => {
      O.ret = await placeOrder(LIVE, buyer, farmer, listing, true); const pay = await gatewayPaid(LIVE, buyer, O.ret); await setStatus(O.ret, 'delivered');
      const rq = await request(http).post('/v1/returns').set(K(T.buyer)).send({ orderId: O.ret, reasonCode: 'damaged', refundAmountMinor: '100000' });
      expect([rq.status, rq.body.error?.code]).toEqual([201, undefined]);
      const R = rq.body.data.id as string; D.ret = R;
      for (const step of ['approve', 'ship', 'receive']) expect([step, (await request(http).post(`/v1/returns/${R}/${step}`).set(K(T.agent)).send({})).status]).toEqual([step, 201]);
      expect((await request(http).post(`/v1/returns/${R}/inspect`).set(K(T.agent)).send({ note: 'hf7: two bags arrived torn, contents spoiled' })).status).toBe(201);
      await setFlag('dispute_refunds', false);
      expect(refusal(await request(http).post(`/v1/returns/${R}/refund`).set(K(T.agent)).send({}))).toEqual([409, 'DISPUTE_REFUNDS_OFF']);
      expect((await q1(`SELECT status::text s, refund_txn_id FROM returns WHERE id = $1`, [R]))).toEqual({ s: 'received', refund_txn_id: null });   // the return stays where it was
      await setFlag('dispute_refunds', [LIVE]);
      const rf = await request(http).post(`/v1/returns/${R}/refund`).set(K(T.agent)).send({});
      expect([rf.status, rf.body.error?.code]).toEqual([201, undefined]);
      expect(published(await relay('disputes.return_refunded', R, [app.get(ReturnRefundedHandler)]))).toBe('published');
      const refund = await legsOf(`return-refund:${R}`);
      expect(refund.map((l) => [l.owner_kind, l.account_code, l.a])).toEqual([['platform', 'escrow', '-100000'], ['platform', 'gateway', '100000']]);
      const rem = await legsOf(`return-remainder:${R}`);
      expect([sum(rem), leg(rem, 'escrow'), leg(rem, 'main', farmer)]).toEqual([0n, -515000n, 515000n]);
      expect((await q1(`SELECT status::text s, refunded_minor::text r FROM payments WHERE id = $1`, [pay]))).toEqual({ s: 'partially_refunded', r: '100000' });
      const n = await count(`SELECT count(*)::int n FROM ledger_entries`);
      expect(published(await replay('disputes.return_refunded', R, [app.get(ReturnRefundedHandler)]))).toBe('published');
      expect(await count(`SELECT count(*)::int n FROM ledger_entries`)).toBe(n);
    }, 180_000);
  });

  describe('(4) B3 — the organisation\'s country, never a literal', () => {
    let taxes: jest.SpyInstance;
    beforeAll(() => { taxes = jest.spyOn(app.get(SettlementPricingService), 'taxes'); });
    afterAll(() => taxes.mockRestore());
    it('an organisation in AE: its completion carries AE; split ON → the taxes are asked for AE (no GST/TDS leg); an IN organisation\'s split prices IN (a GST leg)', async () => {
      await setFlag('commission_split', [OTHER, LIVE]);
      try {
        O.ae = await placeOrder(OTHER, otherBuyer, otherFarmer, otherListing, true); await walletPaid(OTHER, otherBuyer, O.ae); await setStatus(O.ae, 'delivered');
        expect((await complete(T.otherBuyer, O.ae, OTHER)).status).toBe(201);
        expect((await q1(`SELECT payload FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [O.ae])).payload.countryCode).toBe('AE');
        taxes.mockClear();
        expect(published(await relay('orders.order_completed', O.ae, [app.get(OrderCompletedHandler)]))).toBe('published');
        expect(taxes.mock.calls.map((c) => c[1])).toEqual(['AE']);
        const ae = await legsOf(`settle:${O.ae}`);
        expect([sum(ae), leg(ae, 'gst_payable'), leg(ae, 'tds_payable')]).toEqual([0n, 0n, 0n]);
        expect(BigInt((await q1(`SELECT commission_minor::text c FROM settlement_lines WHERE order_id = $1`, [O.ae])).c)).toBeGreaterThan(0n);   // the split ran
        O.in = await placeOrder(LIVE, buyer, farmer, listing, true); await walletPaid(LIVE, buyer, O.in); await setStatus(O.in, 'delivered');
        expect((await complete(T.buyer, O.in)).status).toBe(201);
        taxes.mockClear();
        expect(published(await relay('orders.order_completed', O.in, [app.get(OrderCompletedHandler)]))).toBe('published');
        expect(taxes.mock.calls.map((c) => c[1])).toEqual(['IN']);
        const inr = await legsOf(`settle:${O.in}`);
        expect(sum(inr)).toBe(0n);
        expect(leg(inr, 'gst_payable')).toBeGreaterThan(0n);
      } finally { await setFlag('commission_split', false); }
    }, 180_000);
    it('a tenant with a NULL country (the NOT NULL lifted for the case) → SETTLEMENT_COUNTRY_UNKNOWN, the event quarantined, NO legs', async () => {
      await setFlag('commission_split', [NOCO]);
      O.noco = await placeOrder(NOCO, nocoBuyer, nocoFarmer, nocoListing, true); await walletPaid(NOCO, nocoBuyer, O.noco); await setStatus(O.noco, 'delivered');
      await admin.query(`ALTER TABLE tenants ALTER COLUMN country_code DROP NOT NULL`);
      try {
        await admin.query(`UPDATE tenants SET country_code = NULL WHERE id = $1`, [NOCO]);
        expect((await complete(T.nocoBuyer, O.noco, NOCO)).status).toBe(201);
        expect((await q1(`SELECT payload FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [O.noco])).payload).not.toHaveProperty('countryCode');
        const out = await relay('orders.order_completed', O.noco, [app.get(OrderCompletedHandler)]);
        expect(out.status).toBe('failed');
        expect((out as { error?: { code?: string } }).error?.code).toBe('SETTLEMENT_COUNTRY_UNKNOWN');
        expect(await ledgerKey(`settle:${O.noco}`)).toBe(0);
      } finally {
        await admin.query(`UPDATE tenants SET country_code = 'IN' WHERE id = $1`, [NOCO]);
        await admin.query(`ALTER TABLE tenants ALTER COLUMN country_code SET NOT NULL`);
        await setFlag('commission_split', false);
      }
    }, 120_000);
  });

  describe('(5) D4 — the platform support desk decides; the organisation does not', () => {
    it('the DATABASE grants: tenant_admin holds neither dispute.resolve nor order.refund; support_agent holds both', async () => {
      const ta = await dbToken(tadmin, LIVE); const sa = await dbToken(agent, LIVE);
      expect([ta.perms.includes('dispute.resolve'), ta.perms.includes('order.refund')]).toEqual([false, false]);
      expect([sa.perms.includes('dispute.resolve'), sa.perms.includes('order.refund')]).toEqual([true, true]);
    });
    it('tenant_admin → POST disputes/:id/resolve 403 (the dispute unchanged); support_agent → 201; tenant_admin → POST orders/:id/complete on a buyer\'s order 403 ORDER_FORBIDDEN', async () => {
      const o = await placeOrder(LIVE, buyer, farmer, listing, false); await setStatus(o, 'delivered');
      const d = await raise(T.buyer, o); await setStatus(o, 'disputed');
      expect((await resolve(T.tadmin, d, { resolutionType: 'rejected' })).status).toBe(403);
      expect((await q1(`SELECT status::text s FROM disputes WHERE id = $1`, [d])).s).toBe('open');
      expect((await resolve(T.agent, d, { resolutionType: 'replacement', note: 'replacement lot dispatched' })).status).toBe(201);
      const o2 = await placeOrder(LIVE, buyer2, farmer, listing, false); await setStatus(o2, 'delivered');
      expect(refusal(await complete(T.tadmin, o2))).toEqual([403, 'ORDER_FORBIDDEN']);
      expect(await orderStatus(o2)).toBe('delivered');
    }, 120_000);
  });

  describe('(6) B5 — the names on reviews', () => {
    let rv = ''; let rv2 = '';
    beforeAll(async () => {
      await setFlag('reviews', [LIVE]);
      // the two COD orders of (1) completed and recorded review eligibility (the reviews handler rode the relay)
      const a = await request(http).post('/v1/reviews').set(K(T.buyer)).send({ orderId: O.cod1, stars: 4, body: 'hf7: good groundnut, honest weight' });
      expect([a.status, a.body.error?.code]).toEqual([201, undefined]); rv = a.body.data.id;
      expect(a.body.data).not.toHaveProperty('targetId'); expect(a.body.data).not.toHaveProperty('reviewerUserId');
      const b = await request(http).post('/v1/reviews').set(K(T.buyer2)).send({ orderId: O.cod2, stars: 5, body: 'hf7: excellent' });
      expect(b.status).toBe(201); rv2 = b.body.data.id;
    }, 60_000);
    afterAll(() => setFlag('reviews', false));
    it('a STRANGER\'s box=target and :id reads carry no reviewerUserId / orderId / targetId (no person, no order)', async () => {
      const list = await request(http).get(`/v1/reviews?box=target&targetType=seller&targetId=${farmer}`).set(H(T.stranger));
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(2);
      for (const r of list.body.data) for (const k of ['reviewerUserId', 'orderId', 'targetId']) expect(r).not.toHaveProperty(k);
      const one = await request(http).get(`/v1/reviews/${rv}`).set(H(T.stranger));
      expect(one.status).toBe(200);
      for (const k of ['reviewerUserId', 'orderId', 'targetId']) expect(one.body.data).not.toHaveProperty(k);
      for (const p of [buyer, farmer, O.cod1]) expect(JSON.stringify(one.body.data)).not.toContain(p);
    });
    it('the AUTHOR sees the order (and status), never the target\'s uuid; the SELLER (staff) sees the buyer; a MODERATOR everything', async () => {
      const mine = (await request(http).get(`/v1/reviews/${rv}`).set(H(T.buyer))).body.data;
      expect(mine).toMatchObject({ orderId: O.cod1, status: 'published' });
      expect(mine).not.toHaveProperty('targetId'); expect(JSON.stringify(mine)).not.toContain(farmer);
      expect((await request(http).get(`/v1/reviews/${rv}`).set(H(T.farmer))).body.data).toMatchObject({ reviewerUserId: buyer, orderId: O.cod1 });
      expect((await request(http).get(`/v1/reviews/${rv}`).set(H(T.agent))).body.data).toMatchObject({ reviewerUserId: buyer, orderId: O.cod1, targetId: farmer });
    });
    it('public: targetType=buyer → 422 REVIEW_PUBLIC_BUYER_REFUSED; seller (a person\'s uuid) → 422 REVIEW_PUBLIC_SELLER_REFUSED; organisation → the published reviews with NO uuid, and the aggregate', async () => {
      const anon = { 'x-tenant-id': LIVE };
      expect(refusal(await request(http).get(`/v1/reviews/public?targetType=buyer&targetId=${buyer}`).set(anon))).toEqual([422, 'REVIEW_PUBLIC_BUYER_REFUSED']);
      expect(refusal(await request(http).get(`/v1/reviews/summary?targetType=buyer&targetId=${buyer}`).set(anon))).toEqual([422, 'REVIEW_PUBLIC_BUYER_REFUSED']);
      expect(refusal(await request(http).get(`/v1/reviews/public?targetType=seller&targetId=${farmer}`).set(anon))).toEqual([422, 'REVIEW_PUBLIC_SELLER_REFUSED']);
      const pub = await request(http).get('/v1/reviews/public?targetType=organisation&limit=50').set(anon);
      expect(pub.status).toBe(200);
      expect(pub.body.data.map((r: { body: string }) => r.body).sort()).toEqual(['hf7: excellent', 'hf7: good groundnut, honest weight']);
      expect(JSON.stringify(pub.body.data)).not.toMatch(UUID);
      const sum2 = await request(http).get('/v1/reviews/summary?targetType=organisation').set(anon);
      expect(sum2.body.data).toMatchObject({ count: 2, avgStars: 4.5 });
      void rv2;
    });
  });

  describe('(7) B10 / B25 — the public trace scan', () => {
    let lot = ''; let qr = ''; let trialQr = ''; let otherQr = '';
    const scan = (t: string) => request(http).get(`/v1/traceability/scan/${t}`);
    beforeAll(async () => {
      qr = `HF7${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`; trialQr = `HF7T${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`; otherQr = `HF7O${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`;
      lot = (await q1(`INSERT INTO trace_lots (tenant_id, listing_id, qr_token, farmer_user_id, declared_inputs, certificate_ids) VALUES ($1,$2,$3,$4,'[{"input":"urea","phone":"9898012742"}]'::jsonb, $5::jsonb) RETURNING id`,
        [LIVE, listing, qr, farmer, JSON.stringify([randomUUID()])])).id;
      await admin.query(`INSERT INTO trace_events (trace_lot_id, tenant_id, event_code, meta, event_hash) VALUES
        ($1,$2,'harvested', $3::jsonb, 'h1'), ($1,$2,'packed', '{"packType":"jute bag","packCount":50,"note":"call Ramesh"}'::jsonb, 'h2')`,
        [lot, LIVE, JSON.stringify({ variety: 'GG-20', quantity: 25, unit: 'quintal', phone: '9898012742', gps: '21.5,70.1', farmerName: 'Ramesh', season: 'call 9898012742 for more' })]);
      const tl = (await q1(`INSERT INTO trace_lots (tenant_id, qr_token, farmer_user_id) VALUES ($1,$2,$3) RETURNING id`, [TRIAL, trialQr, farmer])).id;
      await admin.query(`INSERT INTO trace_events (trace_lot_id, tenant_id, event_code, meta, event_hash) VALUES ($1,$2,'harvested','{}'::jsonb,'t1')`, [tl, TRIAL]);
      await admin.query(`INSERT INTO trace_lots (tenant_id, qr_token, farmer_user_id) VALUES ($1,$2,$3)`, [OTHER, otherQr, otherFarmer]);
      await setFlag('traceability', [LIVE, TRIAL]);   // ON for LIVE (and TRIAL — not live, so still 404); OFF for OTHER
    }, 60_000);
    afterAll(() => setFlag('traceability', false));
    it('a live organisation\'s lot: allow-listed meta only (no phone / gps / name / note; a value outside its rule dropped), no listingId / declaredInputs / certificateIds, the organisation named, no uuid', async () => {
      const r = await scan(qr);
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      const p = r.body.data;
      // PC-56 STORE-5b: the scan is `trace_scan_v3` now — + product / place / the seal (`anchor`, `sealed` — `anchored` retired) / certificates,
      // the organisation's slug (a store chrome checks the lot is its own); still no listingId, declaredInputs or person
      expect(Object.keys(p).sort()).toEqual(['anchor', 'certificates', 'createdAt', 'events', 'organisation', 'place', 'product', 'qrToken', 'sealed']);
      expect(p.organisation).toEqual({ displayName: liveName, slug: expect.any(String) });
      expect(p.events.map((e: { eventCode: string }) => e.eventCode)).toEqual(['harvested', 'packed']);
      expect(p.events[0].meta).toEqual({ variety: 'GG-20', quantity: 25, unit: 'quintal' });   // `season` kept by the SQL, dropped for its value (a phone run)
      expect(p.events[1].meta).toEqual({ packType: 'jute bag', packCount: 50 });
      const raw = JSON.stringify(r.body.data);
      expect(raw).not.toMatch(UUID);
      for (const s of ['9898012742', '21.5,70.1', 'Ramesh', 'urea', 'listingId', 'declaredInputs', 'certificateIds', 'tenantId', LIVE]) expect(raw).not.toContain(s);
    });
    it('a TRIAL organisation\'s lot → 404 TRACE_SCAN_NOT_FOUND; per-tenant OFF (OTHER) → 404 TRACE_NOT_PUBLISHED; an unknown token → TRACE_SCAN_NOT_FOUND; the platform kill-switch → TRACE_NOT_PUBLISHED', async () => {
      expect(refusal(await scan(trialQr))).toEqual([404, 'TRACE_SCAN_NOT_FOUND']);
      expect(refusal(await scan(otherQr))).toEqual([404, 'TRACE_NOT_PUBLISHED']);
      expect(refusal(await scan('HF7NOSUCHTOKEN0000'))).toEqual([404, 'TRACE_SCAN_NOT_FOUND']);
      await setFlag('traceability', false);
      try { expect(refusal(await scan(qr))).toEqual([404, 'TRACE_NOT_PUBLISHED']); } finally { await setFlag('traceability', [LIVE, TRIAL]); }
      const flags = await request(http).get('/v1/storefront/flags').set({ 'x-tenant-id': LIVE });
      expect(flags.body.data.traceability).toBe(true);
    });
    it('the AUTHOR posting a key outside the step\'s allow-list → 422; a phone in a variety → 422; an allow-listed meta → 201', async () => {
      const post = (body: Record<string, unknown>) => request(http).post(`/v1/traceability/lots/${lot}/events`).set(K(T.farmer)).send(body);
      expect(refusal(await post({ eventCode: 'in_transit', meta: { driverPhone: '9898012742' } }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refusal(await post({ eventCode: 'harvested', meta: { variety: 'GG-20 ring 9898012742' } }))).toEqual([422, 'VALIDATION_FAILED']);
      const ok = await post({ eventCode: 'in_transit', meta: { mode: 'road' } });
      expect([ok.status, ok.body.error?.code]).toEqual([201, undefined]);
      expect(ok.body.data).toMatchObject({ eventCode: 'in_transit', meta: { mode: 'road' } });
    });
  });

  describe('(8) B24 — keysets that never skip a row', () => {
    /** page a list with limit=1 to the end: every id once */
    async function pageAll(url: (cursor: string | null) => string, headers: Record<string, string>, idOf: (r: any) => string): Promise<string[]> {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const seen: string[] = []; let cursor: string | null = null;
      for (let i = 0; i < 60; i++) {
        const r = await request(http).get(url(cursor)).set(headers);
        expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
        for (const x of r.body.data) seen.push(idOf(x));
        cursor = r.body.meta?.nextCursor ?? null;
        if (!cursor) break;
      }
      return seen;
    }
    const sameMs = async (table: string, ids: string[]) => {
      for (const [i, id] of ids.entries()) await admin.query(`UPDATE ${table} SET created_at = '2026-10-16T18:30:00.1234${String(i + 1).padStart(2, '0')}Z' WHERE id = $1`, [id]);
    };
    it('trace events: page 2 returns the remaining rows (the cursor carries the bigserial id); three events in ONE millisecond page one by one without a skip', async () => {
      await setFlag('traceability', [LIVE]);
      try {
        const lot = (await q1(`INSERT INTO trace_lots (tenant_id, qr_token, farmer_user_id) VALUES ($1,$2,$3) RETURNING id`, [LIVE, `HF7K${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`, farmer])).id;
        await admin.query(`INSERT INTO trace_events (trace_lot_id, tenant_id, event_code, meta, event_hash, created_at) VALUES
          ($1,$2,'harvested','{}','e1','2026-10-16T18:30:00.123401Z'), ($1,$2,'packed','{}','e2','2026-10-16T18:30:00.123402Z'), ($1,$2,'picked','{}','e3','2026-10-16T18:30:00.123403Z')`, [lot, LIVE]);
        const two = await request(http).get(`/v1/traceability/lots/${lot}/events?limit=2`).set(H(T.farmer));
        expect([two.status, two.body.data.length]).toEqual([200, 2]);
        expect(two.body.data[0]).toHaveProperty('id');
        const rest = await request(http).get(`/v1/traceability/lots/${lot}/events?limit=2&cursor=${encodeURIComponent(two.body.meta.nextCursor)}`).set(H(T.farmer));
        expect([rest.status, rest.body.data.map((e: { eventCode: string }) => e.eventCode)]).toEqual([200, ['picked']]);
        const codes = await pageAll((c) => `/v1/traceability/lots/${lot}/events?limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.farmer), (e) => e.eventCode);
        expect(codes).toEqual(['harvested', 'packed', 'picked']);
        // trace lots: two in one millisecond
        const l2 = (await q1(`INSERT INTO trace_lots (tenant_id, qr_token, farmer_user_id) VALUES ($1,$2,$3) RETURNING id`, [LIVE, `HF7L${randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`, farmer])).id;
        await sameMs('trace_lots', [lot, l2]);
        const lots = await pageAll((c) => `/v1/traceability/lots?box=mine&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.farmer), (x) => x.id);
        const all = (await admin.query(`SELECT id FROM trace_lots WHERE tenant_id = $1 AND farmer_user_id = $2 AND deleted_at IS NULL`, [LIVE, farmer])).rows.map((r) => r.id);
        expect(new Set(lots)).toEqual(new Set(all)); expect(lots.length).toBe(all.length);
      } finally { await setFlag('traceability', false); }
    }, 120_000);
    it('reviews, disputes, returns, certificates: two rows in ONE millisecond page one by one without a skip or a repeat', async () => {
      await setFlag('reviews', [LIVE]);
      try {
        // reviews (the author's box): the buyer's own two (cod1 above + one more)
        const o = await placeOrder(LIVE, buyer, farmer, listing, false);
        await admin.query(`INSERT INTO review_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`, [LIVE, o, buyer, farmer]);
        const r2 = await request(http).post('/v1/reviews').set(K(T.buyer)).send({ orderId: o, stars: 3, body: 'hf7: third review' });
        expect(r2.status).toBe(201);
        const mine = (await admin.query(`SELECT id FROM reviews WHERE tenant_id = $1 AND reviewer_user_id = $2`, [LIVE, buyer])).rows.map((r) => r.id);
        await sameMs('reviews', mine.slice(0, 2));
        const got = await pageAll((c) => `/v1/reviews?box=mine&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.buyer), (x) => x.id);
        expect(new Set(got)).toEqual(new Set(mine)); expect(got.length).toBe(mine.length);
        const pub = await pageAll((c) => `/v1/reviews/public?targetType=organisation&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, { 'x-tenant-id': LIVE }, (x) => x.body);
        expect(pub.length).toBe(await count(`SELECT count(*)::int n FROM reviews WHERE tenant_id = $1 AND target_type = 'seller' AND status = 'published'`, [LIVE]));
      } finally { await setFlag('reviews', false); }
      // disputes the buyer raised
      const ds = (await admin.query(`SELECT id FROM disputes WHERE tenant_id = $1 AND raised_by = $2`, [LIVE, buyer])).rows.map((r) => r.id);
      expect(ds.length).toBeGreaterThanOrEqual(2);
      await sameMs('disputes', ds.slice(0, 2));
      const dgot = await pageAll((c) => `/v1/disputes?box=raised&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.buyer), (x) => x.id);
      expect(new Set(dgot)).toEqual(new Set(ds)); expect(dgot.length).toBe(ds.length);
      // returns the buyer requested (the refunded one + a second request)
      const o3 = await placeOrder(LIVE, buyer, farmer, listing, false); await setStatus(o3, 'delivered');
      expect((await request(http).post('/v1/returns').set(K(T.buyer)).send({ orderId: o3, reasonCode: 'wrong_item' })).status).toBe(201);
      const rs = (await admin.query(`SELECT r.id FROM returns r JOIN dispute_eligibility e ON e.order_id = r.order_id WHERE r.tenant_id = $1 AND e.buyer_user_id = $2`, [LIVE, buyer])).rows.map((r) => r.id);
      expect(rs.length).toBeGreaterThanOrEqual(2);
      await sameMs('returns', rs.slice(0, 2));
      const rgot = await pageAll((c) => `/v1/returns?box=mine&limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.buyer), (x) => x.id);
      expect(new Set(rgot)).toEqual(new Set(rs)); expect(rgot.length).toBe(rs.length);
      // certificates (two in one millisecond)
      const ct = (await q1(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order) VALUES ('cert_type', NULL, $1, 'Lab report hf7', 1) RETURNING id`, [`hf7_${randomUUID().slice(0, 8)}`])).id;
      const cs: string[] = [];
      for (const n of ['HF7-C1', 'HF7-C2']) cs.push((await q1(`INSERT INTO certificates (tenant_id, owner_user_id, cert_type_id, cert_no, subject_type, subject_id) VALUES ($1,$2,$3,$4,'listing',$5) RETURNING id`, [LIVE, farmer, ct, n, listing])).id);
      await sameMs('certificates', cs);
      const cgot = await pageAll((c) => `/v1/certificates?limit=1${c ? `&cursor=${encodeURIComponent(c)}` : ''}`, H(T.farmer), (x) => x.id);
      expect(new Set(cgot)).toEqual(new Set(cs)); expect(cgot.length).toBe(2);
      expect(JSON.stringify(cgot)).not.toContain('createdAtUs');
    }, 180_000);
  });

  describe('(9) B23 — the two dispute clocks', () => {
    it('both are in SCHEDULED_JOB_REGISTRY at the table\'s cadence (15 min · 60 min)', () => {
      const jobs = new Map(app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY).list().map((j) => [j.name, j.intervalMs]));
      expect(jobs.get('dispute-seller-response-timeout')).toBe(CLOCK_CADENCE_MS['dispute-seller-response-timeout']);
      expect(jobs.get('dispute-sla-escalation')).toBe(CLOCK_CADENCE_MS['dispute-sla-escalation']);
      expect([CLOCK_CADENCE_MS['dispute-seller-response-timeout'], CLOCK_CADENCE_MS['dispute-sla-escalation']]).toEqual([15 * 60_000, 60 * 60_000]);
    });
    it('a tick moves a due dispute ONCE (open past the respondent\'s 48 h → under_review; past the SLA → escalated); a second tick moves nothing', async () => {
      const o = await placeOrder(LIVE, buyer2, farmer, listing, false); await setStatus(o, 'delivered');
      const d1 = await raise(T.buyer2, o);
      await admin.query(`UPDATE disputes SET seller_respond_by = now() - interval '1 minute' WHERE id = $1`, [d1]);
      const sr = app.get(DisputeSellerResponseTimeoutClock); const sla = app.get(DisputeSlaEscalationClock);
      const first = await sr.tick(relayPool);
      expect(first.advanced).toBeGreaterThanOrEqual(1);
      expect((await q1(`SELECT status::text s FROM disputes WHERE id = $1`, [d1])).s).toBe('under_review');
      expect((await sr.tick(relayPool)).advanced).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'disputes.dispute_under_review' AND aggregate_id = $1`, [d1])).toBe(1);
      await admin.query(`UPDATE disputes SET sla_due_at = now() - interval '1 minute' WHERE id = $1`, [d1]);
      expect((await sla.tick(relayPool)).escalated).toBeGreaterThanOrEqual(1);
      expect((await q1(`SELECT status::text s FROM disputes WHERE id = $1`, [d1])).s).toBe('escalated');
      expect((await sla.tick(relayPool)).escalated).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'disputes.dispute_escalated' AND aggregate_id = $1`, [d1])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_id = $1`, [d1])).toBe(0);   // no money moves
    }, 120_000);
  });
});
