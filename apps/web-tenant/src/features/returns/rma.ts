// apps/web-tenant/src/features/returns/rma.ts · PURE returns/RMA rules (PC-55 B8, on W54-2).
// Framework-free mirror of modules/disputes/domain/return.state.ts, so the seller's console offers only the steps
// the API will accept, in the order the goods actually move.
//
// THE ORDER MATTERS BECAUSE THE MONEY IS AT THE END. requested → approved → in_transit → received → refunded.
// A refund is offered ONLY after the goods are confirmed RECEIVED — anything looser and a seller could refund on a
// promise, which is how return fraud works. And 'refunded'/'rejected' are terminal: a refund cannot be un-issued
// here, so nothing pretends otherwise.
export const RETURN_STATUSES = ['requested', 'approved', 'in_transit', 'received', 'refunded', 'rejected'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const RETURN_BOXES = ['mine', 'against', 'all'] as const;
export type ReturnBox = (typeof RETURN_BOXES)[number];

export function isReturnStatus(v: string | undefined | null): v is ReturnStatus {
  return !!v && (RETURN_STATUSES as readonly string[]).includes(v);
}
export function isReturnBox(v: string | undefined | null): v is ReturnBox {
  return !!v && (RETURN_BOXES as readonly string[]).includes(v);
}

/** The server's flow, copied exactly. */
const FLOW: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = Object.freeze({
  requested: ['approved', 'rejected'],
  approved: ['in_transit', 'rejected'],
  in_transit: ['received'],
  received: ['refunded'],
  refunded: [],
  rejected: [],
});

export function isActive(s: ReturnStatus): boolean { return s !== 'refunded' && s !== 'rejected'; }
export function isTerminal(s: ReturnStatus): boolean { return !isActive(s); }

/** Which lifecycle actions to render for a case.
 *  `in_transit` is the BUYER's act (they post the goods back), so a seller console does not offer it — showing it
 *  would let a seller mark a parcel shipped that they have not seen. `refund` is Resolve-gated server-side and is
 *  offered only from 'received', because a refund before the goods arrive is a gift with extra steps. */
export function sellerActions(status: string | null | undefined, canResolve: boolean): Array<'approve' | 'reject' | 'receive' | 'refund'> {
  if (!isReturnStatus(status)) return [];
  const out: Array<'approve' | 'reject' | 'receive' | 'refund'> = [];
  if (FLOW[status].includes('approved')) out.push('approve');
  if (FLOW[status].includes('rejected')) out.push('reject');
  if (FLOW[status].includes('received')) out.push('receive');
  // The money leg needs the Resolve permission. Withholding the button (rather than 403-ing) keeps a junior
  // operator from learning that the control is decorative.
  if (FLOW[status].includes('refunded') && canResolve) out.push('refund');
  return out;
}

/** True when a case is waiting on the BUYER to post the goods — worth saying, because it looks stalled otherwise. */
export function awaitingBuyerShipment(status: string | null | undefined): boolean { return status === 'approved'; }

/** Whether a refund is the only remaining step but the operator lacks the permission for it. The page can then say
 *  "ask someone with resolve rights" instead of showing a case that appears stuck for no reason. */
export function refundBlockedByPermission(status: string | null | undefined, canResolve: boolean): boolean {
  return status === 'received' && !canResolve;
}

/** The API REUSES THE DISPUTE TAXONOMY for return reasons (CreateReturnSchema imports DISPUTE_REASON_CODES), so this
 *  list is that vocabulary verbatim — an invented code like 'not_as_described' would be a 422, and a console that
 *  offered one would be promising a reason the platform cannot record. */
export const RETURN_REASONS = ['not_delivered', 'poor_quality', 'qty_mismatch', 'late', 'wrong_item', 'damaged', 'payment'] as const;
export function isReturnReason(v: string | undefined | null): boolean {
  return !!v && (RETURN_REASONS as readonly string[]).includes(v);
}

export type RequestResult = { ok: true; value: { orderId: string; reasonCode?: string } } | { ok: false; error: 'order' | 'reason' };

/** Build a buyer's return request. The reason comes from the dispute taxonomy the API already knows; an unknown one
 *  is refused here rather than sent. A reason is optional in the API — but a request with no reason gives a seller
 *  nothing to act on, so the console asks for one and says why. */
export function buildReturnRequest(raw: { orderId: string; reasonCode: string }): RequestResult {
  const orderId = raw.orderId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(orderId)) return { ok: false, error: 'order' };
  const reasonCode = raw.reasonCode.trim();
  if (!reasonCode || !isReturnReason(reasonCode)) return { ok: false, error: 'reason' };
  return { ok: true, value: { orderId, reasonCode } };
}

/** A return can be requested only on an order the buyer has actually received. The API re-checks eligibility; this
 *  keeps the button off a page where it would only produce a refusal. */
export function canRequestReturn(orderStatus: string | null | undefined): boolean {
  return orderStatus === 'delivered' || orderStatus === 'completed';
}
