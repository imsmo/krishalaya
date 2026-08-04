// apps/web-storefront/src/features/orders/buyer-actions.ts · PURE buyer order-action logic (PC-24b). No IO →
// unit-tested. Mirrors the API's order state machine (cancel is legal only pre-fulfilment) and the dispute
// reason enum (disputes/dto DISPUTE_REASON_CODES) — the server re-checks eligibility on every call; these
// helpers reflect, never grant.

/** Statuses from which the buyer may attempt a cancel (transitions to 'cancelled' in order_status). */
const BUYER_CANCELABLE: ReadonlySet<string> = new Set(['created', 'payment_pending', 'confirmed', 'packed']);

export function canCancelOrder(status: string | undefined | null): boolean {
  return !!status && BUYER_CANCELABLE.has(status);
}

/** Server enum mirror — the form offers ONLY these; the API validates again. */
export const DISPUTE_REASONS = ['not_delivered', 'poor_quality', 'qty_mismatch', 'late', 'wrong_item', 'damaged', 'payment'] as const;

export type RaiseResult =
  | { ok: true; value: { orderId: string; reasonCode: string; description?: string } }
  | { ok: false; error: 'reason' | 'description' };

export function buildDisputeRaise(raw: { orderId: string; reasonCode?: string; description?: string }): RaiseResult {
  const reasonCode = (DISPUTE_REASONS as readonly string[]).includes(raw.reasonCode ?? '') ? (raw.reasonCode as string) : null;
  if (!reasonCode) return { ok: false, error: 'reason' };
  const description = (raw.description ?? '').trim();
  if (description.length > 4000) return { ok: false, error: 'description' };
  const value: { orderId: string; reasonCode: string; description?: string } = { orderId: raw.orderId, reasonCode };
  if (description) value.description = description;
  return { ok: true, value };
}
