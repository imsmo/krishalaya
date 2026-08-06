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

// ---------------------------------------------------------------------------
// PC-55 B8 — request a RETURN (returns.request; W54-2)
// ---------------------------------------------------------------------------
// A return is not a dispute. The dispute rail is "something went wrong, adjudicate it"; the return rail moves the
// GOODS back and only then the money (requested → approved → in_transit → received → refunded). They share one
// thing: the reason vocabulary. CreateReturnSchema imports DISPUTE_REASON_CODES, so DISPUTE_REASONS above is the
// return vocabulary too — reused rather than re-typed, because a second copy is a second thing to drift.
//
// ELIGIBILITY IS THE DELIVERY, NOT THE STATUS TEXT. Server-side, `returns.request` resolves buyer/seller from the
// `dispute_eligibility` row that the orders.order_delivered handler writes (0025) — no row, no return. So the honest
// console mirror is "was this order delivered", which for the buyer's own order means delivered or completed. An
// order still in transit shows no return form at all: offering one would be a promise the API must break.

/** Statuses at which a delivery has demonstrably happened, so an eligibility row exists. */
const RETURNABLE: ReadonlySet<string> = new Set(['delivered', 'completed']);
export function canRequestReturn(status: string | undefined | null): boolean {
  return !!status && RETURNABLE.has(status);
}

export type ReturnRequestResult =
  | { ok: true; value: { orderId: string; reasonCode: string } }
  | { ok: false; error: 'reason' };

/** Build the request body. The reason is REQUIRED here even though the API takes it as optional: a return filed with
 *  no reason gives the seller nothing to act on and the buyer no record of what they said, so the console asks for
 *  one. Nothing else is sent — buyer, seller and refund amount are all server-resolved (anti-IDOR, Law 2). */
export function buildReturnRequest(raw: { orderId: string; reasonCode?: string }): ReturnRequestResult {
  const reasonCode = (DISPUTE_REASONS as readonly string[]).includes(raw.reasonCode ?? '') ? (raw.reasonCode as string) : null;
  if (!reasonCode) return { ok: false, error: 'reason' };
  return { ok: true, value: { orderId: raw.orderId, reasonCode } };
}

/** An ACTIVE return already exists → the API refuses a duplicate (DuplicateReturnError → 409). Reflect it so the
 *  buyer sees the case they already opened instead of a form that will fail. */
const RETURN_ACTIVE: ReadonlySet<string> = new Set(['requested', 'approved', 'in_transit', 'received']);
export function returnAlreadyOpen(status: string | undefined | null): boolean {
  return !!status && RETURN_ACTIVE.has(status);
}
