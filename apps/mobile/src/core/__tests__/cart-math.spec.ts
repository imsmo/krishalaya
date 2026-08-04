// Unit tests for the PURE cart helpers (features/cart/cart-math). No React/native deps (SDK types are type-only).
// The server owns the subtotal; these only derive UI gating state from server fields.
import { cartCount, cartBlockers, canCheckout, clampQuantity, formatAddress, lineTotalMinor, stockState, checkoutSummaryRows, isFreeDelivery, previewUnitMap } from '../../features/cart/cart-math';
import type { Cart, CartItem, Address } from '@krishalaya/sdk-js';

describe('checkout summary (screen 96, from CheckoutPreview)', () => {
  const base = { subtotalMinor: '2981000', deliveryFeeMinor: '0', platformFeeMinor: '15000', discountMinor: '0' };
  it('isFreeDelivery is a pure zero check', () => {
    expect(isFreeDelivery('0')).toBe(true);
    expect(isFreeDelivery('15000')).toBe(false);
    expect(isFreeDelivery('')).toBe(false);
  });
  it('emits subtotal + delivery(free) + platform fee, omitting a zero discount', () => {
    expect(checkoutSummaryRows(base)).toEqual([
      { key: 'subtotal', minor: '2981000' },
      { key: 'delivery', minor: '0', free: true },
      { key: 'platformFee', minor: '15000' },
    ]);
  });
  it('includes a non-zero discount as a negative row; a paid delivery is not free', () => {
    const rows = checkoutSummaryRows({ ...base, deliveryFeeMinor: '5000', discountMinor: '10000' });
    expect(rows.find((r) => r.key === 'delivery')).toEqual({ key: 'delivery', minor: '5000', free: false });
    expect(rows.find((r) => r.key === 'discount')).toEqual({ key: 'discount', minor: '10000', negative: true });
  });
  it('previewUnitMap maps listingId → unitCode from seller slices; empty on null', () => {
    expect(previewUnitMap(null)).toEqual({});
    const preview = { currencyCode: 'INR', subtotalMinor: '0', deliveryFeeMinor: '0', platformFeeMinor: '0', discountMinor: '0', grandTotalMinor: '0', couponCode: null,
      sellers: [{ sellerUserId: 's1', subtotalMinor: '0', deliveryFeeMinor: '0', platformFeeMinor: '0', discountMinor: '0', totalMinor: '0',
        items: [{ listingId: 'L1', title: 'Wheat', quantity: 2, unitCode: 'quintal', unitPriceMinor: '288000', lineTotalMinor: '576000' }] }] };
    expect(previewUnitMap(preview)).toEqual({ L1: 'quintal' });
  });
});

describe('lineTotalMinor', () => {
  it('multiplies unit price (minor) by quantity as bigint', () => {
    expect(lineTotalMinor('288000', 2)).toBe('576000'); // ₹2,880 × 2 = ₹5,760
    expect(lineTotalMinor('288000', 1)).toBe('288000');
    expect(lineTotalMinor('288000', 0)).toBe('0');
  });
  it('handles huge values without float error, and bad input → 0', () => {
    expect(lineTotalMinor('99999999999999999999', 3)).toBe('299999999999999999997');
    expect(lineTotalMinor('abc', 2)).toBe('0');
    expect(lineTotalMinor('288000', -5)).toBe('0');
  });
});

describe('stockState', () => {
  it('in-stock when available, else out-of-stock', () => {
    expect(stockState(5)).toBe('in_stock');
    expect(stockState(0)).toBe('out_of_stock');
  });
});

const item = (over: Partial<CartItem> = {}): CartItem => ({
  listingId: over.listingId ?? 'l1', title: 'Wheat', quantity: 2, unitPriceMinor: '10000', lineTotalMinor: '20000',
  priceChanged: false, available: 10, purchasable: true, ...over,
});
const cart = (items: CartItem[]): Cart => ({ items, subtotalMinor: '0' });

describe('cartCount', () => {
  it('counts distinct line items; null → 0', () => {
    expect(cartCount(null)).toBe(0);
    expect(cartCount(cart([item(), item({ listingId: 'l2' })]))).toBe(2);
  });
});

describe('cartBlockers', () => {
  it('flags unavailable, insufficient, and price-changed items', () => {
    const c = cart([
      item({ listingId: 'a', purchasable: false }),
      item({ listingId: 'b', quantity: 99, available: 5 }),
      item({ listingId: 'c', priceChanged: true }),
      item({ listingId: 'd' }),
    ]);
    expect(cartBlockers(c)).toEqual([
      { listingId: 'a', reason: 'unavailable' },
      { listingId: 'b', reason: 'insufficient' },
      { listingId: 'c', reason: 'price_changed' },
    ]);
  });
});

describe('canCheckout', () => {
  it('requires a non-empty cart with every item purchasable + in stock', () => {
    expect(canCheckout(null)).toBe(false);
    expect(canCheckout(cart([]))).toBe(false);
    expect(canCheckout(cart([item()]))).toBe(true);
    expect(canCheckout(cart([item({ purchasable: false })]))).toBe(false);
    expect(canCheckout(cart([item({ quantity: 99, available: 5 })]))).toBe(false);
  });
  it('a price change does NOT hard-block checkout (buyer sees the new price)', () => {
    expect(canCheckout(cart([item({ priceChanged: true })]))).toBe(true);
  });
});

describe('clampQuantity', () => {
  it('keeps quantity within [1, available]', () => {
    expect(clampQuantity(2, +1, 10)).toBe(3);
    expect(clampQuantity(1, -1, 10)).toBe(1);
    expect(clampQuantity(10, +1, 10)).toBe(10);
    expect(clampQuantity(5, +1, 0)).toBe(6); // unknown stock (0) → no upper clamp
  });
});

describe('formatAddress', () => {
  it('joins the present parts, skipping empties', () => {
    const a: Address = { id: 'x', line1: '12 Green Rd', line2: '', village: 'Anand', pincode: '388001', isDefault: true };
    expect(formatAddress(a)).toBe('12 Green Rd, Anand, 388001');
  });
});
