-- ============================================================================
-- MIGRATION 0068 — DELTA-051 SEED: proposed WhatsApp/channel event codes → real notification_events rows
-- (DEV-04)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- This is a SEED-STYLE (data) migration, not a new-table migration — notification_events (0012_engagement.sql)
-- and its ON CONFLICT DO NOTHING seeding convention (db/seeds/core/0007_notification_events_templates.sql)
-- already exist; this file seeds the additional rows DELTA-051 asks for directly via a migration (not the
-- seeds/ directory) so every environment that runs `node db/scripts/migrate.js` gets the real FK target
-- immediately — every WA/SMS/EM template already built that references one of these codes has been rendering
-- against a code that doesn't exist as a row until this migration runs.
--
-- CENSUS (Hard Rule: loose census ≠ execution basis — enumerated below with pasted greps, not paraphrase).
--
-- STEP 1 — what's already seeded (pasted from db/seeds/core/0007_notification_events_templates.sql, read in
-- full): 26 existing notification_events rows — auth.otp, order.created, order.delivered, payment.success,
-- payout.completed, bid.outbid, bid.won, wage.paid, booking.offer, scheme.approved, price.alert, weather.alert,
-- order.confirmed, order.completed, offer.accepted, quote.accepted, shipment.delivered, dispute.opened,
-- dispute.resolved, dispute.refunded, chat.message_posted, requirement.matched, requirement.reminder,
-- review.prompt, auction.ended, tenant.broadcast.
--
-- STEP 2 — the DELTA-051 proposed set, enumerated by grepping the canon (pasted, not paraphrased):
--   DESIGN_DRIVEN_SCHEMA_BACKLOG.md row DELTA-051: "commerce.optin_confirmed, commerce.catalogue_promo,
--   order.payment_pending, order.packed [builder-flagged], order.confirmed, order.out_for_delivery,
--   dispute.acknowledged, dispute.seller_responded, dispute.resolved; family later gains payout.credited,
--   weather.alert_severe, dispute.*, order.payment_failed, billing.*"
--   SCREEN-DATA-CATALOG.md:10995: "DELTA-051 proposed event codes (commerce.optin_confirmed,
--   commerce.catalogue_promo, order.payment_pending, order.packed [builder-added, flagged], order.confirmed,
--   order.out_for_delivery, dispute.acknowledged, dispute.seller_responded, dispute.resolved) await seeding"
--   SCREEN-DATA-CATALOG.md:11021: "event codes payout.credited, weather.alert_severe join DELTA-051 list"
--   SCREEN-DATA-CATALOG.md:11162 (W434): "DELTA-051-family proposed event codes (dispute.*, order.payment_failed,
--   billing.*) still await seeding as a real FK into notification_events — flagged"
--   The literal billing.* / dispute.* codes actually built as templates (grepped from SCREEN-DATA-CATALOG.md):
--     :11119 billing.invoice_issued (EM-029, "important") · :11120 billing.payment_received (EM-030, "important")
--     :11121 billing.due_reminder (EM-031, "important") · :11122 billing.overdue (EM-032, "critical, opt_out=false")
--     :11123 billing.final_notice (EM-033, "critical, opt_out=false") · :11124 billing.autopay_failed
--     (EM-034, "critical, opt_out=false") · :11083 dispute.acknowledged (EM-007, "critical, opt_out=false")
--     :11084 dispute.seller_responded (EM-008, "critical, opt_out=false") · :11076 order.payment_failed
--     (EM-006, "critical, opt_out=false") · :11075 payout.credited (EM-005, "important") · :11030 weather.alert_severe
--     (SMS-001, grouped "opt_out=false ×4" with otp/payment_failed/dispute.resolved) · :11073 order.out_for_delivery
--     (EM-003, "important — W-D50 ruling", also SMS-002/SMS-005/W434) · :11142 order.packed (SMS-005).
--
-- STEP 3 — reconciliation (STEP 2 minus STEP 1 = the actual missing set to seed):
--   order.confirmed and dispute.resolved are ALREADY in notification_events (STEP 1) — the backlog row lists
--   them as part of the DELTA-051 family narrative but they need NO new row; dispute.opened/dispute.refunded
--   are also already seeded (not part of the DELTA-051 literal list, noted only to avoid double-counting).
--   NET MISSING = 16 codes, seeded below: commerce.optin_confirmed, commerce.catalogue_promo,
--   order.payment_pending, order.packed, order.out_for_delivery, dispute.acknowledged, dispute.seller_responded,
--   payout.credited, weather.alert_severe, order.payment_failed, billing.invoice_issued, billing.payment_received,
--   billing.due_reminder, billing.overdue, billing.final_notice, billing.autopay_failed.
--
-- STEP 4 — a note on the founder brief's "49-code registry DEV-03 found in code": DEV-03's boot-proof log line
-- ("registry has 49 event type(s)") refers to `OUTBOX_HANDLER_REGISTRY` (core/outbox/event-envelope.ts), which
-- is the DOMAIN-EVENT-HANDLER registry (search indexing, realtime push, webhooks, notification fan-out, etc. —
-- 15 modules' handlers for their own outbox event TYPES like 'orders.order_confirmed'), NOT a notification
-- EVENT-CODE catalog. Reconciling DELTA-051 against it directly is a category error — that registry's 49 entries
-- are outbox handler registrations, most of which have nothing to do with the notification_events codes table
-- (e.g. search-index handlers, webhook handlers). The correct reconciliation basis is
-- `communication/events/notification-event-map.ts` (NOTIFICATION_EVENT_MAP, 17 entries, read in full — maps
-- outbox event types to notification_events codes) crossed with the canon citations above; this migration
-- follows that basis and documents the discrepancy for founder awareness rather than silently substituting one
-- registry for the other.
-- ============================================================================

INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
 ('commerce.optin_confirmed', 'WhatsApp opt-in confirmed', 'important', '["whatsapp"]', false, false),
 ('commerce.catalogue_promo', 'Catalogue promotion', 'promotional', '["whatsapp","sms"]', true, true),
 ('order.payment_pending', 'Payment pending', 'important', '["whatsapp","push"]', true, false),
 ('order.packed', 'Order packed', 'important', '["push","sms"]', true, false),
 ('order.out_for_delivery', 'Order out for delivery', 'important', '["push","sms","email"]', true, false),
 ('dispute.acknowledged', 'Dispute acknowledged', 'critical', '["push","sms","email"]', false, false),
 ('dispute.seller_responded', 'Seller responded to dispute', 'critical', '["push","sms","email"]', false, false),
 ('payout.credited', 'Payout credited', 'important', '["push","sms","email"]', true, false),
 ('weather.alert_severe', 'Severe weather alert', 'critical', '["push","sms"]', false, false),
 ('order.payment_failed', 'Payment failed', 'critical', '["push","sms","email"]', false, false),
 ('billing.invoice_issued', 'Invoice issued', 'important', '["email","sms"]', true, false),
 ('billing.payment_received', 'Payment received', 'important', '["email","sms"]', true, false),
 ('billing.due_reminder', 'Payment due reminder', 'important', '["email","sms"]', true, false),
 ('billing.overdue', 'Invoice overdue', 'critical', '["email","sms"]', false, false),
 ('billing.final_notice', 'Final notice before restriction', 'critical', '["email","sms"]', false, false),
 ('billing.autopay_failed', 'Autopay failed', 'critical', '["email","sms"]', false, false)
ON CONFLICT (code) DO NOTHING;
