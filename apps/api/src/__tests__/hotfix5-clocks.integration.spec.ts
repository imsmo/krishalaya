// apps/api/src/__tests__/hotfix5-clocks.integration.spec.ts · PC-56 HOTFIX-5 — THE CLOCKS, THE NUMBERS, THE NAMES AND THE DEPOSIT, LIVE.
// The real AppModule over HTTP (supertest), real Postgres + RLS as kv_app; the clocks are handed a pool that LOGS IN as kv_relay (the runner's
// shape — the relay gate's login), and the outbox handlers are driven with the outbox rows the API wrote, exactly as the relay hands them over.
//
// What it proves (brief §B, survey §7 `store3-hotfix-clocks`):
//   (1) SCHEDULED_JOB_REGISTRY holds `seller-confirm-timeout`, `quality-window-complete`, `offers-expire` at the table's cadence (after boot);
//   (2) a `created` (pay-on-delivery) order past its deadline is cancelled ONCE by the clock as the system — `orders.order_cancelled` carries the
//       2c payload, the restock handler gives the stock back ONCE, nothing is refunded (unpaid); a second tick changes nothing;
//       a PAID `payment_pending` order (captured, its confirm not yet relayed) cancelled by the clock is refunded to source ONCE (`refund:<id>`);
//   (3) an AUCTION order past its 24 h deadline is NOT cancelled by the clock (founder D2); at 48 h the default job forfeits the EMD;
//   (4) a delivered order PAID ONLINE past its quality window completes ONCE and its escrow releases zero-sum through payments' settlement
//       (`settle:<id>`), the same path a manual completion takes (a later manual complete is refused, nothing settles twice); a PAY-ON-DELIVERY
//       order is NOT completed by the clock (fail closed: its escrow never held the money);
//   (5) an offer past expires_at becomes `expired` (once);
//   (6) two auctions of one organisation closing in ONE sweep both settle, with distinct order numbers;
//   (7) the buyer's `GET orders`, `GET orders/:id` and `GET orders/:id/events` carry no person uuid and no full_name (the organisation instead;
//       currency, paymentState, acceptanceDeadline on the list); the seller keeps the names;
//   (8) D4: a PAID auction order cancelled → the balance refunded (2c) AND the applied EMD returned (`emd-return:<orderId>`), each exactly once;
//       a replayed cancel books nothing; the relay delivering the cancel before the settlement's `paid` still returns it; an UNPAID cancel
//       still forfeits;
//   (9) the cancel route honours Idempotency-Key (a replay acts nothing);
//   (10) currency from the data: an offer's order is in the listing's currency (USD); the offer and my-bids reads carry currencyCode.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS } from '../core/jobs/clock-cadence';
import { SellerConfirmTimeoutJob } from '../modules/orders/jobs/seller-confirm-timeout.job';
import { AutoCompleteQualityWindowJob } from '../modules/orders/jobs/auto-complete-quality-window.job';
import { ExpireOffersJob } from '../modules/offers/jobs/expire-offers.job';
import { ListingOfferService } from '../modules/offers/services/listing-offer.service';
import { ListingOfferRepository } from '../modules/offers/repositories/listing-offer.repository';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { OfferAcceptedHandler } from '../modules/orders/events/handlers/offer-accepted.handler';
import { OrderCancelledRestockHandler } from '../modules/orders/events/handlers/order-cancelled-restock.handler';
import { OrderCancelledRefundHandler } from '../modules/payments/events/handlers/order-cancelled-refund.handler';
import { OrderCompletedHandler } from '../modules/payments/events/handlers/order-completed.handler';
import { AuctionService } from '../modules/auctions/services/auction.service';
import { BidService } from '../modules/auctions/services/bid.service';
import { MyBidsReadModel } from '../modules/auctions/read-models/my-bids.read-model';
import { AuctionDefaultJob, CloseEndedAuctionsJob } from '../modules/auctions/jobs/auctions.cadence-jobs';
import { AuctionOrderCancelledHandler } from '../modules/auctions/events/handlers/order-cancelled.handler';
import { AuctionPaymentSucceededHandler } from '../modules/auctions/events/handlers/payment-succeeded.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

run('PC-56 HOTFIX-5 · the clocks, the order numbers, the names and the deposit (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relay: Pool; let cache: CacheService; let uow: UnitOfWork; let wallet: WalletPort;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const USDT = randomUUID();
  let seller = ''; let buyer = ''; let buyer2 = ''; let b1 = ''; let b2 = ''; let b3 = ''; let usdSeller = ''; let usdBuyer = '';
  let catId = ''; let product = '';
  const L: Record<string, string> = {};
  const T: Record<string, string> = {};
  const touched = ['online_payments', 'buyer_charges', 'commission_split'];
  const EMD = 1_000_000n;
  const FUND = 50_000_000n;
  const key = () => `k-${randomUUID()}`;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  const setFlag = async (k: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k, on]);
    for (const c of [`flag:${k}`, `flagstale:${k}`, 'flags:all', `flagctx:${LIVE}`, `flagctx:${USDT}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function listing(tenantId: string, sellerId: string, title: string, o: { price?: number; total?: string; currency?: string } = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, $5::text, $6::numeric, $6::numeric, 1, 'quintal', $7, $8, 'published', 'public', $9, now()) RETURNING id`,
      [tenantId, sellerId, product, catId, title, o.total ?? '10', o.price ?? 50_000, o.currency ?? 'INR', JUNAGADH]);
    return r.rows[0].id;
  }
  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const add = (token: string, listingId: string, quantity: string) => request(http).post('/v1/cart/items').set(H(token)).send({ listingId, quantity });
  const clear = (token: string) => request(http).delete('/v1/cart').set(H(token));
  const place = (token: string) => request(http).post('/v1/checkout').set({ ...H(token), 'idempotency-key': randomUUID() }).send({});
  async function placeOne(token: string, listingId: string, qty: string): Promise<string> {
    await clear(token);
    expect((await add(token, listingId, qty)).status).toBe(201);
    const p = await place(token);
    expect([p.status, p.body.error]).toEqual([201, undefined]);
    return p.body.data.orders[0].id as string;
  }
  const stock = async (id: string) => (await admin.query(`SELECT quantity_available::text q, status::text s FROM listings WHERE id = $1`, [id])).rows[0] as { q: string; s: string };
  const orderRow = async (id: string) => (await admin.query(`SELECT status::text, cancelled_by, total_minor::text total, order_no, source, currency_code FROM orders WHERE id = $1`, [id])).rows[0];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const ledgerKey = (k: string) => count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [k]);
  const legsOf = async (k: string) => (await admin.query(
    `SELECT w.owner_kind, w.account_code, e.amount_minor::text a FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
      WHERE t.idempotency_key = $1 ORDER BY w.owner_kind, w.account_code`, [k])).rows as Array<{ owner_kind: string; account_code: string; a: string }>;
  const sumLegs = (legs: Array<{ a: string }>) => legs.reduce((s, l) => s + BigInt(l.a), 0n);
  const escrowLeg = (legs: Array<{ owner_kind: string; account_code: string; a: string }>) => legs.filter((l) => l.owner_kind === 'platform' && l.account_code === 'escrow').reduce((s, l) => s + BigInt(l.a), 0n);
  const mainOf = async (userId: string) => BigInt((await admin.query(`SELECT COALESCE(sum(cached_balance_minor),0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main' AND currency_code='INR'`, [userId])).rows[0].b);
  const cancelEvents = (orderId: string) => count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_cancelled' AND aggregate_id = $1`, [orderId]);
  /** The outbox row the API wrote, as the relay hands it to a handler. */
  async function outboxEvent(eventType: string, aggregateId: string): Promise<OutboxEvent> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0];
    expect(r).toBeDefined();
    return { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
  }
  /** Every consumer of orders.order_cancelled this wave cares about: 2c's restock + refund, 11a's auction deposit. */
  async function cancelSideEffects(orderId: string): Promise<OutboxEvent> {
    const ev = await outboxEvent('orders.order_cancelled', orderId);
    await app.get(OrderCancelledRestockHandler).handle(ev);
    await app.get(OrderCancelledRefundHandler).handle(ev);
    await app.get(AuctionOrderCancelledHandler).handle(ev);
    return ev;
  }
  async function confirmPaid(paymentId: string): Promise<void> {
    const ev = await outboxEvent('payments.payment_succeeded', paymentId);
    await uow.run(LIVE, (tx) => app.get(PaymentSucceededHandler).handle(ev, tx));
  }
  async function fund(tenantId: string, userId: string, amount: bigint): Promise<void> {
    await uow.run(tenantId, (tx) => wallet.post(tx, { tenantId, txnType: 'refund', idempotencyKey: `hf5-fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Gateway), amountMinor: -amount }, { account: userMain(userId), amountMinor: amount }] }), { userId: 'system' });
  }
  async function payFromWallet(token: string, orderId: string): Promise<{ paymentId: string; amountMinor: string }> {
    const pay = await request(http).post(`/v1/orders/${orderId}/pay-from-wallet`).set({ ...H(token), 'idempotency-key': randomUUID() });
    expect([pay.status, pay.body.error]).toEqual([201, undefined]);
    return pay.body.data;
  }
  /** GET one order as `token`, asserting the answer (a failed read names its status and code instead of an undefined body). */
  async function getOrder(token: string, id: string) {
    const r = await request(http).get(`/v1/orders/${id}`).set(H(token));
    expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
    return r.body.data;
  }
  const pastDeadline = (orderId: string) => admin.query(`UPDATE orders SET acceptance_deadline = now() - interval '1 minute' WHERE id = $1`, [orderId]);
  // PC-56 STORE-3a · B2 (founder D1 / D5): a BUYER's cancel now needs a reason from the seeded `cancel_reason` vocabulary (0210) — the buyer's
  // cancels below send `changed_mind` (a seller's decline keeps sending none)
  const REASON = async () => ({ reasonId: (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL AND code = 'changed_mind'`)).rows[0].id as string });

  // --- auctions ---
  const auctions = () => app.get(AuctionService);
  async function settledAuction(winner: string, hammer: string, loser?: string): Promise<{ auctionId: string; listingId: string; orderId: string }> {
    const listingId = await makeAuctionListing(admin, LIVE, seller, `Ghee hf5 ${randomUUID().slice(0, 4)}`, 200, 'kg');
    const c = await auctions().create(LIVE, { userId: seller }, key(), { listingId, kind: 'english_open', startPriceMinor: '61000', reservePriceMinor: '62000', minIncrementMinor: '500',
      emdMinor: EMD.toString(), startsAt: iso(-1000), endsAt: iso(3600_000) });
    expect(await auctions().open(LIVE, c.auctionId)).toBe(true);
    if (loser) await app.get(BidService).placeBid(LIVE, loser, c.auctionId, key(), '61000', '10.0.0.1');
    await app.get(BidService).placeBid(LIVE, winner, c.auctionId, key(), hammer, '10.0.0.1');
    await admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, [c.auctionId]);
    expect(await auctions().closeAndResolve(LIVE, c.auctionId)).toBe(true);
    const orderId = (await admin.query(`SELECT settled_order_id FROM auctions WHERE id = $1`, [c.auctionId])).rows[0].settled_order_id as string;
    expect(orderId).toMatch(UUID);
    return { auctionId: c.auctionId, listingId, orderId };
  }
  const settlement = async (auctionId: string) => (await admin.query(`SELECT outcome, emd_return_txn_id IS NOT NULL ret, emd_forfeit_txn_id IS NOT NULL fft, collection FROM auction_settlements WHERE auction_id = $1`, [auctionId])).rows[0];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    // the runner's pool LOGS IN as kv_relay (the relay gate's statement; db/local/local-login-roles.sql)
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relay = new Pool({ connectionString: u.toString(), max: 2, application_name: 'hotfix5-clocks' });
    expect((await relay.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');
    await makeTenant(admin, LIVE, `Anand FPO hf5 ${LIVE.slice(0, 4)}`); await makeTenant(admin, USDT, `Kisumu Coop hf5 ${USDT.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, USDT], JUNAGADH]);
    [seller, buyer, buyer2, b1, b2, b3, usdSeller, usdBuyer] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [seller]);
    await role(seller, LIVE, 'farmer');
    for (const x of [buyer, buyer2, b1, b2, b3]) await role(x, LIVE, 'customer');
    await role(usdSeller, USDT, 'farmer'); await role(usdBuyer, USDT, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'chf5' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds hf5', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut hf5', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    L.cod = await listing(LIVE, seller, 'Bold groundnut hf5', { total: '10', price: 615_000 });
    L.pay = await listing(LIVE, seller, 'Java groundnut hf5', { total: '10', price: 590_000 });
    L.qw = await listing(LIVE, seller, 'Lokwan wheat hf5', { total: '40', price: 252_000 });
    L.reads = await listing(LIVE, seller, 'Cumin hf5', { total: '40', price: 1_800_000 });
    L.offer = await listing(LIVE, seller, 'Sesame hf5', { total: '40', price: 900_000 });
    L.usd = await listing(USDT, usdSeller, 'Kisumu maize hf5', { total: '40', price: 3_500, currency: 'USD' });
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    // Listen ONCE on 127.0.0.1 (supertest then reuses this address): left to itself supertest listens on an ephemeral port PER REQUEST on
    // every interface and dials 127.0.0.1 — on a machine where another process holds that IPv4 port the request reaches the OTHER server
    // (observed while building this wave: "Parse Error: Expected HTTP/", "socket hang up", stray 401 / 404 answers).
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
    uow = app.get<UnitOfWork>(UNIT_OF_WORK); wallet = app.get<WalletPort>(WALLET_SERVICE);
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2], ['b1', b1], ['b2', b2], ['b3', b3]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.seller = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    await setFlag('online_payments', false); await setFlag('buyer_charges', false); await setFlag('commission_split', false);
    for (const x of [buyer, buyer2, b1, b2, b3]) await fund(LIVE, x, FUND);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, USDT]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await relay?.end().catch(() => undefined);
    await admin?.end();
  }, 40_000);

  it('(1) the registry holds the three clocks at the table\'s cadence (after the real boot)', () => {
    const jobs = new Map(app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY).list().map((j) => [j.name, j.intervalMs]));
    expect([jobs.get('seller-confirm-timeout'), jobs.get('quality-window-complete'), jobs.get('offers-expire')])
      .toEqual([CLOCK_CADENCE_MS['seller-confirm-timeout'], CLOCK_CADENCE_MS['quality-window-complete'], CLOCK_CADENCE_MS['offers-expire']]);
  });

  describe('(2) the seller-confirm timeout', () => {
    let cod = '';
    it('a `created` order past its deadline is cancelled ONCE by the clock (as the system); the 2c payload travels; the stock comes back ONCE; nothing refunded', async () => {
      cod = await placeOne(T.buyer, L.cod, '3');
      expect(await stock(L.cod)).toEqual({ q: '7.000', s: 'published' });
      const fresh = await placeOne(T.buyer2, L.cod, '1');                          // not yet due — the clock must leave it alone
      await pastDeadline(cod);
      const job = app.get(SellerConfirmTimeoutJob);
      const r1 = await job.sweep(relay, new Date(), [LIVE]);
      expect(r1).toMatchObject({ failed: 0 });
      expect(r1.acted).toBeGreaterThanOrEqual(1);
      expect(await orderRow(cod)).toMatchObject({ status: 'cancelled', cancelled_by: null });
      expect((await orderRow(fresh)).status).toBe('created');
      const ev = await cancelSideEffects(cod);
      expect(ev.payload).toMatchObject({ role: 'system', by: 'system', reason: 'seller_confirm_timeout', stockReserved: true, buyerUserId: buyer, sellerUserId: seller, currencyCode: 'INR' });
      expect(ev.payload.totalMinor).toBe((await orderRow(cod)).total);
      expect(await stock(L.cod)).toEqual({ q: '9.000', s: 'published' });        // 3 back; the fresh order still holds its 1
      expect(await ledgerKey(`refund:${cod}`)).toBe(0);                            // unpaid → nothing to refund
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.auto_cancelled' AND entity_id = $1 AND actor_user_id IS NULL`, [cod])).toBe(1);
      // a second tick changes nothing (the rule refuses a cancelled order); replays restock nothing
      const r2 = await job.sweep(relay, new Date(), [LIVE]);
      expect(r2).toMatchObject({ acted: 0, failed: 0 });
      expect(await cancelEvents(cod)).toBe(1);
      await app.get(OrderCancelledRestockHandler).handle(ev); await app.get(OrderCancelledRestockHandler).handle(ev);
      expect(await stock(L.cod)).toEqual({ q: '9.000', s: 'published' });
      expect(await count(`SELECT count(*)::int n FROM order_events WHERE order_id = $1 AND to_status = 'cancelled'`, [cod])).toBe(1);
    }, 120_000);

    it('the HOTFIX-4 payment state becomes reachable: a pay-on-delivery order the clock cancelled reads `cancelled`, an unpaid online one `expired`', async () => {
      expect((await getOrder(T.buyer, cod)).paymentState).toBe('cancelled');
      await setFlag('online_payments', true);
      try {
        const unpaid = await placeOne(T.buyer2, L.pay, '1');
        expect((await orderRow(unpaid)).status).toBe('payment_pending');
        await pastDeadline(unpaid);
        expect((await app.get(SellerConfirmTimeoutJob).sweep(relay, new Date(), [LIVE])).failed).toBe(0);
        expect((await orderRow(unpaid)).status).toBe('cancelled');
        expect((await getOrder(T.buyer2, unpaid)).paymentState).toBe('expired');
        await cancelSideEffects(unpaid);
        expect(await stock(L.pay)).toEqual({ q: '10.000', s: 'published' });
      } finally { await setFlag('online_payments', false); }
    }, 120_000);

    it('a PAID `payment_pending` order (captured, its confirm not yet relayed) cancelled by the clock is refunded to source ONCE (`refund:<id>`), zero-sum', async () => {
      await setFlag('online_payments', true);
      try {
        const o = await placeOne(T.buyer, L.pay, '2');
        const mainBefore = await mainOf(buyer);
        const paid = await payFromWallet(T.buyer, o);                             // money moved; PaymentSucceededHandler NOT yet run
        expect(await mainOf(buyer)).toBe(mainBefore - BigInt(paid.amountMinor));
        await pastDeadline(o);
        expect((await app.get(SellerConfirmTimeoutJob).sweep(relay, new Date(), [LIVE])).failed).toBe(0);
        expect((await orderRow(o)).status).toBe('cancelled');
        const ev = await cancelSideEffects(o);
        expect(await ledgerKey(`refund:${o}`)).toBe(1);
        const legs = await legsOf(`refund:${o}`);
        expect(sumLegs(legs)).toBe(0n);
        expect(escrowLeg(legs)).toBe(-BigInt(paid.amountMinor));
        expect(await mainOf(buyer)).toBe(mainBefore);                             // the wallet payment came back to the wallet
        expect(await stock(L.pay)).toEqual({ q: '10.000', s: 'published' });
        // replays + a second tick book nothing; the late confirm does not resurrect the order
        await app.get(OrderCancelledRefundHandler).handle(ev); await app.get(OrderCancelledRefundHandler).handle(ev);
        expect((await app.get(SellerConfirmTimeoutJob).sweep(relay, new Date(), [LIVE])).acted).toBe(0);
        expect(await ledgerKey(`refund:${o}`)).toBe(1);
        expect(await mainOf(buyer)).toBe(mainBefore);
        await confirmPaid(paid.paymentId);
        expect((await orderRow(o)).status).toBe('cancelled');
      } finally { await setFlag('online_payments', false); }
    }, 120_000);
  });

  describe('(3) auction orders are excluded from the 24 h timeout; the 48 h default forfeits', () => {
    it('an auction order past its 24 h acceptance deadline is NOT cancelled by the clock; past balance_due_at the default job forfeits the EMD', async () => {
      await setFlag('online_payments', true);
      try {
        const { auctionId, orderId } = await settledAuction(b3, '64000');
        expect((await orderRow(orderId)).status).toBe('payment_pending');
        expect((await settlement(auctionId)).collection).toBe('online');
        await pastDeadline(orderId);
        const r = await app.get(SellerConfirmTimeoutJob).sweep(relay, new Date(), [LIVE]);
        expect(r.failed).toBe(0);
        expect((await orderRow(orderId)).status).toBe('payment_pending');        // the clock left it alone (founder D2)
        expect(await cancelEvents(orderId)).toBe(0);
        const sellerBefore = await mainOf(seller);
        await admin.query(`ALTER TABLE auction_settlements DISABLE TRIGGER trg_as_outcome`);
        await admin.query(`UPDATE auction_settlements SET balance_due_at = now() - interval '1 minute' WHERE auction_id = $1`, [auctionId]);
        await admin.query(`ALTER TABLE auction_settlements ENABLE TRIGGER trg_as_outcome`);
        expect((await app.get(AuctionDefaultJob).sweep(relay)).failed).toBe(0);
        expect((await admin.query(`SELECT status::text s FROM auctions WHERE id = $1`, [auctionId])).rows[0].s).toBe('defaulted');
        expect(await ledgerKey(`emd-forfeit:${auctionId}`)).toBe(1);
        expect(await mainOf(seller)).toBe(sellerBefore + EMD);
        expect((await orderRow(orderId)).status).toBe('cancelled');
      } finally { await setFlag('online_payments', false); }
    }, 180_000);
  });

  describe('(4) the quality-window auto-complete releases escrow through the one settlement path', () => {
    it('a delivered order past its window completes ONCE; settle:<id> books once, zero-sum, escrow −total; a manual complete afterwards is refused', async () => {
      await setFlag('online_payments', true);
      let o = ''; let notDue = '';
      try {
        o = await placeOne(T.buyer, L.qw, '2');
        notDue = await placeOne(T.buyer2, L.qw, '1');
        for (const [tok, id] of [[T.buyer, o], [T.buyer2, notDue]] as const) await confirmPaid((await payFromWallet(tok, id)).paymentId);
      } finally { await setFlag('online_payments', false); }
      for (const id of [o, notDue]) for (const step of ['packed', 'ready', 'delivered']) {
        const r = await request(http).post(`/v1/orders/${id}/${step}`).set({ ...H(T.seller), 'idempotency-key': randomUUID() });
        expect([step, r.status, r.body.error?.code]).toEqual([step, 201, undefined]);
      }
      await admin.query(`UPDATE orders SET quality_window_ends = now() - interval '1 minute' WHERE id = $1`, [o]);
      const sellerBefore = await mainOf(seller);
      const job = app.get(AutoCompleteQualityWindowJob);
      const r1 = await job.sweep(relay, new Date(), [LIVE]);
      expect(r1).toMatchObject({ acted: 1, failed: 0 });
      expect((await orderRow(o)).status).toBe('completed');
      expect((await orderRow(notDue)).status).toBe('delivered');
      const ev = await outboxEvent('orders.order_completed', o);
      expect(ev.payload).toMatchObject({ reason: 'quality_window_closed', sellerUserId: seller, buyerUserId: buyer, currencyCode: 'INR' });
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.auto_completed' AND entity_id = $1 AND actor_user_id IS NULL`, [o])).toBe(1);
      // the payments module's consumer, as the relay hands it over → OrderSettlementService.settle (the moderator's path too)
      await uow.run(LIVE, (tx) => app.get(OrderCompletedHandler).handle(ev, tx));
      expect(await ledgerKey(`settle:${o}`)).toBe(1);
      const legs = await legsOf(`settle:${o}`);
      expect(sumLegs(legs)).toBe(0n);
      expect(escrowLeg(legs)).toBe(-BigInt((await orderRow(o)).total));
      expect(await mainOf(seller)).toBe(sellerBefore + BigInt((await orderRow(o)).total));   // buyer_charges off: the whole total is goods
      // a second tick, a replayed event and a manual completion all settle nothing more
      expect((await job.sweep(relay, new Date(), [LIVE])).acted).toBe(0);
      await uow.run(LIVE, (tx) => app.get(OrderCompletedHandler).handle(ev, tx));
      const manual = await request(http).post(`/v1/orders/${o}/complete`).set(H(T.buyer));
      expect([manual.status, manual.body.error?.code]).toEqual([409, 'ORDER_ILLEGAL_TRANSITION']);
      expect(await ledgerKey(`settle:${o}`)).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [o])).toBe(1);
      // FAIL CLOSED (order-clocks.ts QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT): a PAY-ON-DELIVERY order past its window is NOT completed by the
      // clock — its settlement would credit the seller from an escrow that never held the money (the live probe: escrow 0 → −total)
      const cod = await placeOne(T.buyer, L.qw, '1');
      expect((await request(http).post(`/v1/orders/${cod}/confirm`).set({ ...H(T.seller), 'idempotency-key': randomUUID() })).status).toBe(201);
      for (const step of ['packed', 'ready', 'delivered']) expect((await request(http).post(`/v1/orders/${cod}/${step}`).set({ ...H(T.seller), 'idempotency-key': randomUUID() })).status).toBe(201);
      await admin.query(`UPDATE orders SET quality_window_ends = now() - interval '1 minute' WHERE id = $1`, [cod]);
      expect(await job.sweep(relay, new Date(), [LIVE])).toMatchObject({ acted: 0, failed: 0 });
      expect((await orderRow(cod)).status).toBe('delivered');
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'orders.order_completed' AND aggregate_id = $1`, [cod])).toBe(0);
      expect(await ledgerKey(`settle:${cod}`)).toBe(0);
      // D3: the BUYER's completion of a delivered order is already a legal act (the route allows the buyer) — no new route this wave
      const byBuyer = await request(http).post(`/v1/orders/${notDue}/complete`).set(H(T.buyer2));
      expect(byBuyer.status).toBe(201);
    }, 180_000);
  });

  describe('(5) offer expiry', () => {
    it('an offer past expires_at becomes `expired` ONCE; the tenant list is read as kv_relay (`tenants` only); the offer read carries the listing\'s currency', async () => {
      const offers = app.get(ListingOfferService);
      const made = await offers.make(LIVE, buyer, key(), { listingId: L.offer, quantity: '2', offeredPriceMinor: '850000', expiresAt: iso(60_000) } as never);
      expect(made).toMatchObject({ status: 'open', currencyCode: 'INR' });
      expect(await app.get(ListingOfferRepository).liveTenants(relay)).toContain(LIVE);
      const later = new Date(Date.now() + 3600_000);
      const job = app.get(ExpireOffersJob);
      expect(await job.sweep(relay, later, [LIVE])).toMatchObject({ expired: 1, failed: 0 });
      expect((await admin.query(`SELECT status FROM listing_offers WHERE id = $1`, [made.offerId])).rows[0].status).toBe('expired');
      expect(await job.sweep(relay, later, [LIVE])).toMatchObject({ expired: 0, failed: 0 });
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type LIKE '%expired%'`, [made.offerId])).toBe(1);
      expect((await offers.getById(LIVE, { userId: buyer, canModerate: false }, made.offerId)).currencyCode).toBe('INR');
    }, 60_000);
  });

  describe('(6) two auctions of one organisation closing in ONE sweep', () => {
    it('both settle, each with its own order number (the random bits, not the timestamp prefix)', async () => {
      const ids: string[] = [];
      for (const hammer of ['63000', '63500']) {
        const listingId = await makeAuctionListing(admin, LIVE, seller, `Ghee pair ${randomUUID().slice(0, 4)}`, 200, 'kg');
        const c = await auctions().create(LIVE, { userId: seller }, key(), { listingId, kind: 'english_open', startPriceMinor: '61000', minIncrementMinor: '500',
          emdMinor: EMD.toString(), startsAt: iso(-1000), endsAt: iso(3600_000) });
        await auctions().open(LIVE, c.auctionId);
        await app.get(BidService).placeBid(LIVE, b2, c.auctionId, key(), hammer, '10.0.0.2');
        ids.push(c.auctionId);
      }
      await admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])`, [ids]);
      await app.get(CloseEndedAuctionsJob).sweep(relay, new Date());              // ONE sweep, ONE `now` for both
      const rows = (await admin.query(`SELECT a.status::text s, o.order_no, o.id FROM auctions a JOIN orders o ON o.id = a.settled_order_id WHERE a.id = ANY($1::uuid[])`, [ids])).rows;
      expect(rows.map((x) => x.s)).toEqual(['settled', 'settled']);
      expect(new Set(rows.map((x) => x.order_no)).size).toBe(2);
      for (const x of rows) expect(x.order_no).toBe(`KV${new Date().getUTCFullYear()}-${String(x.id).replace(/-/g, '').slice(-8).toUpperCase()}`);
      // my-bids carries the lot's currency (Rule Zero)
      const mine = await app.get(MyBidsReadModel).forBidder(LIVE, b2, { limit: 20 });
      expect(mine.items.length).toBeGreaterThanOrEqual(2);
      for (const it of mine.items) expect(it.currencyCode).toBe('INR');
    }, 180_000);
  });

  describe('(7) the buyer\'s order reads name the organisation, never a person', () => {
    let o = '';
    it('GET orders (buyer): organisation, currencyCode, paymentState, acceptanceDeadline — no counterparty, no person uuid', async () => {
      o = await placeOne(T.buyer2, L.reads, '1');
      const confirm = await request(http).post(`/v1/orders/${o}/confirm`).set({ ...H(T.seller), 'idempotency-key': randomUUID() });
      expect(confirm.status).toBe(201);
      const list = await request(http).get('/v1/orders?role=buyer&limit=50').set(H(T.buyer2));
      expect(list.status).toBe(200);
      const row = list.body.data.find((x: { id: string }) => x.id === o);
      const slug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
      expect(row).toMatchObject({ currencyCode: 'INR', paymentState: 'none', organisation: { slug, name: `Anand FPO hf5 ${LIVE.slice(0, 4)}` } });
      expect(row.acceptanceDeadline).toBeTruthy();
      for (const k of ['counterparty', 'sellerUserId', 'buyerUserId']) expect(row).not.toHaveProperty(k);
      const json = JSON.stringify(list.body.data);
      expect(json).not.toContain(seller);
      expect(json).not.toMatch(/Ramesh/);
      // the seller's own list keeps its worklist counterparty (the buyer)
      const sellerList = await request(http).get('/v1/orders?role=seller&limit=50').set(H(T.seller));
      expect(sellerList.body.data.find((x: { id: string }) => x.id === o).counterparty).toBe(buyer2);
    });
    it('GET orders/:id (buyer): no sellerUserId / buyerUserId, the organisation instead; the seller keeps both', async () => {
      const asBuyer = await getOrder(T.buyer2, o);
      expect(asBuyer).not.toHaveProperty('sellerUserId'); expect(asBuyer).not.toHaveProperty('buyerUserId');
      expect(asBuyer.organisation).toMatchObject({ name: `Anand FPO hf5 ${LIVE.slice(0, 4)}` });
      expect(JSON.stringify(asBuyer)).not.toContain(seller);
      const asSeller = await getOrder(T.seller, o);
      expect(asSeller).toMatchObject({ sellerUserId: seller, buyerUserId: buyer2 });
    });
    it('GET orders/:id/events (buyer): ROLE labels only — never full_name, never a uuid; the seller keeps the names', async () => {
      const asBuyer = await request(http).get(`/v1/orders/${o}/events`).set(H(T.buyer2));
      expect(asBuyer.status).toBe(200);
      expect(asBuyer.body.data.map((e: { toStatus: string; actorRole: string }) => [e.toStatus, e.actorRole]).sort()).toEqual([['confirmed', 'seller'], ['created', 'buyer']]);
      const json = JSON.stringify(asBuyer.body.data);
      expect(json).not.toMatch(/Ramesh|actorName|actorUserId|"note"/);
      expect(json).not.toMatch(UUID);
      const asSeller = (await request(http).get(`/v1/orders/${o}/events`).set(H(T.seller))).body.data;
      expect(asSeller.find((e: { toStatus: string }) => e.toStatus === 'confirmed')).toMatchObject({ actorName: 'Ramesh Kumar Patel', actorRole: 'seller', actorUserId: seller });
    });
  });

  describe('(8) D4 — the deposit on a cancelled auction order', () => {
    it('a PAID auction order cancelled by the buyer → the balance refunded (2c) AND the applied EMD returned, each ONCE; escrow nets to zero; a replay books nothing', async () => {
      await setFlag('online_payments', true);
      try {
        const { auctionId, listingId, orderId } = await settledAuction(b1, '65500', b2);
        expect((await orderRow(orderId)).status).toBe('payment_pending');
        const paid = await payFromWallet(T.b1, orderId);
        expect(BigInt(paid.amountMinor)).toBe(13_100_000n - EMD);                   // the balance: total − applied EMD
        await confirmPaid(paid.paymentId);
        await app.get(AuctionPaymentSucceededHandler).handle(await outboxEvent('payments.payment_succeeded', paid.paymentId));
        expect((await settlement(auctionId)).outcome).toBe('paid');
        const before = await mainOf(b1);
        const c = await request(http).post(`/v1/orders/${orderId}/cancel`).set({ ...H(T.b1), 'idempotency-key': randomUUID() }).send(await REASON());
        expect(c.status).toBe(201);
        const ev = await cancelSideEffects(orderId);
        expect(await ledgerKey(`refund:${orderId}`)).toBe(1);
        expect(await ledgerKey(`emd-return:${orderId}`)).toBe(1);
        expect(await ledgerKey(`emd-forfeit:${auctionId}`)).toBe(0);
        const ret = await legsOf(`emd-return:${orderId}`);
        expect(sumLegs(ret)).toBe(0n);
        expect(escrowLeg(ret)).toBe(-EMD);
        expect(await mainOf(b1)).toBe(before + 13_100_000n);                       // the balance AND the deposit — the whole order value back
        // escrow for this order nets to zero: wallet pay + EMD apply in, refund + EMD return out
        let net = 0n;
        for (const k of [`walletpay:${orderId}`, `emd-apply:${auctionId}`, `refund:${orderId}`, `emd-return:${orderId}`]) net += escrowLeg(await legsOf(k));
        expect(net).toBe(0n);
        expect(await settlement(auctionId)).toMatchObject({ outcome: 'paid', fft: false });   // 0186: an outcome moves once — `paid` stays
        expect(await count(`SELECT count(*)::int n FROM auction_events WHERE auction_id = $1 AND event_code = 'paid_order_cancelled'`, [auctionId])).toBe(1);
        expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'auction.emd_returned' AND entity_id = $1`, [auctionId])).toBe(1);
        expect(await stock(listingId)).toEqual({ q: '200.000', s: 'published' });   // the lot is back on sale
        // the relay delivers it again — nothing more moves
        for (let i = 0; i < 2; i++) { await app.get(AuctionOrderCancelledHandler).handle(ev); await app.get(OrderCancelledRefundHandler).handle(ev); }
        expect(await ledgerKey(`emd-return:${orderId}`)).toBe(1);
        expect(await ledgerKey(`refund:${orderId}`)).toBe(1);
        expect(await mainOf(b1)).toBe(before + 13_100_000n);
        expect(await stock(listingId)).toEqual({ q: '200.000', s: 'published' });
      } finally { await setFlag('online_payments', false); }
    }, 180_000);

    it('the relay delivering the cancel BEFORE the settlement\'s `paid` (a seller declines a paid order) still returns it — the outcome is recorded `returned`', async () => {
      await setFlag('online_payments', true);
      try {
        const { auctionId, orderId } = await settledAuction(b2, '66000');
        const paid = await payFromWallet(T.b2, orderId);
        await confirmPaid(paid.paymentId);                                           // the ORDER is paid (confirmed); the auction consumer not yet run
        expect((await settlement(auctionId)).outcome).toBe('open');
        const before = await mainOf(b2);
        expect((await request(http).post(`/v1/orders/${orderId}/cancel`).set({ ...H(T.seller), 'idempotency-key': randomUUID() }).send({})).status).toBe(201);
        await cancelSideEffects(orderId);
        expect(await settlement(auctionId)).toMatchObject({ outcome: 'returned', ret: true });
        expect(await ledgerKey(`emd-return:${orderId}`)).toBe(1);
        expect(await mainOf(b2)).toBe(before + BigInt(paid.amountMinor) + EMD);
        await app.get(AuctionPaymentSucceededHandler).handle(await outboxEvent('payments.payment_succeeded', paid.paymentId));   // late: changes nothing
        expect((await settlement(auctionId)).outcome).toBe('returned');
      } finally { await setFlag('online_payments', false); }
    }, 180_000);

    it('an UNPAID auction order cancelled by the buyer still FORFEITS the deposit to the seller (the founder\'s earlier ruling)', async () => {
      await setFlag('online_payments', true);
      try {
        const { auctionId, orderId } = await settledAuction(b3, '64500');
        const sellerBefore = await mainOf(seller); const winnerBefore = await mainOf(b3);
        expect((await request(http).post(`/v1/orders/${orderId}/cancel`).set({ ...H(T.b3), 'idempotency-key': randomUUID() }).send(await REASON())).status).toBe(201);
        const ev = await cancelSideEffects(orderId);
        expect(await ledgerKey(`emd-forfeit:${auctionId}`)).toBe(1);
        expect(await ledgerKey(`emd-return:${orderId}`)).toBe(0);
        expect(await mainOf(seller)).toBe(sellerBefore + EMD);
        expect(await mainOf(b3)).toBe(winnerBefore);
        expect((await settlement(auctionId)).outcome).toBe('defaulted');
        await app.get(AuctionOrderCancelledHandler).handle(ev);
        expect(await ledgerKey(`emd-forfeit:${auctionId}`)).toBe(1);
      } finally { await setFlag('online_payments', false); }
    }, 180_000);
  });

  describe('(9) the cancel honours Idempotency-Key', () => {
    it('a replay with the same key returns the first answer and acts nothing; another key is refused by the state machine', async () => {
      const o = await placeOne(T.buyer, L.reads, '1');
      const k = randomUUID();
      const body = await REASON();
      const a = await request(http).post(`/v1/orders/${o}/cancel`).set({ ...H(T.buyer), 'idempotency-key': k }).send(body);
      const b = await request(http).post(`/v1/orders/${o}/cancel`).set({ ...H(T.buyer), 'idempotency-key': k }).send(body);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(b.body.data).toEqual(a.body.data);
      expect(await count(`SELECT count(*)::int n FROM order_events WHERE order_id = $1 AND to_status = 'cancelled'`, [o])).toBe(1);
      expect(await cancelEvents(o)).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.cancelled' AND entity_id = $1`, [o])).toBe(1);
      const other = await request(http).post(`/v1/orders/${o}/cancel`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send(body);
      // PC-56 STORE-3a: a cancel of an order that has moved past `ready` (here: already cancelled) is the STATE MACHINE's refusal now
      // (ORDER_ILLEGAL_TRANSITION, 409) — it answered ORDER_FORBIDDEN (403), the "not a party" code, before (order.entity.ts cancel)
      expect([other.status, other.body.error?.code]).toEqual([409, 'ORDER_ILLEGAL_TRANSITION']);
      await cancelSideEffects(o);
    });
  });

  describe('(10) currency from the data', () => {
    it('an accepted offer becomes an order in the LISTING\'s currency (USD), numbered from its random bits', async () => {
      const offerId = randomUUID();
      const ev: OutboxEvent = { id: '0', tenantId: USDT, aggregateType: 'listing_offer', aggregateId: offerId, eventType: 'offers.offer_accepted',
        payload: { v: 1, offerId, listingId: L.usd, buyerUserId: usdBuyer, agreedPriceMinor: '3000', quantity: '2' } };
      await uow.run(USDT, (tx) => app.get(OfferAcceptedHandler).handle(ev, tx), { userId: 'system' });
      const r = (await admin.query(`SELECT id, currency_code, source, order_no, total_minor::text t FROM orders WHERE tenant_id = $1 AND offer_id = $2`, [USDT, offerId])).rows[0];
      expect(r).toMatchObject({ currency_code: 'USD', source: 'offer', t: '6000' });
      expect(r.order_no).toBe(`KV${new Date().getUTCFullYear()}-${String(r.id).replace(/-/g, '').slice(-8).toUpperCase()}`);
    });
  });
});
