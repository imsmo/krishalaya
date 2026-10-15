// apps/api/src/modules/orders/__tests__/store3a-order-rules.spec.ts · PC-56 STORE-3a — the order rules this wave adds, as UNIT specs (the live
// proofs are in src/__tests__/store3a-orders.integration.spec.ts):
//   • B1 (founder D4): `orderGroupOf` is exhaustive over the 15-state machine — every status in exactly ONE of the four groups; attention =
//     awaiting the buyer's payment + delivered; `statusesOf('all')` is no filter;
//   • B2 (founder D1 / D5): a BUYER's cancel needs a reason (CANCEL_REASON_REQUIRED), a known one (CANCEL_REASON_UNKNOWN), and `other` needs a
//     note (CANCEL_NOTE_REQUIRED) — nothing is written when refused; the code travels in the event and the audit; the seller's decline keeps
//     the optional reason; an order past `ready` is refused by the STATE MACHINE (ORDER_ILLEGAL_TRANSITION) before any reason is asked;
//   • B5 (lead's D6, Law 9): the BUYER's completion of an order whose escrow was never funded (placed `created`, pay-on-delivery) is refused
//     ORDER_COMPLETE_REQUIRES_ESCROW and nothing is written; a paid-online order completes; a moderator's completion is not gated.
import { ORDER_STATUSES, OrderStatus } from '../domain/order.state';
import { ORDER_GROUPS, orderGroupOf, statusesOf, isOrderGroup, ORDER_GROUP_COUNT_CAP } from '../domain/order-groups';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { OrderService } from '../services/order.service';

describe('STORE-3a · B1 the buyer\'s order groups (one mapping, exhaustive)', () => {
  it('every one of the 15 statuses belongs to exactly ONE of active / attention / completed / cancelled', () => {
    expect(ORDER_STATUSES.length).toBe(15);
    const seen = new Map<OrderStatus, number>();
    for (const g of ORDER_GROUPS) for (const s of statusesOf(g) ?? []) seen.set(s, (seen.get(s) ?? 0) + 1);
    for (const s of ORDER_STATUSES) expect([s, seen.get(s)]).toEqual([s, 1]);
    expect(statusesOf('all')).toBeNull();
  });
  it('founder D4: Needs attention = awaiting the buyer\'s payment + delivered (awaiting their confirmation)', () => {
    expect(statusesOf('attention')).toEqual(['payment_pending', 'delivered']);
    expect(statusesOf('completed')).toEqual(['completed']);
    expect(statusesOf('cancelled')).toEqual(['cancelled', 'refunded']);
    expect(statusesOf('active')).toHaveLength(10);
    expect(statusesOf('active')).toEqual(expect.arrayContaining(['created', 'confirmed', 'packed', 'ready', 'picked_up', 'in_transit', 'out_for_delivery', 'disputed', 'partially_refunded', 'partially_fulfilled']));
  });
  it('an unknown status is refused, never filed in a group; the tab names are a closed list; the cap is the named constant', () => {
    expect(() => orderGroupOf('teleported' as OrderStatus)).toThrow(/unmapped order status/);
    expect(ORDER_GROUPS).toEqual(['all', 'active', 'attention', 'completed', 'cancelled']);
    expect([isOrderGroup('attention'), isOrderGroup('needs_action'), isOrderGroup(undefined)]).toEqual([true, false, false]);
    expect(ORDER_GROUP_COUNT_CAP).toBe(100);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------ */
const T = 'T'; const BUYER = 'buyer-1'; const SELLER = 'seller-1';
const REASONS: Record<string, { code: string; textRequired: boolean }> = {
  'r-changed': { code: 'changed_mind', textRequired: false }, 'r-other': { code: 'other', textRequired: true },
};
function place(requiresPayment: boolean): Order {
  const id = '00000000-0000-7000-8000-0000000003a1';
  return Order.place({ id, tenantId: T, orderNo: 'KV-3A', checkoutGroupId: null, buyerUserId: BUYER, sellerUserId: SELLER, source: 'direct', currencyCode: 'INR',
    deliveryMethodId: null, deliveryAddressId: null, requiresPayment,
    items: [OrderItem.of({ id: 'i', orderId: id, orderCreatedAt: new Date(), tenantId: T, listingId: 'L', productId: 'P', titleSnapshot: 'Lot',
      quantity: 2, unitCode: 'quintal', unitPriceMinor: 615_000n, gstRatePct: null, hsnCode: null, batchId: null })] });
}
function world(order: Order, placedAwaitingPayment = false) {
  order.pullEvents();
  const outbox: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const audits: Array<Record<string, unknown>> = [];
  const updates: Order[] = [];
  const repo = {
    getForUpdate: jest.fn(async () => order),
    update: jest.fn(async (_tx: unknown, o: Order) => { updates.push(o); return true; }),
    cancelReasonTx: jest.fn(async (_tx: unknown, _t: string, id: string) => REASONS[id] ?? null),
    placedAwaitingPaymentTx: jest.fn(async () => placedAwaitingPayment),
  };
  const svc = new OrderService(
    { run: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({}) } as never,
    { write: async (_tx: unknown, e: { eventType: string; payload: Record<string, unknown> }) => { outbox.push(e); } } as never,
    { observe: () => undefined } as never,
    { write: async (_tx: unknown, a: Record<string, unknown>) => { audits.push(a); } } as never,
    repo as never,
  );
  return { svc, repo, outbox, audits, updates };
}
const buyer = { userId: BUYER, canModerate: false };
const seller = { userId: SELLER, canModerate: false };
const codeOf = async (p: Promise<unknown>) => p.then(() => 'OK', (e: { code?: string }) => e.code ?? String(e));

describe('STORE-3a · B2 the buyer\'s cancel needs a reason (founder D1 / D5)', () => {
  it('no reason → CANCEL_REASON_REQUIRED; unknown → CANCEL_REASON_UNKNOWN; `other` without a note → CANCEL_NOTE_REQUIRED — nothing written', async () => {
    const w = world(place(false));
    expect(await codeOf(w.svc.cancel(T, buyer, 'o', { reasonId: null }, null))).toBe('CANCEL_REASON_REQUIRED');
    expect(await codeOf(w.svc.cancel(T, buyer, 'o', { reasonId: 'r-nope' }, null))).toBe('CANCEL_REASON_UNKNOWN');
    expect(await codeOf(w.svc.cancel(T, buyer, 'o', { reasonId: 'r-other', note: '   ' }, null))).toBe('CANCEL_NOTE_REQUIRED');
    expect([w.updates.length, w.outbox.length, w.audits.length]).toEqual([0, 0, 0]);
  });
  it('a known reason cancels: the code travels in `orders.order_cancelled` (reasonCode) and the audit (reason); a note is kept only for `other`', async () => {
    const o = place(false); const w = world(o);
    expect(await codeOf(w.svc.cancel(T, buyer, 'o', { reasonId: 'r-changed', note: 'ignored for a reason that needs none' }, '10.0.0.1'))).toBe('OK');
    expect(o.status).toBe('cancelled');
    expect(o.toProps()).toMatchObject({ cancelReasonId: 'r-changed', cancelNote: null });
    expect(w.outbox.find((e) => e.eventType === 'orders.order_cancelled')?.payload).toMatchObject({ reasonId: 'r-changed', reasonCode: 'changed_mind', role: 'buyer' });
    expect(w.audits[0]).toMatchObject({ action: 'order.cancelled', reason: 'changed_mind', newValue: { status: 'cancelled', reasonCode: 'changed_mind', note: null } });
    const o2 = place(false); const w2 = world(o2);
    expect(await codeOf(w2.svc.cancel(T, buyer, 'o', { reasonId: 'r-other', note: '  bought locally  ' }, null))).toBe('OK');
    expect(o2.toProps().cancelNote).toBe('bought locally');
    expect(w2.audits[0]).toMatchObject({ reason: 'other', newValue: { note: 'bought locally' } });
  });
  it('the seller\'s decline keeps the optional reason (no vocabulary read); an order past `ready` is refused by the state machine first', async () => {
    const o = place(false); const w = world(o);
    expect(await codeOf(w.svc.cancel(T, seller, 'o', { reasonId: null }, null))).toBe('OK');
    expect(w.repo.cancelReasonTx).not.toHaveBeenCalled();
    expect(w.outbox.find((e) => e.eventType === 'orders.order_cancelled')?.payload).toMatchObject({ role: 'seller' });
    const late = place(false); late.confirm(SELLER); late.markPacked(SELLER); late.markReady(SELLER); late.markDelivered(SELLER);
    const w2 = world(late);
    expect(await codeOf(w2.svc.cancel(T, buyer, 'o', { reasonId: null }, null))).toBe('ORDER_ILLEGAL_TRANSITION');
    expect(w2.repo.cancelReasonTx).not.toHaveBeenCalled();
    // `ready` IS cancellable (the API's isCancellable) — the reason rule applies
    const ready = place(false); ready.confirm(SELLER); ready.markPacked(SELLER); ready.markReady(SELLER);
    expect(await codeOf(world(ready).svc.cancel(T, buyer, 'o', { reasonId: 'r-changed' }, null))).toBe('OK');
  });
  it('a stranger is still refused as not a party (ORDER_FORBIDDEN), never asked for a reason', async () => {
    const w = world(place(false));
    expect(await codeOf(w.svc.cancel(T, { userId: 'stranger', canModerate: false }, 'o', { reasonId: null }, null))).toBe('ORDER_FORBIDDEN');
  });
});

describe('STORE-3a · B5 the buyer\'s "I received it" is FAIL-CLOSED on an unfunded escrow (lead\'s D6, Law 9)', () => {
  const delivered = (requiresPayment: boolean) => {
    const o = place(requiresPayment);
    if (requiresPayment) o.markPaid(); else o.confirm(SELLER);
    o.markPacked(SELLER); o.markReady(SELLER); o.markDelivered(SELLER);
    return o;
  };
  it('a pay-on-delivery order: ORDER_COMPLETE_REQUIRES_ESCROW, nothing written, no `orders.order_completed` (so no settlement)', async () => {
    const o = delivered(false); const w = world(o, false);
    expect(await codeOf(w.svc.complete(T, buyer, 'o', null))).toBe('ORDER_COMPLETE_REQUIRES_ESCROW');
    expect(o.status).toBe('delivered');
    expect([w.updates.length, w.outbox.length, w.audits.length]).toEqual([0, 0, 0]);
  });
  it('an order paid online into escrow completes — the settlement event is emitted once', async () => {
    const o = delivered(true); const w = world(o, true);
    expect(await codeOf(w.svc.complete(T, buyer, 'o', null))).toBe('OK');
    expect(o.status).toBe('completed');
    expect(w.outbox.filter((e) => e.eventType === 'orders.order_completed')).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ action: 'order.completed', newValue: { status: 'completed', by: 'buyer', escrowFunded: true } });
  });
  it('a moderator\'s completion is not gated (named in §9 as the remaining door); the seller may not complete at all', async () => {
    const o = delivered(false); const w = world(o, false);
    expect(await codeOf(w.svc.complete(T, { userId: 'mod', canModerate: true }, 'o', null))).toBe('OK');
    expect(w.repo.placedAwaitingPaymentTx).not.toHaveBeenCalled();
    const w2 = world(delivered(false), false);
    expect(await codeOf(w2.svc.complete(T, seller, 'o', null))).toBe('ORDER_FORBIDDEN');
  });
});
