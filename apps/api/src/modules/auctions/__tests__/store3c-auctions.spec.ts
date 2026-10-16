// modules/auctions/__tests__/store3c-auctions.spec.ts · PC-56 STORE-3c — the money wave's auction rules as unit tests against in-memory fakes (no
// Postgres). The live proofs are apps/api/src/__tests__/store3c-auctions-group.integration.spec.ts.
//   B2 (founder D1) a SEALED bid only raises the bidder's own last one — BID_SEALED_MUST_RAISE {yourLastMinor}; a higher one is placed; the EMD is
//      not held twice;
//   B3 (C-8) the deposit's state FROM THE LEDGER (`emdLedgerState`): returned > forfeited > applied > released > held > none;
//   B4 (F-18) the members' list drops settledOrderId / winningBidId / cancelReason for a NON-privileged viewer (the seller keeps them);
//   B5 (founder D5) the OFFLINE default: an unconfirmed order → cancelled by the system, the EMD returned under `emd-return:<auctionId>` (zero-sum,
//      escrow → winner), outcome `returned`, the lot restocked; a confirmed one → `paid`, nothing moves; the online forfeit unchanged;
//   B6 (founder D6, 0212) a PAID order cancelled → the outcome `cancelled_paid` with the `emd-return:<orderId>` txn;
//   B7 (founder D7) "paid" = the order's timeline OR a captured payment (AuctionOrderService.paidBeforeCancelInTx).
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { Metrics } from '../../../core/observability/metrics';
import { WalletPort, PostTxnInput, PostTxnResult } from '../../../core/wallet/wallet.port';
import { Auction } from '../domain/auction.entity';
import { BidService } from '../services/bid.service';
import { AuctionService } from '../services/auction.service';
import { emdLedgerState } from '../read-models/my-bids.read-model';
import { SettlementRow } from '../repositories/auction-settlement.repository';
import { AuctionOrderService, AUCTION_SELLER_SILENT_REASON } from '../../orders/services/auction-order.service';
import { Order } from '../../orders/domain/order.entity';
import { OrderItem } from '../../orders/domain/order-item.entity';
import { uuidv7 } from '../../../core/database/uuid.util';

class FakeTx implements TxContext { constructor(readonly tenantId: string) {} async query<T = any>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; } }   // eslint-disable-line @typescript-eslint/no-explicit-any
class FakeUow extends UnitOfWork { async run<T>(t: string, fn: (tx: TxContext) => Promise<T>): Promise<T> { return fn(new FakeTx(t)); } }
class PassIdem extends IdempotencyService { async remember<T>(_k: string, _u: string | undefined, _e: string, fn: () => Promise<T>): Promise<T> { return fn(); } }
class FakeMetrics extends Metrics { inc(): void {} observe(): void {} }
class FakeWallet implements WalletPort {
  posts: PostTxnInput[] = []; keys = new Map<string, string>();
  async post(_tx: TxContext, input: PostTxnInput): Promise<PostTxnResult> {
    const seen = this.keys.get(input.idempotencyKey); if (seen) return { txnId: seen, alreadyApplied: true };
    this.posts.push(input); const id = `txn_${this.posts.length}`; this.keys.set(input.idempotencyKey, id); return { txnId: id, alreadyApplied: false };
  }
  async balanceMinor(): Promise<bigint> { return 10n ** 12n; }
}
const T = 'tenant-s3c';
const H = 3_600_000;
const lotAuction = (over: Partial<ReturnType<Auction['toProps']>> = {}, kind: 'english_open' | 'sealed' = 'english_open') => {
  const a = Auction.create({ id: uuidv7(), tenantId: T, listingId: 'listing-1', kind, quantity: '200', unitCode: 'kg', startPriceMinor: 61000n, emdMinor: 1_000_000n,
    startsAt: new Date(Date.now() - H), endsAt: new Date(Date.now() + H) });
  a.open(); a.pullEvents();
  return Auction.rehydrate({ ...a.toProps(), auctionNo: 'AUC-2026-1016-01', ...over });
};
const settlement = (a: Auction, over: Partial<SettlementRow> = {}): SettlementRow => ({
  id: 's1', tenantId: T, auctionId: a.id, orderId: 'order-1', winnerUserId: 'winner', sellerUserId: 'seller', quantity: '200.000', unitCode: 'kg',
  hammerUnitMinor: 65500n, orderValueMinor: 13_100_000n, emdAppliedMinor: 1_000_000n, emdApplyTxnId: 'txn_apply', balanceDueMinor: 12_100_000n,
  balanceDueAt: new Date(Date.now() - 60_000), collection: 'offline', settledAt: new Date(Date.now() - 48 * H), outcome: 'open', outcomeAt: null,
  emdForfeitTxnId: null, emdReturnTxnId: null, ...over,
});
const sum = (p: PostTxnInput) => p.legs.reduce((s, l) => s + l.amountMinor, 0n);

function auctionWorld(a: Auction, s: SettlementRow | null, orderAct: Partial<Record<string, unknown>> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const wallet = new FakeWallet();
  const repo = {
    getForUpdate: async () => a, update: async () => true, hasEventTx: async () => false,
    recordEvent: async (_tx: unknown, _t: string, id: string, code: string) => { calls.push(['event', id, code]); },
  };
  const settlements = {
    forAuctionForUpdate: async () => s, forOrderForUpdate: async () => s,
    recordOutcome: async (_tx: unknown, _t: string, id: string, outcome: string, txn: unknown) => { calls.push(['outcome', id, outcome, txn]); return true; },
    recordCancelledPaid: async (_tx: unknown, _t: string, id: string, ret: string | null) => { calls.push(['cancelled_paid', id, ret]); return true; },
  };
  const auctionOrders = {
    cancelUnconfirmedOfflineInTx: async () => 'cancelled', statusForUpdate: async () => 'cancelled', cancelForDefaultInTx: async () => true,
    paidBeforeCancelInTx: async () => true, ...orderAct,
  };
  const listings = { restockInTx: async (_tx: unknown, _t: string, id: string, q: number) => { calls.push(['restock', id, q]); }, invalidate: async () => undefined, getById: async () => ({ title: 'Ghee', sellerUserId: 'seller' }) };
  const audit = { write: async (_tx: unknown, e: { action: string }) => { calls.push(['audit', e.action]); } };
  const outbox = { write: async (_tx: unknown, e: { eventType: string; payload: Record<string, unknown> }) => { calls.push(['outbox', e.eventType, e.payload]); } };
  const svc = new AuctionService(new FakeUow(), outbox as never, new PassIdem(), new FakeMetrics(), wallet, audit as never, listings as never, repo as never,
    { firstBidAmounts: async () => [], statsFor: async () => new Map() } as never, {} as never, { emdReleased: async () => undefined } as never, settlements as never, auctionOrders as never);
  return { svc, wallet, calls };
}

describe('STORE-3c · B3 the deposit state FROM THE LEDGER (emdLedgerState)', () => {
  const f = (amount: bigint, iso: string) => ({ amountMinor: amount, at: new Date(iso) });
  it('none → held → released / applied → forfeited / returned: the latest fact wins, with its amount and time', () => {
    expect(emdLedgerState({})).toEqual({ state: 'none', amountMinor: '0', at: null });
    const hold = f(1_000_000n, '2026-10-16T05:00:00.000Z');
    expect(emdLedgerState({ hold })).toEqual({ state: 'held', amountMinor: '1000000', at: '2026-10-16T05:00:00.000Z' });
    expect(emdLedgerState({ hold, release: f(1_000_000n, '2026-10-16T13:00:00.000Z') }).state).toBe('released');
    const apply = f(1_000_000n, '2026-10-16T12:30:00.000Z');
    expect(emdLedgerState({ hold, apply })).toMatchObject({ state: 'applied', at: '2026-10-16T12:30:00.000Z' });
    expect(emdLedgerState({ hold, apply, forfeit: f(1_000_000n, '2026-10-18T12:30:00.000Z') })).toMatchObject({ state: 'forfeited', at: '2026-10-18T12:30:00.000Z' });
    expect(emdLedgerState({ hold, apply, returned: f(1_000_000n, '2026-10-17T09:00:00.000Z') })).toMatchObject({ state: 'returned', amountMinor: '1000000' });
  });
});

describe('STORE-3c · B2 sealed bids only raise (founder D1)', () => {
  function bidWorld(mine: bigint | null) {
    const a = lotAuction({}, 'sealed');
    const inserted: unknown[] = [];
    const wallet = new FakeWallet();
    const bids = { highest: async () => ({ id: 'b0', amountMinor: 300_000n, bidderUserId: 'other' }), highestForBidder: async () => mine, hasBid: async () => mine !== null,
      existingEmdTxn: async () => (mine !== null ? 'txn_hold' : null), insert: async (_tx: unknown, b: unknown) => { inserted.push(b); } };
    const svc = new BidService(new FakeUow(), { write: async () => undefined } as never, new PassIdem(), new FakeMetrics(), wallet,
      { getById: async () => ({ sellerUserId: 'seller', title: 'Ghee' }) } as never, { getForUpdate: async () => a, update: async () => true, recordEvent: async () => undefined } as never,
      bids as never, { outbid: async () => undefined } as never);
    return { svc, a, inserted, wallet };
  }
  it('a second sealed bid at or BELOW the bidder\'s own last → 409 BID_SEALED_MUST_RAISE {yourLastMinor}; nothing inserted', async () => {
    const w = bidWorld(200_000n);
    await expect(w.svc.placeBid(T, 'me', w.a.id, 'k1', '150000', null)).rejects.toMatchObject({ code: 'BID_SEALED_MUST_RAISE', httpStatus: 409, details: { yourLastMinor: '200000' } });
    await expect(w.svc.placeBid(T, 'me', w.a.id, 'k2', '200000', null)).rejects.toMatchObject({ code: 'BID_SEALED_MUST_RAISE' });
    expect(w.inserted).toHaveLength(0);
  });
  it('a HIGHER sealed bid is placed — and the deposit is not held again (once per auction and bidder)', async () => {
    const w = bidWorld(200_000n);
    await w.svc.placeBid(T, 'me', w.a.id, 'k3', '250000', null);
    expect(w.inserted).toHaveLength(1);
    expect(w.wallet.posts).toHaveLength(0);
  });
  it('the FIRST sealed bid (no prior bid) is placed even below another bidder\'s higher sealed bid (the highest still wins at close)', async () => {
    const w = bidWorld(null);
    await w.svc.placeBid(T, 'me', w.a.id, 'k4', '100000', null);
    expect(w.inserted).toHaveLength(1);
    expect(w.wallet.posts.map((p) => p.idempotencyKey)).toEqual([`emd:${w.a.id}:me`]);
  });
});

describe('STORE-3c · B5 the OFFLINE default (founder D5)', () => {
  it('an unconfirmed offline order at balanceDueAt → cancelled by the system; the EMD RETURNED under emd-return:<auctionId> (escrow → winner, zero-sum); outcome `returned`; restocked', async () => {
    const a = lotAuction({ status: 'settled' }); const s = settlement(a);
    const w = auctionWorld(a, s);
    expect(await w.svc.defaultIfUnpaid(T, a.id)).toBe('returned');
    expect(w.wallet.posts).toHaveLength(1);
    const p = w.wallet.posts[0];
    expect(p).toMatchObject({ txnType: 'emd_return', idempotencyKey: `emd-return:${a.id}`, referenceType: 'order', referenceId: 'order-1' });
    expect(sum(p)).toBe(0n);
    expect(p.legs).toHaveLength(2);
    expect(p.legs.find((l) => l.amountMinor > 0n)?.account).toEqual(expect.objectContaining({ kind: 'user', userId: 'winner', accountCode: 'main' }));
    expect(p.legs.find((l) => l.amountMinor < 0n)?.amountMinor).toBe(-1_000_000n);
    expect(w.calls).toContainEqual(['outcome', 's1', 'returned', { ret: 'txn_1' }]);
    expect(w.calls).toContainEqual(['restock', 'listing-1', 200]);
    expect(w.calls).toContainEqual(['audit', 'auction.emd_returned']);
    expect(w.calls.find((c) => c[0] === 'outbox')?.[2]).toMatchObject({ sellerSilent: true, amountMinor: '1000000', bidderUserId: 'winner' });
  });
  it('a CONFIRMED offline order (past `created`) → outcome `paid` (the organisation took the order); NOTHING moves', async () => {
    const a = lotAuction({ status: 'settled' });
    const w = auctionWorld(a, settlement(a), { cancelUnconfirmedOfflineInTx: async () => 'confirmed' });
    expect(await w.svc.defaultIfUnpaid(T, a.id)).toBe('paid');
    expect(w.wallet.posts).toHaveLength(0);
    expect(w.calls).toContainEqual(['outcome', 's1', 'paid', undefined]);
    expect(w.calls.find((c) => c[0] === 'restock')).toBeUndefined();
  });
  it('not yet due / already decided / already cancelled → skipped; the ONLINE default still forfeits to the seller (unchanged)', async () => {
    const a = lotAuction({ status: 'settled' });
    expect(await auctionWorld(a, settlement(a, { balanceDueAt: new Date(Date.now() + H) })).svc.defaultIfUnpaid(T, a.id)).toBe('skipped');
    expect(await auctionWorld(a, settlement(a, { outcome: 'returned' })).svc.defaultIfUnpaid(T, a.id)).toBe('skipped');
    expect(await auctionWorld(a, settlement(a), { cancelUnconfirmedOfflineInTx: async () => 'gone' }).svc.defaultIfUnpaid(T, a.id)).toBe('skipped');
    const b = lotAuction({ status: 'settled' });
    const on = auctionWorld(b, settlement(b, { collection: 'online' }), { statusForUpdate: async () => 'payment_pending' });
    expect(await on.svc.defaultIfUnpaid(T, b.id)).toBe('defaulted');
    expect(on.wallet.posts.map((p) => p.idempotencyKey)).toEqual([`emd-forfeit:${b.id}`]);
  });
});

describe('STORE-3c · B6 a PAID order cancelled → `cancelled_paid` (0212, founder D6)', () => {
  it('the EMD returned under emd-return:<orderId> and the outcome moved paid → cancelled_paid WITH that txn', async () => {
    const a = lotAuction({ status: 'settled' });
    const w = auctionWorld(a, settlement(a, { outcome: 'paid', collection: 'online' }));
    expect(await w.svc.onOrderCancelled(T, 'order-1', 'buyer')).toBe('returned_paid');
    expect(w.wallet.posts.map((p) => p.idempotencyKey)).toEqual(['emd-return:order-1']);
    expect(w.calls).toContainEqual(['cancelled_paid', 's1', 'txn_1']);
    expect(w.calls.find((c) => c[0] === 'outcome')).toBeUndefined();
  });
  it('an OPEN settlement (the cancel delivered before the capture\'s `paid`) still moves to `returned` (HOTFIX-5, unchanged)', async () => {
    const a = lotAuction({ status: 'settled' });
    const w = auctionWorld(a, settlement(a, { outcome: 'open', collection: 'online' }));
    expect(await w.svc.onOrderCancelled(T, 'order-1', 'seller')).toBe('returned_paid');
    expect(w.calls).toContainEqual(['outcome', 's1', 'returned', { ret: 'txn_1' }]);
  });
});

describe('STORE-3c · B7 "paid" also means a CAPTURED payment (founder D7)', () => {
  const svc = (timeline: boolean, captured: boolean) => new AuctionOrderService({ paidBeforeCancelTx: async () => timeline } as never, {} as never, {} as never, new FakeMetrics(),
    { capturedForOrderInTx: async () => captured } as never);
  it('the timeline OR a captured payment row → paid; neither → unpaid (the forfeit path)', async () => {
    const tx = new FakeTx(T);
    expect(await svc(true, false).paidBeforeCancelInTx(tx, T, 'o')).toBe(true);
    expect(await svc(false, true).paidBeforeCancelInTx(tx, T, 'o')).toBe(true);
    expect(await svc(false, false).paidBeforeCancelInTx(tx, T, 'o')).toBe(false);
  });
  it('the offline cancel: a `created` order → system-cancelled `seller_silent` with the auction id on the event; past `created` → confirmed; none → gone', async () => {
    const id = uuidv7();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: new Date(), tenantId: T, listingId: uuidv7(), productId: uuidv7(), titleSnapshot: 'Ghee (auction lot)',
      quantity: 200, unitCode: 'kg', unitPriceMinor: 65_500n, gstRatePct: null, hsnCode: null, batchId: null });
    const order = Order.place({ id, tenantId: T, orderNo: 'KV2026-00000001', checkoutGroupId: null, buyerUserId: 'winner', sellerUserId: 'seller', source: 'auction', currencyCode: 'INR',
      items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: false });
    order.pullEvents();
    const written: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const s = new AuctionOrderService({ getForUpdate: async () => order, update: async () => true } as never, {} as never, { write: async (_tx: unknown, e: never) => { written.push(e); } } as never,
      new FakeMetrics(), {} as never);
    expect(await s.cancelUnconfirmedOfflineInTx(new FakeTx(T), T, id, 'auction-1')).toBe('cancelled');
    expect(order.status).toBe('cancelled');
    expect(written.find((e) => e.eventType === 'orders.order_cancelled')).toMatchObject({ eventType: 'orders.order_cancelled', payload: { auctionId: 'auction-1', sellerSilent: true, reason: AUCTION_SELLER_SILENT_REASON, role: 'system' } });
    expect(await s.cancelUnconfirmedOfflineInTx(new FakeTx(T), T, id, 'auction-1')).toBe('gone');
    const confirmed = new AuctionOrderService({ getForUpdate: async () => ({ status: 'confirmed' }) } as never, {} as never, {} as never, new FakeMetrics(), {} as never);
    expect(await confirmed.cancelUnconfirmedOfflineInTx(new FakeTx(T), T, id, 'auction-1')).toBe('confirmed');
  });
});

describe('STORE-3c · B4 the members\' list hides the settlement ids from a non-privileged member (F-18)', () => {
  it('a plain member: no settledOrderId / winningBidId / cancelReason; the seller and staff keep them; ONE listing batch for the page', async () => {
    const a = lotAuction({ status: 'settled', settledOrderId: 'order-1', winningBidId: 'bid-9', cancelReason: null });
    let batches = 0;
    const repo = { listFor: async () => [a], groupCounts: async () => ({ live: 0, scheduled: 0, awaiting_approval: 0, ended: 1, cancelled: 0 }),
      listingFactsFor: async () => { batches++; return new Map([['listing-1', { title: 'Ghee', sellerUserId: 'seller', currencyCode: 'INR', exponent: 2 }]]); } };
    const listings = { getById: async () => { throw new Error('the list must not read listings one by one'); } };
    const svc = new AuctionService(new FakeUow(), {} as never, new PassIdem(), new FakeMetrics(), new FakeWallet(), {} as never, listings as never, repo as never,
      { statsFor: async () => new Map([[a.id, { highMinor: 65_500n, bidders: 3 }]]) } as never, {} as never, {} as never, {} as never, {} as never);
    const member = (await svc.list(T, { limit: 20 }, { userId: 'member', isStaff: false })).items[0];
    for (const k of ['settledOrderId', 'winningBidId', 'cancelReason']) expect([k, k in member]).toEqual([k, false]);
    expect(member).toMatchObject({ listingTitle: 'Ghee', bidderCount: 3 });
    const seller = (await svc.list(T, { limit: 20 }, { userId: 'seller', isStaff: false })).items[0];
    expect(seller).toMatchObject({ settledOrderId: 'order-1', winningBidId: 'bid-9' });
    const staff = (await svc.list(T, { limit: 20 }, { userId: 'desk', isStaff: true })).items[0];
    expect(staff).toMatchObject({ settledOrderId: 'order-1' });
    expect(batches).toBe(3);
  });
});
