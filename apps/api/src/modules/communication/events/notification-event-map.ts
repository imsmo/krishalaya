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
  // PC-56 ADMIN-6b · **`payout.credited` WAS SEEDED IN 0068 AND NOTHING HAS EVER EMITTED IT.** W063 says "Farmer SMS
  // queued — celebratory Gujarati message sends on payout success"; W067's confirm dialog promises "farmers get the
  // celebratory SMS on success". `PayoutService.execute` writes `payments.payout_succeeded` — a DIFFERENT code, absent
  // from this map, consumed by no notification handler. So the money arrived and the platform said nothing.
  //
  // AND THE ROW ALONE WOULD NOT HAVE FIXED IT. The event's payload was `{ v: 1, payoutId, amountMinor }` — no user id,
  // so `DomainEventFanoutHandler` would have found no recipient and returned early, silently, exactly as it does for a
  // mapped event with a missing key. The payload is enriched in `payout.service.ts` in the same wave; a map row
  // pointing at a payload with no recipient is the shape of fix that looks done and changes nothing.
  { outboxType: 'payments.payout_succeeded',    eventCode: 'payout.credited',      recipientKeys: ['userId'] },
];
