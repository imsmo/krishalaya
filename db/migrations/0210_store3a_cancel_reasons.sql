-- ==================================================================================================================
-- MIGRATION 0210 — PC-56 STORE-3a · YOUR ORDERS TELL THE TRUTH: WHAT YOU PAID, WHAT HAPPENS NEXT, HOW TO CANCEL
-- (canon W287 order confirmed · W288 my orders · W289 order detail · W291 cancellations & refunds · the cancel chain W3083–W3085 ·
-- the order Retry chain W3058–W3060)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0209 are applied; nothing here edits them: this file ADDS seven platform
-- vocabulary rows (and seed 0005's `cancel_reason` type row when absent), one nullable column on `orders` and three nullable columns on
-- `payments`.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey_store3.md F-9 / F-13 / B10 / B11 — verified on krishalaya_dev at 0209 before writing this file):
--   • F-9  THE CANCEL HAD NO REASON. `POST /v1/orders/:id/cancel` took an optional `reasonId` (dto/update-order.dto.ts) and stored it in
--          `orders.cancel_reason_id`, but the `cancel_reason` vocabulary (seed 0005, `is_tenant_extendable = true`) held its TYPE row only —
--          not one value — so no caller could ever send one, and the storefront sent none. The audit row of a cancel said nothing of why.
--   • F-13 (the cancel half) The buyer's "other" reason had nowhere to keep its words.
--   • B11  NO BUYER REFUND READ. A cancelled, paid order is refunded to source automatically since STORE-2c (`refund:<orderId>`), but the
--          payments row keeps only the status and `refunded_minor`: WHEN the refund was asked for, WHEN the source confirmed it and the
--          GATEWAY's refund reference (Razorpay `rfnd_…`, the one thing a buyer can quote to their bank) lived only in `audit_log`
--          (`payment.refund_processed` newValue) and the `payments.payment_refunded` outbox payload — neither a buyer read. `updated_at` moves
--          on any write, so it is not the completion instant.
--
-- WHAT IS TRUE NOW:
--   210.1  THE SEVEN BUYER CANCEL REASONS (founder D5, 2026-10-15), platform-wide (tenant_id NULL), sort 1–7: changed_mind ·
--          found_better_price · ordered_by_mistake · delivery_too_slow · quantity_or_grade_doubt · payment_issue · other (meta
--          {"textRequired": true} — the 0005 labour precedent). `default_name` is English; the labels the buyer reads (en / hi / gu) live in
--          the STOREFRONT catalogues keyed by code (`order.cancelReason.<code>`), as the dispute reasons do. The type stays tenant-extendable:
--          an organisation's own values are read by the same `GET /v1/lookups/values?type=cancel_reason` (a tenant value shadows a platform
--          value of the same code) and accepted by the cancel (the value must be active and visible to the order's tenant).
--          The API now REQUIRES a reason for a BUYER's cancel (CANCEL_REASON_REQUIRED / CANCEL_REASON_UNKNOWN / CANCEL_NOTE_REQUIRED — 422);
--          the seller's decline keeps today's optional reason (its vocabulary is a later wave).
--   210.2  `orders.cancel_note varchar(280)` — the buyer's own words when the reason is `other` (textRequired); NULL otherwise. Shown to the
--          selling organisation and staff (the order detail's `cancelNote`); the buyer's detail carries the reason CODE only.
--   210.3  `payments.gateway_refund_id varchar(120)` · `payments.refund_initiated_at timestamptz` · `payments.refunded_at timestamptz` —
--          written by the Payment aggregate exactly where the refund is already audited: `initiateRefund` (the automatic refund of a cancelled
--          order, `PaymentService.refundCancelledOrder`, in the transaction that posts `refund:<orderId>`), `completeRefund` (the gateway's
--          answer or Razorpay's `refund.processed` webhook — `payment.service.ts` handleWebhook / refundCancelledOrder) and the moderator's
--          `refund` (both instants at once: the ledger reversal IS the refund there). Brief A3 asked first whether the facts were recoverable
--          from the row + the `refund:<orderId>` ledger transaction's `created_at`: the initiation instant is, the completion instant and the
--          gateway's refund id are NOT — so the three columns are added together (one read, one writer). Rows refunded before this file keep
--          NULL; the read says "not recorded", never a guess. Varchar(120) = `gateway_payment_id`'s width (0006).
--
-- NOTHING ELSE (brief A): no table for the order groups (a pure mapping — orders/domain/order-groups.ts — and a bounded SQL count), nothing
-- for the cancellation fee ladder or a partial-fulfilment refund (founder D1 / D2: refused by name), nothing for flags (`disputes` is seeded
-- in seed 0009; this wave only allow-lists it on the storefront's public flags read — code).
--
-- RLS / GRANTS DECISION: `lookup_values` is a global registry (no RLS; kv_app SELECT, unchanged). `orders` and `payments` keep their RLS
-- policies; their grants are TABLE-level (kv_app SELECT / INSERT / UPDATE on both; kv_relay on `orders` per 0018; kv_wallet on `payments` per
-- 0014; verified on krishalaya_dev: information_schema.role_table_grants — no column-level grant is in force on either table), so a new
-- column inherits them and nothing is granted here. kv_relay still holds NOTHING on `payments` (0078). Partition pass: `orders` is
-- RANGE-partitioned by created_at — ALTER on the parent propagates to every existing partition and ensure-partitions creates future ones from
-- the parent; `payments` is a plain table.
--
-- LAW 9 (money path — founder review before production): NO money moves because of this file. 210.3 records WHEN a refund already booked by
-- STORE-2c's one posting function (`PaymentService.postRefundToSource`, keys `refund:<orderId>` / `refund:<paymentId>:<refundable>`) was asked
-- for and confirmed, and the gateway's reference for it — facts, not postings. 210.1 / 210.2 are why a buyer cancelled (the cancel itself
-- triggers 2c's refund — listed in the wave report §9). No ledger vocabulary row, no posting function. CODEOWNERS note: 210.3 touches the
-- `payments` table (money-bearing, Law 9).
--
-- REVERSAL (documented, not automatic):
--   ALTER TABLE payments DROP COLUMN IF EXISTS refunded_at, DROP COLUMN IF EXISTS refund_initiated_at, DROP COLUMN IF EXISTS gateway_refund_id;
--                                                     -- the buyer's refund read then answers the state and amount only (the code reads NULL)
--   ALTER TABLE orders DROP COLUMN IF EXISTS cancel_note;   -- the code must be reverted first (the order repository names the column)
--   the seven cancel_reason rows CANNOT be deleted once an order references one (orders.cancel_reason_id keeps the id) — deactivate instead:
--   UPDATE lookup_values SET is_active = false WHERE type_code = 'cancel_reason' AND tenant_id IS NULL;   -- a buyer cancel is then refused
--   CANCEL_REASON_UNKNOWN until the API's reason rule is reverted (fail closed, never a silent reason-less cancel).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 210.1  the seven buyer cancel reasons (founder D5) — platform values of the tenant-extendable `cancel_reason` type (seed 0005)
-- ------------------------------------------------------------------------------------------------------------------
-- The TYPE row is seed 0005's, byte for byte — written here too because migrations run BEFORE seeds on a database built from empty and
-- `lookup_values.type_code` is an FK to `lookup_types` (the 0187 pattern: "ALSO INSERTED BY MIGRATION"); ON CONFLICT keeps an existing row.
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('cancel_reason', 'Order cancel reason', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('cancel_reason', 'changed_mind',            'I changed my mind',                          '{}',                     1),
    ('cancel_reason', 'found_better_price',      'I found a better price',                     '{}',                     2),
    ('cancel_reason', 'ordered_by_mistake',      'I ordered by mistake',                       '{}',                     3),
    ('cancel_reason', 'delivery_too_slow',       'Delivery would take too long',               '{}',                     4),
    ('cancel_reason', 'quantity_or_grade_doubt', 'I am unsure of the quantity or the grade',   '{}',                     5),
    ('cancel_reason', 'payment_issue',           'A problem with the payment',                 '{}',                     6),
    ('cancel_reason', 'other',                   'Other (reason written by the buyer)',        '{"textRequired": true}', 7)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 210.2  the buyer's own words for `other` (founder D1 / D5)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_note varchar(280);
COMMENT ON COLUMN orders.cancel_note IS
  'PC-56 STORE-3a (0210, founder D1/D5): the buyer''s own words when the cancel reason is one whose meta says textRequired (the platform '
  'value `other`); NULL otherwise. Shown to the selling organisation and staff; the buyer''s order read carries the reason code only.';

-- ------------------------------------------------------------------------------------------------------------------
-- 210.3  the refund's facts on the payment (brief A3 / survey B11) — written where the refund is already audited
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_refund_id varchar(120);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_initiated_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
COMMENT ON COLUMN payments.gateway_refund_id IS
  'PC-56 STORE-3a (0210, survey B11): the payment provider''s refund reference (Razorpay rfnd_…) once the source confirmed the refund — the '
  'buyer''s reference to quote. NULL for a wallet refund (no provider) and for rows refunded before 0210.';
COMMENT ON COLUMN payments.refund_initiated_at IS
  'PC-56 STORE-3a (0210): when the platform asked for this payment''s refund (the ledger refund was booked in the same transaction).';
COMMENT ON COLUMN payments.refunded_at IS
  'PC-56 STORE-3a (0210): when the refund''s source confirmed it (status refunded / partially_refunded).';
