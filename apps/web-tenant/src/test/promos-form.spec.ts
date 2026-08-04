import { buildPromotion, buildCoupon } from '../features/promos/form';

const now = new Date('2026-08-04T10:00:00Z');

describe('features/promos/form (PC-28b)', () => {
  it('promotion: percent needs 1–100; flat needs a positive amount; window ordered + future', () => {
    const ok = buildPromotion({ promoType: 'festival', name: 'Diwali 10%', discountType: 'percent', percentOff: '10', amountMajor: '', minOrderMajor: '500', startsLocal: '2026-10-01T00:00', endsLocal: '2026-11-01T00:00' }, now);
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.value.rules.percentOff).toBe(10); expect(ok.value.rules.minOrderMinor).toBe('50000'); }
    const flat = buildPromotion({ promoType: 'cashback', name: 'Flat ₹50', discountType: 'flat', percentOff: '', amountMajor: '50', minOrderMajor: '', startsLocal: '2026-09-01T00:00', endsLocal: '2026-09-10T00:00' }, now);
    expect(flat.ok).toBe(true);
    if (flat.ok) expect(flat.value.rules.amountOffMinor).toBe('5000');
    expect(buildPromotion({ promoType: 'festival', name: 'Bad', discountType: 'percent', percentOff: '0', amountMajor: '', minOrderMajor: '', startsLocal: '2026-09-01T00:00', endsLocal: '2026-09-02T00:00' }, now)).toEqual({ ok: false, error: 'discount' });
    expect(buildPromotion({ promoType: 'festival', name: 'Bad', discountType: 'percent', percentOff: '10', amountMajor: '', minOrderMajor: '', startsLocal: '2026-09-02T00:00', endsLocal: '2026-09-01T00:00' }, now)).toEqual({ ok: false, error: 'window' });
    expect(buildPromotion({ promoType: 'mystery', name: 'Bad', discountType: 'percent', percentOff: '10', amountMajor: '', minOrderMajor: '', startsLocal: '2026-09-01T00:00', endsLocal: '2026-09-02T00:00' }, now)).toEqual({ ok: false, error: 'type' });
  });

  it('coupon: code pattern + optional positive limits', () => {
    expect(buildCoupon({ promotionId: 'p1', code: 'DIWALI-10', maxUses: '1000', perUserLimit: '2' }))
      .toEqual({ ok: true, value: { promotionId: 'p1', code: 'DIWALI-10', maxUses: 1000, perUserLimit: 2 } });
    expect(buildCoupon({ promotionId: 'p1', code: 'ab', maxUses: '', perUserLimit: '' })).toEqual({ ok: false, error: 'code' });
    expect(buildCoupon({ promotionId: '', code: 'GOOD', maxUses: '', perUserLimit: '' })).toEqual({ ok: false, error: 'promo' });
    expect(buildCoupon({ promotionId: 'p1', code: 'GOOD', maxUses: '0', perUserLimit: '' })).toEqual({ ok: false, error: 'limits' });
  });
});
