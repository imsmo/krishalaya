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
  // PC-56 ADMIN-9b · **W008 CALLS TENANT VISIBILITY "THE POLICY" AND NOTHING EMITTED ANYTHING.** A platform operator
  // could open a farmer's account, read their invoices and their wallet statement, and the farmer was told nothing —
  // by any channel, ever. The grant, its audit row and this event are now one transaction, so a session cannot exist
  // without the notice being queued. `userId` is the IMPERSONATED user, and it is in the payload rather than assumed:
  // ADMIN-6b's finding was a map row pointing at a payload with no recipient, which looks fixed and changes nothing.
  { outboxType: 'impersonation.session_started', eventCode: 'impersonation.session_started', recipientKeys: ['userId'] },
  // PC-56 TENANT-1b-4 · W156: "the invite SMS says who added them and why, in their language, with a decline path". The
  // applier emits the FACT (a member was imported) and this row decides who hears about it — which is why the applier
  // needs no dependency on the communication module, and why an import in a module that does not import CommunicationModule
  // was a DI defect rather than a style preference. Templates and the event row are seeded by 0129, versioned so the
  // 0122 send-time gate resolves them.
  { outboxType: 'identity.member_imported',     eventCode: 'member.invited',       recipientKeys: ['userId'] },
  { outboxType: 'impersonation.session_ended',   eventCode: 'impersonation.session_ended',   recipientKeys: ['userId'] },
  // ---- PC-56 TENANT-4d-5 · THE BILLING NOTICES ----------------------------------------------------------------
  // **THIS FILE HAD NO TENANCY ROW OF ANY KIND, SO A TENANT HAD NEVER BEEN TOLD ANYTHING ABOUT ITS OWN BILL.** Not
  // that it was raised, not that it was paid, not that it was overdue, and — after 4d-4 built the grace window —
  // not that its service was inside a window that was about to close. W120's footnote promises "while we retry and
  // notify you"; W118 promises "at 90% of any limit you get a console + email notice". Seven tenancy outbox events
  // existed with zero subscribers, which is the event-with-no-subscriber defect at the largest scale this
  // programme has found it: the whole billing correspondence of the platform.
  //
  // THE RECIPIENT IS THE WAVE, NOT THESE ROWS — and this file already said so. ADMIN-6b's note above is the
  // precedent verbatim: "a map row pointing at a payload with no recipient is the shape of fix that looks done and
  // changes nothing." Every one of these seven payloads carried `tenantId` and no user id, so all seven rows would
  // have registered handlers that found no recipient and returned early, silently, for ever. `recipientUserIds` is
  // put there by `BillingNoticeService.enrich` (modules/tenancy), which resolves the holders of `tenant.settings`
  // — the SAME permission the billing console requires, so the people told about a bill are exactly the people who
  // can open it and pay it. See `domain/billing-notice.ts` for why a permission and not a role or a billing_email
  // column, and why the per-tenant `saas_billing_notifications` flag gates the RECIPIENT rather than the send.
  //
  // Catalog rows, declared variables, en/hi/gu templates AND their approved template_versions are seeded by
  // migration 0149 — all four, because 0122's send-time gate resolves through `serving_version_id` and a seeded
  // template with no approved version resolves to nothing and records `no_template` silently (0123 and 0129 both
  // hit that; 0149 checked before writing).
  { outboxType: 'tenancy.saas_invoice_issued',   eventCode: 'saas.invoice_issued',   recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.saas_invoice_paid',     eventCode: 'saas.invoice_paid',     recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.saas_invoice_overdue',  eventCode: 'saas.invoice_overdue',  recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.subscription_grace_started', eventCode: 'saas.grace_started', recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.subscription_renewed',  eventCode: 'saas.subscription_renewed', recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.trial_ending',          eventCode: 'saas.trial_ending',     recipientKeys: ['recipientUserIds'] },
  { outboxType: 'tenancy.usage_limit_alert',     eventCode: 'saas.usage_limit_alert', recipientKeys: ['recipientUserIds'] },
];
