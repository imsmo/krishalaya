// modules/promotions/domain/coupon-outcome.ts · PC-56 TENANT-10b · A1 / A4 / A5 / F-21 / F-22 — ONE DECISION. PURE.
//
// "Can this coupon be applied to this order, and if not, why" used to be answered TWICE, differently: `validate()` (the
// checkout preview) checked the window, the global cap and the discount; `redeemInTx()` (checkout itself) additionally
// checked the per-user limit and the budget — so the preview showed a discount checkout then refused (F-22), and the
// budget refusal THREW inside the checkout transaction and took the buyer's whole order down with it (F-21).
//
// Now both ask this one function over the same facts, gathered the same way (the preview from the replica, checkout under
// the coupon + promotion row locks). The answer is an OUTCOME, never an exception: a declined coupon means the order
// proceeds at full price, the attempt is recorded (`coupon_redemption_attempts`), and the buyer is shown a kind message
// KEY — not an error code. The order of the checks is the order a buyer would want to be told.
import type { PromotionStatus } from './promotion.state';

export const COUPON_OUTCOMES = ['applied', 'user_limit', 'budget_exhausted', 'window', 'tenant_funds_unavailable', 'invalid', 'max_uses_reached', 'not_applicable'] as const;
export type CouponOutcome = (typeof COUPON_OUTCOMES)[number];
export type DeclinedOutcome = Exclude<CouponOutcome, 'applied'>;

/** The brief's buyer notice for the funds case, by its own name. */
export const TENANT_FUNDS_UNAVAILABLE = 'TENANT_FUNDS_UNAVAILABLE';

export interface CouponFacts {
  /** null = the code matched no live coupon of this tenant (unknown, deleted, or its promotion row is gone). */
  coupon: { hasGlobalCapacity: boolean; perUserLimit: number } | null;
  promotion: { status: PromotionStatus; canReserve: boolean } | null;
  /** The discount the promotion's rules give on this subtotal (0 = below the minimum / computes to nothing). */
  discountMinor: bigint;
  /** Live (not released) redemptions of this coupon by this buyer. */
  usedByUser: number;
  /** Can the tenant's Main cover the reservation? null = not asked yet (checkout asks the wallet itself, under lock). */
  fundsAvailable: boolean | null;
}

export function couponDecision(f: CouponFacts): CouponOutcome {
  if (!f.coupon || !f.promotion) return 'invalid';
  if (f.promotion.status === 'exhausted') return 'budget_exhausted';
  if (f.promotion.status !== 'active') return 'window';                  // scheduled · expired · paused
  if (!f.coupon.hasGlobalCapacity) return 'max_uses_reached';
  if (f.discountMinor <= 0n) return 'not_applicable';
  if (f.usedByUser >= f.coupon.perUserLimit) return 'user_limit';
  if (!f.promotion.canReserve) return 'budget_exhausted';
  if (f.fundsAvailable === false) return 'tenant_funds_unavailable';
  return 'applied';
}

/**
 * The buyer-facing message KEY for a declined coupon — rendered by the storefront / app in the buyer's language. Kind by
 * design: the buyer is never told the cooperative's wallet is short, only that the offer cannot be used on this order and
 * the order goes ahead at the normal price.
 */
export function couponNoticeKey(outcome: DeclinedOutcome): string { return `coupon.notice.${outcome}`; }

/** The notice a checkout / preview response carries when the coupon was NOT applied. `code` is the stable machine name. */
export interface CouponNotice { code: string; outcome: DeclinedOutcome; messageKey: string }
export function couponNotice(outcome: DeclinedOutcome): CouponNotice {
  return { code: outcome === 'tenant_funds_unavailable' ? TENANT_FUNDS_UNAVAILABLE : outcome.toUpperCase(), outcome, messageKey: couponNoticeKey(outcome) };
}
