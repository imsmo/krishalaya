// apps/api/src/__tests__/store3c-auctions-group.integration.spec.ts · PC-56 STORE-3c — DEPOSITS, BALANCES AND POOLED LOTS, LIVE. The real AppModule
// over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the clocks are handed a pool that LOGS IN as
// kv_relay (the runner's shape), and the outbox consumers are driven with the outbox rows the API wrote, exactly as the relay hands them over. Own
// fixtures (never the shared makeCategory). `auctions` (seed OFF — Law 10) and `online_payments` are switched ON for THIS spec's tenant only (an
// allow-list) and every touched flag is restored afterwards.
//
// What it proves (brief §C7):
//   (1) D2 the winner pays the BALANCE: an intent for the DUE (total − EMD) succeeds and the sandbox capture books `pay:<paymentId>`; escrow holds
//       EMD + balance = the total; an intent for the TOTAL → 409 ORDER_PAYMENT_AMOUNT_MISMATCH; a capture whose payment carries the TOTAL (a forged
//       payment row) → 409 `amount_drift`, nothing booked; wallet pay on the DUE when the wallet covers the due only;
//   (2) D6 a PAID auction order cancelled by the buyer → ONE `emd-return:<orderId>`, ONE `refund:<orderId>`, the settlement `cancelled_paid`
//       (0212) with the return txn, escrow nets 0 for the order; a replay moves nothing;
//   (3) D4 the PUBLIC list: the groups partition; no reserve / winner / order id / identity; flag OFF → 404; `mine` without a session → 401 and
//       with one → the caller's auctions only; the members' list hides settledOrderId / winningBidId / cancelReason from a plain member and keeps
//       them for the seller;
//   (4) C-8 my-bids PER AUCTION with the deposit as the LEDGER has it: `held` while live, `released` (with its time) for a loser after close,
//       `applied` for the winner (amountDueMinor = total − EMD), `forfeited` after the default clock, `returned` after a seller cancel;
//   (5) D1 a sealed lower (or equal) re-bid → 409 BID_SEALED_MUST_RAISE {yourLastMinor}; a higher one accepted; ONE EMD hold;
//   (6) D3 the PUBLIC group-lot read: the pledger COUNT, no identity, no coordinator id; flag OFF → 404;
//   (7) D3 the deadline clock (on the kv_relay pool) cancels an unfilled `pledging` lot past its deadline ONCE with `target_missed`, by the system;
//       leaves a `ready` lot and a not-yet-due lot; writes no ledger row;
//   (8) D5 OFFLINE: the seller silent at balanceDueAt → the order cancelled by the system, `emd-return:<auctionId>` once (escrow → winner,
//       zero-sum), outcome `returned`, the lot restocked; a CONFIRMED offline order → outcome `paid`, nothing moves;
//   (9) D7 the race: the capture landed (a `success` payment row) but the order is still `payment_pending` when the buyer cancels → the EMD
//       RETURNED (not forfeited) and the balance refunded, once each;
//   (10) B9 `bid.outbid` → a notification row for the outbid bidder, from its template (seed 0007);
//   (11) the relay gate runs as its own spec (group B).
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
import { OutboxEvent, OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { GatewayRegistry } from '../modules/payments/gateway/gateway.registry';
import { SandboxGateway } from '../modules/payments/gateway/sandbox.gateway';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { OrderCancelledRestockHandler } from '../modules/orders/events/handlers/order-cancelled-restock.handler';
import { OrderCancelledRefundHandler } from '../modules/payments/events/handlers/order-cancelled-refund.handler';
import { AuctionService } from '../modules/auctions/services/auction.service';
import { BidService } from '../modules/auctions/services/bid.service';
import { AuctionDefaultJob } from '../modules/auctions/jobs/auctions.cadence-jobs';
import { AuctionOrderCancelledHandler } from '../modules/auctions/events/handlers/order-cancelled.handler';
import { AuctionPaymentSucceededHandler } from '../modules/auctions/events/handlers/payment-succeeded.handler';
import { GroupLotService } from '../modules/group-lots/services/group-lot.service';
import { GroupLotDeadlineJob } from '../modules/group-lots/jobs/deadline.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const H = 3_600_000;

run('PC-56 STORE-3c · deposits, balances and pooled lots (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relay: Pool; let cache: CacheService; let uow: UnitOfWork; let wallet: WalletPort; let sandbox: SandboxGateway;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID();
  let slug = '';
  const U: Record<string, string> = {};
  const T: Record<string, string> = {};
  let product = '';
  const EMD = 1_000_000n;
  const TOTAL = 13_100_000n;                                   // 200 kg × 65,500 per kg
  const DUE = TOTAL - EMD;
  const FUND = 50_000_000n;
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  const key = () => `k-${randomUUID()}`;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  async function setFlag(k: string, on: boolean): Promise<void> {
    if (!flagBackup.some((f) => f.key === k)) {
      const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0];
      if (row) flagBackup.push(row);
    }
    // an ALLOW-LIST for this spec's tenant — never a platform-wide switch
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 0, rules = $3::jsonb WHERE key = $1`, [k, on, JSON.stringify(on ? { tenant_ids: [LIVE] } : {})]);
    for (const c of [`flag:${k}`, `flagstale:${k}`, 'flags:all', `flagctx:${LIVE}`]) await cache.del(c);
  }
  async function role(userId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, LIVE, code]);
  }
  const Hd = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE });
  const pub = () => ({ 'x-tenant-slug': slug });
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const ledgerKey = (k: string) => count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [k]);
  const legsOf = async (k: string) => (await admin.query(
    `SELECT w.owner_kind, w.account_code, e.amount_minor::text a FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
      WHERE t.idempotency_key = $1 ORDER BY w.owner_kind, w.account_code`, [k])).rows as Array<{ owner_kind: string; account_code: string; a: string }>;
  const sumLegs = (legs: Array<{ a: string }>) => legs.reduce((s, l) => s + BigInt(l.a), 0n);
  const escrowLeg = (legs: Array<{ owner_kind: string; account_code: string; a: string }>) => legs.filter((l) => l.owner_kind === 'platform' && l.account_code === 'escrow').reduce((s, l) => s + BigInt(l.a), 0n);
  const mainOf = async (userId: string) => BigInt((await admin.query(`SELECT COALESCE(sum(cached_balance_minor),0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main' AND currency_code='INR'`, [userId])).rows[0].b);
  const settlement = async (auctionId: string) => (await admin.query(`SELECT outcome, collection, emd_return_txn_id IS NOT NULL ret, emd_forfeit_txn_id IS NOT NULL fft FROM auction_settlements WHERE auction_id = $1`, [auctionId])).rows[0];
  const orderRow = async (id: string) => (await admin.query(`SELECT status::text, cancelled_by, total_minor::text total FROM orders WHERE id = $1`, [id])).rows[0];
  const stock = async (id: string) => (await admin.query(`SELECT quantity_available::text q, status::text s FROM listings WHERE id = $1`, [id])).rows[0] as { q: string; s: string };
  async function outboxEvent(eventType: string, aggregateId: string): Promise<OutboxEvent> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0];
    expect(r).toBeDefined();
    return { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
  }
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
    await app.get(AuctionPaymentSucceededHandler).handle(ev);
  }
  async function fund(userId: string, amount: bigint): Promise<void> {
    await uow.run(LIVE, (tx) => wallet.post(tx, { tenantId: LIVE, txnType: 'refund', idempotencyKey: `s3c-fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Gateway), amountMinor: -amount }, { account: userMain(userId), amountMinor: amount }] }), { userId: 'system' });
  }
  const intent = (token: string, orderId: string, amountMinor: bigint, attempt = 1) =>
    request(http).post('/v1/payments').set({ ...Hd(token), 'idempotency-key': `order-pay:${orderId}:${attempt}` })
      .send({ purpose: 'direct_order', amountMinor: amountMinor.toString(), currencyCode: 'INR', referenceType: 'order', referenceId: orderId });
  const sandboxHook = (body: Record<string, unknown>) => { const raw = JSON.stringify(body); return request(http).post('/v1/payments/webhooks/sandbox').set({ 'content-type': 'application/json', 'x-webhook-signature': sandbox.sign(raw) }).send(raw); };
  const captureVia = (gwOrder: string, payId: string, amount: bigint) => sandboxHook({ id: `evt_${randomUUID()}`, event: 'payment.captured', order_id: gwOrder, payment_id: payId, amount: Number(amount), currency: 'INR', method: 'upi' });
  const REASON = async () => ({ reasonId: (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL AND code = 'changed_mind'`)).rows[0].id as string });
  /** Push a settlement's balance due time into the past (the 0186 trigger freezes money facts — disabled for the one UPDATE, as the 11a spec does). */
  async function pastDue(auctionId: string): Promise<void> {
    await admin.query(`ALTER TABLE auction_settlements DISABLE TRIGGER trg_as_outcome`);
    try { await admin.query(`UPDATE auction_settlements SET balance_due_at = now() - interval '1 minute' WHERE auction_id = $1`, [auctionId]); }
    finally { await admin.query(`ALTER TABLE auction_settlements ENABLE TRIGGER trg_as_outcome`); }
  }

  // --- auctions ---
  const auctions = () => app.get(AuctionService);
  const bid = (bidder: string, auctionId: string, amount: string) => app.get(BidService).placeBid(LIVE, bidder, auctionId, key(), amount, '10.0.0.3');
  async function openAuction(o: { kind?: 'english_open' | 'sealed'; startsIn?: number } = {}): Promise<{ auctionId: string; listingId: string }> {
    const listingId = await makeAuctionListing(admin, LIVE, U.seller, `Ghee s3c ${randomUUID().slice(0, 4)}`, 200, 'kg');
    const c = await auctions().create(LIVE, { userId: U.seller }, key(), { listingId, kind: o.kind ?? 'english_open', startPriceMinor: '61000', reservePriceMinor: '62000', minIncrementMinor: '500',
      emdMinor: EMD.toString(), startsAt: o.startsIn ? iso(o.startsIn) : iso(-1000), endsAt: iso((o.startsIn ?? 0) + H) });
    if (!o.startsIn) expect(await auctions().open(LIVE, c.auctionId)).toBe(true);
    return { auctionId: c.auctionId, listingId };
  }
  async function settledAuction(winner: string, hammer = '65500', loser?: string): Promise<{ auctionId: string; listingId: string; orderId: string }> {
    const { auctionId, listingId } = await openAuction();
    if (loser) await bid(loser, auctionId, '61000');
    await bid(winner, auctionId, hammer);
    await admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id = $1`, [auctionId]);
    expect(await auctions().closeAndResolve(LIVE, auctionId)).toBe(true);
    const orderId = (await admin.query(`SELECT settled_order_id FROM auctions WHERE id = $1`, [auctionId])).rows[0].settled_order_id as string;
    expect(orderId).toMatch(UUID);
    return { auctionId, listingId, orderId };
  }
  const myBids = async (token: string) => {
    const r = await request(http).get('/v1/auctions/my-bids').set(Hd(token));
    expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
    return r.body.data as Array<Record<string, any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const rowFor = (rows: Array<Record<string, any>>, auctionId: string) => rows.find((r) => r.auctionId === auctionId);   // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relay = new Pool({ connectionString: u.toString(), max: 2, application_name: 'store3c-clocks' });
    expect((await relay.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');
    await makeTenant(admin, LIVE, `Anand FPO s3c ${LIVE.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = $1`, [LIVE, JUNAGADH]);
    slug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    const names = ['seller', 'member', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 's1', 'coord', 'f1', 'f2'];
    const ids = await Promise.all(names.map(() => makeUser(admin)));
    names.forEach((n, i) => { U[n] = ids[i]; });
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [U.seller]);
    await admin.query(`UPDATE users SET full_name = 'Bhavna Bidder' WHERE id = $1`, [U.b5]);
    await role(U.seller, 'farmer');
    for (const n of names.filter((x) => x !== 'seller')) await role(U[n], 'customer');
    for (const n of ['coord', 'f1', 'f2']) await role(U[n], 'farmer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs3c' + randomUUID().replace(/-/g, '').slice(0, 12);
    const catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s3c', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Vanthali GG-20 Groundnut s3c', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin (foreign processes on IPv4 ephemeral ports)
    uow = app.get<UnitOfWork>(UNIT_OF_WORK); wallet = app.get<WalletPort>(WALLET_SERVICE);
    sandbox = app.get(GatewayRegistry).get('sandbox') as SandboxGateway;
    for (const n of names.filter((x) => x !== 'seller')) T[n] = mintToken(app, { userId: U[n], tenantId: LIVE, roles: ['customer'], perms: ['order.create', 'auction.bid'] });
    T.seller = mintToken(app, { userId: U.seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create', 'auction.create'] });
    for (const n of ['b1', 'b2', 'b3', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 's1']) await fund(U[n], FUND);
    await fund(U.b4, EMD);                                     // b4 holds exactly the deposit — then exactly the balance (case 1)
    await setFlag('auctions', true); await setFlag('online_payments', false); await setFlag('buyer_charges', false); await setFlag('commission_split', false);
    await setFlag('group_lots', true);
  }, 240_000);
  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id=$1`, [LIVE]).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await relay?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  }, 60_000);

  // ------------------------------------------------------------------------------------------------------------------------------------------
  const X: Record<string, { auctionId: string; listingId: string; orderId: string }> = {};
  let paidPaymentId = '';

  describe('(1) D2 — the winner pays the BALANCE', () => {
    it('the order reads amountDueMinor = total − EMD; an intent for the TOTAL → 409 ORDER_PAYMENT_AMOUNT_MISMATCH; for the DUE → booked `pay:<id>`; escrow = EMD + balance = total', async () => {
      await setFlag('online_payments', true);
      X.paid = await settledAuction(U.b1, '65500', U.b2);
      const o = (await request(http).get(`/v1/orders/${X.paid.orderId}`).set(Hd(T.b1))).body.data;
      expect([o.status, o.totalMinor, o.amountDueMinor, o.depositAppliedMinor]).toEqual(['payment_pending', TOTAL.toString(), DUE.toString(), EMD.toString()]);
      // my-bids (4, the winner before paying): applied, and the live amount due
      const mine = rowFor(await myBids(T.b1), X.paid.auctionId)!;
      expect(mine.emd).toMatchObject({ state: 'applied', amountMinor: EMD.toString() });
      expect(mine.won).toBe(true);
      expect(mine.settlement).toMatchObject({ orderId: X.paid.orderId, outcome: 'open', collection: 'online', emdAppliedMinor: EMD.toString(), balanceDueMinor: DUE.toString(), amountDueMinor: DUE.toString() });
      const bad = await intent(T.b1, X.paid.orderId, TOTAL, 1);
      expect([bad.status, bad.body.error?.code]).toEqual([409, 'ORDER_PAYMENT_AMOUNT_MISMATCH']);
      const ok = await intent(T.b1, X.paid.orderId, DUE, 2);
      expect([ok.status, ok.body.error?.code]).toEqual([201, undefined]);
      paidPaymentId = ok.body.data.paymentId;
      expect((await captureVia(ok.body.data.gatewayOrderId, `pay_${paidPaymentId.slice(-12)}`, DUE)).status).toBe(200);
      expect(await ledgerKey(`pay:${paidPaymentId}`)).toBe(1);
      const escrow = escrowLeg(await legsOf(`emd-apply:${X.paid.auctionId}`)) + escrowLeg(await legsOf(`pay:${paidPaymentId}`));
      expect(escrow).toBe(TOTAL);
      await confirmPaid(paidPaymentId);
      expect((await orderRow(X.paid.orderId)).status).toBe('confirmed');
      expect((await settlement(X.paid.auctionId)).outcome).toBe('paid');
    }, 180_000);

    it('a capture whose payment row carries the TOTAL (forged) → 409 `amount_drift`; nothing is booked', async () => {
      X.forged = await settledAuction(U.b3, '65500');
      const i = await intent(T.b3, X.forged.orderId, DUE, 1);
      expect(i.status).toBe(201);
      const pid = i.body.data.paymentId as string;
      await admin.query(`UPDATE payments SET amount_minor = $2 WHERE id = $1`, [pid, TOTAL.toString()]);   // the forged row: the TOTAL
      const r = await captureVia(i.body.data.gatewayOrderId, `pay_${pid.slice(-12)}`, TOTAL);
      expect([r.status, r.body.error?.code, r.body.error?.details?.reason]).toEqual([409, 'PAYMENT_ORDER_REFERENCE_INVALID', 'amount_drift']);
      expect(await ledgerKey(`pay:${pid}`)).toBe(0);
      expect((await orderRow(X.forged.orderId)).status).toBe('payment_pending');
    }, 120_000);

    it('wallet pay charges the DUE: a wallet that covers the BALANCE only (not the total) pays; escrow = total', async () => {
      X.wallet = await settledAuction(U.b4, '65500');
      expect(await mainOf(U.b4)).toBe(0n);                                       // the deposit moved to Hold, then into escrow
      await fund(U.b4, DUE - 1n);
      const short = await request(http).post(`/v1/orders/${X.wallet.orderId}/pay-from-wallet`).set({ ...Hd(T.b4), 'idempotency-key': randomUUID() });
      expect([short.status, short.body.error?.code]).toEqual([422, 'WALLET_INSUFFICIENT_BALANCE']);
      await fund(U.b4, 1n);                                                       // now exactly the balance — never the total
      const pay = await request(http).post(`/v1/orders/${X.wallet.orderId}/pay-from-wallet`).set({ ...Hd(T.b4), 'idempotency-key': randomUUID() });
      expect([pay.status, pay.body.data?.amountMinor]).toEqual([201, DUE.toString()]);
      expect(await mainOf(U.b4)).toBe(0n);
      expect(escrowLeg(await legsOf(`emd-apply:${X.wallet.auctionId}`)) + escrowLeg(await legsOf(`walletpay:${X.wallet.orderId}`))).toBe(TOTAL);
    }, 120_000);
  });

  describe('(2) D6 — a PAID auction order cancelled → `cancelled_paid`', () => {
    it('ONE emd-return:<orderId>, ONE refund:<orderId>, the settlement `cancelled_paid` with its return txn; escrow nets 0; a replay moves nothing', async () => {
      const before = await mainOf(U.b1);
      const c = await request(http).post(`/v1/orders/${X.paid.orderId}/cancel`).set({ ...Hd(T.b1), 'idempotency-key': randomUUID() }).send(await REASON());
      expect(c.status).toBe(201);
      const ev = await cancelSideEffects(X.paid.orderId);
      expect(await ledgerKey(`emd-return:${X.paid.orderId}`)).toBe(1);
      expect(await ledgerKey(`refund:${X.paid.orderId}`)).toBe(1);
      expect(await ledgerKey(`emd-forfeit:${X.paid.auctionId}`)).toBe(0);
      expect(sumLegs(await legsOf(`emd-return:${X.paid.orderId}`))).toBe(0n);
      expect(await settlement(X.paid.auctionId)).toMatchObject({ outcome: 'cancelled_paid', ret: true, fft: false });
      expect(await mainOf(U.b1)).toBe(before + EMD);                              // the deposit back to the wallet; the balance to its source (the gateway)
      let net = 0n;
      for (const k of [`emd-apply:${X.paid.auctionId}`, `pay:${paidPaymentId}`, `refund:${X.paid.orderId}`, `emd-return:${X.paid.orderId}`]) net += escrowLeg(await legsOf(k));
      expect(net).toBe(0n);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'auction.emd_returned' AND entity_id = $1`, [X.paid.auctionId])).toBe(1);
      for (let i = 0; i < 2; i++) { await app.get(AuctionOrderCancelledHandler).handle(ev); await app.get(OrderCancelledRefundHandler).handle(ev); }
      expect(await ledgerKey(`emd-return:${X.paid.orderId}`)).toBe(1);
      expect(await ledgerKey(`refund:${X.paid.orderId}`)).toBe(1);
      expect((await settlement(X.paid.auctionId)).outcome).toBe('cancelled_paid');
      // my-bids (4): the winner reads the deposit RETURNED and the outcome
      const mine = rowFor(await myBids(T.b1), X.paid.auctionId)!;
      expect(mine.emd.state).toBe('returned');
      expect(mine.settlement.outcome).toBe('cancelled_paid');
    }, 180_000);
  });

  describe('(4) C-8 — my-bids per auction, the deposit as the LEDGER has it', () => {
    it('`released` with its time for a LOSER after the close (never the rule\'s "held"); ONE row per auction, newest first; no other bidder named', async () => {
      const rows = await myBids(T.b2);
      const r = rowFor(rows, X.paid.auctionId)!;
      expect(r.emd.state).toBe('released');
      expect(r.emd.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(r.emdHeldMinor).toBe('0');
      expect([r.won, r.settlement, r.myBestMinor, r.myBidCount, r.currencyCode, r.listingTitle]).toEqual([false, null, '61000', 1, 'INR', expect.stringMatching(/^Ghee s3c/)]);
      expect(rows.filter((x) => x.auctionId === X.paid.auctionId)).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(U.b1);
    });
    it('`held` while live (its amount = the ledger\'s hold); `forfeited` after the default clock; `returned` after a seller cancel', async () => {
      X.live = await openAuction() as typeof X.live;
      await bid(U.b5, X.live.auctionId, '61000');
      const live = rowFor(await myBids(T.b5), X.live.auctionId)!;
      expect(live.emd).toMatchObject({ state: 'held', amountMinor: EMD.toString() });
      expect([live.isOpen, live.leading, live.outbid, live.minNextBidMinor]).toEqual([true, true, false, '61500']);
      // forfeited: an online balance unpaid at its due time — the default clock on the kv_relay pool
      X.forfeit = await settledAuction(U.b6, '65000');
      await pastDue(X.forfeit.auctionId);
      expect((await app.get(AuctionDefaultJob).sweep(relay)).failed).toBe(0);
      expect((await settlement(X.forfeit.auctionId)).outcome).toBe('defaulted');
      expect(rowFor(await myBids(T.b6), X.forfeit.auctionId)!.emd.state).toBe('forfeited');
      // returned: the SELLER cancels the unpaid order
      X.sellerCancel = await settledAuction(U.b7, '65000');
      expect((await request(http).post(`/v1/orders/${X.sellerCancel.orderId}/cancel`).set({ ...Hd(T.seller), 'idempotency-key': randomUUID() }).send({})).status).toBe(201);
      await cancelSideEffects(X.sellerCancel.orderId);
      const ret = rowFor(await myBids(T.b7), X.sellerCancel.auctionId)!;
      expect(ret.emd.state).toBe('returned');
      expect(ret.settlement.outcome).toBe('returned');
    }, 240_000);
  });

  describe('(5) D1 — a sealed bid only raises', () => {
    it('a lower (or equal) re-bid → 409 BID_SEALED_MUST_RAISE {yourLastMinor}; a higher one accepted; ONE EMD hold', async () => {
      const { auctionId } = await openAuction({ kind: 'sealed' });
      await bid(U.s1, auctionId, '64000');
      await expect(bid(U.s1, auctionId, '63000')).rejects.toMatchObject({ code: 'BID_SEALED_MUST_RAISE', httpStatus: 409, details: { yourLastMinor: '64000' } });
      const viaHttp = await request(http).post(`/v1/auctions/${auctionId}/bids`).set({ ...Hd(T.s1), 'idempotency-key': randomUUID() }).send({ amountMinor: '64000' });
      expect([viaHttp.status, viaHttp.body.error?.code, viaHttp.body.error?.details?.yourLastMinor]).toEqual([409, 'BID_SEALED_MUST_RAISE', '64000']);
      await bid(U.s1, auctionId, '65000');
      expect(await count(`SELECT count(*)::int n FROM bids WHERE auction_id = $1 AND bidder_user_id = $2`, [auctionId, U.s1])).toBe(2);
      expect(await ledgerKey(`emd:${auctionId}:${U.s1}`)).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_type = 'auction' AND reference_id = $1`, [auctionId])).toBe(1);
      const sealed = rowFor(await myBids(T.s1), auctionId)!;
      expect([sealed.sealedHidden, sealed.currentBidMinor, sealed.myBestMinor]).toEqual([true, null, '65000']);
    }, 120_000);
  });

  describe('(10) B9 — `bid.outbid` reaches the outbid bidder', () => {
    it('a higher bid → `auctions.bidder_outbid` (the lot name, no other bidder) → a notification row for the outbid bidder from its template', async () => {
      await bid(U.b2, X.live.auctionId, '62000');                                // b5 led at 61000
      const ev = await outboxEvent('auctions.bidder_outbid', X.live.auctionId);
      expect(ev.payload).toMatchObject({ previousBidderUserId: U.b5, lot_name: expect.stringMatching(/^Ghee s3c/) });
      expect(JSON.stringify(ev.payload)).not.toContain(U.b2);
      const handlers = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY).handlersFor('auctions.bidder_outbid');
      expect(handlers.length).toBeGreaterThan(0);
      for (const h of handlers) await uow.run(LIVE, (tx) => h.handle(ev, tx), { userId: 'system' });
      const n = (await admin.query(`SELECT template_id, status::text s, channel FROM notifications WHERE user_id = $1 AND event_code = 'bid.outbid'`, [U.b5])).rows;
      expect(n.length).toBeGreaterThan(0);
      expect(n.every((x: { template_id: string | null }) => x.template_id !== null)).toBe(true);
      expect(await count(`SELECT count(*)::int n FROM notification_templates WHERE event_code = 'bid.outbid' AND tenant_id IS NULL AND serving_version_id IS NOT NULL`)).toBe(6);
      // my-bids (4): b5 is now outbid on the live auction
      expect(rowFor(await myBids(T.b5), X.live.auctionId)).toMatchObject({ leading: false, outbid: true, currentBidMinor: '62000', minNextBidMinor: '62500' });
    }, 120_000);
  });

  describe('(3) D4 — the PUBLIC list and the members\' list', () => {
    it('the groups partition (live / upcoming / ended); no reserve amount, winner, order id or identity; keyset bounded', async () => {
      const upcoming = await openAuction({ startsIn: 2 * H });
      const get = async (group: string) => { const r = await request(http).get(`/v1/storefront/auctions?group=${group}&limit=50`).set(pub()); expect(r.status).toBe(200); return r.body.data as Array<Record<string, any>>; };   // eslint-disable-line @typescript-eslint/no-explicit-any
      const [live, up, ended] = [await get('live'), await get('upcoming'), await get('ended')];
      const ids = (xs: Array<Record<string, any>>) => xs.map((x) => String(x.auctionId));   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(ids(live)).toContain(X.live.auctionId);
      expect(ids(up)).toEqual([upcoming.auctionId]);
      expect(ids(ended)).toEqual(expect.arrayContaining([X.paid.auctionId, X.forfeit.auctionId, X.sellerCancel.auctionId]));
      const all = [...ids(live), ...ids(up), ...ids(ended)];
      expect(new Set(all).size).toBe(all.length);
      const card = live.find((x) => x.auctionId === X.live.auctionId)!;
      expect(card).toMatchObject({ status: 'live', kind: 'english_open', reserveMet: true, bidderCount: 2, currentBidMinor: '62000', minNextBidMinor: '62500', currencyCode: 'INR', exponent: 2,
        lot: { title: expect.stringMatching(/^Ghee s3c/), unitCode: 'kg', quantity: '200.000', organisation: { slug, name: expect.any(String) } }, emd: { flatMinor: EMD.toString(), pctBps: null } });
      const json = JSON.stringify([live, up, ended]);
      for (const k of ['reservePriceMinor', 'winningBidId', 'settledOrderId', 'bidderUserId', 'orderId', 'cancelReason']) expect([k, json.includes(`"${k}"`)]).toEqual([k, false]);
      for (const u of [U.seller, U.b1, U.b2, U.b5, X.paid.orderId]) expect(json).not.toContain(u);
      expect(json).not.toMatch(/Ramesh|Bhavna/);
      expect((await request(http).get('/v1/storefront/auctions?group=bogus').set(pub())).status).toBe(422);   // the zod query refusal
    }, 120_000);
    it('`mine` without a session → 401; with one → the caller\'s auctions only', async () => {
      const anon = await request(http).get('/v1/storefront/auctions?group=ended&mine=1').set(pub());
      expect(anon.status).toBe(401);
      const r = await request(http).get('/v1/storefront/auctions?group=ended&mine=1').set({ ...pub(), authorization: `Bearer ${T.b6}` });
      expect(r.status).toBe(200);
      expect(r.body.data.map((x: { auctionId: string }) => x.auctionId)).toEqual([X.forfeit.auctionId]);
    });
    it('the members\' list: a plain member gets NO settledOrderId / winningBidId / cancelReason; the seller keeps them', async () => {
      const asMember = await request(http).get('/v1/auctions?group=ended&limit=100').set(Hd(T.member));
      expect(asMember.status).toBe(200);
      const m = asMember.body.data.find((x: { auctionId: string }) => x.auctionId === X.paid.auctionId);
      for (const k of ['settledOrderId', 'winningBidId', 'cancelReason']) expect([k, k in m]).toEqual([k, false]);
      const asSeller = await request(http).get('/v1/auctions?group=ended&limit=100').set(Hd(T.seller));
      expect(asSeller.body.data.find((x: { auctionId: string }) => x.auctionId === X.paid.auctionId)).toMatchObject({ settledOrderId: X.paid.orderId, winningBidId: expect.stringMatching(UUID) });
    });
    it('the `auctions` flag OFF → the public list and read answer 404', async () => {
      await setFlag('auctions', false);
      try {
        expect((await request(http).get('/v1/storefront/auctions').set(pub())).status).toBe(404);
        expect((await request(http).get(`/v1/storefront/auctions/${X.live.auctionId}`).set(pub())).status).toBe(404);
      } finally { await setFlag('auctions', true); }
    });
  });

  describe('(9) D7 — the capture landed, the order still awaits it, the buyer cancels', () => {
    it('a `success` payment row + a `payment_pending` order cancelled by the buyer → the EMD RETURNED (not forfeited), the balance refunded — once each', async () => {
      X.race = await settledAuction(U.b10, '65500');
      const i = await intent(T.b10, X.race.orderId, DUE, 1);
      expect(i.status).toBe(201);
      const pid = i.body.data.paymentId as string;
      expect((await captureVia(i.body.data.gatewayOrderId, `pay_${pid.slice(-12)}`, DUE)).status).toBe(200);   // the capture is booked …
      expect((await admin.query(`SELECT status::text s FROM payments WHERE id = $1`, [pid])).rows[0].s).toBe('success');
      expect((await orderRow(X.race.orderId)).status).toBe('payment_pending');                                   // … its confirm not yet relayed
      const c = await request(http).post(`/v1/orders/${X.race.orderId}/cancel`).set({ ...Hd(T.b10), 'idempotency-key': randomUUID() }).send(await REASON());
      expect(c.status).toBe(201);
      const ev = await cancelSideEffects(X.race.orderId);
      expect(await ledgerKey(`emd-return:${X.race.orderId}`)).toBe(1);
      expect(await ledgerKey(`emd-forfeit:${X.race.auctionId}`)).toBe(0);
      expect(await ledgerKey(`refund:${X.race.orderId}`)).toBe(1);
      expect(await settlement(X.race.auctionId)).toMatchObject({ outcome: 'returned', ret: true });
      for (let k = 0; k < 2; k++) { await app.get(AuctionOrderCancelledHandler).handle(ev); await app.get(OrderCancelledRefundHandler).handle(ev); }
      expect(await ledgerKey(`emd-return:${X.race.orderId}`)).toBe(1);
      expect(await ledgerKey(`refund:${X.race.orderId}`)).toBe(1);
    }, 180_000);
  });

  describe('(8) D5 — OFFLINE collection: the default clock covers it too', () => {
    it('the seller silent at balanceDueAt → the order cancelled by the SYSTEM, `emd-return:<auctionId>` once (escrow → winner, zero-sum), outcome `returned`, the lot restocked', async () => {
      await setFlag('online_payments', false);
      X.silent = await settledAuction(U.b8, '65500');
      expect((await orderRow(X.silent.orderId)).status).toBe('created');
      expect((await settlement(X.silent.auctionId)).collection).toBe('offline');
      const before = await mainOf(U.b8);
      await pastDue(X.silent.auctionId);
      expect((await app.get(AuctionDefaultJob).sweep(relay)).failed).toBe(0);
      expect(await orderRow(X.silent.orderId)).toMatchObject({ status: 'cancelled' });
      expect(await ledgerKey(`emd-return:${X.silent.auctionId}`)).toBe(1);
      const legs = await legsOf(`emd-return:${X.silent.auctionId}`);
      expect(sumLegs(legs)).toBe(0n);
      expect(escrowLeg(legs)).toBe(-EMD);
      expect(await mainOf(U.b8)).toBe(before + EMD);
      expect(await settlement(X.silent.auctionId)).toMatchObject({ outcome: 'returned', ret: true, fft: false });
      expect(await stock(X.silent.listingId)).toEqual({ q: '200.000', s: 'published' });
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'auction.emd_returned' AND entity_id = $1 AND actor_user_id IS NULL`, [X.silent.auctionId])).toBe(1);
      // the system's own order_cancelled, relayed, moves nothing more; a second sweep moves nothing
      await cancelSideEffects(X.silent.orderId);
      await app.get(AuctionDefaultJob).sweep(relay);
      expect(await ledgerKey(`emd-return:${X.silent.auctionId}`)).toBe(1);
      expect(await ledgerKey(`emd-forfeit:${X.silent.auctionId}`)).toBe(0);
      expect(await mainOf(U.b8)).toBe(before + EMD);
      expect(await stock(X.silent.listingId)).toEqual({ q: '200.000', s: 'published' });
      expect(rowFor(await myBids(T.b8), X.silent.auctionId)!.emd.state).toBe('returned');
    }, 180_000);
    it('a CONFIRMED offline order → outcome `paid` (the organisation took the order); nothing moves', async () => {
      X.confirmed = await settledAuction(U.b9, '65500');
      const conf = await request(http).post(`/v1/orders/${X.confirmed.orderId}/confirm`).set({ ...Hd(T.seller), 'idempotency-key': randomUUID() });
      expect(conf.status).toBe(201);
      await pastDue(X.confirmed.auctionId);
      await app.get(AuctionDefaultJob).sweep(relay);
      expect((await settlement(X.confirmed.auctionId)).outcome).toBe('paid');
      expect((await orderRow(X.confirmed.orderId)).status).toBe('confirmed');
      expect(await ledgerKey(`emd-return:${X.confirmed.auctionId}`)).toBe(0);
      expect(await ledgerKey(`emd-forfeit:${X.confirmed.auctionId}`)).toBe(0);
    }, 120_000);
  });

  describe('(6)(7) D3 — group lots: the public read and the deadline clock', () => {
    const actor = (u: string, coord = false) => ({ userId: u, canCoordinate: coord, canManage: false, canApprove: false });
    const lots = () => app.get(GroupLotService);
    async function lot(target: string, deadlineIn = H): Promise<string> {
      const g = await lots().create(LIVE, actor(U.coord, true), key(), { productId: product, targetQuantity: target, unitCode: 'quintal', pledgeDeadline: iso(deadlineIn), coordinationFeeBps: 150 });
      return g.id as string;
    }
    const L: Record<string, string> = {};
    it('(6) the public read: the pledger COUNT, progress bps, fee bps, the organisation — no identity, no coordinator id; flag OFF → 404', async () => {
      L.short = await lot('200');
      await lots().pledge(LIVE, actor(U.f1), key(), L.short, { quantity: '100' });
      await lots().pledge(LIVE, actor(U.f2), key(), L.short, { quantity: '48' });
      const r = await request(http).get(`/v1/storefront/group-lots/${L.short}`).set(pub());
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      expect(r.body.data).toMatchObject({ id: L.short, product: { name: 'Vanthali GG-20 Groundnut s3c' }, targetQuantity: '200.000', pledgedQuantity: '148.000', unitCode: 'quintal',
        progressBps: 7400, pledgerCount: 2, status: 'pledging', coordinationFeeBps: 150, currencyCode: 'INR', listingId: null, organisation: { slug } });
      const json = JSON.stringify(r.body.data);
      for (const u of [U.coord, U.f1, U.f2]) expect(json).not.toContain(u);
      for (const k of ['coordinatorUserId', 'coordinatorShortName', 'memberShortName', 'farmerUserId', 'pledges']) expect([k, json.includes(`"${k}"`)]).toEqual([k, false]);
      await setFlag('group_lots', false);
      try { expect((await request(http).get(`/v1/storefront/group-lots/${L.short}`).set(pub())).status).toBe(404); }
      finally { await setFlag('group_lots', true); }
    }, 120_000);
    it('(7) the deadline clock on the kv_relay pool: the unfilled `pledging` lot past its deadline → cancelled ONCE (`target_missed`, by the system); a `ready` lot and a not-yet-due lot untouched; no ledger row', async () => {
      L.ready = await lot('100');
      await lots().pledge(LIVE, actor(U.f1), key(), L.ready, { quantity: '100' });       // reaches the target → ready (the entity's rule)
      L.notDue = await lot('200', 6 * H);
      await lots().pledge(LIVE, actor(U.f2), key(), L.notDue, { quantity: '10' });
      await admin.query(`UPDATE group_lots SET pledge_deadline = now() - interval '1 minute' WHERE id = ANY($1::uuid[])`, [[L.short, L.ready]]);
      const statusOf = async (id: string) => (await admin.query(`SELECT g.status, g.cancelled_by, lv.code FROM group_lots g LEFT JOIN lookup_values lv ON lv.id = g.cancel_reason_id WHERE g.id = $1`, [id])).rows[0];
      const job = app.get(GroupLotDeadlineJob);
      const first = await job.sweep(relay);
      expect(first.failed).toBe(0);
      expect(await statusOf(L.short)).toEqual({ status: 'cancelled', cancelled_by: null, code: 'target_missed' });
      expect((await statusOf(L.ready)).status).toBe('ready');
      expect((await statusOf(L.notDue)).status).toBe('pledging');
      expect(await count(`SELECT count(*)::int n FROM group_lot_pledges WHERE group_lot_id = $1 AND status = 'released'`, [L.short])).toBe(2);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'group_lot.cancelled' AND entity_id = $1 AND actor_user_id IS NULL`, [L.short])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'group_lot.cancelled' AND aggregate_id = $1`, [L.short])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_id = ANY($1::uuid[])`, [[L.short, L.ready, L.notDue]])).toBe(0);
      await job.sweep(relay);                                                              // a second tick changes nothing
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'group_lot.cancelled' AND entity_id = $1`, [L.short])).toBe(1);
      const pubRead = (await request(http).get(`/v1/storefront/group-lots/${L.short}`).set(pub())).body.data;
      expect([pubRead.status, pubRead.cancelReasonCode]).toEqual(['cancelled', 'target_missed']);
    }, 120_000);
  });
});
