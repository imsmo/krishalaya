-- ==================================================================================================================
-- MIGRATION 0215 — PC-56 STORE-4c · NOTICES YOU CAN READ, SWITCHES THAT HOLD
-- (canon W299 notifications · W302 preferences · W3118–W3120 the inbox Retry (DECOR) · W3134–W3136 the preferences save chain)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0214 are applied; nothing here edits them: this file inserts four
-- catalogue rows WHERE MISSING, updates four catalogue rows under guards, and widens one CHECK constraint.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store4.md §0 C-12, §2 F-9 / F-12, §3 B12 / B14 — verified at 96da18c8, STORE-4a):
--   • F-9 · THE MONEY NOTICES NEVER REACHED THE IN-APP INBOX. The inbox lists `channel = 'inapp'` rows only, and the catalogue (seed core/0007
--     lines 4–8) gave `payment.success` ["push","sms"], `order.created` ["push","sms"], `order.delivered` ["push","sms","whatsapp"] and
--     `bid.outbid` ["push"] — no `inapp`. `resolveChannels` walks the default channels only, so 3c's in-app outbid copy was never selected
--     (C-12) and a buyer's payment notice could never appear on W299.
--   • `payment.success` was `important` and OPT-OUT-ABLE: a buyer could switch off the one notice that says their money arrived, and quiet
--     hours held it until morning. Canon W299 / W302 "critical — always on" was FALSE.
--   • F-12 · PROMOTIONAL NOTICES DEFAULTED ON and the `marketing` consent (seed 0006) was consulted by nothing. The delivery log could not
--     even say "not sent — no marketing consent": 0176's `ck_notif_suppressed_reason` admits quiet_hours · channel_off · routine_collapsed ·
--     opted_out only.
--
-- WHAT IS TRUE NOW (founder decisions 2026-10-16, STORE-4c D1 / D2):
--   215.1  D1 · `payment.success` is CRITICAL and LOCKED (`priority = 'critical'`, `user_can_opt_out = false`) and carries `inapp`;
--          `order.created`, `order.delivered` and `bid.outbid` carry `inapp`. Each UPDATE is GUARDED (`NOT default_channels ? 'inapp'`,
--          `priority <> 'critical'`, `user_can_opt_out`) — re-running it changes nothing. FROM EMPTY the four rows do not exist yet when this
--          file runs (seed core/0007 creates the catalogue AFTER migrations — the 0210 lesson), so the same four rows are first INSERTED with
--          the NEW values `ON CONFLICT (code) DO NOTHING`; seed 0007's own insert is `ON CONFLICT DO NOTHING` too, so either order ends with
--          these values. Their in-app copy (en / hi / gu) rides seed core/0007, ABOVE its version backfill (the TENANT-6d-1 NOTE): the existing
--          `payment.success` / inapp / en row is kept; hi + gu added; `order.created` and `order.delivered` in-app ×3 added; `bid.outbid`
--          in-app ×3 already existed (3c). The "delivery OTP" event of the canon is REFUSED by name (founder D1: named for logistics).
--   215.2  D2 · `ck_notif_suppressed_reason` admits `no_consent`: a PROMOTIONAL notice to a person whose latest `marketing` consent is not a
--          grant is written `suppressed · no_consent` (apps/api communication/services/notification.service.ts `fanout` — ONE place, so the
--          broadcast handler inherits it), and the delivery log can then say why. `suppressed_reason` is varchar(20); `no_consent` fits.
--          The constraint lives on the partitioned parent `notifications` (0176) and is inherited by every partition; it is dropped and
--          re-added in this transaction (re-validating the existing rows, which all satisfy the narrower list).
--   215.3  NOTHING for flags (Law 10): the storefront allow-list gains `communication` IN CODE (STOREFRONT_PUBLIC_FLAGS, tenant-scoped,
--          fail-closed); no flag row is added or flipped; seed 0009 keeps `communication` OFF. A person's inbox, preferences and quiet hours
--          lose the `communication` guard in code; chat, calls and push devices keep it.
--
-- NOTHING ELSE: no table is created (the RLS gate's count does not move: 1,955 + the wall); no grant changes; no money moves (Law 9 — the
-- payment notice's tier is copy, founder D1; its money figure, if a template ever prints one, comes from the emitter's payload only).
-- Partition pass: `notifications` is partitioned; only its CHECK is re-declared on the parent (inherited by every partition).
--
-- REVERSAL (documented, not automatic — the previous values restated):
--   UPDATE notification_events SET priority = 'important', user_can_opt_out = true, default_channels = '["push","sms"]'::jsonb
--    WHERE code = 'payment.success';
--   UPDATE notification_events SET default_channels = '["push","sms"]'::jsonb             WHERE code = 'order.created';
--   UPDATE notification_events SET default_channels = '["push","sms","whatsapp"]'::jsonb  WHERE code = 'order.delivered';
--   UPDATE notification_events SET default_channels = '["push"]'::jsonb                   WHERE code = 'bid.outbid';
--   -- the in-app templates stay (an inactive event channel selects nothing); deactivate them with UPDATE notification_templates SET is_active = false.
--   -- the constraint can be narrowed again ONLY after every `no_consent` row has aged out of retention (or been re-labelled):
--   ALTER TABLE notifications DROP CONSTRAINT ck_notif_suppressed_reason;
--   ALTER TABLE notifications ADD CONSTRAINT ck_notif_suppressed_reason CHECK (
--     suppressed_reason IS NULL OR suppressed_reason IN ('quiet_hours', 'channel_off', 'routine_collapsed', 'opted_out'));
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 215.1  THE CATALOGUE (founder D1)
-- ------------------------------------------------------------------------------------------------------------------
-- From empty: the rows with their NEW values (seed core/0007 then finds them and does nothing).
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('payment.success', 'Payment successful', 'critical',  '["push","sms","inapp"]',            false, false),
  ('order.created',   'Order placed',       'important', '["push","sms","inapp"]',            true,  false),
  ('order.delivered', 'Order delivered',    'important', '["push","sms","whatsapp","inapp"]', true,  false),
  ('bid.outbid',      'You were outbid',    'important', '["push","inapp"]',                  true,  false)
ON CONFLICT (code) DO NOTHING;

-- On a database that already holds them (every deployed environment): guarded, idempotent.
UPDATE notification_events
   SET default_channels = default_channels || '"inapp"'::jsonb, updated_at = now()
 WHERE code IN ('payment.success', 'order.created', 'order.delivered', 'bid.outbid')
   AND NOT (default_channels ? 'inapp');

UPDATE notification_events
   SET priority = 'critical', user_can_opt_out = false, updated_at = now()
 WHERE code = 'payment.success'
   AND (priority <> 'critical' OR user_can_opt_out);

-- ------------------------------------------------------------------------------------------------------------------
-- 215.2  THE SUPPRESS REASON (founder D2) — `no_consent`
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notif_suppressed_reason;
ALTER TABLE notifications ADD CONSTRAINT ck_notif_suppressed_reason CHECK (
  suppressed_reason IS NULL OR suppressed_reason IN ('quiet_hours', 'channel_off', 'routine_collapsed', 'opted_out', 'no_consent'));

COMMENT ON COLUMN notifications.suppressed_reason IS
  'PC-56 TENANT-8b (F-4) + STORE-4c (D2). Why this channel was NOT sent: quiet_hours (held until held_until, then released by the cadence job — the row then carries its final status and keeps this reason as history), opted_out (the member switched this event × channel off — or, for a PROMOTIONAL event, never opted in: promotional notices are opt-in, STORE-4c D2), routine_collapsed (the decided one-primary-channel rule, G0-4, flag notification_routine_single_channel), no_consent (STORE-4c D2: a promotional notice to a person whose latest `marketing` consent is not a grant — never sent on any channel), channel_off (reserved for a channel master switch — W433''s, refused by name in 8b; written by nothing until it exists).';
