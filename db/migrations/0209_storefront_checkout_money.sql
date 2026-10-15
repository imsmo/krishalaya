-- ==================================================================================================================
-- MIGRATION 0209 — PC-56 STORE-2c · THE MONEY WAVE: QUOTE = CHARGE, PAY ONCE, REFUND AUTOMATICALLY, NEVER LOSE A CAPTURE
-- (canon W278 auction · W283 checkout address · W284 payment · W285 review · W286 payment processing · the "+ Add address" chain W3048–W3051 ·
-- the checkout Retry chain W3052–W3054 · the payment "Send again" chain W3061–W3063)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0208 are applied; nothing here edits them: this file ADDS one ledger
-- vocabulary row, one platform setting, one nullable column on `orders`, one index on `payments` and one payment-provider registry row.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey F-2, F-3, F-6, F-22 — verified on krishalaya_dev at 0208 before writing this file):
--   • F-2  STOCK WAS NEVER RESERVED. Checkout compared the cart against `listings.quantity_available` read through a 300 s cache and wrote
--          nothing; the ONLY decrement was `modules/listings/events/handlers/order-completed.handler.ts` — and that class was never registered
--          with the outbox relay (it has no `eventType`, ListingsModule.onModuleInit registers only the bulk applier). So stock NEVER moved for
--          a sale: two buyers could each pay escrow for the same last 34 qtl, forever. (Its comment, "Order layer reserves stock at checkout",
--          was false — survey C-2.)
--   • F-3  NO AUTOMATIC REFUND. A paid order cancelled by the buyer, declined by the seller or auto-cancelled at 24 h kept the buyer's money in
--          platform escrow: no handler consumed `orders.order_cancelled` for money; refund was a moderator act.
--   • F-6  A multi-seller checkout created one order per seller and a checkout group with no payment path (founder D2: kept — each order is
--          paid on its own; nothing here changes that).
--   • F-22 A `per_km` charge definition is allowed by `charge_definitions.calc_method`'s CHECK and THROWS in the calculator (a 500 at every
--          checkout of that tenant). The write path already refused it (TENANT-3c-2, 0141 DEFECT 4); this wave refuses it BY NAME at the quote
--          too (code, not schema — the CHECK keeps the method as a gated intention, 0141's reasoning).
--
-- WHAT IS TRUE NOW:
--   209.1  `order_cancel_refund` JOINS THE LEDGER VOCABULARY (0111's pattern: `ledger_transactions.txn_type_id` is an FK to `lookup_values`
--          type `ledger_txn_type` — SEEDED codes, not a CHECK or an enum; a post typed with a missing code fails the FK). Platform-scoped
--          (tenant_id NULL) like every other ledger txn type. Posted by `PaymentService.refundCancelledOrder` (founder D3): escrow −, source +,
--          idempotency key `refund:<orderId>`.
--   209.2  `platform.payment_attempt_ttl_seconds` — how long ONE payment attempt (a gateway order) stays LIVE before the buyer may ask for a
--          fresh one ("Send again", W3061). Brief B3: "expiry = the gateway's (or a platform setting if one exists — never a literal)". Razorpay
--          orders carry no expiry of their own and no setting existed, so the platform setting is ADDED here (a registry row, not a schema
--          change), seeded 900 s (15 minutes — longer than the canon's 10-minute UPI collect, so a still-open sheet is not overtaken by a
--          second attempt). risk_class `money_path`. The storefront passes the same figure to the gateway sheet as its timeout.
--   209.3  `orders.stock_reserved_at` — THE RESERVATION MARKER (founder D1). Set in the checkout transaction when placement decrements each
--          line's listing under its row lock; cleared — in the SAME transaction that puts the stock back — by the restock handler on
--          `orders.order_cancelled`. That makes the restock exactly-once and durable (a replayed cancel event finds the marker NULL and moves
--          nothing), and it is what tells an order that RESERVED from one that never did: every order placed before this file (and every
--          offer / auction / requirement order, which reserve nothing at checkout) has NULL and is never "restocked" — without it, cancelling
--          an order placed yesterday would ADD stock that was never taken (an oversell door opened by this very wave). Nullable, no default,
--          no backfill. NOT a holds table (founder D1: no holds); brief A2 said "nothing for stock" — this column is the deviation, named in
--          the wave report §6 with this reason.
--   209.4  idx_payments_reference — (tenant_id, reference_type, reference_id, created_at DESC). The attempt rule (B3: refuse a second LIVE
--          attempt, number the attempts) and the auto-refund (D3: the captured payment of a cancelled order) read the payments OF AN ORDER on
--          the money path; 0006 indexes payments by user and by open status only, so those reads scanned the tenant's payments (Law 11).
--   209.5  `wallet` JOINS `integration_providers` (category `payment`). FOUND PROVING D6: `POST /v1/orders/:id/pay-from-wallet` records its
--          Payment with `provider_code = 'wallet'` (PaymentService.captureOrderFromWalletInTx, since the wallet-pay door was built), and
--          `payments.provider_code` is an FK to `integration_providers(code)` — which held sandbox / razorpay / razorpayx and never `wallet`.
--          So EVERY pay-from-wallet died 23503 → a 500, after the wallet legs were posted in the same transaction (rolled back with it — no
--          money moved, but the door never worked against a real database; its only spec was a unit spec over fakes). The registry row is the
--          fix (0123's rule: "a migration that names a provider registers it"); not tenant-ownable, no credentials, no verify method.
--
-- NOTHING ELSE (brief A2): no group payment (D2), no holds / slots / pickup / GSTIN table (D7, D5 — refused by name on the surface), no new
-- payment status (`refund_initiated`, 0006, is the "refund pending at the gateway" state the brief calls refund_pending), no notification
-- catalogue row (the communication event map is CODE — modules/communication/events/notification-event-map.ts — and `payment_refunded` /
-- `payment_failed` need template rows a seed owns: named owed in the report, not faked here).
--
-- RLS / GRANTS DECISION: `lookup_values` and `setting_definitions` are global registries (no RLS; kv_app SELECT, unchanged). `orders` keeps its
-- 0005/0016 RLS policies and grants — a nullable column inherits them, and every existing partition receives it from the parent (partition
-- pass: `orders` is RANGE-partitioned by created_at; ALTER on the parent propagates; ensure-partitions' future partitions are created from
-- the parent). `payments` keeps its policies and grants (0078: kv_relay holds NOTHING on it — the refund and restock handlers work in
-- kv_app's unit of work, so no grant is added to kv_relay; the relay gate proves it). Partition pass for the index: `payments` is a plain
-- table.
--
-- LAW 9 (money path — founder review before production): 209.1 is a ledger vocabulary row (the transaction TYPE of a new posting); the
-- posting itself is code (one function, `PaymentService.postRefundToSource`, zero-sum, idempotent). 209.3 is a stock fact on the order. Both
-- are listed in the wave report §9 with the posting functions and their idempotency keys. CODEOWNERS review owed (Law 9: wallet/ledger).
--
-- REVERSAL (documented, not automatic):
--   DROP INDEX IF EXISTS idx_payments_reference;
--   (the `wallet` provider row cannot be deleted once a payment references it — set is_active = false; wallet pay then fails again)
--   ALTER TABLE orders DROP COLUMN IF EXISTS stock_reserved_at;      -- the restock handler then finds no marker and restocks NOTHING (safe)
--   DELETE FROM setting_definitions WHERE key = 'platform.payment_attempt_ttl_seconds';   -- attempts then never lapse by time (fail closed)
--   the `order_cancel_refund` row CANNOT be deleted once a ledger transaction references it (FK) — deactivate it instead
--   (UPDATE lookup_values SET is_active = false …), which stops new auto-refund posts (they then fail the type lookup → the relay retries).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 209.1  the ledger txn type of the automatic refund (founder D3)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'ledger_txn_type', NULL, 'order_cancel_refund', 'Refund of a cancelled order (to source)',
       '{"wave":"PC-56 STORE-2c","legs":"escrow -, source +","key":"refund:<orderId>"}'::jsonb, 91
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values v WHERE v.type_code = 'ledger_txn_type' AND v.tenant_id IS NULL AND v.code = 'order_cancel_refund');

-- ------------------------------------------------------------------------------------------------------------------
-- 209.2  how long one payment attempt stays live (brief B3 — a platform setting, never a literal)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class) VALUES
  ('platform.payment_attempt_ttl_seconds', 'int', '900', 'platform',
   'PC-56 STORE-2c (0209, brief B3): seconds one payment attempt (one gateway order) stays LIVE. While an attempt is live a second one for the '
   'same order is refused (PAYMENT_ATTEMPT_LIVE, with its expiry); after it lapses — or once the gateway reports it failed — the buyer may '
   'send a fresh request (a new gateway order, a new payment row). A late capture of a lapsed attempt is still booked once. Seeded 900 s.',
   'money_path')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 209.3  the reservation marker on the order (founder D1)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_reserved_at timestamptz;
COMMENT ON COLUMN orders.stock_reserved_at IS
  'PC-56 STORE-2c (0209, founder D1): when checkout RESERVED this order''s stock (each line''s listing decremented under its row lock in the '
  'placement transaction). Cleared by the restock handler on orders.order_cancelled in the same transaction that puts the stock back — '
  'so a restock happens at most once. NULL = this order reserved nothing (placed before 0209, an offer / auction / requirement order, or '
  'already restocked).';

-- ------------------------------------------------------------------------------------------------------------------
-- 209.4  the payments of an order (the attempt rule and the auto-refund read them on the money path)
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments (tenant_id, reference_type, reference_id, created_at DESC)
  WHERE reference_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 209.5  the wallet is a payment source the payments table can name (D6 — found proving the wallet-pay door)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO integration_providers (code, default_name, category, is_active)
SELECT 'wallet', 'Krishalaya wallet (buyer balance)', 'payment', true
 WHERE NOT EXISTS (SELECT 1 FROM integration_providers p WHERE p.code = 'wallet');
