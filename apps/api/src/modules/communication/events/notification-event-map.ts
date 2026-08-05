// modules/communication/events/notification-event-map.ts · the bridge from a module's OUTBOX event type to a
// notification CATALOG event code + how to find the recipient(s) in the payload. Adding a notification for a new
// domain event = one row here + a catalog row (+ templates) — no code in the emitting module. recipientKeys are
// tried in order; every present (string) value becomes a recipient (deduped downstream). Keep this in sync with
// the seeded notification_events catalog (db/seeds). Only events with a catalog row + templates actually send.
export interface NotificationMapEntry { outboxType: string; eventCode: string; recipientKeys: string[]; }

export const NOTIFICATION_EVENT_MAP: readonly NotificationMapEntry[] = [
  { outboxType: 'orders.order_confirmed',       eventCode: 'order.confirmed',     recipientKeys: ['buyerUserId', 'userId'] },
  { outboxType: 'orders.order_delivered',       eventCode: 'order.delivered',     recipientKeys: ['buyerUserId', 'userId'] },
  { outboxType: 'orders.order_completed',       eventCode: 'order.completed',     recipientKeys: ['sellerUserId', 'buyerUserId'] },
  { outboxType: 'offers.offer_accepted',        eventCode: 'offer.accepted',      recipientKeys: ['sellerUserId', 'buyerUserId', 'userId'] },
  { outboxType: 'requirements.quote_accepted',  eventCode: 'quote.accepted',      recipientKeys: ['sellerUserId', 'userId'] },
  { outboxType: 'logistics.shipment_delivered', eventCode: 'shipment.delivered',  recipientKeys: ['buyerUserId', 'userId'] },
  { outboxType: 'payments.payment_succeeded',   eventCode: 'payment.success',   recipientKeys: ['buyerUserId', 'userId'] },
  { outboxType: 'payments.dispute_refunded',    eventCode: 'dispute.refunded',    recipientKeys: ['buyerUserId', 'userId'] },
  { outboxType: 'disputes.dispute_opened',      eventCode: 'dispute.opened',      recipientKeys: ['sellerUserId', 'buyerUserId', 'userId'] },
  { outboxType: 'disputes.dispute_resolved',    eventCode: 'dispute.resolved',    recipientKeys: ['sellerUserId', 'buyerUserId', 'userId'] },
  { outboxType: 'comm.message_posted',          eventCode: 'chat.message_posted',  recipientKeys: ['recipientUserIds'] },
  // ---- Wave 4 engagement glue (API-W4-01) ----
  { outboxType: 'auctions.bidder_outbid',       eventCode: 'bid.outbid',           recipientKeys: ['previousBidderUserId'] },
  // P1-7: an auction closed → notify everyone who WATCHED it (fanout list travels as recipientUserIds).
  { outboxType: 'auctions.watchers_auction_ended', eventCode: 'auction.ended',     recipientKeys: ['recipientUserIds'] },
  { outboxType: 'requirements.requirement_matched',  eventCode: 'requirement.matched',  recipientKeys: ['buyerUserId'] },
  { outboxType: 'requirements.requirement_reminder', eventCode: 'requirement.reminder', recipientKeys: ['buyerUserId'] },
  { outboxType: 'reviews.review_prompt',        eventCode: 'review.prompt',        recipientKeys: ['recipientUserIds'] },
  { outboxType: 'memberships.payment_confirmed', eventCode: 'payment.success',     recipientKeys: ['userId'] },
  // PC-55 A6 · ops alerting rides the SAME spine as everything else — no private channel for urgency.
  { outboxType: 'ops.alert_fired',              eventCode: 'ops.alert_fired',      recipientKeys: ['recipientUserIds'] },
];
