// apps/web-storefront/src/features/checkout/preview.ts · PURE checkout-preview helpers (no React/IO) → unit-tested.
// The authoritative bill + coupon discount come from the server (`checkout.preview`); the serviceable delivery
// options from `checkout.deliveryMethods`. These helpers only normalize input and choose a sensible default — they
// never compute money (Law 2: the server owns every total) and never fabricate a method.
import type { DeliveryMethod } from '@krishalaya/sdk-js';

/** Normalize a raw coupon string to the server's accepted shape (trim + upper), or null when blank/invalid.
 *  Mirrors the API DTO regex (^[A-Za-z0-9_-]{3,40}$) so we don't round-trip an obviously-bad code. */
export function normalizeCoupon(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return null;
  return code;
}

/** Pick the default delivery method to pre-select: the cheapest by feeMinor (bigint-safe string compare via BigInt),
 *  stable on ties (first wins). Returns null when there are no serviceable methods. */
export function pickDefaultMethod(methods: DeliveryMethod[] | null | undefined): DeliveryMethod | null {
  if (!Array.isArray(methods) || methods.length === 0) return null;
  let best = methods[0];
  for (const m of methods) {
    if (toMinor(m.feeMinor) < toMinor(best.feeMinor)) best = m;
  }
  return best;
}

function toMinor(s: string): bigint {
  try { return BigInt(s); } catch { return 0n; }
}

/* PC-56 TENANT-10b · a declined coupon is a KIND MESSAGE, never an error code. The API answers a coupon it will not apply
 * (the cooperative's wallet cannot cover it, the budget is spent, the buyer's per-user limit is reached, …) with
 * `couponNotice: { outcome, messageKey }` — on the preview AND on the placed order, the same decision both times — and
 * the order goes ahead at the normal price. The storefront renders only keys it knows; anything else is the generic line. */
export const DECLINED_COUPON_OUTCOMES = ['user_limit', 'budget_exhausted', 'window', 'tenant_funds_unavailable', 'invalid', 'max_uses_reached', 'not_applicable'] as const;
export type DeclinedCouponOutcome = (typeof DECLINED_COUPON_OUTCOMES)[number];
export function isDeclinedOutcome(v: unknown): v is DeclinedCouponOutcome {
  return typeof v === 'string' && (DECLINED_COUPON_OUTCOMES as readonly string[]).includes(v);
}
/** The buyer's kind message key for a declined coupon outcome (null when the outcome is not one this console knows). */
export function couponNoticeKey(outcome: unknown): string | null {
  return isDeclinedOutcome(outcome) ? `coupon.notice.${outcome}` : null;
}
/** The preview's first seller slice carries the coupon decision (the coupon applies to the primary seller only). */
export function previewCouponOutcome(preview: { sellers: Array<{ couponNotice?: { outcome: string } }> } | null): string | null {
  return preview?.sellers.find((s) => s.couponNotice)?.couponNotice?.outcome ?? null;
}
