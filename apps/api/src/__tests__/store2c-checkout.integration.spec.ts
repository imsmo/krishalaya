// apps/api/src/__tests__/store2c-checkout.integration.spec.ts · PC-56 STORE-2c — THE MONEY WAVE, LIVE (the real AppModule over HTTP, real
// Postgres + RLS as kv_app; supertest drives the same middleware, guards, pipes and filter production runs; the outbox handlers are driven with
// the outbox rows the API wrote, exactly as the relay would hand them over).
//
// What it proves (brief §C8, the numbered list):
//   (1) placement decrements `quantity_available` under the listing's row lock — the LOCKED remainder, not the 300 s cache (the cache is
//       poisoned with the pre-placement figure and the second buyer is still refused LISTING_INSUFFICIENT_STOCK {available}); the last unit
//       sells the lot out (the tombstone says sold_out); cancel restocks EXACTLY once (a replayed cancel event moves nothing); completion does
//       not decrement again (no listings handler on orders.order_completed; the old class is a no-op);
//   (2) a two-seller checkout: each order paid on its own (two attempts, two captures), escrow after both = the sum of both totals;
//   (3) cancelling (buyer) and declining (seller) a PAID order → one `order_cancel_refund` ledger transaction each, zero-sum (gateway +,
//       escrow −), idempotent `refund:<orderId>` on replay, the gateway refund recorded once, payment `refunded`, `payments.payment_refunded`
//       written; an UNPAID order's cancel books nothing;
//   (4) a second live intent → 409 PAYMENT_ATTEMPT_LIVE {paymentId, expiresAt}; after a failure "send again" → a new attempt with a new
//       gateway order; after a lapse → the old attempt `expired`, and its LATE capture is still booked exactly once (the HOTFIX-4 rule kept);
//   (5) the order's currency = the listing's (a USD lot on a USD organisation); a mixed-currency cart → 422 MIXED_CURRENCY (preview and
//       placement); a non-Indian (4-digit) postal code is accepted by the delivery-methods rule and the address book;
//   (6) a `per_km` charge definition → 422 CHARGE_METHOD_UNSUPPORTED at creation, by name;
//   (7) wallet pay succeeds when the balance covers (the escrow leg = the total), refused 422 WALLET_INSUFFICIENT_BALANCE when it does not;
//   (8) the public auction read: `reserveMet` boolean only (no amount anywhere), server `minNextBidMinor` / `lotTotalMinor`, no bidder
//       identity; `auctions` OFF → 404; a bid without a session → 401;
//   (9) the failure reason on the payment read (a CODE + chargedNothing), the attempt number and its expiry;
//   (10) is the relay gate (relay-handlers-as-kv-relay.integration.spec.ts) — the two new handlers registered and exercised as kv_relay.
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
import { OUTBOX_HANDLER_REGISTRY, OutboxEvent } from '../core/outbox/event-envelope';
import type { OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { GatewayRegistry } from '../modules/payments/gateway/gateway.registry';
import { SandboxGateway } from '../modules/payments/gateway/sandbox.gateway';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { OrderCancelledRestockHandler } from '../modules/orders/events/handlers/order-cancelled-restock.handler';
import { OrderCancelledRefundHandler } from '../modules/payments/events/handlers/order-cancelled-refund.handler';
import { OrderCompletedHandler as ListingsOrderCompletedHandler } from '../modules/listings/events/handlers/order-completed.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';

run('PC-56 STORE-2c · the money wave (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let sandbox: SandboxGateway;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const USDT = randomUUID();
  let liveSlug = '';
  let seller = ''; let seller2 = ''; let seller3 = ''; let buyer = ''; let buyer2 = ''; let buyer3 = ''; let usdSeller = ''; let usdBuyer = ''; let admin1 = '';
  let catId = ''; let product = '';
  const L: Record<string, string> = {};
  const T: Record<string, string> = {};
  const touched = ['online_payments', 'auctions', 'buyer_charges', 'commission_split'];

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${LIVE}`, `flagctx:${USDT}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function listing(tenantId: string, sellerId: string, title: string, o: { price?: number; total?: string; avail?: string; currency?: string; status?: string } = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, $5::text, $6::numeric, $7::numeric, 1, 'quintal', $8, $9, $10, 'public', $11, now()) RETURNING id`,
      [tenantId, sellerId, product, catId, title, o.total ?? '10', o.avail ?? o.total ?? '10', o.price ?? 50_000, o.currency ?? 'INR', o.status ?? 'published', JUNAGADH]);
    return r.rows[0].id;
  }
  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const add = (token: string, listingId: string, quantity: string, tenantId = LIVE) => request(http).post('/v1/cart/items').set(H(token, tenantId)).send({ listingId, quantity });
  const clear = (token: string, tenantId = LIVE) => request(http).delete('/v1/cart').set(H(token, tenantId));
  const place = (token: string, body: Record<string, unknown> = {}, tenantId = LIVE) => request(http).post('/v1/checkout').set({ ...H(token, tenantId), 'idempotency-key': randomUUID() }).send(body);
  const preview = (token: string, tenantId = LIVE) => request(http).post('/v1/checkout/preview').set(H(token, tenantId)).send({});
  const stock = async (id: string) => (await admin.query(`SELECT quantity_available::text q, status FROM listings WHERE id = $1`, [id])).rows[0] as { q: string; status: string };
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const order = async (token: string, id: string) => (await request(http).get(`/v1/orders/${id}`).set(H(token))).body.data;
  /** The outbox row the API wrote, as the relay hands it to a handler. */
  async function outboxEvent(eventType: string, aggregateId: string): Promise<OutboxEvent> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0];
    expect(r).toBeDefined();
    return { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
  }
  async function cancelSideEffects(orderId: string) {
    const ev = await outboxEvent('orders.order_cancelled', orderId);
    await app.get(OrderCancelledRestockHandler).handle(ev);
    await app.get(OrderCancelledRefundHandler).handle(ev);
    return ev;
  }
  async function confirmPaid(paymentId: string) {
    const ev = await outboxEvent('payments.payment_succeeded', paymentId);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(LIVE, (tx) => app.get(PaymentSucceededHandler).handle(ev, tx));
  }
  const intent = (token: string, o: { id: string; totalMinor: string; currencyCode: string }, attempt: number) =>
    request(http).post('/v1/payments').set({ ...H(token), 'idempotency-key': `order-pay:${o.id}:${attempt}` })
      .send({ purpose: 'direct_order', amountMinor: o.totalMinor, currencyCode: o.currencyCode, referenceType: 'order', referenceId: o.id });
  const sandboxHook = (body: Record<string, unknown>) => { const raw = JSON.stringify(body); return request(http).post('/v1/payments/webhooks/sandbox').set({ 'content-type': 'application/json', 'x-webhook-signature': sandbox.sign(raw) }).send(raw); };
  const captureVia = (gwOrder: string, payId: string, amount: string) => sandboxHook({ id: `evt_${randomUUID()}`, event: 'payment.captured', order_id: gwOrder, payment_id: payId, amount: Number(amount), currency: 'INR', method: 'upi' });
  const ledgerKey = (key: string) => count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [key]);
  // PC-56 STORE-3a · B2 (founder D1 / D5): a BUYER's cancel now needs a reason from the seeded `cancel_reason` vocabulary (0210) — the buyer's
  // cancels below send `changed_mind` (a seller's decline keeps sending none)
  const REASON = async () => ({ reasonId: (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL AND code = 'changed_mind'`)).rows[0].id as string });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s2c ${LIVE.slice(0, 4)}`); await makeTenant(admin, USDT, `Kisumu Coop s2c ${USDT.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, USDT], JUNAGADH]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    [seller, seller2, seller3, buyer, buyer2, buyer3, usdSeller, usdBuyer, admin1] = await Promise.all(Array.from({ length: 9 }, () => makeUser(admin)));
    for (const u of [seller, seller2, seller3]) await role(u, LIVE, 'farmer');
    for (const u of [buyer, buyer2, buyer3]) await role(u, LIVE, 'customer');
    await role(admin1, LIVE, 'tenant_admin'); await role(usdSeller, USDT, 'farmer'); await role(usdBuyer, USDT, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs2c' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s2c', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s2c', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    L.stock = await listing(LIVE, seller, 'Bold groundnut s2c', { total: '10', price: 615_000 });
    L.a = await listing(LIVE, seller, 'Java groundnut s2c', { total: '40', price: 590_000 });
    L.b = await listing(LIVE, seller2, 'Lokwan wheat s2c', { total: '40', price: 252_000 });
    L.c = await listing(LIVE, seller3, 'Cumin s2c', { total: '40', price: 1_800_000 });
    L.usdInLive = await listing(LIVE, seller3, 'Imported lentils s2c', { total: '40', price: 9_000, currency: 'USD' });
    L.usd = await listing(USDT, usdSeller, 'Kisumu maize s2c', { total: '40', price: 3_500, currency: 'USD' });
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    sandbox = app.get(GatewayRegistry).get('sandbox') as SandboxGateway;
    for (const [k, u, t] of [['buyer', buyer, LIVE], ['buyer2', buyer2, LIVE], ['buyer3', buyer3, LIVE], ['usdBuyer', usdBuyer, USDT]] as const) T[k] = mintToken(app, { userId: u, tenantId: t, roles: ['customer'], perms: ['order.create'] });
    T.seller = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    T.seller2 = mintToken(app, { userId: seller2, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    T.admin = mintToken(app, { userId: admin1, tenantId: LIVE, roles: ['tenant_admin'], perms: ['tenant.settings'] });
    await setFlag('online_payments', true); await setFlag('buyer_charges', false); await setFlag('commission_split', false);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  describe('(1) stock is reserved at placement under the row lock; cancel restocks once; completion does not decrement', () => {
    let orderA = ''; let orderB = '';
    it('placement decrements in the placement transaction and marks the order as having reserved', async () => {
      await clear(T.buyer); await clear(T.buyer2);
      expect((await add(T.buyer, L.stock, '7')).status).toBe(201);
      expect((await add(T.buyer2, L.stock, '4')).status).toBe(201);           // both carted while 10 were available
      const p = await place(T.buyer);
      expect([p.status, p.body.error]).toEqual([201, undefined]);
      orderA = p.body.data.orders[0].id;
      expect(await stock(L.stock)).toEqual({ q: '3.000', status: 'published' });
      expect((await admin.query(`SELECT stock_reserved_at IS NOT NULL r FROM orders WHERE id = $1`, [orderA])).rows[0].r).toBe(true);
    });
    it('a second buyer for the remainder + 1 is refused LISTING_INSUFFICIENT_STOCK with the LOCKED remainder — even when the cache still says 10', async () => {
      const key = `t:${LIVE}:listing:${L.stock}`;
      const stale = await cache.get<Record<string, unknown>>(key) ?? (await (async () => { await request(http).get(`/v1/listings/${L.stock}`).set('x-tenant-slug', liveSlug); return cache.get<Record<string, unknown>>(key); })());
      await cache.set(key, { ...(stale ?? {}), quantityAvailable: 10, status: 'published' }, 300);   // the 300 s cache still holds the pre-placement figure
      const r = await place(T.buyer2);
      expect(refusal(r)).toEqual([409, 'LISTING_INSUFFICIENT_STOCK']);
      expect(r.body.error.details).toMatchObject({ listingId: L.stock, requested: '4.000', available: '3.000' });
      expect(await stock(L.stock)).toEqual({ q: '3.000', status: 'published' });    // nothing moved
      await cache.del(key);
    });
    it('the last units sell the lot out: the public tombstone says sold_out', async () => {
      expect((await request(http).patch(`/v1/cart/items/${L.stock}`).set(H(T.buyer2)).send({ quantity: '3' })).status).toBe(200);
      const p = await place(T.buyer2);
      expect(p.status).toBe(201);
      orderB = p.body.data.orders[0].id;
      expect(await stock(L.stock)).toEqual({ q: '0.000', status: 'sold_out' });
      const tomb = await request(http).get(`/v1/listings/${L.stock}/tombstone`).set('x-tenant-slug', liveSlug);
      expect([tomb.status, tomb.body.data?.status]).toEqual([200, 'sold_out']);
    });
    it('the buyer cancels → the restock handler gives the 7 back ONCE (the lot is on sale again); a replayed event moves nothing', async () => {
      const c = await request(http).post(`/v1/orders/${orderA}/cancel`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send(await REASON());
      expect(c.status).toBe(201);
      const ev = await cancelSideEffects(orderA);
      expect(ev.payload).toMatchObject({ role: 'buyer', stockReserved: true });
      expect(await stock(L.stock)).toEqual({ q: '7.000', status: 'published' });
      await app.get(OrderCancelledRestockHandler).handle(ev);                   // the relay delivers it again
      await app.get(OrderCancelledRestockHandler).handle(ev);
      expect(await stock(L.stock)).toEqual({ q: '7.000', status: 'published' });
      expect((await admin.query(`SELECT stock_reserved_at FROM orders WHERE id = $1`, [orderA])).rows[0].stock_reserved_at).toBeNull();
    });
    it('completion does NOT decrement again: no listings handler consumes orders.order_completed, and the old class is a no-op', async () => {
      const reg = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
      expect(reg.handlersFor('orders.order_completed').map((h) => h.constructor.name)).not.toContain('ListingsOrderCompletedHandler');
      expect(reg.handlersFor('orders.order_completed').some((h) => h instanceof ListingsOrderCompletedHandler)).toBe(false);
      await app.get(ListingsOrderCompletedHandler).handle({ v: 1, tenantId: LIVE, listingId: L.stock, quantity: 3, orderId: orderB });
      expect(await stock(L.stock)).toEqual({ q: '7.000', status: 'published' });
    });
  });

  describe('(2)(3)(9)(4) paying each order of a two-seller checkout; the automatic refund; attempts and their failure reasons', () => {
    let o1: any; let o2: any; let p1 = ''; let p2 = '';   // eslint-disable-line @typescript-eslint/no-explicit-any
    it('(2) a two-seller checkout → two orders, each paid on its own; escrow after both = the sum of both totals', async () => {
      await clear(T.buyer);
      expect((await add(T.buyer, L.a, '2')).status).toBe(201);
      expect((await add(T.buyer, L.b, '3')).status).toBe(201);
      const c = await place(T.buyer);
      expect(c.status).toBe(201);
      expect(c.body.data.orders).toHaveLength(2);
      [o1, o2] = await Promise.all(c.body.data.orders.map((o: { id: string }) => order(T.buyer, o.id)));
      for (const o of [o1, o2]) expect([o.paymentState, o.currencyCode]).toEqual(['pending', 'INR']);
      const i1 = await intent(T.buyer, o1, 1); const i2 = await intent(T.buyer, o2, 1);
      expect([i1.status, i2.status, i1.body.data.attempt, i2.body.data.attempt]).toEqual([201, 201, 1, 1]);
      p1 = i1.body.data.paymentId; p2 = i2.body.data.paymentId;
      for (const [pid, gw] of [[p1, i1.body.data.gatewayOrderId], [p2, i2.body.data.gatewayOrderId]]) {
        const amount = pid === p1 ? o1.totalMinor : o2.totalMinor;
        expect((await captureVia(gw, `pay_${pid.slice(-12)}`, amount)).status).toBe(200);
        await confirmPaid(pid);
      }
      for (const o of [o1, o2]) expect((await order(T.buyer, o.id)).paymentState).toBe('paid');
      const escrow = (await admin.query(
        `SELECT COALESCE(sum(e.amount_minor),0)::text s FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
          WHERE t.reference_type = 'payment' AND t.reference_id = ANY($1::uuid[]) AND w.owner_kind = 'platform' AND w.account_code = 'escrow'`, [[p1, p2]])).rows[0].s;
      expect(escrow).toBe((BigInt(o1.totalMinor) + BigInt(o2.totalMinor)).toString());
    });
    it('(3) the buyer cancels a PAID order → ONE order_cancel_refund transaction, zero-sum (gateway +, escrow −), refund recorded once, payment refunded', async () => {
      const before = sandbox.refunds.length;
      expect((await request(http).post(`/v1/orders/${o1.id}/cancel`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send(await REASON())).status).toBe(201);
      const ev = await cancelSideEffects(o1.id);
      expect(await ledgerKey(`refund:${o1.id}`)).toBe(1);
      const legs = (await admin.query(
        `SELECT lv.code, w.account_code, e.amount_minor::text a FROM ledger_transactions t JOIN lookup_values lv ON lv.id = t.txn_type_id
           JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id WHERE t.idempotency_key = $1 ORDER BY w.account_code`, [`refund:${o1.id}`])).rows;
      expect(legs).toEqual([{ code: 'order_cancel_refund', account_code: 'escrow', a: `-${o1.totalMinor}` }, { code: 'order_cancel_refund', account_code: 'gateway', a: o1.totalMinor }]);
      expect(legs.reduce((s: bigint, l: { a: string }) => s + BigInt(l.a), 0n)).toBe(0n);
      expect(sandbox.refunds.length - before).toBe(1);
      expect(sandbox.refunds[sandbox.refunds.length - 1]).toMatchObject({ amountMinor: BigInt(o1.totalMinor), receipt: `refund:${o1.id}` });
      expect((await admin.query(`SELECT status, refunded_minor::text r FROM payments WHERE id = $1`, [p1])).rows[0]).toEqual({ status: 'refunded', r: o1.totalMinor });
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'payments.payment_refunded' AND aggregate_id = $1`, [p1])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'payment.auto_refunded' AND entity_id = $1`, [p1])).toBe(1);
      // the replay (the relay delivers the same cancel again) books nothing and asks the gateway nothing
      await app.get(OrderCancelledRefundHandler).handle(ev); await app.get(OrderCancelledRefundHandler).handle(ev);
      expect(await ledgerKey(`refund:${o1.id}`)).toBe(1);
      expect(sandbox.refunds.length - before).toBe(1);
      // the ORDER says what happened to the order (cancelled); the PAYMENT read says what happened to the money (refunded) — the storefront
      // prints both (the order's paymentState vocabulary is the order's own facts: HOTFIX-4)
      expect((await order(T.buyer, o1.id)).paymentState).toBe('cancelled');
      expect((await request(http).get(`/v1/payments/order/${o1.id}/attempts`).set(H(T.buyer))).body.data.latest.status).toBe('refunded');
    });
    it('(3) the SELLER declines a paid order → refunded to source the same way (its own key)', async () => {
      expect((await request(http).post(`/v1/orders/${o2.id}/cancel`).set({ ...H(T.seller2), 'idempotency-key': randomUUID() }).send({})).status).toBe(201);
      const ev = await cancelSideEffects(o2.id);
      expect(ev.payload).toMatchObject({ role: 'seller' });
      expect(await ledgerKey(`refund:${o2.id}`)).toBe(1);
      expect((await admin.query(`SELECT status FROM payments WHERE id = $1`, [p2])).rows[0].status).toBe('refunded');
    });
    it('(3) an UNPAID order\'s cancel books nothing (no payment ever captured)', async () => {
      await clear(T.buyer3);
      expect((await add(T.buyer3, L.c, '1')).status).toBe(201);
      const c = await place(T.buyer3);
      const id = c.body.data.orders[0].id;
      expect((await request(http).post(`/v1/orders/${id}/cancel`).set({ ...H(T.buyer3), 'idempotency-key': randomUUID() }).send(await REASON())).status).toBe(201);
      await cancelSideEffects(id);
      expect(await ledgerKey(`refund:${id}`)).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM payments WHERE reference_id = $1`, [id])).toBe(0);
    });

    describe('(4)(9) attempts', () => {
      let oc: any; let a1: any; let a2: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
      it('(4) a second LIVE intent for the same order → 409 PAYMENT_ATTEMPT_LIVE {paymentId, expiresAt}; the same key replays the attempt', async () => {
        await clear(T.buyer);
        expect((await add(T.buyer, L.c, '1')).status).toBe(201);
        oc = await order(T.buyer, (await place(T.buyer)).body.data.orders[0].id);
        const r1 = await intent(T.buyer, oc, 1);
        expect([r1.status, r1.body.data.attempt, typeof r1.body.data.expiresAt]).toEqual([201, 1, 'string']);
        a1 = r1.body.data;
        expect((await intent(T.buyer, oc, 1)).body.data).toEqual(a1);                  // a refresh of the SAME attempt
        const r2 = await intent(T.buyer, oc, 2);
        expect(refusal(r2)).toEqual([409, 'PAYMENT_ATTEMPT_LIVE']);
        expect(r2.body.error.details).toEqual({ paymentId: a1.paymentId, expiresAt: a1.expiresAt });
      });
      it('(9) the gateway fails the attempt → the payment read carries the reason as a CODE, whether nothing was charged, the attempt and its expiry', async () => {
        const f = await sandboxHook({ id: `evt_${randomUUID()}`, event: 'payment.failed', order_id: a1.gatewayOrderId, payment_id: 'pay_fail_s2c', error_code: 'BAD_REQUEST_ERROR', error_reason: 'payment_timed_out' });
        expect(f.status).toBe(200);
        const p = (await request(http).get(`/v1/payments/${a1.paymentId}`).set(H(T.buyer))).body.data;
        expect([p.status, p.failureCode, p.failureReason, p.chargedNothing, p.attempt, p.expiresAt]).toEqual(['failed', 'BAD_REQUEST_ERROR', 'timed_out', true, 1, a1.expiresAt]);
        const att = (await request(http).get(`/v1/payments/order/${oc.id}/attempts`).set(H(T.buyer))).body.data;
        expect([att.latest.id, att.attempts, att.nextAttempt, att.liveAttempt, att.ttlSeconds]).toEqual([a1.paymentId, 1, 2, false, 900]);
      });
      it('(4) after the failure, "send again" → a NEW attempt (attempt 2, a new gateway order, a new payment row)', async () => {
        const r = await intent(T.buyer, oc, 2);
        expect([r.status, r.body.data.attempt]).toEqual([201, 2]);
        a2 = r.body.data;
        expect([a2.gatewayOrderId === a1.gatewayOrderId, a2.paymentId === a1.paymentId]).toEqual([false, false]);
      });
      it('(4) the attempt LAPSES (past the platform TTL) → attempt 3 allowed, attempt 2 marked expired — and attempt 2\'s LATE capture is still booked exactly once', async () => {
        await admin.query(`UPDATE payments SET created_at = now() - interval '16 minutes' WHERE id = $1`, [a2.paymentId]);
        const r3 = await intent(T.buyer, oc, 3);
        expect([r3.status, r3.body.data.attempt]).toEqual([201, 3]);
        expect((await admin.query(`SELECT status FROM payments WHERE id = $1`, [a2.paymentId])).rows[0].status).toBe('expired');
        const late = await captureVia(a2.gatewayOrderId, 'pay_late_s2c', oc.totalMinor);
        expect([late.status, late.body.data]).toEqual([200, { ok: true }]);
        expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_type = 'payment' AND reference_id = $1`, [a2.paymentId])).toBe(1);
        const replay = await captureVia(a2.gatewayOrderId, 'pay_late_s2c', oc.totalMinor);
        expect([replay.status, replay.body.data]).toEqual([200, { ok: true, duplicate: true }]);
        expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_type = 'payment' AND reference_id = $1`, [a2.paymentId])).toBe(1);
        await confirmPaid(a2.paymentId);
        expect((await order(T.buyer, oc.id)).paymentState).toBe('paid');
      });
    });
  });

  describe('(5) currency from the data; the country-aware postal rule', () => {
    afterEach(async () => { await setFlag('online_payments', true); });   // a refusal mid-test never leaks the flag into the next case
    it('a USD organisation\'s lot → the preview and the order are in USD (never an assumed INR)', async () => {
      await setFlag('online_payments', false);
      await clear(T.usdBuyer, USDT);
      expect((await add(T.usdBuyer, L.usd, '2', USDT)).status).toBe(201);
      const pv = await preview(T.usdBuyer, USDT);
      expect([pv.status, pv.body.data.currencyCode]).toEqual([201, 'USD']);
      const c = await place(T.usdBuyer, {}, USDT);
      expect(c.status).toBe(201);
      const o = (await request(http).get(`/v1/orders/${c.body.data.orders[0].id}`).set(H(T.usdBuyer, USDT))).body.data;
      expect([o.currencyCode, o.totalMinor]).toEqual(['USD', '7000']);
      await setFlag('online_payments', true);
    });
    it('a cart mixing INR and USD lots → 422 MIXED_CURRENCY naming both, at the preview and at placement; nothing placed', async () => {
      await clear(T.buyer3);
      expect((await add(T.buyer3, L.a, '1')).status).toBe(201);
      expect((await add(T.buyer3, L.usdInLive, '1')).status).toBe(201);
      const pv = await preview(T.buyer3);
      expect(refusal(pv)).toEqual([422, 'MIXED_CURRENCY']);
      expect(pv.body.error.details).toEqual({ currencies: ['INR', 'USD'] });
      const before = await stock(L.a);
      expect(refusal(await place(T.buyer3))).toEqual([422, 'MIXED_CURRENCY']);
      expect(await stock(L.a)).toEqual(before);
      await clear(T.buyer3);
    });
    it('a 4-digit (non-Indian) postal code is accepted by the address book AND the delivery-methods rule (no Indian-only PIN regex)', async () => {
      const a = await request(http).post('/v1/addresses').set({ ...H(T.buyer3), 'idempotency-key': randomUUID() }).send({ line1: '12 Market Road', pincode: '1010', countryCode: 'US', contactName: 'Buyer s2c' });
      expect([a.status, typeof a.body.data?.id]).toEqual([201, 'string']);
      expect((await admin.query(`SELECT pincode, country_code FROM addresses WHERE id = $1`, [a.body.data.id])).rows[0]).toEqual({ pincode: '1010', country_code: 'US' });
      expect((await add(T.buyer3, L.a, '1')).status).toBe(201);
      const dm = await request(http).get('/v1/checkout/delivery-methods?pincode=1010').set(H(T.buyer3));
      expect([dm.status, dm.body.data.currencyCode]).toEqual([200, 'INR']);
      expect((await request(http).get('/v1/checkout/delivery-methods?pincode=12ab').set(H(T.buyer3))).status).toBe(422);
      await clear(T.buyer3);
    });
  });

  it('(6) a per_km charge definition is refused at creation BY NAME — CHARGE_METHOD_UNSUPPORTED', async () => {
    const r = await request(http).post('/v1/charges/proposals').set(H(T.admin)).send({ chargeCode: 'delivery_fee', action: 'add', calcMethod: 'per_km',
      config: { rate_minor: 8000, per_km: 100 }, effectiveFrom: '2027-01-01', note: 'a per-kilometre delivery rate for the Junagadh routes' });
    expect(refusal(r)).toEqual([409, 'CHARGE_METHOD_UNSUPPORTED']);   // the charge desk's refusals are 409s (ChargeRefusedError), by name
    expect(r.body.error.details).toMatchObject({ method: 'per_km', supported: ['flat', 'percent', 'slab', 'per_unit'] });
  });

  describe('(7) wallet pay when the balance covers; refused by name when it does not', () => {
    it('balance ≥ total → paid from the wallet; the escrow leg equals the total; balance short → 422 WALLET_INSUFFICIENT_BALANCE', async () => {
      await clear(T.buyer2);
      expect((await add(T.buyer2, L.b, '2')).status).toBe(201);
      const o = await order(T.buyer2, (await place(T.buyer2)).body.data.orders[0].id);
      // money into the buyer's wallet (a fixture top-up through the app's own wallet port: gateway − / buyer main +)
      await app.get<UnitOfWork>(UNIT_OF_WORK).run(LIVE, (tx) => app.get<WalletPort>(WALLET_SERVICE).post(tx, { tenantId: LIVE, txnType: 'refund', idempotencyKey: `s2c-topup:${o.id}`,
        initiatedBy: 'system', legs: [{ account: platform(PlatformAccount.Gateway), amountMinor: -BigInt(o.totalMinor) }, { account: userMain(buyer2), amountMinor: BigInt(o.totalMinor) }] }), { userId: 'system' });
      const bal = await request(http).get('/v1/wallet/balance?currency=INR').set(H(T.buyer2));
      expect([bal.status, bal.body.data.availableMinor]).toEqual([200, o.totalMinor]);
      const pay = await request(http).post(`/v1/orders/${o.id}/pay-from-wallet`).set({ ...H(T.buyer2), 'idempotency-key': randomUUID() });
      expect([pay.status, pay.body.error, pay.body.data?.amountMinor]).toEqual([201, undefined, o.totalMinor]);
      const esc = (await admin.query(`SELECT e.amount_minor::text a FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
         WHERE t.idempotency_key = $1 AND w.owner_kind = 'platform' AND w.account_code = 'escrow'`, [`walletpay:${o.id}`])).rows;
      expect(esc).toEqual([{ a: o.totalMinor }]);
      // another order, the wallet now empty → refused by name with both numbers
      await clear(T.buyer2);
      expect((await add(T.buyer2, L.b, '1')).status).toBe(201);
      const o2 = await order(T.buyer2, (await place(T.buyer2)).body.data.orders[0].id);
      const short = await request(http).post(`/v1/orders/${o2.id}/pay-from-wallet`).set({ ...H(T.buyer2), 'idempotency-key': randomUUID() });
      expect(refusal(short)).toEqual([422, 'WALLET_INSUFFICIENT_BALANCE']);
      expect(short.body.error.details).toEqual({ requiredMinor: o2.totalMinor, availableMinor: '0' });
    });
  });

  describe('(8) the public auction read', () => {
    let auctionId = ''; let lotId = '';
    beforeAll(async () => {
      lotId = await listing(LIVE, seller, 'Bold groundnut auction s2c', { total: '60', price: 600_000, status: 'reserved_auction' });
      auctionId = randomUUID();
      await admin.query(`INSERT INTO auctions (id, tenant_id, listing_id, kind, start_price_minor, reserve_price_minor, min_increment_minor, emd_minor, emd_pct_bps,
          starts_at, ends_at, auto_extend_secs, extend_trigger_secs, status, quantity, unit_code, auction_no)
        VALUES ($1,$2,$3,'english_open',600000,630000,2000,0,200, now() - interval '1 hour', now() + interval '1 hour', 120, 90, 'live', 60, 'quintal', $4)`,
        [auctionId, LIVE, lotId, `AUC-${auctionId.slice(0, 10)}`]);
      for (const [who, amt, ago] of [[buyer, 620000, 30], [buyer2, 632000, 10]] as const) {
        await admin.query(`INSERT INTO bids (tenant_id, auction_id, bidder_user_id, amount_minor, created_at) VALUES ($1,$2,$3,$4, now() - make_interval(mins => $5))`, [LIVE, auctionId, who, amt, ago]);
      }
    });
    it('auctions ON: anonymous → reserveMet boolean only, server min-next and lot totals, history with NO identity, the organisation named', async () => {
      await setFlag('auctions', true);
      const r = await request(http).get(`/v1/storefront/auctions/${auctionId}`).set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      const v = r.body.data;
      expect([v.reserveMet, v.currentBidMinor, v.minNextBidMinor, v.lotTotalMinor, v.minNextLotTotalMinor]).toEqual([true, '632000', '634000', '37920000', '38040000']);
      expect([v.currencyCode, v.exponent, v.antiSnipe, v.emd, v.balanceDueHours, v.viewer]).toEqual(['INR', 2, { triggerSec: 90, extendSec: 120 }, { flatMinor: null, pctBps: 200 }, 48, null]);
      expect(v.lot).toMatchObject({ title: 'Bold groundnut auction s2c', quantity: '60.000', unitCode: 'quintal', organisation: { slug: liveSlug } });
      expect(v.bids.map((b: Record<string, unknown>) => Object.keys(b).sort())).toEqual([['amountMinor', 'at'], ['amountMinor', 'at']]);
      const json = JSON.stringify(r.body);
      expect(json).not.toContain('630000');                                   // the reserve amount never leaves
      for (const id of [buyer, buyer2, seller]) expect(json).not.toContain(id);
    });
    it('with the bidder\'s own session: their best bid and whether it leads — nobody else\'s', async () => {
      const r = await request(http).get(`/v1/storefront/auctions/${auctionId}`).set(H(T.buyer2));
      expect(r.body.data.viewer).toEqual({ bestBidMinor: '632000', leading: true, won: false, orderId: null });
    });
    it('a bid without a session → 401; auctions OFF → 404', async () => {
      expect((await request(http).post(`/v1/auctions/${auctionId}/bids`).set({ 'x-tenant-slug': liveSlug, 'idempotency-key': randomUUID() }).send({ amountMinor: '634000' })).status).toBe(401);
      await setFlag('auctions', false);
      expect((await request(http).get(`/v1/storefront/auctions/${auctionId}`).set('x-tenant-slug', liveSlug)).status).toBe(404);
    });
  });
});
