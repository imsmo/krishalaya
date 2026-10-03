// Unit tests for the PURE checkout-preview helpers. No money is computed here (the server owns totals); these
// only normalize the coupon and choose the cheapest delivery method.
import type { DeliveryMethod } from '@krishalaya/sdk-js';
import { PLACE_REFUSAL_KEYS, normalizeCoupon, pickDefaultMethod, placeRefusalStatus } from '../features/checkout/preview';
import { en } from '../i18n/en';

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

// PC-56 TENANT-10b · a declined coupon is a KIND MESSAGE KEY, never an error code — and every key exists ×3.
import { DECLINED_COUPON_OUTCOMES, couponNoticeKey, isDeclinedOutcome, previewCouponOutcome } from '../features/checkout/preview';
import { en as en10b } from '../i18n/en';
import { hi as hi10b } from '../i18n/hi';
import { gu as gu10b } from '../i18n/gu';
describe('TENANT-10b · declined coupon notices', () => {
  it('maps the API outcomes to kind message keys; unknown outcomes fall back to the generic line', () => {
    expect(couponNoticeKey('tenant_funds_unavailable')).toBe('coupon.notice.tenant_funds_unavailable');
    expect(couponNoticeKey('applied')).toBeNull(); expect(couponNoticeKey('TENANT_FUNDS_UNAVAILABLE')).toBeNull(); expect(isDeclinedOutcome(undefined)).toBe(false);
    expect(previewCouponOutcome({ sellers: [{}, { couponNotice: { outcome: 'user_limit' } }] })).toBe('user_limit');
    expect(previewCouponOutcome(null)).toBeNull();
  });
  it('every notice exists in en, hi and gu, and none of them is an error code', () => {
    for (const o of [...DECLINED_COUPON_OUTCOMES, 'placedAtNormalPrice']) {
      const k = `coupon.notice.${o}`;
      for (const cat of [en10b, hi10b, gu10b]) { expect(typeof (cat as Record<string, string>)[k]).toBe('string'); expect((cat as Record<string, string>)[k]).not.toMatch(/[A-Z]{3,}_[A-Z]/); }
    }
  });
});

describe('PC-56 TENANT-SW-a · placement delivery refusals are said kindly', () => {
  it('a pincode in no active zone → "we don’t deliver here yet", never the raw code', () => {
    expect(placeRefusalStatus('UNSERVICEABLE_PINCODE')).toBe('unserviceable');
    expect(placeRefusalStatus('DELIVERY_ADDRESS_REQUIRED')).toBe('needAddress');
    expect(placeRefusalStatus('DELIVERY_METHOD_NOT_SERVING')).toBe('method');
    expect(placeRefusalStatus('DELIVERY_METHOD_REQUIRED')).toBe('method');
    expect(placeRefusalStatus('INSUFFICIENT_STOCK')).toBe('err');
    expect(placeRefusalStatus(null)).toBe('err');
    for (const k of Object.values(PLACE_REFUSAL_KEYS)) expect((en as Record<string, string>)[k]).toBeTruthy();
  });
});
