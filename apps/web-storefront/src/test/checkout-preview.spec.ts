// Unit tests for the PURE checkout-preview helpers. No money is computed here (the server owns totals); these
// only normalize the coupon and choose the cheapest delivery method.
import type { DeliveryMethod } from '@krishalaya/sdk-js';
import { normalizeCoupon, pickDefaultMethod } from '../features/checkout/preview';

describe('normalizeCoupon', () => {
  it('trims + uppercases a valid code', () => {
    expect(normalizeCoupon('  harvest10 ')).toBe('HARVEST10');
    expect(normalizeCoupon('SAVE_5')).toBe('SAVE_5');
  });
  it('returns null for blank / nullish / too-short / illegal', () => {
    expect(normalizeCoupon(null)).toBeNull();
    expect(normalizeCoupon(undefined)).toBeNull();
    expect(normalizeCoupon('')).toBeNull();
    expect(normalizeCoupon('  ')).toBeNull();
    expect(normalizeCoupon('ab')).toBeNull();             // < 3 chars
    expect(normalizeCoupon('bad code!')).toBeNull();      // space + illegal char
  });
});

const m = (id: string, feeMinor: string): DeliveryMethod => ({ id, name: id, feeMinor });

describe('pickDefaultMethod', () => {
  it('returns null when there are no methods', () => {
    expect(pickDefaultMethod(null)).toBeNull();
    expect(pickDefaultMethod(undefined)).toBeNull();
    expect(pickDefaultMethod([])).toBeNull();
  });
  it('picks the cheapest by feeMinor (bigint-safe)', () => {
    const out = pickDefaultMethod([m('a', '5000'), m('b', '0'), m('c', '12000')]);
    expect(out?.id).toBe('b');
  });
  it('handles large minor-unit values without float error', () => {
    const out = pickDefaultMethod([m('a', '90000000000000000001'), m('b', '90000000000000000000')]);
    expect(out?.id).toBe('b');
  });
  it('is stable on ties (first wins)', () => {
    const out = pickDefaultMethod([m('a', '5000'), m('b', '5000')]);
    expect(out?.id).toBe('a');
  });
});
