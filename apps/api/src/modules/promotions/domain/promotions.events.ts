// modules/promotions/domain/promotions.events.ts · integration events (via outbox, Law 4).
export const PromotionEventType = {
  PromotionCreated:  'promotions.promotion_created',
  PromotionUpdated:  'promotions.promotion_updated',
  CouponCreated:     'promotions.coupon_created',
  CouponRedeemed:    'promotions.coupon_redeemed',   // a coupon was applied to an order (discount reserved from the tenant wallet)
  CouponReleased:    'promotions.coupon_released',   // PC-56 TENANT-10b: the reservation went back to the tenant (order cancelled/refunded)
  CouponSettled:     'promotions.coupon_settled',    // PC-56 TENANT-10b: the reservation was paid to the seller at settlement
  BudgetExhausted:   'promotions.promotion_budget_exhausted',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };

/** Every promo_type a row may carry (rows written before PC-56 TENANT-10b carry the first four). */
export const PROMO_TYPES = ['recharge_bonus', 'cashback', 'listing_boost', 'festival', 'discount'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];
/**
 * PC-56 TENANT-10b · F-24 — THE TYPES WITH AN ENGINE. A promotion's money engine is the coupon DISCOUNT (percent or flat,
 * reserved from the tenant wallet at redemption). `discount` is that engine under its own name; `festival` is the same
 * engine whose window the festival scheduler opens and closes. `cashback`, `recharge_bonus` and `listing_boost` have NO
 * engine — they behaved as an order discount under a label that promised something else — so creating one is refused by
 * name (PROMO_TYPE_NO_ENGINE) and an existing row prints "no engine — label only".
 */
export const ENGINE_PROMO_TYPES = ['discount', 'festival'] as const;
export const NO_ENGINE_PROMO_TYPES = ['cashback', 'recharge_bonus', 'listing_boost'] as const;
export const hasEngine = (t: string): boolean => (ENGINE_PROMO_TYPES as readonly string[]).includes(t);

export const DISCOUNT_TYPES = ['percent', 'flat'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
