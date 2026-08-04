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
