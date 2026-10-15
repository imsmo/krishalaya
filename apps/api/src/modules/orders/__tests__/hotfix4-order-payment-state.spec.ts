// PC-56 HOTFIX-4 · A1 — the order's payment state, said by the ORDER (survey F-1). A table over EVERY status of order.state.ts, both ways
// an order can be placed (awaiting an online payment / not), plus the two cancellation shapes. Also: a seller can no longer confirm an order
// that is still awaiting the buyer's online payment — the one other door to `payment_pending → confirmed`, closed so "paid" is true.
import { ORDER_STATUSES, OrderStatus } from '../domain/order.state';
import { orderPaymentState, ORDER_PAYMENT_STATES, OrderPaymentFacts } from '../domain/order-payment-state';
import { Order } from '../domain/order.entity';
import { OrderItem } from '../domain/order-item.entity';

const ONLINE: OrderPaymentFacts = { placedAwaitingPayment: true, cancelledFrom: null, cancelledBySystem: false };
const COD: OrderPaymentFacts = { placedAwaitingPayment: false, cancelledFrom: null, cancelledBySystem: false };

const EXPECTED: Record<OrderStatus, [online: string, cod: string]> = {
  created: ['none', 'none'],
  payment_pending: ['pending', 'pending'],
  confirmed: ['paid', 'none'],
  packed: ['paid', 'none'],
  ready: ['paid', 'none'],
  picked_up: ['paid', 'none'],
  in_transit: ['paid', 'none'],
  out_for_delivery: ['paid', 'none'],
  delivered: ['paid', 'none'],
  completed: ['paid', 'none'],
  disputed: ['paid', 'none'],
  partially_fulfilled: ['paid', 'none'],
  refunded: ['refunded', 'refunded'],
  partially_refunded: ['refunded', 'refunded'],
  cancelled: ['cancelled', 'cancelled'],
};

describe('HOTFIX-4 · A1 orderPaymentState — every order status, both placements', () => {
  it('the table covers every status of the machine (a new status without a decision fails here)', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORDER_STATUSES].sort());
  });
  it.each(ORDER_STATUSES.map((s) => [s]))('%s', (s) => {
    const [online, cod] = EXPECTED[s as OrderStatus];
    expect(orderPaymentState(s as OrderStatus, ONLINE)).toBe(online);
    expect(orderPaymentState(s as OrderStatus, COD)).toBe(cod);
    expect(ORDER_PAYMENT_STATES).toContain(orderPaymentState(s as OrderStatus, ONLINE));
  });
  it("a paid order ('confirmed', placed awaiting payment) is PAID — never pending (the F-1 bug)", () => {
    expect(orderPaymentState('confirmed', ONLINE)).toBe('paid');
    expect(orderPaymentState('confirmed', ONLINE)).not.toBe('pending');
  });
  it('an unpaid order the system cancelled at the end of its window is EXPIRED; a person\'s cancel is CANCELLED', () => {
    expect(orderPaymentState('cancelled', { ...ONLINE, cancelledFrom: 'payment_pending', cancelledBySystem: true })).toBe('expired');
    expect(orderPaymentState('cancelled', { ...ONLINE, cancelledFrom: 'payment_pending', cancelledBySystem: false })).toBe('cancelled');
    expect(orderPaymentState('cancelled', { ...COD, cancelledFrom: 'created', cancelledBySystem: true })).toBe('cancelled');
    expect(orderPaymentState('cancelled', { ...ONLINE, cancelledFrom: 'confirmed', cancelledBySystem: false })).toBe('cancelled');
  });
});

describe('HOTFIX-4 · Order.confirm refuses an order still awaiting online payment', () => {
  const SELLER = '00000000-0000-7000-8000-0000000000a1'; const BUYER = '00000000-0000-7000-8000-0000000000b1';
  const place = (requiresPayment: boolean) => Order.place({
    id: '00000000-0000-7000-8000-0000000000c1', tenantId: '00000000-0000-7000-8000-0000000000d1', orderNo: 'KV-T', checkoutGroupId: null,
    buyerUserId: BUYER, sellerUserId: SELLER, source: 'direct', currencyCode: 'INR', deliveryMethodId: null, deliveryAddressId: null, requiresPayment,
    items: [OrderItem.of({ id: '00000000-0000-7000-8000-0000000000e1', orderId: '00000000-0000-7000-8000-0000000000c1', orderCreatedAt: new Date(),
      tenantId: '00000000-0000-7000-8000-0000000000d1', listingId: '00000000-0000-7000-8000-0000000000f1', productId: '00000000-0000-7000-8000-0000000000f2', titleSnapshot: 'Lot',
      quantity: 1, unitCode: 'quintal', unitPriceMinor: 100n, gstRatePct: null, hsnCode: null, batchId: null })],
  });
  it('payment_pending → the seller confirm is refused by name (ORDER_AWAITING_PAYMENT); markPaid still confirms', () => {
    const o = place(true);
    expect(() => o.confirm(SELLER)).toThrow(/ORDER_AWAITING_PAYMENT|awaiting/);
    expect(o.status).toBe('payment_pending');
    o.markPaid();
    expect(o.status).toBe('confirmed');
  });
  it('a COD order (created) is still confirmed by its seller', () => {
    const o = place(false);
    o.confirm(SELLER);
    expect(o.status).toBe('confirmed');
  });
});

describe('HOTFIX-4 · A2 the order detail\'s rows sum to its total (every placement-time row non-zero)', () => {
  it('subtotal + delivery + tax − discount + platformFee + buyerCommission = total, all minor-unit strings; paymentState from the timeline', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OrderService } = require('../services/order.service');
    const id = '00000000-0000-7000-8000-0000000000c2';
    const o = Order.place({
      id, tenantId: 'T', orderNo: 'KV-A2', checkoutGroupId: 'G', buyerUserId: 'B', sellerUserId: 'S', source: 'direct', currencyCode: 'INR',
      deliveryMethodId: null, deliveryAddressId: null, requiresPayment: true, deliveryFeeMinor: 7_500n, platformFeeMinor: 46_125n,
      discountMinor: 10_000n, buyerCommissionMinor: 43_542n,
      items: [OrderItem.of({ id: 'i', orderId: id, orderCreatedAt: new Date(), tenantId: 'T', listingId: 'L', productId: 'P', titleSnapshot: 'Lot',
        quantity: 3, unitCode: 'quintal', unitPriceMinor: 615_000n, gstRatePct: null, hsnCode: null, batchId: null })],
    });
    o.markPaid();
    const repo = { getVisible: jest.fn().mockResolvedValue(o), itemsOf: jest.fn().mockResolvedValue([]),
      paymentFacts: jest.fn().mockResolvedValue({ placedAwaitingPayment: true, cancelledFrom: null, cancelledBySystem: false }),
      organisationOf: jest.fn().mockResolvedValue({ slug: 'anand-fpo', name: 'Anand FPO' }) };   // PC-56 HOTFIX-5 · B3: the buyer's view names the organisation
    const svc = new OrderService({} as never, {} as never, {} as never, {} as never, repo as never);
    const d = await svc.getById('T', { userId: 'B', canModerate: false }, id);
    for (const k of ['subtotalMinor', 'deliveryFeeMinor', 'discountMinor', 'platformFeeMinor', 'buyerCommissionMinor']) expect(BigInt(d[k])).toBeGreaterThan(0n);
    const rows = BigInt(d.subtotalMinor) + BigInt(d.deliveryFeeMinor) + BigInt(d.taxMinor) - BigInt(d.discountMinor) + BigInt(d.platformFeeMinor) + BigInt(d.buyerCommissionMinor);
    expect(rows.toString()).toBe(d.totalMinor);
    expect([d.paymentState, d.currencyCode, d.checkoutGroupId, d.taxMinor]).toEqual(['paid', 'INR', 'G', '0']);   // tax: 0 at placement by the named rule (extracted on the invoice)
  });
});
