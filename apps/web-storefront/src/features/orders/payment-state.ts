// apps/web-storefront/src/features/orders/payment-state.ts · PC-56 HOTFIX-4 · C1/C2 (survey F-1 / B1, founder D2) — WHAT THE BUYER HAS PAID,
// SAID BY THE ORDER. PURE.
//
// **THE DEFECT THIS REPLACES.** `features/payments/status.ts` classified an ORDER's status with a PAYMENT vocabulary
// (`captured|succeeded|paid|settled|success`). A paid order is `confirmed`, in none of those, so a buyer who had paid read "Payment is still
// being confirmed" and was offered Pay again (which the API then refused); and with `online_payments` OFF (the seed) every order is
// `created` — and the buyer was sent to a Pay step whose route answers 404. Its own spec pinned the bug.
//
// **NOW THE STOREFRONT GUESSES NOTHING.** The API serialises the order's `paymentState` (apps/api orders/domain/order-payment-state.ts — the
// one mapping, exhaustive over the order state machine). This module only maps that closed vocabulary to what the page does next and which
// sentence it prints. A value outside the vocabulary is `unknown` — never treated as paid, never offered a Pay button.
export const ORDER_PAYMENT_STATES = ['none', 'pending', 'paid', 'refunded', 'cancelled', 'expired'] as const;
export type OrderPaymentState = (typeof ORDER_PAYMENT_STATES)[number];
export type KnownOrUnknown = OrderPaymentState | 'unknown';

/** The order's own payment state, exactly as the API said it — anything else is `unknown` (no string guessing, no case folding). */
export function paymentStateOf(order: { paymentState?: unknown } | null | undefined): KnownOrUnknown {
  const v = order?.paymentState;
  return typeof v === 'string' && (ORDER_PAYMENT_STATES as readonly string[]).includes(v) ? (v as OrderPaymentState) : 'unknown';
}

/** Only an order AWAITING the buyer's online payment has a Pay step. `none` (no online payment — the seller confirms, payment on delivery)
 *  NEVER shows a Pay button (founder D2); paid / closed orders go to their confirmation; unknown shows neither. */
export function showsPayStep(state: KnownOrUnknown): boolean { return state === 'pending'; }

/** /checkout/pay: where an order in this state belongs. */
export function payPageRoute(state: KnownOrUnknown): 'pay' | 'confirm' { return state === 'pending' ? 'pay' : 'confirm'; }

/** The confirmation sentence for each state (catalogue keys — every one en/hi/gu). */
export const CONFIRM_STATE_KEYS: Readonly<Record<KnownOrUnknown, string>> = Object.freeze({
  none: 'checkout.state.none',
  pending: 'checkout.state.pending',
  paid: 'checkout.state.paid',
  refunded: 'checkout.state.refunded',
  cancelled: 'checkout.state.cancelled',
  expired: 'checkout.state.expired',
  unknown: 'checkout.state.unknown',
});
export function confirmStateKey(state: KnownOrUnknown): string { return CONFIRM_STATE_KEYS[state]; }

/** States the page renders as good news (the notice style) vs. as something to act on / closed (the warning style). */
export function isSettledGood(state: KnownOrUnknown): boolean { return state === 'paid' || state === 'none'; }

/** PC-56 HOTFIX-4 · C2 / A9 — after placement, where the buyer goes, decided by the ORDERS' payment states (never by calling the payments
 *  route when it is off). One order awaiting payment → its Pay step. Anything else → the confirmation page, which names EVERY order of the
 *  checkout (the group when there is one), each with its own Pay link when it awaits payment. */
export function afterPlacementHref(result: { orders: Array<{ id: string; paymentState?: unknown }>; checkoutGroupId: string | null }, couponNotice: string | null = null): string | null {
  const orders = result.orders ?? [];
  if (orders.length === 0) return null;
  const cn = couponNotice ? `&cn=${encodeURIComponent(couponNotice)}` : '';
  if (orders.length === 1 && paymentStateOf(orders[0]) === 'pending') return `/checkout/pay?o=${encodeURIComponent(orders[0].id)}${cn}`;
  if (result.checkoutGroupId) return `/checkout/confirm?g=${encodeURIComponent(result.checkoutGroupId)}${cn}`;
  return `/checkout/confirm?o=${encodeURIComponent(orders[0].id)}${cn}`;
}

/** The confirmation page's address for an order, keeping its checkout group (so paying one order of a group returns to the whole group). */
export function confirmHref(orderId: string, groupId?: string | null): string {
  return groupId ? `/checkout/confirm?g=${encodeURIComponent(groupId)}` : `/checkout/confirm?o=${encodeURIComponent(orderId)}`;
}
/** The Pay step for one order of (maybe) a group. */
export function payHref(orderId: string, groupId?: string | null): string {
  return `/checkout/pay?o=${encodeURIComponent(orderId)}${groupId ? `&g=${encodeURIComponent(groupId)}` : ''}`;
}
