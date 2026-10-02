// modules/auctions/__tests__/tenant11a-auction-truth.integration.spec.ts · PC-56 TENANT-11a — real PG16, the harness's database
// (every migration through 0186 + seeds), every tenant-realm query as `kv_app` under RLS, the cadence jobs handed a pool that
// runs AS kv_relay (SET SESSION AUTHORIZATION — a missing grant is a real 42501).
//
// FOUNDER DECISIONS: F-12 = the price is PER UNIT; F-2 = the winner's EMD is APPLIED to the order and FORFEITED on default.
// What this file proves, live (each case fails on HEAD d0f4afe):
//   1. F-7  — create reserves the listing (reserved_auction) and a buyer cannot put it in a cart; the lot is copied from the
//             listing; the auction number is assigned; the create is audited;
//   2. F-15 — a bid at/after ends_at is refused AUCTION_ENDED and does not move ends_at;
//   3. F-2 / F-12 / F-16 — the close (run by the CLOSE JOB through kv_app) keeps the winner's hold and releases the losers';
//             the settlement, in ONE transaction, writes status settled + settled_order_id, an order of quantity × hammer
//             (200 kg × ₹655 = ₹1,31,000), the EMD APPLY leg (winner hold → escrow, `emd-apply:`), the settlement row
//             (balance = value − EMD, due in 48 h) and consumes the lot; a replay moves nothing;
//   4. F-2 / F-13 — awaiting_approval keeps the winner's hold; staff cannot approve without the seller's recorded consent;
//             the seller's approval is idempotent on its key; the LAPSE JOB ends an undecided auction and returns every EMD;
//   5. F-2 default — with online payments the order awaits payment and the payments module asks for total − EMD; past
//             balance_due_at the DEFAULT JOB forfeits the EMD to the seller, cancels the order, re-publishes the listing;
//   6. a SELLER cancel of the order returns the applied EMD to the winner;
//   7. F-17 / F-27a — the bid stream names bidders B1…Bn, never another person's id; the reserve is the seller's to see;
//   8. F-10 — a live auction is tenant_admin's to cancel (reason mandatory, bidders notified, every EMD back);
//   9. A11 — pause entry refuses NEW bidders, existing bidders continue;
//  10. F-21 — unwatch works as kv_app;
//  11. 0186 — auction_settlements / auction_consents: cross-tenant INSERT refused by RLS; consents append-only; money
//             facts of a settlement frozen.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { ListingNotPurchasableError } from '../../orders/domain/orders.errors';
import { AuctionEndedError, AuctionConsentRequiredError, AuctionForbiddenError, AuctionCancelLiveForbiddenError, AuctionReasonRequiredError, AuctionEntryPausedError } from '../domain/auctions.errors';
import { AuctionPaymentSucceededHandler } from '../events/handlers/payment-succeeded.handler';
import { AuctionOrderCancelledHandler } from '../events/handlers/order-cancelled.handler';
import { AuctionDefaultJob, CloseEndedAuctionsJob, OpenScheduledAuctionsJob, SellerDecisionLapseJob } from '../jobs/auctions.cadence-jobs';
import { AuctionHarness, balanceOf, buildHarness, fundUser, makeListing, relayPool } from './auction-harness';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

run('PC-56 TENANT-11a · auction truth — per-unit lots, the deposit applied and forfeited, the listing held (integration, real Postgres)', () => {
  let admin: Pool; let h: AuctionHarness; let relay: Pool;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const seller = randomUUID(); const b1 = randomUUID(); const b2 = randomUUID(); const b3 = randomUUID(); const deskUser = randomUUID(); const outsider = randomUUID();
  const EMD = 1_000_000n;                     // ₹10,000 per lot
  const FUND = 50_000_000n;
  const sellerActor = { userId: seller };
  const tenantAdmin = { userId: deskUser, onBehalf: true, cancelLive: true, pauseEntry: true };
  const supportAgent = { userId: outsider };  // held listing.moderate / dispute.resolve — no auction-desk verb
  const key = () => `k-${randomUUID()}`;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

  /** A live auction on a fresh 200 kg listing, ₹610/kg start, ₹640/kg reserve, ₹5 increment, EMD ₹10,000 per lot. */
  async function liveAuction(over: Record<string, unknown> = {}) {
    const listingId = await makeListing(admin, tenantA, seller, `Ghee ${randomUUID().slice(0, 4)}`, 200, 'kg');
    const c = await h.auctions.create(tenantA, sellerActor, key(), { listingId, kind: 'english_open', startPriceMinor: '61000', reservePriceMinor: '64000', minIncrementMinor: '500',
      emdMinor: EMD.toString(), startsAt: iso(-1000), endsAt: iso(3600_000), ...over });
    expect(await h.auctions.open(tenantA, c.auctionId)).toBe(true);
    return { listingId, auctionId: c.auctionId, auctionNo: c.auctionNo };
  }
  const bid = (u: string, auctionId: string, amount: string) => h.bids.placeBid(tenantA, u, auctionId, key(), amount, '10.0.0.1');
  const endNow = (auctionId: string) => admin.query(`UPDATE auctions SET ends_at = now() - interval '1 second' WHERE id=$1`, [auctionId]);
  const row = async (auctionId: string) => (await admin.query(`SELECT status::text, settled_order_id, winning_bid_id, decision_due_at, ended_at, quantity::text, unit_code, auction_no FROM auctions WHERE id=$1`, [auctionId])).rows[0];
  const listingStatus = async (id: string) => (await admin.query(`SELECT status::text s, quantity_available::text q FROM listings WHERE id=$1`, [id])).rows[0];
  const sellerMain = () => balanceOf(admin, seller, 'main');
  const auditOf = async (auctionId: string, action: string) => (await admin.query(`SELECT actor_user_id, reason, old_value, new_value FROM audit_log WHERE entity_type='auction' AND entity_id=$1 AND action=$2 ORDER BY created_at DESC LIMIT 1`, [auctionId, action])).rows[0];
  const ledgerTxn = async (k: string) => (await admin.query(`SELECT t.id, lv.code, t.reference_type, t.reference_id FROM ledger_transactions t JOIN lookup_values lv ON lv.id=t.txn_type_id WHERE t.idempotency_key=$1`, [k])).rows[0];

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [seller, b1, b2, b3, deskUser, outsider]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET full_name='Ramesh Kumar Patel' WHERE id=$1`, [b2]);
    h = buildHarness(APP_URL!);
    relay = relayPool(admin);
    for (const u of [b1, b2, b3]) await fundUser(h, tenantA, u, FUND);
  }, 120000);
  // The outbox is ONE shared queue: specs that drain it with a bounded relayBatch (dispute-refund: 100) never reach their own
  // event behind this file's few hundred. Nothing in this file relays them, so they are closed here rather than left pending.
  afterAll(async () => { await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined); await h?.close(); await admin?.end(); });

  it('F-7 · create RESERVES the listing (not purchasable), copies the lot, numbers the auction and audits the create', async () => {
    const { listingId, auctionId, auctionNo } = await liveAuction();
    expect(auctionNo).toMatch(/^AUC-\d{4}-\d{4}-\d{2}$/);
    expect(await listingStatus(listingId)).toEqual({ s: 'reserved_auction', q: '200.000' });
    await expect(h.carts.addItem(tenantA, b3, { listingId, quantity: 1 } as never)).rejects.toBeInstanceOf(ListingNotPurchasableError);
    expect(await row(auctionId)).toMatchObject({ quantity: '200.000', unit_code: 'kg', status: 'live' });
    const a = await auditOf(auctionId, 'auction.created');
    expect(a.actor_user_id).toBe(seller);
    expect(a.new_value).toMatchObject({ quantity: '200.000', unitCode: 'kg', startPriceMinor: '61000', listingStatus: 'reserved_auction' });
    // a listing that is not published cannot be auctioned at all
    await expect(h.auctions.create(tenantA, sellerActor, key(), { listingId, kind: 'english_open', startPriceMinor: '61000', startsAt: iso(-1000), endsAt: iso(3600_000) }))
      .rejects.toMatchObject({ code: 'AUCTION_LISTING_UNAVAILABLE' });
  }, 60000);

  it('F-15 · a bid at or after ends_at is refused AUCTION_ENDED and ends_at does not move', async () => {
    const { auctionId } = await liveAuction();
    await bid(b1, auctionId, '61000');
    await endNow(auctionId);
    const before = (await row(auctionId)).ended_at;
    const endsBefore = (await admin.query(`SELECT ends_at FROM auctions WHERE id=$1`, [auctionId])).rows[0].ends_at;
    await expect(bid(b2, auctionId, '70000')).rejects.toBeInstanceOf(AuctionEndedError);
    expect((await admin.query(`SELECT ends_at, status::text s FROM auctions WHERE id=$1`, [auctionId])).rows[0]).toEqual({ ends_at: endsBefore, s: 'live' });
    expect(before).toBeNull();
    // leave nothing held: the late window is closed by the desk (reason recorded), every EMD back
    await h.auctions.cancel(tenantA, tenantAdmin, auctionId, 'test window closed', null, null);
    expect(await balanceOf(admin, b1, 'hold')).toBe(0n);
  }, 60000);

  let settledAuction = ''; let settledListing = ''; let settledOrder = '';
  it('F-2 / F-12 / F-16 · the CLOSE JOB (kv_app) settles in one tx: order = 200 kg × ₹655, winner EMD APPLIED, losers back, lot consumed', async () => {
    const { auctionId, listingId } = await liveAuction();
    settledAuction = auctionId; settledListing = listingId;
    await bid(b1, auctionId, '61000');
    await bid(b2, auctionId, '65500');                                   // winner, ₹655/kg
    expect(await balanceOf(admin, b1, 'hold')).toBe(EMD);
    expect(await balanceOf(admin, b2, 'hold')).toBe(EMD);
    const b1MainBefore = await balanceOf(admin, b1, 'main'); const b2MainBefore = await balanceOf(admin, b2, 'main');
    await endNow(auctionId);
    const swept = await new CloseEndedAuctionsJob(30_000, h.uow, h.auctionRepo, h.auctions).sweep(relay);
    expect(swept.failed).toBe(0);
    expect(swept.acted).toBeGreaterThanOrEqual(1);

    const r = await row(auctionId);
    expect(r.status).toBe('settled');
    expect(r.settled_order_id).not.toBeNull();
    settledOrder = r.settled_order_id;
    const order = (await admin.query(`SELECT o.total_minor::text t, o.status::text s, o.auction_id, o.buyer_user_id, i.quantity::text q, i.unit_code, i.unit_price_minor::text u, i.line_total_minor::text lt
      FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.id=$1`, [settledOrder])).rows;
    expect(order).toEqual([{ t: '13100000', s: 'created', auction_id: auctionId, buyer_user_id: b2, q: '200.000', unit_code: 'kg', u: '65500', lt: '13100000' }]);
    // the loser is whole; the winner's EMD left their hold for escrow (applied), not for their Main
    expect(await balanceOf(admin, b1, 'hold')).toBe(0n);
    expect(await balanceOf(admin, b1, 'main')).toBe(b1MainBefore + EMD);
    expect(await balanceOf(admin, b2, 'hold')).toBe(0n);
    expect(await balanceOf(admin, b2, 'main')).toBe(b2MainBefore);
    expect(await ledgerTxn(`emd-apply:${auctionId}`)).toMatchObject({ code: 'emd_apply', reference_type: 'order', reference_id: settledOrder });
    const s = (await admin.query(`SELECT order_value_minor::text v, emd_applied_minor::text e, balance_due_minor::text b, collection, outcome,
        extract(epoch from (balance_due_at - settled_at))::int AS due_secs FROM auction_settlements WHERE auction_id=$1`, [auctionId])).rows[0];
    expect(s).toEqual({ v: '13100000', e: '1000000', b: '12100000', collection: 'offline', outcome: 'open', due_secs: 48 * 3600 });
    expect(await listingStatus(listingId)).toEqual({ s: 'sold_out', q: '0.000' });
    // the payments module asks this order for its balance only
    expect(await h.payments.orderEmdCreditMinor(tenantA, settledOrder)).toBe(EMD);
    // a replay of the close moves nothing
    expect(await h.auctions.closeAndResolve(tenantA, auctionId)).toBe(false);
    expect((await admin.query(`SELECT count(*)::int n FROM orders WHERE auction_id=$1`, [auctionId])).rows[0].n).toBe(1);
    // the winner is told (bid.won mapping) with the lot facts
    const won = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='auctions.auction_won'`, [auctionId])).rows[0].payload;
    expect(won).toMatchObject({ bidderUserId: b2, unitPriceMinor: '65500', quantity: '200.000', lotValueMinor: '13100000' });
  }, 90000);

  it('F-17 / F-27a · the bid stream is B1…Bn (no other person\'s id leaves the API); the reserve is the seller\'s to see', async () => {
    const asB1 = await h.live.bidHistory(tenantA, { userId: b1, isStaff: false }, settledAuction, { limit: 20 });
    expect(asB1.items.map((x) => x.bidderLabel).sort()).toEqual(['B1', 'B2']);
    const json = JSON.stringify(asB1);
    expect(json).not.toContain(b2);                                     // the winner's id never reaches another bidder
    expect(asB1.items.find((x) => x.bidderLabel === 'B1')).toMatchObject({ isMine: true, bidderUserId: b1, reserveMet: false });
    expect(asB1.items.find((x) => x.bidderLabel === 'B2')).toMatchObject({ isMine: false, bidderUserId: null, reserveMet: true, isHighest: true, lotValueMinor: '13100000', bidderPhoneMasked: null });
    const asSeller = await h.live.bidHistory(tenantA, { userId: seller, isStaff: false }, settledAuction, { limit: 20 });
    const sb2 = asSeller.items.find((x) => x.bidderLabel === 'B2')!;
    expect(sb2.bidderShortName).toBe('Ramesh P.');
    expect(sb2.bidderPhoneMasked).toMatch(/•/);
    expect(sb2.emdMinor).toBe(EMD.toString());
    expect(JSON.stringify(asSeller)).not.toContain(b2);
    const forBidder = await h.auctions.getById(tenantA, settledAuction, { userId: b1, isStaff: false });
    expect(forBidder).toMatchObject({ reservePriceMinor: null, reserveHidden: true, hasReserve: true });
    const forSeller = await h.auctions.getById(tenantA, settledAuction, { userId: seller, isStaff: false });
    expect(forSeller).toMatchObject({ reservePriceMinor: '64000', reserveHidden: false });
    expect(forSeller.settlement).toMatchObject({ orderValueMinor: '13100000', emdAppliedMinor: '1000000', balanceDueMinor: '12100000' });
  }, 60000);

  it('a SELLER cancel of the auction order returns the applied EMD to the winner (who did not default) and re-publishes the lot', async () => {
    const b2Main = await balanceOf(admin, b2, 'main');
    await admin.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [settledOrder]);
    await new AuctionOrderCancelledHandler(h.auctions).handle({ id: '1', tenantId: tenantA, aggregateType: 'order', aggregateId: settledOrder, eventType: 'orders.order_cancelled', payload: { role: 'seller' } } as never);
    expect(await balanceOf(admin, b2, 'main')).toBe(b2Main + EMD);
    expect(await ledgerTxn(`emd-return:${settledAuction}`)).toMatchObject({ code: 'emd_return', reference_id: settledOrder });
    expect((await admin.query(`SELECT outcome FROM auction_settlements WHERE auction_id=$1`, [settledAuction])).rows[0].outcome).toBe('returned');
    expect(await listingStatus(settledListing)).toEqual({ s: 'published', q: '200.000' });
    // replay: nothing moves
    expect(await h.auctions.onOrderCancelled(tenantA, settledOrder, 'seller')).toBe('skipped');
  }, 60000);

  it('F-2 / F-13 · awaiting approval KEEPS the winner\'s hold; staff need the seller\'s consent; the seller\'s approval is idempotent', async () => {
    const { auctionId } = await liveAuction({ requiresSellerApproval: true, decisionWindowHours: 6 });
    await bid(b1, auctionId, '64000');
    await bid(b3, auctionId, '66000');
    await endNow(auctionId);
    expect(await h.auctions.closeAndResolve(tenantA, auctionId)).toBe(true);
    const r = await row(auctionId);
    expect(r.status).toBe('awaiting_approval');
    expect(new Date(r.decision_due_at).getTime() - new Date(r.ended_at).getTime()).toBe(6 * 3600_000);
    expect(await balanceOf(admin, b3, 'hold')).toBe(EMD);              // the winner's deposit still secures the sale
    expect(await balanceOf(admin, b1, 'hold')).toBe(0n);               // the loser's came back at close
    await expect(h.auctions.approve(tenantA, supportAgent, auctionId, key(), null, null)).rejects.toBeInstanceOf(AuctionForbiddenError);
    await expect(h.auctions.approve(tenantA, tenantAdmin, auctionId, key(), null, null)).rejects.toBeInstanceOf(AuctionConsentRequiredError);
    expect((await row(auctionId)).status).toBe('awaiting_approval');
    const k = key();
    const first = await h.auctions.approve(tenantA, sellerActor, auctionId, k, null, '10.0.0.9');
    const again = await h.auctions.approve(tenantA, sellerActor, auctionId, k, null, '10.0.0.9');
    expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(first)));   // the replay is the stored response
    expect(first).toMatchObject({ status: 'settled', orderValueMinor: '13200000', emdAppliedMinor: '1000000', balanceDueMinor: '12200000' });
    expect((await row(auctionId)).settled_order_id).toBe(first.orderId);
    expect((await admin.query(`SELECT count(*)::int n FROM orders WHERE auction_id=$1`, [auctionId])).rows[0].n).toBe(1);
    const a = await auditOf(auctionId, 'auction.approved');
    expect(a).toMatchObject({ actor_user_id: seller, reason: 'approved by the seller' });
  }, 90000);

  it('F-10 · staff approve WITH the seller\'s recorded consent writes the consent row for THAT act', async () => {
    const { auctionId } = await liveAuction({ requiresSellerApproval: true });
    await bid(b1, auctionId, '65000');
    await endNow(auctionId);
    await h.auctions.closeAndResolve(tenantA, auctionId);
    const out = await h.auctions.approve(tenantA, tenantAdmin, auctionId, key(), { channel: 'otp' }, null);
    expect(out.status).toBe('settled');
    expect((await admin.query(`SELECT act, channel, recorded_by, seller_user_id FROM auction_consents WHERE auction_id=$1`, [auctionId])).rows)
      .toEqual([{ act: 'approve', channel: 'otp', recorded_by: deskUser, seller_user_id: seller }]);
    expect((await auditOf(auctionId, 'auction.approved')).reason).toMatch(/recorded consent/);
  }, 90000);

  it('F-13 · the LAPSE JOB (kv_app) ends an undecided auction: no sale, EVERY EMD back (the winner\'s too), the lot back on sale', async () => {
    const { auctionId, listingId } = await liveAuction({ requiresSellerApproval: true });
    await bid(b1, auctionId, '66000');
    await endNow(auctionId);
    await h.auctions.closeAndResolve(tenantA, auctionId);
    expect(await balanceOf(admin, b1, 'hold')).toBe(EMD);
    await admin.query(`UPDATE auctions SET decision_due_at = now() - interval '1 minute' WHERE id=$1`, [auctionId]);
    const swept = await new SellerDecisionLapseJob(300_000, h.uow, h.auctionRepo, h.auctions).sweep(relay);
    expect(swept.failed).toBe(0);
    expect((await row(auctionId)).status).toBe('ended');
    expect(await balanceOf(admin, b1, 'hold')).toBe(0n);
    expect((await listingStatus(listingId)).s).toBe('published');
    expect((await auditOf(auctionId, 'auction.lapsed')).reason).toMatch(/did not decide/);
    expect((await admin.query(`SELECT count(*)::int n FROM orders WHERE auction_id=$1`, [auctionId])).rows[0].n).toBe(0);
  }, 90000);

  it('F-2 · DEFAULT: online order asks for total − EMD; past due the DEFAULT JOB forfeits the EMD to the seller, cancels the order, re-publishes the lot', async () => {
    h.flags.online = true;
    try {
      const { auctionId, listingId } = await liveAuction();
      await bid(b3, auctionId, '64000');
      await endNow(auctionId);
      await h.auctions.closeAndResolve(tenantA, auctionId);
      const r = await row(auctionId);
      const order = (await admin.query(`SELECT status::text s, total_minor::text t FROM orders WHERE id=$1`, [r.settled_order_id])).rows[0];
      expect(order).toEqual({ s: 'payment_pending', t: '12800000' });
      expect(await h.payments.orderEmdCreditMinor(tenantA, r.settled_order_id)).toBe(EMD);     // due = 1,28,000 − 10,000
      expect((await admin.query(`SELECT collection FROM auction_settlements WHERE auction_id=$1`, [auctionId])).rows[0].collection).toBe('online');
      // not yet due → the job leaves it alone
      expect((await new AuctionDefaultJob(900_000, h.uow, h.auctionRepo, h.auctions, h.settlements).sweep(relay)).acted).toBe(0);
      const sellerBefore = await sellerMain(); const b3Main = await balanceOf(admin, b3, 'main');
      await admin.query(`ALTER TABLE auction_settlements DISABLE TRIGGER trg_as_outcome`);
      await admin.query(`UPDATE auction_settlements SET balance_due_at = now() - interval '1 minute' WHERE auction_id=$1`, [auctionId]);
      await admin.query(`ALTER TABLE auction_settlements ENABLE TRIGGER trg_as_outcome`);
      const swept = await new AuctionDefaultJob(900_000, h.uow, h.auctionRepo, h.auctions, h.settlements).sweep(relay);
      if (swept.failed) await h.auctions.defaultIfUnpaid(tenantA, auctionId);   // surfaces the error a sweep only counts
      expect(swept.failed).toBe(0);
      expect((await row(auctionId)).status).toBe('defaulted');
      expect(await sellerMain()).toBe(sellerBefore + EMD);                                   // the seller keeps the deposit
      expect(await balanceOf(admin, b3, 'main')).toBe(b3Main);                               // the winner does not get it back
      expect(await ledgerTxn(`emd-forfeit:${auctionId}`)).toMatchObject({ code: 'emd_forfeit', reference_id: r.settled_order_id });
      expect((await admin.query(`SELECT status::text s FROM orders WHERE id=$1`, [r.settled_order_id])).rows[0].s).toBe('cancelled');
      expect(await listingStatus(listingId)).toEqual({ s: 'published', q: '200.000' });
      expect((await admin.query(`SELECT outcome, emd_forfeit_txn_id IS NOT NULL f FROM auction_settlements WHERE auction_id=$1`, [auctionId])).rows[0]).toEqual({ outcome: 'defaulted', f: true });
      expect((await auditOf(auctionId, 'auction.defaulted')).new_value).toMatchObject({ emdForfeitedMinor: '1000000', toSeller: seller });
      const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='auctions.auction_defaulted'`, [auctionId])).rows[0].payload;
      expect(ev.recipientUserIds.sort()).toEqual([b3, seller].sort());
      // the order_cancelled the default wrote is a no-op for the deposit (already forfeited); a second sweep moves nothing
      expect(await h.auctions.onOrderCancelled(tenantA, r.settled_order_id, 'system')).toBe('skipped');
      expect((await new AuctionDefaultJob(900_000, h.uow, h.auctionRepo, h.auctions, h.settlements).sweep(relay)).acted).toBe(0);
      expect(await sellerMain()).toBe(sellerBefore + EMD);
    } finally { h.flags.online = false; }
  }, 90000);

  it('a paid auction order is recorded paid (payments.payment_succeeded → kv_app), and the default job then leaves it', async () => {
    h.flags.online = true;
    try {
      const { auctionId } = await liveAuction();
      await bid(b1, auctionId, '64500');
      await endNow(auctionId);
      await h.auctions.closeAndResolve(tenantA, auctionId);
      const orderId = (await row(auctionId)).settled_order_id;
      await new AuctionPaymentSucceededHandler(h.auctions).handle({ id: '2', tenantId: tenantA, aggregateType: 'payment', aggregateId: randomUUID(), eventType: 'payments.payment_succeeded', payload: { referenceType: 'order', referenceId: orderId } } as never);
      expect((await admin.query(`SELECT outcome FROM auction_settlements WHERE auction_id=$1`, [auctionId])).rows[0].outcome).toBe('paid');
    } finally { h.flags.online = false; }
  }, 90000);

  it('F-10 · a live auction is tenant_admin\'s: the seller cannot stop it; the admin must give a reason; bidders are told; every EMD back', async () => {
    const { auctionId, listingId } = await liveAuction();
    await bid(b1, auctionId, '61000'); await bid(b3, auctionId, '62000');
    await expect(h.auctions.cancel(tenantA, sellerActor, auctionId, 'changed my mind', null, null)).rejects.toBeInstanceOf(AuctionCancelLiveForbiddenError);
    await expect(h.auctions.cancel(tenantA, supportAgent, auctionId, 'moderation', null, null)).rejects.toBeInstanceOf(AuctionCancelLiveForbiddenError);
    await expect(h.auctions.cancel(tenantA, tenantAdmin, auctionId, 'no', null, null)).rejects.toBeInstanceOf(AuctionReasonRequiredError);
    const out = await h.auctions.cancel(tenantA, tenantAdmin, auctionId, 'quality complaint on the lot', null, '10.0.0.7');
    expect(out).toMatchObject({ status: 'cancelled' });
    expect(await balanceOf(admin, b1, 'hold')).toBe(0n); expect(await balanceOf(admin, b3, 'hold')).toBe(0n);
    expect((await listingStatus(listingId)).s).toBe('published');
    expect(await auditOf(auctionId, 'auction.cancelled')).toMatchObject({ actor_user_id: deskUser, reason: 'quality complaint on the lot', old_value: { status: 'live' } });
    const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='auctions.auction_cancelled'`, [auctionId])).rows[0].payload;
    expect(ev.reason).toBe('quality complaint on the lot');
    expect(ev.recipientUserIds.sort()).toEqual([b1, b3, seller].sort());
  }, 60000);

  it('A11 · pause entry refuses NEW bidders; existing bidders continue; resume lets them in', async () => {
    const { auctionId } = await liveAuction();
    await bid(b1, auctionId, '61000');
    await bid(b2, auctionId, '61500');
    await h.auctions.setEntryPaused(tenantA, tenantAdmin, auctionId, true, 'checking a suspected ring', null);
    await expect(bid(b3, auctionId, '62000')).rejects.toBeInstanceOf(AuctionEntryPausedError);   // new bidder: refused
    await bid(b1, auctionId, '62000');                                                             // existing bidder: continues
    await expect(h.auctions.setEntryPaused(tenantA, sellerActor, auctionId, false, 'resume please', null)).rejects.toBeInstanceOf(AuctionForbiddenError);
    expect((await auditOf(auctionId, 'auction.entry_paused')).reason).toBe('checking a suspected ring');
    await h.auctions.setEntryPaused(tenantA, tenantAdmin, auctionId, false, 'ring cleared', null);
    await bid(b3, auctionId, '62500');
    expect(await balanceOf(admin, b3, 'hold')).toBeGreaterThan(0n);
  }, 60000);

  it('F-1 · the OPEN JOB opens a due scheduled auction through kv_app; F-21 · unwatch works as kv_app', async () => {
    const listingId = await makeListing(admin, tenantA, seller, 'Cumin lot', 60, 'quintal');
    const c = await h.auctions.create(tenantA, sellerActor, key(), { listingId, kind: 'sealed', startPriceMinor: '700000', emdMinor: '2500000', startsAt: iso(-500), endsAt: iso(3600_000) });
    const swept = await new OpenScheduledAuctionsJob(60_000, h.uow, h.auctionRepo, h.auctions).sweep(relay);
    expect(swept.failed).toBe(0);
    expect((await row(c.auctionId)).status).toBe('live');
    await h.watchers.watch(tenantA, b1, c.auctionId);
    await h.watchers.unwatch(tenantA, b1, c.auctionId);
    expect((await admin.query(`SELECT count(*)::int n FROM auction_watchers WHERE auction_id=$1`, [c.auctionId])).rows[0].n).toBe(0);
  }, 60000);

  it('0186 · kv_app: cross-tenant INSERT refused (RLS); consents append-only; a settlement\'s money facts are frozen', async () => {
    const app = new Pool({ connectionString: APP_URL });
    const c = await app.connect();
    const st = async (sql: string, p: unknown[]) => c.query(sql, p).then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantB]);
      expect(await st(`INSERT INTO auction_consents (tenant_id, auction_id, seller_user_id, act, channel, recorded_by) VALUES ($1,$2,$3,'approve','otp',$3)`, [tenantA, settledAuction, seller])).toBe('42501');
      await c.query('ROLLBACK');
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA]);
      expect(await st(`UPDATE auction_consents SET channel='voice'`, [])).toBe('42501');
      await c.query('ROLLBACK');
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA]);
      expect(await st(`UPDATE auction_settlements SET order_value_minor = 1 WHERE auction_id=$1`, [settledAuction])).toBe('42501');   // column grant: outcome columns only
      await c.query('ROLLBACK');
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantB]);
      expect((await c.query(`SELECT count(*)::int n FROM auction_settlements WHERE auction_id=$1`, [settledAuction])).rows[0].n).toBe(0);
      await c.query('ROLLBACK');
    } finally { c.release(); await app.end(); }
    expect(await admin.query(`UPDATE auction_settlements SET order_value_minor = 1 WHERE auction_id=$1`, [settledAuction]).then(() => 'ok', (e: { code?: string }) => e.code)).toBe('23514');
  }, 60000);
});
