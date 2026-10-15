// apps/api/src/__tests__/store3a-orders.integration.spec.ts · PC-56 STORE-3a — YOUR ORDERS TELL THE TRUTH, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the outbox
// consumers are driven with the outbox rows the API wrote, exactly as the relay hands them over. Own fixtures (never the shared makeCategory).
//
// What it proves (brief §C6, survey §7 `store3a-orders`):
//   (1) `?group=` partitions all 15 statuses (one order per status, written through the order repository): every order in exactly one tab,
//       the tab its status maps to; `groups` counts the caller's own orders as buyer — and caps (cap 3 → `capped: true`); never tenant-wide;
//       `status` + `group` together → 400;
//   (2) a buyer's cancel without a reason → 422 CANCEL_REASON_REQUIRED; an unknown / another organisation's reason → 422 CANCEL_REASON_UNKNOWN;
//       `other` without a note → 422 CANCEL_NOTE_REQUIRED (the order untouched); with `changed_mind` → cancelled, `cancel_reason_id` set, the
//       audit's reason = the code, `orders.order_cancelled` carries `reasonCode`; a replay with the same key acts nothing; `other` + a note →
//       the note kept, shown to the seller, never to the buyer; the organisation's OWN value is offered and accepted;
//   (3) a PAID order cancelled → the refund read: `none` → `initiated` (the provider has not confirmed) → `refunded` with the amount and the
//       provider's refund reference, through the real `refund.processed` webhook (sandbox);
//   (4) the buyer's "I received it" on an order paid ONLINE and delivered → completed, exactly ONE `settle:<id>` ledger transaction, zero-sum;
//       a replay with the same key books nothing; on a PAY-ON-DELIVERY delivered order → 409 ORDER_COMPLETE_REQUIRES_ESCROW and ZERO ledger
//       rows for it (Law 9 — lead's D6);
//   (5) the detail carries `amountDueMinor` = total and `depositAppliedMinor` = '0' (an auction order: total − the deposit applied, the
//       payments module's one rule), `cancelReasonCode` after a cancel, and no person id for the buyer;
//   (6) `GET lookups/values?type=cancel_reason` → the seven, in order, locale-resolved (a reviewed hi label served; English otherwise);
//   (7) `GET storefront/flags` carries `disputes` (seed OFF → false; ON → true).
//   (8) the relay gate is run as its own spec (group B).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { makeListing as makeAuctionListing } from '../modules/auctions/__tests__/auction-harness';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { platform, userMain, PlatformAccount } from '../core/wallet/account-codes';
import { OutboxEvent } from '../core/outbox/event-envelope';
import { uuidv7 } from '../core/database/uuid.util';
import { GatewayRegistry } from '../modules/payments/gateway/gateway.registry';
import { SandboxGateway } from '../modules/payments/gateway/sandbox.gateway';
import { Order } from '../modules/orders/domain/order.entity';
import { OrderItem } from '../modules/orders/domain/order-item.entity';
import { ORDER_STATUSES, OrderStatus } from '../modules/orders/domain/order.state';
import { ORDER_GROUPS, orderGroupOf } from '../modules/orders/domain/order-groups';
import { orderNoFor } from '../modules/orders/domain/order-no';
import { OrderRepository } from '../modules/orders/repositories/order.repository';
import { OrderTimelineReadModel } from '../modules/orders/read-models/order-timeline.read-model';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { OrderCancelledRestockHandler } from '../modules/orders/events/handlers/order-cancelled-restock.handler';
import { OrderCancelledRefundHandler } from '../modules/payments/events/handlers/order-cancelled-refund.handler';
import { OrderCompletedHandler } from '../modules/payments/events/handlers/order-completed.handler';
import { AuctionService } from '../modules/auctions/services/auction.service';
import { BidService } from '../modules/auctions/services/bid.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SEVEN = ['changed_mind', 'found_better_price', 'ordered_by_mistake', 'delivery_too_slow', 'quantity_or_grade_doubt', 'payment_issue', 'other'];

run('PC-56 STORE-3a · your orders tell the truth (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let uow: UnitOfWork; let wallet: WalletPort; let sandbox: SandboxGateway;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let seller = ''; let buyer = ''; let buyer2 = ''; let gbuyer = ''; let winner = ''; let liveSlug = '';
  let catId = ''; let product = '';
  const L: Record<string, string> = {};
  const T: Record<string, string> = {};
  const R: Record<string, string> = {};          // cancel reason ids by code (+ `own` = LIVE's own value, `foreign` = OTHER's)
  const touched = ['online_payments', 'buyer_charges', 'commission_split', 'disputes'];

  const setFlag = async (k: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k, on]);
    for (const c of [`flag:${k}`, `flagstale:${k}`, 'flags:all', `flagctx:${LIVE}`, `flagctx:${OTHER}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function listing(title: string, o: { price?: number; total?: string } = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, $5::text, $6::numeric, $6::numeric, 1, 'quintal', $7, 'INR', 'published', 'public', $8, now()) RETURNING id`,
      [LIVE, seller, product, catId, title, o.total ?? '40', o.price ?? 50_000, JUNAGADH]);
    return r.rows[0].id;
  }
  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const placeOne = async (token: string, listingId: string, qty: string): Promise<string> => {
    await request(http).delete('/v1/cart').set(H(token));
    expect((await request(http).post('/v1/cart/items').set(H(token)).send({ listingId, quantity: qty })).status).toBe(201);
    const p = await request(http).post('/v1/checkout').set({ ...H(token), 'idempotency-key': randomUUID() }).send({});
    expect([p.status, p.body.error]).toEqual([201, undefined]);
    return p.body.data.orders[0].id as string;
  };
  const cancel = (token: string, id: string, body: Record<string, unknown>, key: string = randomUUID()) =>
    request(http).post(`/v1/orders/${id}/cancel`).set({ ...H(token), 'idempotency-key': key }).send(body);
  const complete = (token: string, id: string, key: string = randomUUID()) => request(http).post(`/v1/orders/${id}/complete`).set({ ...H(token), 'idempotency-key': key });
  const step = async (id: string, s: string) => {
    const r = await request(http).post(`/v1/orders/${id}/${s}`).set({ ...H(T.seller), 'idempotency-key': randomUUID() });
    expect([s, r.status, r.body.error?.code]).toEqual([s, 201, undefined]);
  };
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const ledgerKey = (k: string) => count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [k]);
  const ledgerRowsFor = (orderId: string) => count(
    `SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key LIKE '%' || $1 || '%' OR (reference_type = 'order' AND reference_id = $1::uuid)`, [orderId]);
  const legsOf = async (k: string) => (await admin.query(
    `SELECT w.owner_kind, w.account_code, e.amount_minor::text a FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
      WHERE t.idempotency_key = $1 ORDER BY w.owner_kind, w.account_code`, [k])).rows as Array<{ owner_kind: string; account_code: string; a: string }>;
  const sumLegs = (legs: Array<{ a: string }>) => legs.reduce((s, l) => s + BigInt(l.a), 0n);
  const orderRow = async (id: string) => (await admin.query(`SELECT status::text, cancel_reason_id, cancel_note, total_minor::text total FROM orders WHERE id = $1`, [id])).rows[0];
  async function getOrder(token: string, id: string) {
    const r = await request(http).get(`/v1/orders/${id}`).set(H(token));
    expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
    return r.body.data;
  }
  async function outboxEvent(eventType: string, aggregateId: string): Promise<OutboxEvent> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0];
    expect(r).toBeDefined();
    return { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
  }
  async function cancelSideEffects(orderId: string): Promise<OutboxEvent> {
    const ev = await outboxEvent('orders.order_cancelled', orderId);
    await app.get(OrderCancelledRestockHandler).handle(ev);
    await app.get(OrderCancelledRefundHandler).handle(ev);
    return ev;
  }
  const confirmPaid = async (paymentId: string) => {
    const ev = await outboxEvent('payments.payment_succeeded', paymentId);
    await uow.run(LIVE, (tx) => app.get(PaymentSucceededHandler).handle(ev, tx));
  };
  async function fund(userId: string, amount: bigint): Promise<void> {
    await uow.run(LIVE, (tx) => wallet.post(tx, { tenantId: LIVE, txnType: 'refund', idempotencyKey: `s3a-fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Gateway), amountMinor: -amount }, { account: userMain(userId), amountMinor: amount }] }), { userId: 'system' });
  }
  const sandboxHook = (body: Record<string, unknown>) => { const raw = JSON.stringify(body); return request(http).post('/v1/payments/webhooks/sandbox').set({ 'content-type': 'application/json', 'x-webhook-signature': sandbox.sign(raw) }).send(raw); };
  const attempts = async (token: string, id: string) => (await request(http).get(`/v1/payments/order/${id}/attempts`).set(H(token))).body.data;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s3a ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Kisan Sathi s3a ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    [seller, buyer, buyer2, gbuyer, winner] = await Promise.all(Array.from({ length: 5 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [seller]);
    await role(seller, LIVE, 'farmer');
    for (const x of [buyer, buyer2, gbuyer, winner]) await role(x, LIVE, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs3a' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s3a', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s3a', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    L.cod = await listing('Bold groundnut s3a', { price: 615_000 });
    L.pay = await listing('Java groundnut s3a', { price: 590_000 });
    // the seven platform reasons (0210), the organisation's OWN value (the type is tenant-extendable) and another organisation's
    for (const r of (await admin.query(`SELECT id, code FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL`)).rows) R[r.code] = r.id;
    R.own = (await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order) VALUES ('cancel_reason', $1, 'lot_resold_offline', 'Bought the lot offline', 8) RETURNING id`, [LIVE])).rows[0].id;
    R.foreign = (await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name, sort_order) VALUES ('cancel_reason', $1, 'kisan_only', 'Their own reason', 8) RETURNING id`, [OTHER])).rows[0].id;
    // a REVIEWED (human) Hindi label for one reason — the lookups read serves it for hi; the others fall back to their English default
    await admin.query(`INSERT INTO translations (entity_type, entity_id, field, language_code, text, is_machine) VALUES ('lookup_value', $1, 'name', 'hi', 'मेरा मन बदल गया', false) ON CONFLICT DO NOTHING`, [R.changed_mind]);
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin (foreign processes on IPv4 ephemeral ports)
    uow = app.get<UnitOfWork>(UNIT_OF_WORK); wallet = app.get<WalletPort>(WALLET_SERVICE);
    sandbox = app.get(GatewayRegistry).get('sandbox') as SandboxGateway;
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2], ['gbuyer', gbuyer], ['winner', winner]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.seller = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    await setFlag('online_payments', false); await setFlag('buyer_charges', false); await setFlag('commission_split', false); await setFlag('disputes', false);
    for (const x of [buyer, buyer2, winner]) await fund(x, 50_000_000n);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  describe('(1) the buyer\'s tabs (founder D4)', () => {
    const byStatus = new Map<OrderStatus, string>();
    beforeAll(async () => {
      // one order per status, written through the order repository (the placement row included), then moved to its status
      const repo = app.get(OrderRepository);
      for (const s of ORDER_STATUSES) {
        const id = uuidv7(); const now = new Date();
        const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: now, tenantId: LIVE, listingId: L.cod, productId: product, titleSnapshot: `Lot ${s}`,
          quantity: 1, unitCode: 'quintal', unitPriceMinor: 615_000n, gstRatePct: null, hsnCode: null, batchId: null });
        const o = Order.place({ id, tenantId: LIVE, orderNo: orderNoFor(id, now), checkoutGroupId: null, buyerUserId: gbuyer, sellerUserId: seller, source: 'direct',
          currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: false, now });
        await uow.run(LIVE, (tx) => repo.insertGraph(tx, o, [item]), { userId: gbuyer });
        await admin.query(`UPDATE orders SET status = $2::order_status WHERE id = $1`, [id, s]);
        byStatus.set(s, id);
      }
    }, 120_000);
    it('`?group=` partitions all 15 statuses: every order in exactly one tab — the tab its status maps to; `all` holds the 15', async () => {
      const seen = new Map<string, string[]>();
      for (const g of ORDER_GROUPS) {
        const r = await request(http).get(`/v1/orders?role=buyer&group=${g}&limit=100`).set(H(T.gbuyer));
        expect([g, r.status]).toEqual([g, 200]);
        const ids = (r.body.data as Array<{ id: string; status: OrderStatus }>).map((x) => { if (g !== 'all') expect([x.status, orderGroupOf(x.status)]).toEqual([x.status, g]); return x.id; });
        if (g === 'all') { expect(new Set(ids)).toEqual(new Set(byStatus.values())); continue; }
        for (const id of ids) seen.set(id, [...(seen.get(id) ?? []), g]);
      }
      for (const [s, id] of byStatus) expect([s, seen.get(id)]).toEqual([s, [orderGroupOf(s)]]);
      expect(seen.size).toBe(15);
    });
    it('`groups` counts the caller\'s own orders as buyer (10 / 2 / 1 / 2), never the organisation\'s; with cap 3 a tab says `capped`', async () => {
      const r = await request(http).get('/v1/orders/groups').set(H(T.gbuyer));
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({ all: { count: 15, capped: false }, active: { count: 10, capped: false }, attention: { count: 2, capped: false },
        completed: { count: 1, capped: false }, cancelled: { count: 2, capped: false } });
      const capped = await app.get(OrderTimelineReadModel).groupCounts(LIVE, gbuyer, 3);
      expect(capped).toEqual({ all: { count: 3, capped: true }, active: { count: 3, capped: true }, attention: { count: 2, capped: false },
        completed: { count: 1, capped: false }, cancelled: { count: 2, capped: false } });
      // another buyer of the same organisation sees only their own — none of these 15
      const theirs = (await request(http).get('/v1/orders/groups').set(H(T.buyer2))).body.data;
      expect(theirs.all.count).toBeLessThan(15);
      expect(refusal(await request(http).get('/v1/orders?role=buyer&group=active&status=created').set(H(T.gbuyer)))).toEqual([400, expect.any(String)]);
    });
  });

  describe('(2) the buyer\'s cancel needs a reason (founder D1 / D5)', () => {
    let o = '';
    it('no reason / an unknown or another organisation\'s reason / `other` without a note → 422 by name; the order is untouched', async () => {
      o = await placeOne(T.buyer, L.cod, '1');
      expect(refusal(await cancel(T.buyer, o, {}))).toEqual([422, 'CANCEL_REASON_REQUIRED']);
      expect(refusal(await cancel(T.buyer, o, { reasonId: randomUUID() }))).toEqual([422, 'CANCEL_REASON_UNKNOWN']);
      expect(refusal(await cancel(T.buyer, o, { reasonId: R.foreign }))).toEqual([422, 'CANCEL_REASON_UNKNOWN']);
      expect(refusal(await cancel(T.buyer, o, { reasonId: R.other }))).toEqual([422, 'CANCEL_NOTE_REQUIRED']);
      expect(refusal(await cancel(T.buyer, o, { reasonId: R.other, note: '   ' }))).toEqual([422, 'CANCEL_NOTE_REQUIRED']);
      expect(await orderRow(o)).toMatchObject({ status: 'created', cancel_reason_id: null, cancel_note: null });
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_cancelled' AND aggregate_id = $1`, [o])).toBe(0);
    });
    it('`changed_mind` → cancelled: the reason recorded, the audit\'s reason = the code, the event carries `reasonCode`; a replay with the same key acts nothing', async () => {
      const k = randomUUID();
      const a = await cancel(T.buyer, o, { reasonId: R.changed_mind, note: 'not kept for a reason that needs none' }, k);
      const b = await cancel(T.buyer, o, { reasonId: R.changed_mind }, k);
      expect([a.status, b.status, b.body.data]).toEqual([201, 201, a.body.data]);
      expect(await orderRow(o)).toMatchObject({ status: 'cancelled', cancel_reason_id: R.changed_mind, cancel_note: null });
      expect((await admin.query(`SELECT reason, new_value FROM audit_log WHERE action = 'order.cancelled' AND entity_id = $1`, [o])).rows).toEqual([
        { reason: 'changed_mind', new_value: { status: 'cancelled', reasonCode: 'changed_mind', note: null } }]);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_cancelled' AND aggregate_id = $1`, [o])).toBe(1);
      const ev = await cancelSideEffects(o);
      expect(ev.payload).toMatchObject({ reasonId: R.changed_mind, reasonCode: 'changed_mind', role: 'buyer' });
      // the replay key is bound to THIS order (sha256(orderId:key)) and its scope
      expect(await count(`SELECT count(*)::int n FROM idempotency_keys WHERE key = $1`, [`${buyer}::orders.cancel::${createHash('sha256').update(`${o}:${k}`).digest('base64url')}`])).toBe(1);
      // a cancel of an order that cannot be cancelled any more is the STATE MACHINE's refusal (not "you are not a party")
      expect(refusal(await cancel(T.buyer, o, { reasonId: R.changed_mind }))).toEqual([409, 'ORDER_ILLEGAL_TRANSITION']);
    });
    it('`other` + a note → the note kept (≤ 280), the seller and staff read it; the buyer\'s read carries the code only; the organisation\'s own value is accepted', async () => {
      const o2 = await placeOne(T.buyer, L.cod, '1');
      expect((await cancel(T.buyer, o2, { reasonId: R.other, note: '  bought the same lot at the mandi  ' })).status).toBe(201);
      expect(await orderRow(o2)).toMatchObject({ status: 'cancelled', cancel_reason_id: R.other, cancel_note: 'bought the same lot at the mandi' });
      const asBuyer = await getOrder(T.buyer, o2);
      expect(asBuyer.cancelReasonCode).toBe('other');
      expect(asBuyer).not.toHaveProperty('cancelNote');
      expect(await getOrder(T.seller, o2)).toMatchObject({ cancelReasonCode: 'other', cancelNote: 'bought the same lot at the mandi' });
      await cancelSideEffects(o2);
      const o3 = await placeOne(T.buyer, L.cod, '1');
      expect((await cancel(T.buyer, o3, { reasonId: R.own })).status).toBe(201);
      expect((await getOrder(T.buyer, o3)).cancelReasonCode).toBe('lot_resold_offline');
      await cancelSideEffects(o3);
      // the seller's decline keeps today's optional reason
      const o4 = await placeOne(T.buyer, L.cod, '1');
      expect((await cancel(T.seller, o4, {})).status).toBe(201);
      await cancelSideEffects(o4);
    });
  });

  describe('(3) the buyer\'s refund read (survey B11)', () => {
    it('a PAID order cancelled: `none` → `initiated` (the provider has not confirmed) → `refunded` with the amount and the provider\'s reference (`refund.processed`)', async () => {
      await setFlag('online_payments', true);   // the payment routes answer behind it (ON for the whole case)
      try {
      const o: { id: string; totalMinor: string; currencyCode: string } = await getOrder(T.buyer2, await placeOne(T.buyer2, L.pay, '2'));
      const intent = await request(http).post('/v1/payments').set({ ...H(T.buyer2), 'idempotency-key': `order-pay:${o.id}:1` })
        .send({ purpose: 'direct_order', amountMinor: o.totalMinor, currencyCode: o.currencyCode, referenceType: 'order', referenceId: o.id });
      expect(intent.status).toBe(201);
      const { paymentId, gatewayOrderId } = intent.body.data;
      expect((await sandboxHook({ id: `evt_${randomUUID()}`, event: 'payment.captured', order_id: gatewayOrderId, payment_id: `pay_${paymentId.slice(-12)}`, amount: Number(o.totalMinor), currency: 'INR', method: 'upi' })).status).toBe(200);
      await confirmPaid(paymentId);
      expect((await attempts(T.buyer2, o.id)).refund).toEqual({ state: 'none', amountMinor: '0', currencyCode: 'INR', initiatedAt: null, completedAt: null, gatewayRefundId: null });
      expect((await cancel(T.buyer2, o.id, { reasonId: R.found_better_price })).status).toBe(201);
      // the provider answers "pending" (Razorpay's normal answer) — the payment stays `refund_initiated` until the webhook confirms it
      const spy = jest.spyOn(sandbox, 'refund').mockResolvedValueOnce({ gatewayRefundId: 'rfnd_pending_s3a', status: 'pending' });
      try { await cancelSideEffects(o.id); } finally { spy.mockRestore(); }
      expect(await ledgerKey(`refund:${o.id}`)).toBe(1);
      const initiated = (await attempts(T.buyer2, o.id)).refund;
      expect(initiated).toMatchObject({ state: 'initiated', amountMinor: o.totalMinor, currencyCode: 'INR', completedAt: null, gatewayRefundId: null });
      expect(initiated.initiatedAt).toEqual(expect.any(String));
      const refundId = `rfnd_S3A${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      expect((await sandboxHook({ id: `evt_${randomUUID()}`, event: 'refund.processed', order_id: gatewayOrderId, payment_id: `pay_${paymentId.slice(-12)}`, refund_id: refundId, amount: Number(o.totalMinor), currency: 'INR' })).status).toBe(200);
      const done = (await attempts(T.buyer2, o.id)).refund;
      expect(done).toMatchObject({ state: 'refunded', amountMinor: o.totalMinor, currencyCode: 'INR', initiatedAt: initiated.initiatedAt, gatewayRefundId: refundId });
      expect(Date.parse(done.completedAt)).toBeGreaterThanOrEqual(Date.parse(done.initiatedAt));
      expect((await admin.query(`SELECT status, gateway_refund_id, refund_initiated_at IS NOT NULL i, refunded_at IS NOT NULL d FROM payments WHERE id = $1`, [paymentId])).rows[0])
        .toEqual({ status: 'refunded', gateway_refund_id: refundId, i: true, d: true });
      // the buyer's refund read names nothing else about the gateway
      expect(Object.keys(done).sort()).toEqual(['amountMinor', 'completedAt', 'currencyCode', 'gatewayRefundId', 'initiatedAt', 'state']);
      expect(await ledgerKey(`refund:${o.id}`)).toBe(1);
      } finally { await setFlag('online_payments', false); }
    }, 120_000);
  });

  describe('(4) the buyer\'s "I received it" (lead\'s D6, Law 9)', () => {
    it('an order PAID ONLINE and delivered → completed; ONE settle:<id>, zero-sum, escrow −total; a replay with the same key books nothing', async () => {
      await setFlag('online_payments', true);
      let o = '';
      try { o = await placeOne(T.buyer2, L.pay, '1'); } finally { await setFlag('online_payments', false); }
      const pay = await request(http).post(`/v1/orders/${o}/pay-from-wallet`).set({ ...H(T.buyer2), 'idempotency-key': randomUUID() });
      expect([pay.status, pay.body.error]).toEqual([201, undefined]);
      await confirmPaid(pay.body.data.paymentId);
      for (const s of ['packed', 'ready', 'delivered']) await step(o, s);
      const k = randomUUID();
      const a = await complete(T.buyer2, o, k);
      expect([a.status, a.body.data]).toEqual([201, { ok: true }]);
      expect((await orderRow(o)).status).toBe('completed');
      const ev = await outboxEvent('orders.order_completed', o);
      await uow.run(LIVE, (tx) => app.get(OrderCompletedHandler).handle(ev, tx));
      expect(await ledgerKey(`settle:${o}`)).toBe(1);
      const legs = await legsOf(`settle:${o}`);
      expect(sumLegs(legs)).toBe(0n);
      expect(legs.filter((l) => l.owner_kind === 'platform' && l.account_code === 'escrow').reduce((s, l) => s + BigInt(l.a), 0n)).toBe(-BigInt((await orderRow(o)).total));
      const b = await complete(T.buyer2, o, k);                                    // the replay
      expect([b.status, b.body.data]).toEqual([201, { ok: true }]);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [o])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.completed' AND entity_id = $1`, [o])).toBe(1);
      await uow.run(LIVE, (tx) => app.get(OrderCompletedHandler).handle(ev, tx));
      expect(await ledgerKey(`settle:${o}`)).toBe(1);
    }, 120_000);
    it('a PAY-ON-DELIVERY order delivered → 409 ORDER_COMPLETE_REQUIRES_ESCROW, the order stays delivered and ZERO ledger rows exist for it', async () => {
      const o = await placeOne(T.buyer, L.cod, '1');
      for (const s of ['confirm', 'packed', 'ready', 'delivered']) await step(o, s);
      const r = await complete(T.buyer, o);
      expect(refusal(r)).toEqual([409, 'ORDER_COMPLETE_REQUIRES_ESCROW']);
      expect((await orderRow(o)).status).toBe('delivered');
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [o])).toBe(0);
      expect(await ledgerKey(`settle:${o}`)).toBe(0);
      expect(await ledgerRowsFor(o)).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.completed' AND entity_id = $1`, [o])).toBe(0);
    }, 120_000);
  });

  describe('(5) the detail: the amount due, the deposit applied, the cancel reason, no person', () => {
    it('a checkout order: amountDueMinor = totalMinor, depositAppliedMinor = \'0\'; no person id for the buyer (the organisation instead)', async () => {
      const o = await placeOne(T.buyer, L.cod, '2');
      const d = await getOrder(T.buyer, o);
      expect([d.amountDueMinor, d.depositAppliedMinor, d.cancelReasonCode]).toEqual([d.totalMinor, '0', null]);
      for (const k of ['buyerUserId', 'sellerUserId', 'cancelNote']) expect(d).not.toHaveProperty(k);
      expect(d.organisation).toMatchObject({ slug: liveSlug });
      const json = JSON.stringify(d);
      expect(json).not.toContain(seller); expect(json).not.toContain(buyer); expect(json).not.toMatch(/Ramesh/);
      expect((await cancel(T.buyer, o, { reasonId: R.ordered_by_mistake })).status).toBe(201);
      expect((await getOrder(T.buyer, o)).cancelReasonCode).toBe('ordered_by_mistake');
      await cancelSideEffects(o);
    });
    it('an AUCTION order: amountDueMinor = total − the deposit applied in escrow (the payments module\'s one rule), depositAppliedMinor = the deposit', async () => {
      await setFlag('online_payments', true);
      try {
        const EMD = 1_000_000n;
        const listingId = await makeAuctionListing(admin, LIVE, seller, `Ghee s3a ${randomUUID().slice(0, 4)}`, 200, 'kg');
        const auctions = app.get(AuctionService);
        const c = await auctions.create(LIVE, { userId: seller }, `k-${randomUUID()}`, { listingId, kind: 'english_open', startPriceMinor: '61000', reservePriceMinor: '62000',
          minIncrementMinor: '500', emdMinor: EMD.toString(), startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() });
        expect(await auctions.open(LIVE, c.auctionId)).toBe(true);
        await app.get(BidService).placeBid(LIVE, winner, c.auctionId, `k-${randomUUID()}`, '64000', '10.0.0.3');
        await admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, [c.auctionId]);
        expect(await auctions.closeAndResolve(LIVE, c.auctionId)).toBe(true);
        const orderId = (await admin.query(`SELECT settled_order_id FROM auctions WHERE id = $1`, [c.auctionId])).rows[0].settled_order_id as string;
        expect(orderId).toMatch(UUID);
        const d = await getOrder(T.winner, orderId);
        expect(d.source).toBe('auction');
        expect([d.depositAppliedMinor, d.amountDueMinor]).toEqual([EMD.toString(), (BigInt(d.totalMinor) - EMD).toString()]);
      } finally { await setFlag('online_payments', false); }
    }, 180_000);
  });

  describe('(6)(7) the public reads', () => {
    it('(6) lookups/values?type=cancel_reason → the seven platform values in order (+ the organisation\'s own), locale-resolved; `other` says textRequired', async () => {
      const en = await request(http).get('/v1/lookups/values?type=cancel_reason').set({ 'x-tenant-id': LIVE, 'x-lang': 'en' });
      expect(en.status).toBe(200);
      expect(en.body.data.map((v: { code: string }) => v.code)).toEqual([...SEVEN, 'lot_resold_offline']);
      expect(en.body.data.find((v: { code: string }) => v.code === 'other').meta).toEqual({ textRequired: true });
      expect(en.body.data.find((v: { code: string }) => v.code === 'changed_mind').name).toBe('I changed my mind');
      const hi = await request(http).get('/v1/lookups/values?type=cancel_reason').set({ 'x-tenant-id': LIVE, 'x-lang': 'hi' });
      expect(hi.body.data.find((v: { code: string }) => v.code === 'changed_mind').name).toBe('मेरा मन बदल गया');
      expect(hi.body.data.find((v: { code: string }) => v.code === 'payment_issue').name).toBe('A problem with the payment');
      // another organisation never sees LIVE's own value; the platform seven are everyone's
      const other = await request(http).get('/v1/lookups/values?type=cancel_reason').set({ 'x-tenant-id': OTHER, 'x-lang': 'en' });
      expect(other.body.data.map((v: { code: string }) => v.code)).toEqual([...SEVEN, 'kisan_only']);
    });
    it('(7) storefront/flags carries `disputes` for an organisation (seed OFF → false; ON → true); not answered with no organisation', async () => {
      const off = await request(http).get('/v1/storefront/flags').set({ 'x-tenant-slug': liveSlug });
      expect([off.status, off.body.data.disputes]).toEqual([200, false]);
      await setFlag('disputes', true);
      try {
        expect((await request(http).get('/v1/storefront/flags').set({ 'x-tenant-slug': liveSlug })).body.data.disputes).toBe(true);
      } finally { await setFlag('disputes', false); }
      expect((await request(http).get('/v1/storefront/flags')).body.data).not.toHaveProperty('disputes');
    });
  });
});
