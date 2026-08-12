// modules/disputes/domain/disputes.events.ts · integration events (via outbox, Law 4).
export const DisputeEventType = {
  Opened:          'disputes.dispute_opened',          // → orders pauses the order (sets it 'disputed')
  SellerResponded: 'disputes.dispute_seller_responded',
  UnderReview:     'disputes.dispute_under_review',
  Escalated:       'disputes.dispute_escalated',
  Resolved:        'disputes.dispute_resolved',         // → orders applies refund/release (downstream)
  Withdrawn:       'disputes.dispute_withdrawn',
  MessagePosted:   'disputes.dispute_message_posted',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };

export const RESOLUTION_TYPES = ['refund_full', 'refund_partial', 'replacement', 'rejected'] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

/** Returns/RMA integration events (via outbox, Law 4). The refund itself is applied downstream
 *  (orders/payments) on return_refunded — NO money moves in the disputes module. */
export const ReturnEventType = {
  Requested: 'disputes.return_requested',
  Approved:  'disputes.return_approved',
  Rejected:  'disputes.return_rejected',
  InTransit: 'disputes.return_in_transit',
  Received:  'disputes.return_received',
  Inspected: 'disputes.return_inspected',   // W142's "inspect within 24h" — evidence, not a status hop (0139)
  // → payments' ReturnRefundedHandler applies the wallet reversal (TENANT-3b). **BEFORE 0139 THIS EVENT HAD NO
  // SUBSCRIBER IN ANY APP**: a return reached 'refunded' and no money moved, while W142 promised "refunds are
  // ledger reversals (refund_txn_id) — the money trail always closes". The trail did not start.
  Refunded:  'disputes.return_refunded',
} as const;
