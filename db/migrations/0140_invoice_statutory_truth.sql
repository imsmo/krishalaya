-- ============================================================================
-- MIGRATION 0140 — THE TRADE INVOICE, MADE INTO A DOCUMENT SOMEBODY CAN CHECK
-- (PC-56 TENANT-3c-1 · W151, W152 + W2434–W2442)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one (Law 9).
--
-- TENANT-3c SPLIT IN TWO, on the boundary between a STATUTORY DOCUMENT and a TENANT'S OWN FEE TABLE:
--   3c-1 (this) — W151 + W152 + W2434–W2442, 11 files: the invoice, its tax, its corrections, its GSTR-1 export.
--   3c-2        — W150 + W2524–W2530, 8 files: `charge_definitions`' missing tenant write path and the
--                 read-only tax-rule table W150 renders. Deliberately separate: one is what the law requires of
--                 a document we issue, the other is what an FPO charges for delivery. A wave that cannot finish
--                 honestly splits itself rather than thinning the bar.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: THE INVOICE'S TAX IS COMPUTED ON THE WRONG BASE, AT A RATE NOBODY CHOSE, AND NOTHING CHECKS IT
-- ---------------------------------------------------------------------------
-- `TradeInvoiceService.generateForOrder` is, in full arithmetic:
--
--     gst        = tax_rules.resolve(country, 'gst', categoryId)      -- categoryId is ALWAYS null (see below)
--     taxMinor   = applyBps(order.total_minor, gst.rateBps)           -- the rate applied to the WHOLE ORDER
--     taxBreakup = { taxableMinor: order.total_minor, cgst: tax/2, sgst: tax-cgst, igst: 0 }
--
-- Three independent errors in four lines, each of which lands on a document a buyer files with:
--
--   (a) **THE BASE IS THE WHOLE ORDER.** W152's own invoice is ₹44,660 of unprocessed groundnut (EXEMPT) plus a
--       ₹893 facilitation fee; the taxable value is ₹893, not ₹45,553. Declaring the goods taxable overstates the
--       taxable turnover of every produce order this platform has ever invoiced.
--   (b) **THE RATE IS THE COUNTRY DEFAULT, ALWAYS.** `orders.order_completed` (order.entity.ts) carries
--       buyerUserId, sellerUserId, totalMinor, deliveryFeeMinor, platformFeeMinor, currencyCode and source — and
--       NO categoryId. The handler reads `event.payload.categoryId`, which is undefined, so every invoice resolves
--       the country-wide row. That row is seeded at **500 bps** (db/seeds/rules/0203): so today every trade invoice
--       declares 5% GST on the entire order. On W152's example that is ₹2,285 of tax where ₹161 is due.
--   (c) **NOTHING RECONCILES.** `taxable_minor` is not stored at all, so no query can ask whether taxable + exempt
--       + tax equals the total the buyer paid. The entity checks only `tax <= total`, which 5%-of-total passes.
--
-- This migration gives the invoice the columns a checkable document needs: the taxable base, the exempt base, the
-- tax, the per-line breakdown with HSN and rate, the place of supply, and the supply type — with a CHECK that the
-- three bases add up to the total. The arithmetic itself moves to `domain/invoice-tax.ts`, per line, in one place.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: EVERY INVOICE IS ISSUED AS INTRA-STATE, BECAUSE THE SPLIT IS HARDCODED
-- ---------------------------------------------------------------------------
-- `cgst = tax/2; sgst = tax - cgst; igst = 0` — with no place of supply anywhere in the schema. W152 lists
-- "Place of supply: Gujarat (24) · intra-state → CGST 9% + SGST 9%" as a STATUTORY FIELD, and it is: an inter-state
-- supply must carry IGST, and a buyer who receives CGST/SGST on an inter-state purchase cannot claim the credit.
-- A Gujarat FPO selling into Maharashtra is invoiced today with the wrong tax type.
--
-- `admin_regions` carries the LGD code, which is not the GST state code, so 0140 adds `gst_state_code` on the
-- state level and seeds the two launch states. Where a state has no code recorded and neither party's GSTIN
-- supplies one, the supply type is **'unknown'** and stays unknown: the tax figure is still recorded, but nothing
-- guesses which of the two column pairs it belongs in, and the GSTR-1 export refuses those rows by name.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3 (NAMED, NOT FIXED): WHETHER THE PLATFORM'S FEE IS GST-INCLUSIVE IS A PRICING DECISION, NOT A BUG
-- ---------------------------------------------------------------------------
-- W152 adds ₹161 of GST ON TOP of the ₹893 fee and totals ₹45,714. Checkout (TENANT-3a) charges
-- subtotal + delivery + fee and sets `orders.tax_minor` to 0 — the buyer is never charged the ₹161. So the canon's
-- arithmetic and the platform's charging disagree by the tax on the fee.
--
-- **THE INVARIANT W152 STATES TWICE WINS**: "Invoice total ₹45,714 = buyer payment exactly — one number everywhere:
-- checkout, order screen, invoice." An invoice for more than the buyer paid is a demand for money nobody collected,
-- which is worse than an invoice whose fee is inclusive. So the invoice treats the platform fee as **GST-inclusive**,
-- EXTRACTS the tax from it, and says so on the document. Charging GST on top of the fee raises what every buyer pays
-- and is a pricing decision for the people who set prices — recorded here, not made here.
--
-- ---------------------------------------------------------------------------
-- DEFECT 4: INVOICES GENERATE AT COMPLETION; W151 SAYS "ON ORDER CONFIRM", AND THE LAW AGREES WITH W151
-- ---------------------------------------------------------------------------
-- `TradeInvoiceHandler.eventType = 'orders.order_completed'` — completion is after delivery and after the quality
-- window. W151's KPI card reads "auto-generated on order confirm" and its empty state says "Invoices generate
-- automatically when orders confirm". For a supply of GOODS a tax invoice is due at or before REMOVAL of the goods,
-- which is dispatch — so an invoice created after delivery is late for every order, and the goods travel with no
-- invoice to accompany them. TENANT-3c-1 generates at CONFIRM and keeps the completion handler as an idempotent
-- BACKSTOP (one invoice per order, enforced by 0019's unique index), because a confirm event lost to a relay
-- failure must not leave an order permanently uninvoiced.
--
-- ---------------------------------------------------------------------------
-- DEFECT 5: THERE IS NO CREDIT NOTE, SO "ISSUED INVOICES ARE NEVER EDITED" IS A PROMISE WITH NO ALTERNATIVE
-- ---------------------------------------------------------------------------
-- W152: "Issued invoices are never edited. Corrections issue a credit note referencing this number." No credit-note
-- table exists in any migration; the only way to change an issued invoice today is an UPDATE. 0140 adds
-- `credit_notes` — its own gapless number series, its own place of supply, its own line breakdown — and it rides
-- **0139's refund approval plane** rather than growing a second maker-checker: one threshold, one maker≠checker
-- rule, one audit shape. That is why 0139's subject CHECK is widened here instead of being copied.
--
-- ---------------------------------------------------------------------------
-- DEFECT 6 (NAMED, NOT FIXED): THE PLATFORM CANNOT PRINT A B2B BUYER'S GSTIN, BY DESIGN
-- ---------------------------------------------------------------------------
-- 0058 stores `business_kyc_profiles.gstin_masked` and says in its own comment "NEVER the raw value". A GST invoice
-- to a registered buyer must carry that buyer's GSTIN in full, and a GSTR-1 B2B row cannot be filed with a mask.
-- So W151's masked column is honest and W152's "full GSTIN reveal needs finance scope" describes a reveal of
-- something the platform does not hold. The mask still yields the STATE CODE (its first two digits), which is what
-- the place-of-supply determination needs — so 0140 uses the mask for the state and refuses to invent the rest:
-- invoices record what is held, and the GSTR-1 export names the rows it cannot file rather than filing them wrong.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 140.1  THE GST STATE CODE — THE ONE FIELD PLACE-OF-SUPPLY NEEDS AND NOBODY HAD
-- ---------------------------------------------------------------------------
-- LGD codes (admin_regions.code) are the government's Local Government Directory identifiers; the GST state code is
-- a different 2-digit list, and it is the one that appears on an invoice and in a return.
ALTER TABLE admin_regions ADD COLUMN IF NOT EXISTS gst_state_code char(2);
ALTER TABLE admin_regions DROP CONSTRAINT IF EXISTS ck_admin_regions_gst_state_code;
ALTER TABLE admin_regions
  ADD CONSTRAINT ck_admin_regions_gst_state_code CHECK (
    gst_state_code IS NULL OR (gst_state_code ~ '^[0-9]{2}$' AND level = 1));
COMMENT ON COLUMN admin_regions.gst_state_code IS
  'GST state code (24 = Gujarat, 27 = Maharashtra) for level-1 rows (0140). Distinct from `code`, which is the LGD identifier. NULL means not recorded — the invoice then reads the state from a party''s GSTIN prefix, and where neither is available the supply type stays "unknown" rather than being guessed.';

-- The two launch states (db/seeds/core/0002 seeds GJ + MH). Matched on the ltree path root rather than on a name,
-- because a display name is translatable and a path is not.
UPDATE admin_regions SET gst_state_code = '24'
  WHERE level = 1 AND country_code = 'IN' AND gst_state_code IS NULL AND path::text IN ('in.gj', 'IN.GJ');
UPDATE admin_regions SET gst_state_code = '27'
  WHERE level = 1 AND country_code = 'IN' AND gst_state_code IS NULL AND path::text IN ('in.mh', 'IN.MH');

-- ---------------------------------------------------------------------------
-- 140.2  THE INVOICE'S OWN NUMBERS, IN COLUMNS A QUERY CAN CHECK
-- ---------------------------------------------------------------------------
ALTER TABLE trade_invoices
  ADD COLUMN IF NOT EXISTS taxable_minor        bigint,
  ADD COLUMN IF NOT EXISTS exempt_minor         bigint,
  ADD COLUMN IF NOT EXISTS tax_minor            bigint,
  -- Per-line: [{key, hsn, qtyText, grossMinor, taxableMinor, exemptMinor, rateBps, taxMinor, rateBasis, legalRef}]
  -- W152 renders exactly this table and calls it "Line items (tax_breakup jsonb)"; the old column held one blended
  -- rate for the whole order, which is why a line-level document could not be drawn from it.
  ADD COLUMN IF NOT EXISTS lines                jsonb,
  ADD COLUMN IF NOT EXISTS place_of_supply_code char(2),
  ADD COLUMN IF NOT EXISTS supply_type          varchar(10),
  -- FALSE when any line's rate could not be resolved from tax_rules. **THE GSTR-1 EXPORT REFUSES A MONTH THAT
  -- CONTAINS ONE**: a return with a guessed rate is worse than a missing return (the c3 assemble-or-refuse rule).
  ADD COLUMN IF NOT EXISTS tax_basis_complete   boolean,
  ADD COLUMN IF NOT EXISTS issued_at            timestamptz;

ALTER TABLE trade_invoices DROP CONSTRAINT IF EXISTS ck_trade_invoice_supply_type;
ALTER TABLE trade_invoices
  ADD CONSTRAINT ck_trade_invoice_supply_type CHECK (
    supply_type IS NULL OR supply_type IN ('intra', 'inter', 'unknown'));

ALTER TABLE trade_invoices DROP CONSTRAINT IF EXISTS ck_trade_invoice_place_of_supply;
ALTER TABLE trade_invoices
  ADD CONSTRAINT ck_trade_invoice_place_of_supply CHECK (
    place_of_supply_code IS NULL OR place_of_supply_code ~ '^[0-9]{2}$');

-- **AN INVOICE THAT DOES NOT ADD UP CANNOT BE STORED.** exempt + taxable + tax = total, exactly, in minor units.
-- This is the constraint whose absence let 5%-of-the-whole-order pass for as long as the feature has existed.
-- NOT VALID because every pre-0140 row has NULLs in the three new columns and passes by the NULL guard; failing the
-- migration on rows written under the old arithmetic would block the fix that stops producing them.
ALTER TABLE trade_invoices DROP CONSTRAINT IF EXISTS ck_trade_invoice_bases_sum;
ALTER TABLE trade_invoices
  ADD CONSTRAINT ck_trade_invoice_bases_sum CHECK (
    taxable_minor IS NULL OR exempt_minor IS NULL OR tax_minor IS NULL
    OR (taxable_minor >= 0 AND exempt_minor >= 0 AND tax_minor >= 0
        AND exempt_minor + taxable_minor + tax_minor = total_minor)) NOT VALID;

-- An inter-state supply must name the place of supply; an intra-state one must too (it is the seller's own state,
-- and printing it is a statutory field either way — W152 lists it among the four).
ALTER TABLE trade_invoices DROP CONSTRAINT IF EXISTS ck_trade_invoice_inter_needs_place;
ALTER TABLE trade_invoices
  ADD CONSTRAINT ck_trade_invoice_inter_needs_place CHECK (
    supply_type IS NULL OR supply_type = 'unknown' OR place_of_supply_code IS NOT NULL) NOT VALID;

COMMENT ON COLUMN trade_invoices.taxable_minor IS
  'The base GST was actually charged on (0140) — the platform fee, and any goods line whose HSN/category carries a rate. NOT the order total: W152''s invoice is ₹44,660 of exempt produce plus a ₹893 fee, so the taxable value is ₹893. NULL on pre-0140 rows, which were computed as a flat percentage of the whole order and cannot be re-derived.';
COMMENT ON COLUMN trade_invoices.tax_basis_complete IS
  'FALSE when any line''s rate could not be resolved from tax_rules (0140). Such an invoice is still issued — the buyer paid and is owed a document — but it is EXCLUDED from the GSTR-1 export, which names the count rather than filing a guessed rate.';

-- W151's month view ("Showing 3 of 1,214 invoices (Jul)") and its keyset pager.
CREATE INDEX IF NOT EXISTS idx_trade_inv_tenant_recent ON trade_invoices (tenant_id, created_at DESC, id DESC);
-- The GSTR-1 export reads one month at a time and must not scan the tenant's whole history to do it.
CREATE INDEX IF NOT EXISTS idx_trade_inv_month ON trade_invoices (tenant_id, issued_at)
  WHERE issued_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 140.3  CREDIT NOTES — THE ALTERNATIVE THAT MAKES "NEVER EDITED" TRUE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_notes (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  invoice_id        uuid NOT NULL REFERENCES trade_invoices(id),
  order_id          uuid NOT NULL,
  -- Its own gapless series (next_doc_number(tenant,'credit_note','CRN',period)) — a credit note is a document in
  -- its own right in a GST return, not an annotation on the invoice.
  credit_note_no    varchar(40) NOT NULL,
  reason_code       varchar(30) NOT NULL,
  -- Read by the buyer, and by whoever reconciles the return. 20 characters for the same reason 0139's notes carry
  -- one: "wrong" is not a reason a third party can act on.
  reason_text       text NOT NULL,
  total_minor       bigint NOT NULL,
  taxable_minor     bigint NOT NULL DEFAULT 0,
  exempt_minor      bigint NOT NULL DEFAULT 0,
  tax_minor         bigint NOT NULL DEFAULT 0,
  lines             jsonb NOT NULL DEFAULT '[]',
  place_of_supply_code char(2),
  supply_type       varchar(10),
  -- The 0139 approval that authorised it. NOT NULL is deliberate: W152 says "(checker)" on the button, and a credit
  -- note reduces what a buyer owes — there is no path here that one person can walk alone.
  approval_id       uuid NOT NULL REFERENCES refund_approvals(id),
  issued_by         uuid NOT NULL REFERENCES users(id),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, credit_note_no)
);
CALL add_std_columns('credit_notes');

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS ck_credit_note_amounts;
ALTER TABLE credit_notes
  ADD CONSTRAINT ck_credit_note_amounts CHECK (
    total_minor > 0 AND taxable_minor >= 0 AND exempt_minor >= 0 AND tax_minor >= 0
    AND exempt_minor + taxable_minor + tax_minor = total_minor);
ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS ck_credit_note_reason;
ALTER TABLE credit_notes
  ADD CONSTRAINT ck_credit_note_reason CHECK (
    reason_text IS NOT NULL AND char_length(btrim(reason_text)) >= 20);
ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS ck_credit_note_supply_type;
ALTER TABLE credit_notes
  ADD CONSTRAINT ck_credit_note_supply_type CHECK (
    supply_type IS NULL OR supply_type IN ('intra', 'inter', 'unknown'));
-- One credit note per approval: the approval IS the authorisation for one specific amount (0139 pins the figure on
-- the row), so re-using it to issue a second note would be a signature spent twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_note_approval ON credit_notes (approval_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes (tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_month ON credit_notes (tenant_id, issued_at);

-- Append-only, like every evidence table since 0119: a correction trail the correcting party can delete is not one.
REVOKE ALL ON credit_notes FROM kv_relay;
REVOKE DELETE, TRUNCATE ON credit_notes FROM kv_app, kv_admin;
REVOKE INSERT, UPDATE ON credit_notes FROM kv_admin;
GRANT SELECT, INSERT ON credit_notes TO kv_app;
GRANT SELECT ON credit_notes TO kv_readonly;

ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_reads_own_credit_notes ON credit_notes;
CREATE POLICY tenant_reads_own_credit_notes ON credit_notes
  FOR ALL
  USING (tenant_id = current_tenant_id());

COMMENT ON TABLE credit_notes IS
  'GST credit notes against issued trade invoices (0140, PC-56 TENANT-3c-1). W152: "Issued invoices are never edited. Corrections issue a credit note referencing this number." Rides 0139''s refund_approvals plane for its checker rather than growing a second maker-checker — one threshold, one maker != checker rule, one audit shape.';

-- ---------------------------------------------------------------------------
-- 140.4  0139's APPROVAL PLANE LEARNS ONE MORE SUBJECT
-- ---------------------------------------------------------------------------
-- Widened rather than copied. A credit note is the same act as a refund from the plane's point of view: tenant money
-- going back to a buyer, proposed by one person and signed by another, at an amount that is pinned on the row.
--
-- **AND THE COLUMN HAS TO GROW BEFORE THE CHECK MEANS ANYTHING — A DEFECT THE LIVE APPLY CAUGHT.** 0139 declared
-- `subject_type varchar(10)`, sized for 'dispute' and 'return'. 'credit_note' is ELEVEN characters, so with the CHECK
-- widened and the column left alone every insert failed at runtime with "value too long for type character
-- varying(10)" — a migration that applied cleanly, unit tests that all passed (TypeScript never sees a column width),
-- and a feature that could not write a single row. The widening comes first, and the CHECK second.
ALTER TABLE refund_approvals ALTER COLUMN subject_type TYPE varchar(20);
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_subject;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_subject CHECK (subject_type IN ('dispute', 'return', 'credit_note'));

-- ---------------------------------------------------------------------------
-- 140.5  THE CITATION AN EXEMPT LINE MUST CARRY, AND THE ONE RATE THIS PLATFORM'S OWN FEE NEEDS
-- ---------------------------------------------------------------------------
-- W152's statutory field: "HSN codes per line · exempt produce cited (Notif. 2/2017)". A rate with no authority is
-- a number in a table; on an invoice it has to be attributable.
ALTER TABLE tax_rules ADD COLUMN IF NOT EXISTS legal_ref varchar(200);
COMMENT ON COLUMN tax_rules.legal_ref IS
  'The authority a rate rests on — "Notification 2/2017 (exempt)", "HSN 9997 services @18%" (0140). W150 renders it as the Authority column. NULL means the citation was not recorded, which the invoice SAYS rather than inventing one.';

-- **THE ONE RATE ADDED HERE, AND WHY ONLY THIS ONE.** The platform's facilitation fee is a service supplied by the
-- platform under HSN 9997 at 18% (CGST 9 + SGST 9 / IGST 18) — the figure W150 and W152 both print, and the only
-- rate on the invoice that is about OUR OWN supply rather than about a commodity. Per-commodity produce rates are
-- per-HSN statutory data "maintained by platform compliance, per country" (W150's own footer) and are NOT invented
-- here: an unresolved goods rate is recorded as unresolved and the export refuses it (140.2).
INSERT INTO tax_rules (country_code, tax_code, category_id, hsn_prefix, rate_bps, threshold_minor, split, effective_from, is_active, legal_ref)
SELECT 'IN', 'gst_service', NULL, '9997', 1800, NULL, '{"cgst":900,"sgst":900,"igst":1800}'::jsonb, CURRENT_DATE, true,
       'HSN 9997 — marketplace facilitation service @ 18% (CGST 9 + SGST 9; IGST 18 inter-state)'
 WHERE NOT EXISTS (
   SELECT 1 FROM tax_rules WHERE country_code = 'IN' AND tax_code = 'gst_service' AND category_id IS NULL);

-- ---------------------------------------------------------------------------
-- 140.6  WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
-- ---------------------------------------------------------------------------
-- IT DOES NOT BACKFILL `taxable_minor`, `tax_minor` OR `lines` ON EXISTING INVOICES. Those documents were issued
-- with a blended percentage of the whole order and the components cannot be recovered — the invoice number is on a
-- buyer's records and the figure it carries is the figure they hold. The columns stay NULL, the console says the
-- breakdown was not recorded, and the GSTR-1 export excludes them by name. Re-deriving what "should" have been
-- charged would replace a wrong document with a fictional one.
--
-- IT DOES NOT ADD AN `irn` WORKFLOW. `irn` exists (0006) and W151/W152 both say "e-invoice IRN arrives in Phase 2".
-- An IRN comes from the government's IRP after a signed API call; a column that is always NULL under a screen that
-- says "pending Phase 2" is honest, and a status field pretending to track a registration nobody performs would be
-- the ADMIN-10 shape.
--
-- IT DOES NOT MAKE `tax_rules` TENANT-WRITABLE. W150 is explicit — "Tax rules are platform-maintained per country
-- and never tenant-editable — statutory correctness is our job, not your risk" — and this migration adds no tenant
-- write path, no tenant_id column, and no permission that would allow one. That refusal is the feature.
--
-- IT DOES NOT CHANGE WHAT A BUYER IS CHARGED (see DEFECT 3). Adding GST on top of the platform fee raises every
-- buyer's total; the invoice extracts the tax from the fee instead and prints that basis.
-- ============================================================================
