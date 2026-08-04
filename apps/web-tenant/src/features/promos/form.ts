// apps/web-tenant/src/features/promos/form.ts · PURE validation for promotions + coupons (PC-28b). Mirrors
// CreatePromotionSchema/PromoRulesSchema/CreateCouponSchema. Money float-free; percent 1–100; window must be a
// future-ordered pair. No IO → unit-tested.
import { parseMajorToMinor } from '../listings/form';

export const PROMO_TYPES = ['festival', 'cashback', 'recharge_bonus', 'listing_boost'] as const;
export const DISCOUNT_TYPES = ['percent', 'flat'] as const;

export type PromoResult =
  | { ok: true; value: { promoType: string; defaultName: string; rules: { discountType: string; percentOff?: number; amountOffMinor?: string; minOrderMinor?: string }; startsAt: string; endsAt: string } }
  | { ok: false; error: 'type' | 'name' | 'discount' | 'window' };

export function buildPromotion(raw: { promoType: string; name: string; discountType: string; percentOff: string; amountMajor: string; minOrderMajor: string; startsLocal: string; endsLocal: string }, now: Date = new Date()): PromoResult {
  if (!(PROMO_TYPES as readonly string[]).includes(raw.promoType)) return { ok: false, error: 'type' };
  const defaultName = raw.name.trim();
  if (defaultName.length < 3 || defaultName.length > 150) return { ok: false, error: 'name' };
  if (!(DISCOUNT_TYPES as readonly string[]).includes(raw.discountType)) return { ok: false, error: 'discount' };

  const rules: { discountType: string; percentOff?: number; amountOffMinor?: string; minOrderMinor?: string } = { discountType: raw.discountType };
  if (raw.discountType === 'percent') {
    const p = Number.parseInt(raw.percentOff, 10);
    if (!Number.isInteger(p) || p < 1 || p > 100) return { ok: false, error: 'discount' };
    rules.percentOff = p;
  } else {
    const amountOffMinor = parseMajorToMinor(raw.amountMajor);
    if (amountOffMinor === undefined || amountOffMinor === '0') return { ok: false, error: 'discount' };
    rules.amountOffMinor = amountOffMinor;
  }
  const minOrder = raw.minOrderMajor.trim();
  if (minOrder) {
    const minOrderMinor = parseMajorToMinor(minOrder);
    if (minOrderMinor === undefined) return { ok: false, error: 'discount' };
    rules.minOrderMinor = minOrderMinor;
  }

  const starts = new Date(raw.startsLocal); const ends = new Date(raw.endsLocal);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends.getTime() <= starts.getTime() || ends.getTime() <= now.getTime()) {
    return { ok: false, error: 'window' };
  }
  return { ok: true, value: { promoType: raw.promoType, defaultName, rules, startsAt: starts.toISOString(), endsAt: ends.toISOString() } };
}

export type CouponResult =
  | { ok: true; value: { promotionId: string; code: string; maxUses?: number; perUserLimit?: number } }
  | { ok: false; error: 'promo' | 'code' | 'limits' };

export function buildCoupon(raw: { promotionId: string; code: string; maxUses: string; perUserLimit: string }): CouponResult {
  const promotionId = raw.promotionId.trim();
  if (!promotionId) return { ok: false, error: 'promo' };
  const code = raw.code.trim();
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) return { ok: false, error: 'code' };
  const value: { promotionId: string; code: string; maxUses?: number; perUserLimit?: number } = { promotionId, code };
  if (raw.maxUses.trim()) {
    const n = Number.parseInt(raw.maxUses, 10);
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'limits' };
    value.maxUses = n;
  }
  if (raw.perUserLimit.trim()) {
    const n = Number.parseInt(raw.perUserLimit, 10);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { ok: false, error: 'limits' };
    value.perUserLimit = n;
  }
  return { ok: true, value };
}
