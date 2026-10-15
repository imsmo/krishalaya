// modules/orders/__tests__/store2c-checkout-money.spec.ts · PC-56 STORE-2c — the orders side of the money wave, as unit tests (no Postgres):
//   B4 the order's currency is the LOTS' own — a mixed cart refused MIXED_CURRENCY by name (never an assumed 'INR');
//   B1 the order carries its reservation marker; a cancel says whether it reserved; the restock handler releases each line ONCE (a replay
//      finds the marker cleared and releases nothing); an order that never reserved releases nothing.
// The live proofs are apps/api/src/__tests__/store2c-checkout.integration.spec.ts (1) and (5).
import { oneCurrency } from '../domain/cart-rules';
import { MixedCurrencyError } from '../domain/orders.errors';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';
import { OrderCancelledRestockHandler } from '../events/handlers/order-cancelled-restock.handler';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';

describe('STORE-2c · B4 — one currency, the lots\' own (Rule Zero)', () => {
  it('a single currency is returned upper-cased, whatever the case it was stored in', () => {
    expect(oneCurrency(['INR', 'inr', 'INR'])).toBe('INR');
    expect(oneCurrency(['KES'])).toBe('KES');
  });
  it('two currencies → MIXED_CURRENCY naming both; none / a malformed code → MIXED_CURRENCY too (never "INR" by default)', () => {
    try { oneCurrency(['INR', 'KES']); throw new Error('not refused'); } catch (e) {
      expect(e).toBeInstanceOf(MixedCurrencyError);
      expect([(e as MixedCurrencyError).code, (e as MixedCurrencyError).details]).toEqual(['MIXED_CURRENCY', { currencies: ['INR', 'KES'] }]);
    }
    expect(() => oneCurrency([])).toThrow(MixedCurrencyError);
    expect(() => oneCurrency([null, undefined])).toThrow(MixedCurrencyError);
    expect(() => oneCurrency(['RUPEES'])).toThrow(MixedCurrencyError);
  });
});

function order(stockReserved: boolean, currencyCode = 'INR') {
  const id = uuidv7();
  const it = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: new Date(), tenantId: 't', listingId: 'L1', productId: 'p', titleSnapshot: 'Wheat',
    quantity: 2.5, unitCode: 'quintal', unitPriceMinor: 250_000n, gstRatePct: null, hsnCode: null, batchId: null });
  return Order.place({ id, tenantId: 't', orderNo: 'KV-1', checkoutGroupId: null, buyerUserId: 'b', sellerUserId: 's', source: 'direct', currencyCode,
    items: [it], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: true, stockReserved });
}

describe('STORE-2c · B1 — the order carries its reservation; the cancel says so', () => {
  it('placement that reserved stamps stockReservedAt; one that did not leaves it null', () => {
    expect(order(true).toProps().stockReservedAt).toBeInstanceOf(Date);
    expect(order(false).toProps().stockReservedAt).toBeNull();
  });
  it('the order is in the lots\' currency (a KES lot → a KES order)', () => {
    expect(order(true, 'KES').toProps().currencyCode).toBe('KES');
  });
  it('the cancel event (buyer and system) carries stockReserved + the buyer, additively', () => {
    const o = order(true); o.pullEvents(); o.cancel('b', null, true);
    const c = o.pullEvents().find((e) => e.type === 'orders.order_cancelled')!;
    expect(c.payload).toMatchObject({ role: 'buyer', stockReserved: true, buyerUserId: 'b', currencyCode: 'INR' });
    const s = order(false); s.pullEvents(); s.systemCancel('seller_confirm_timeout');
    expect(s.pullEvents().find((e) => e.type === 'orders.order_cancelled')!.payload).toMatchObject({ role: 'system', stockReserved: false });
  });
});

describe('STORE-2c · B1 — the restock handler releases ONCE', () => {
  class FakeUow extends UnitOfWork {
    async run<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>): Promise<T> { return fn({ tenantId, query: async () => ({ rows: [], rowCount: 0 }) } as unknown as TxContext); }
  }
  function harness(lines: Array<{ listingId: string; quantity: string }> | null) {
    let marker = lines !== null;
    const released: Array<[string, string]> = []; const dropped: string[] = [];
    const repo = { releaseReservationTx: async () => { if (!marker) return null; marker = false; return lines; } };
    const listings = { releaseInTx: async (_tx: TxContext, _t: string, id: string, q: string) => { released.push([id, q]); }, invalidate: async (_t: string, id: string) => { dropped.push(id); } };
    const h = new OrderCancelledRestockHandler(new FakeUow(), { inc: () => undefined, observe: () => undefined } as never, repo as never, listings as never);
    return { h, released, dropped };
  }
  const ev = (orderId: string) => ({ id: '9', tenantId: 't', aggregateType: 'order', aggregateId: orderId, eventType: 'orders.order_cancelled', payload: { v: 1, orderId } });
  it('a reserved order: every line released with its exact 3-place quantity; the cache dropped after; a replay releases nothing', async () => {
    const { h, released, dropped } = harness([{ listingId: 'L1', quantity: '2.500' }, { listingId: 'L2', quantity: '10.000' }]);
    await h.handle(ev('o1'));
    await h.handle(ev('o1'));
    expect(h.eventType).toBe('orders.order_cancelled');
    expect(released).toEqual([['L1', '2.500'], ['L2', '10.000']]);
    expect(dropped).toEqual(['L1', 'L2']);
  });
  it('an order that never reserved releases nothing', async () => {
    const { h, released } = harness(null);
    await h.handle(ev('o2'));
    expect(released).toEqual([]);
  });
});
