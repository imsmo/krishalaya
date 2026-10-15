// modules/listings/__tests__/store2c-reservation.spec.ts · PC-56 STORE-2c · B1 (founder D1) — THE NO-OVERSELL INVARIANT. Pure unit tests of the
// listing aggregate's `reserve` / `release` and the thousandths helpers (no DB). The live proof (two buyers, the row lock, the restock once) is
// apps/api/src/__tests__/store2c-checkout.integration.spec.ts (1).
import { Listing } from '../domain/listing.entity';
import { InsufficientStockError, InvalidPriceError, ListingNotEditableError } from '../domain/listing.errors';
import { stockMilli, stockNumber, stockText, InvalidStockQuantityError } from '../domain/listing-stock';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';

const base = {
  id: 'L1', tenantId: 't1', sellerUserId: 'u1', productId: 'p1', categoryId: 'c1', title: 'Groundnut 34 qtl', description: null,
  quantityTotal: 34.1, minOrderQty: 1, unitCode: 'quintal', priceMinor: 615_000n, currencyCode: 'INR',
  organicClaim: 'none' as const, saleType: 'direct' as const, pincode: null, regionId: null, lat: null, lng: null,
  visibility: 'public' as const, aiExtracted: false, publishAt: null, publishedAt: null, expiresAt: null,
};
const published = (o: Partial<typeof base> = {}) => { const l = Listing.create({ ...base, ...o }); l.publish(); l.pullEvents(); return l; };

describe('STORE-2c · B1 — listing-stock thousandths (never a float subtraction)', () => {
  it('reads numbers and decimal strings into thousandths and back', () => {
    expect(stockMilli('2.5')).toBe(2500n);
    expect(stockMilli(34.1)).toBe(34100n);
    expect(stockMilli('0.001')).toBe(1n);
    expect(stockText(31600n)).toBe('31.600');
    expect(stockNumber(31600n)).toBe(31.6);
  });
  it('refuses a negative, a 4th decimal or garbage', () => {
    for (const bad of ['-1', '1.2345', 'abc', '', -2]) expect(() => stockMilli(bad as string)).toThrow(InvalidStockQuantityError);
  });
  it('0.3 − 0.1 is exactly 0.2 (the float answer is 0.19999999999999998) — and the remainder is then exactly reservable', () => {
    expect(0.3 - 0.1).not.toBe(0.2);
    const l = published({ quantityTotal: 0.3, minOrderQty: 0.1 });
    l.reserve('0.1');
    expect(l.quantityAvailable).toBe(0.2);
    l.reserve('0.2');                                   // a float remainder of 0.1999… would have refused this
    expect([l.quantityAvailable, l.status]).toEqual([0, 'sold_out']);
  });
});

describe('STORE-2c · B1 — Listing.reserve: the no-oversell invariant', () => {
  it('decrements the remainder and emits stock_changed', () => {
    const l = published({ quantityTotal: 10 });
    l.reserve('4');
    expect(l.quantityAvailable).toBe(6);
    expect(l.pullEvents().map((e) => e.type)).toEqual(['listing.stock_changed']);
  });
  it('the remainder + 1 is refused with the EXACT remainder (all-or-nothing; nothing moves)', () => {
    const l = published({ quantityTotal: 10 });
    l.reserve('6.5');
    try { l.reserve('4.5'); throw new Error('not refused'); } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError);
      expect((e as InsufficientStockError).details).toEqual({ requested: 4.5, available: 3.5 });
    }
    expect(l.quantityAvailable).toBe(3.5);
  });
  it('the last unit sells the lot out (the tombstone the storefront shows) — and nothing more can be reserved', () => {
    const l = published({ quantityTotal: 3 });
    l.reserve('3');
    expect([l.quantityAvailable, l.status]).toEqual([0, 'sold_out']);
    expect(l.pullEvents().map((e) => e.type)).toEqual(['listing.stock_changed', 'listing.sold_out']);
    expect(() => l.reserve('0.001')).toThrow(ListingNotEditableError);   // sold_out is not on sale
  });
  it('only a PUBLISHED lot can be reserved (paused between preview and placement → refused)', () => {
    const l = published();
    l.pause();
    expect(() => l.reserve('1')).toThrow(ListingNotEditableError);
    const draft = Listing.create({ ...base });
    expect(() => draft.reserve('1')).toThrow(ListingNotEditableError);
  });
  it('a zero / negative quantity is refused', () => {
    const l = published();
    expect(() => l.reserve('0')).toThrow(InvalidPriceError);
    expect(() => l.reserve('-1')).toThrow(InvalidStockQuantityError);
  });
});

describe('STORE-2c · B1 — Listing.release (a cancelled order gives its stock back)', () => {
  it('adds the quantity back, never above the lot total, and re-publishes a sold-out lot', () => {
    const l = published({ quantityTotal: 5 });
    l.reserve('5');
    l.pullEvents();
    l.release('2.25');
    expect([l.quantityAvailable, l.status]).toEqual([2.25, 'published']);
    expect(l.pullEvents().map((e) => e.type)).toEqual(['listing.status_changed', 'listing.stock_changed']);
    l.release('10');                                     // more than was taken → capped at the total
    expect(l.quantityAvailable).toBe(5);
  });
  it('a paused lot gets its stock back but stays paused (a cancellation never re-publishes what the seller paused)', () => {
    const l = published({ quantityTotal: 5 });
    l.reserve('2');
    l.pause();
    l.release('2');
    expect([l.quantityAvailable, l.status]).toEqual([5, 'paused']);
  });
});

describe('STORE-2c · B1 — completion no longer decrements (the old handler is a logging no-op)', () => {
  it('OrderCompletedHandler.handle touches nothing and never throws', async () => {
    const h = new OrderCompletedHandler();
    await expect(h.handle({ v: 1, tenantId: 't1', listingId: 'L1', quantity: 4, orderId: 'o1' })).resolves.toBeUndefined();
  });
});
