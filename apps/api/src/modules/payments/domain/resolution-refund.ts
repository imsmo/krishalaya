// modules/payments/domain/resolution-refund.ts · PC-56 HOTFIX-7 · D3 (founder Q3) — ONE REFUND RULE FOR THE BUYER: a dispute or return refund of
// an online payment goes BACK TO THE SOURCE, exactly like 2c's cancel refund (PaymentService.refundCancelledOrder / postRefundToSource). PURE.
//
// The keys, in one place (Law 3 — every money act is idempotent on a key derived from the act, never minted per attempt):
//   `dispute-refund:<disputeId>` / `return-refund:<returnId>`   the LEDGER refund (escrow −amount · source +amount) — posted by
//                                                               PaymentService.refundForResolution in its own kv_app transaction. These are the
//                                                               SAME keys the payments handlers posted the buyer-wallet refund under before
//                                                               HOTFIX-7, so a refund booked by the old code is recognised as booked.
//   `dispute-remainder:<disputeId>` / `return-remainder:<returnId>`   the KEPT REMAINDER re-settled to the seller (escrow −remainder · seller …),
//                                                               on the relay tx (new in HOTFIX-7 — before, it rode inside the refund txn).
//   `dispute-clawback:<disputeId>` / `return-clawback:<returnId>`   unchanged: an already-settled order's release reversed leg for leg.
//   gateway: `gateway-refund:<paymentId>:<referenceId>` under the idempotency endpoint `payments.gw_refund` — a SECOND refund on the same payment
//            (a return after a partial dispute refund) asks the gateway again under its own key; the cancel refund keeps `gateway-refund:<paymentId>`
//            (endpoint `payments.gateway_refund`). The scoped key `system::payments.gw_refund::gateway-refund:<uuid>:<uuid>` is 116 characters —
//            inside idempotency_keys.key varchar(120) (the spec pins it).
export type ResolutionRefundKind = 'dispute' | 'return';
export const RESOLUTION_KINDS: readonly ResolutionRefundKind[] = Object.freeze(['dispute', 'return'] as ResolutionRefundKind[]);

/** The ledger txn type the refund and the remainder post under: `refund` — the type the dispute / return handlers always used (no new
 *  `ledger_txn_type` lookup value; statements and reconciliation read the same type as before). */
export const RESOLUTION_REFUND_TXN_TYPE = 'refund' as const;
export const RESOLUTION_GATEWAY_ENDPOINT = 'payments.gw_refund';

export const resolutionRefundKey = (kind: ResolutionRefundKind, referenceId: string): string => `${kind}-refund:${referenceId}`;
export const resolutionRemainderKey = (kind: ResolutionRefundKind, referenceId: string): string => `${kind}-remainder:${referenceId}`;
export const resolutionClawbackKey = (kind: ResolutionRefundKind, referenceId: string): string => `${kind}-clawback:${referenceId}`;
export const resolutionGatewayRefundKey = (paymentId: string, referenceId: string): string => `gateway-refund:${paymentId}:${referenceId}`;
/** The reason a resolution refund carries on `payments.payment_refunded` and its audit row. */
export const resolutionRefundReason = (kind: ResolutionRefundKind): string => `${kind}_resolved`;

/** What the buyer gets back and what the seller keeps, from the captured gross and the decided amount — capped at the gross (never more than
 *  was paid). `refund <= 0` = nothing to refund. */
export function splitResolution(grossMinor: bigint, requestedMinor: bigint): { refundMinor: bigint; remainderMinor: bigint } {
  const refund = requestedMinor > grossMinor ? grossMinor : requestedMinor;
  return { refundMinor: refund, remainderMinor: grossMinor - refund };
}
