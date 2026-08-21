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
  // PC-56 TENANT-6d-5 · **EVERY CRITICAL OPS ALERT WAS SILENT DURING SOMEBODY'S QUIET HOURS.** `resolveChannels()`
  // suppresses push, sms, whatsapp and ivr inside a recipient's quiet window unless the CATALOGUE event is `critical`,
  // and `ops.alert_fired` is catalogued `important` — one constant for every alert this platform raises. Severity lives
  // on the fired alert, so `severityFor()` was correctly calling a tank breaching five times or a sensor silent for two
  // days CRITICAL, and every one of those was held until morning while W170 promised *"alerts fire to the operator's
  // phone before the dairy loses a rupee"*. `OpsAlertService` now emits this type for a critical verdict and
  // `ops.alert_critical` is catalogued `critical` with `user_can_opt_out = false` (0165). Same recipients, same spine,
  // same rules — the difference is that this one is allowed to wake somebody, and a maintenance reminder still is not.
  { outboxType: 'ops.alert_fired_critical',     eventCode: 'ops.alert_critical',   recipientKeys: ['recipientUserIds'] },
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
  // PC-56 TENANT-6b-1 · **W168 PROMISES THE MEMBER IS TOLD, IN GUJARATI, AND NOTHING TOLD THEM ANYTHING.** The quality
  // desk's footer reads "Flag decisions are recorded · pour-level hold, never wallet freeze · member notified in
  // Gujarati" — and before this wave the flag was two columns on a pour: no review, no decision, no message, and the
  // pour was paid in the next bill anyway. Now a farmer whose morning pour is held learns it from their own phone in
  // their own language, and learns the outcome when it is decided. `userId` is the FARMER's, put into the payload by
  // `MilkQualityReview.open`/`decide` rather than assumed — ADMIN-6b's finding was a map row pointing at a payload with
  // no recipient, which looks like a fix and sends nothing.
  { outboxType: 'dairy.quality_flag_opened',    eventCode: 'dairy.quality_flag_opened',  recipientKeys: ['userId'] },
  { outboxType: 'dairy.quality_flag_decided',   eventCode: 'dairy.quality_flag_decided', recipientKeys: ['userId'] },
  // PC-56 TENANT-6c-2 · **W169'S SUBTITLE IS A PROMISE AND NOTHING KEPT IT.** *"Preview goes to every member in
  // Gujarati BEFORE money moves — surprises are for birthdays, not milk money."* No dairy BILL event was in this map at
  // all, so a member learned what they were being paid when the money landed, or not at all. `BillPreviewed` existed as
  // an event type since the module was built and was emitted by a transition that carried no recipient — the shape
  // ADMIN-6b named: a map row over a payload with no user id looks like a fix and sends nothing. `MilkBill.preview` now
  // puts the FARMER's userId and the figures the SMS interpolates into the payload.
  //
  // AND THE ROW ALONE STILL WOULD NOT HAVE SENT ANYTHING. Every template in
  // `db/seeds/core/0007_notification_events_templates.sql` had no `serving_version_id`, so 0122's send-time gate
  // resolved it to NULL and recorded `no_template` silently — 42 templates, including all ten of 6b-1's dairy quality
  // rows. Fixed in that seed file in the same wave; checked before writing this row rather than discovered when the
  // first cycle preview texted nobody.
  { outboxType: 'dairy.bill_previewed',         eventCode: 'dairy.bill_previewed',        recipientKeys: ['userId'] },
  { outboxType: 'dairy.bill_dispute_resolved',  eventCode: 'dairy.bill_dispute_resolved', recipientKeys: ['userId'] },
  // [PC-56 TENANT-6c-4] W169: *"Deductions above 25% of gross need the member's fresh consent, not just standing
  // instructions."* THE ONLY WAY A MEMBER LEARNS THEIR BILL IS WAITING ON THEM. A consent gate with no notification is
  // a bill that silently never pays, and the member would be told nothing while their money sat still.
  { outboxType: 'dairy.bill_deduction_consent_required', eventCode: 'dairy.bill_deduction_consent_required', recipientKeys: ['userId'] },
  // [PC-56 TENANT-6c-5] W169's *"not just standing instructions"* — the arrangement itself. A member must be told when
  // a routine deduction from their milk cheque STARTS and when it ENDS; an arrangement recorded silently is
  // indistinguishable from software helping itself, and the revocation notice is what makes "you can stop this" real.
  { outboxType: 'dairy.deduction_instruction_authorised', eventCode: 'dairy.deduction_instruction_authorised', recipientKeys: ['userId'] },
  { outboxType: 'dairy.deduction_instruction_revoked',    eventCode: 'dairy.deduction_instruction_revoked',    recipientKeys: ['userId'] },
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
  // ---- PC-56 TENANT-6d-8 · W170's ROUTE NOTICE ------------------------------------------------------------------
  // *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*.
  //
  // THE FIRST DAIRY EVENTS IN THIS MAP WHOSE RECIPIENTS ARE A LIST. Every other dairy row above notifies ONE person
  // about their own milk, their own bill, their own arrangement. A diversion is one decision about eighty-seven
  // families, so `DairyDiversionService.queueNotice` resolves them from the route history AS OF THE DIVERTED DAY (not
  // today's membership rows — a member who moved away last week is not on tonight's list) and emits the ids in the
  // payload, CHUNKED, because the fan-out of one event runs inside one relay transaction.
  //
  // AND THE RETRACTION IS ITS OWN CODE. A signed diversion can be called off while no milk has been taken under it,
  // and until 6d-8 that was a silent state change: 87 families had been told to walk to Bhesan and nobody told them to
  // stay. Catalogued `critical` and unmutable exactly like the diversion, voice channel first.
  //
  // Both were only worth wiring AFTER TENANT-6d-7: before it, `fanout` resolved one language for the whole batch and
  // every one of these notices would have gone out in English while the canon says *"Gujarati voice"*.
  { outboxType: 'dairy.shift_diverted',           eventCode: 'dairy.shift_diverted',           recipientKeys: ['recipientUserIds'] },
  { outboxType: 'dairy.shift_diversion_cancelled', eventCode: 'dairy.shift_diversion_cancelled', recipientKeys: ['recipientUserIds'] },
];
