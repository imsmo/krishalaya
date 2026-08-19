-- =============================================================================================
-- 0153_freight_recon_evidence.sql · PC-56 TENANT-5c — THE FREIGHT DESK 0070 BUILT TABLES FOR
-- =============================================================================================
-- W241's lead: "What carriers bill you vs what shipments say they should — reconciled line by line. FREIGHT LEAKAGE
-- IS QUIET MONEY; THIS DESK MAKES IT LOUD." W242's rule: "pay the clean lines now, dispute the rest", and its claim:
-- "Every claim cites our shipment_events — timestamped, GPS-tagged, signed-exportable."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE WAVE'S SUBJECT): TWO TABLES WITH AN RLS SPEC AND NO APPLICATION CODE
-- ---------------------------------------------------------------------------------------------
-- 0070 built `freight_invoices` + `freight_invoice_lines` carefully: header and lines split precisely so a disputed
-- line can be isolated from a clean one ("disputed lines never block the clean ones"), `variance_minor` as a
-- GENERATED column on both, the full six-value recon vocabulary, tenant RLS, four indexes, and a written FK-target
-- verification. Then `grep -rl freight apps` returned three RLS integration specs and a mobile spending category.
-- No entity. No repository. No service. No controller. No SDK method. No screen.
--
-- The mirror image of TENANT-5a's finding (`shipment_events`: two writers, no reader) — here the readers and the
-- writers are both missing, and the RLS spec has been protecting an empty table for eighty-three migrations.
--
-- Closed in code, not here. What this migration adds is the EVIDENCE the recon needs to be worth anything.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: A DISPUTE WITH NO EVIDENCE IS AN ASSERTION, AND THIS ONE HAS MONEY ATTACHED
-- ---------------------------------------------------------------------------------------------
-- 0070 gave a line `dispute_status` and a free-text `dispute_reason`. W242's disputed-lines table is four CODED
-- classes with facts behind each ("billed as 2 attempts — our events show ONE attempt"), and its "why we win these"
-- paragraph rests entirely on the evidence being real and exportable. Free text cannot be grouped, counted, or
-- exported as a pack, and it cannot tell a carrier's ops desk anything a lawyer would accept.
--
-- So a line gains `dispute_reason_code` (a coded class) and `evidence` (the facts, snapshotted at dispute time),
-- plus `line_no` so an invoice's lines have the order the carrier printed them in — a recon that renumbers lines
-- cannot be checked against the paper it came from. `billed_attempts` records what the carrier CLAIMED about
-- attempts, which is what makes W242's first dispute checkable against 5a's `delivery_attempts` counter.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION REFUSES TO INVENT
-- ---------------------------------------------------------------------------------------------
--   • **A carrier payee.** W241: "Carrier invoices pay from the tenant wallet through the normal rails
--     (maker-checker above ₹25,000) — freight is money like all money." Those rails cannot carry a carrier:
--     `payouts.bank_account_id` is NOT NULL and `bank_accounts` requires `user_id` OR `tenant_id`, and a carrier is
--     a `logistics_partners` row, which is neither. `payout_purpose` is seeded with `settlement` and `wage` only, so
--     there is no freight purpose either. And `PayoutService.requestPayout` is a MEMBER-WITHDRAWAL path gated on the
--     calling user's own per-role KYC — paying a carrier through it would mean settling a freight bill against a
--     farmer's KYC. No bank-account owner column is added here and no purpose is seeded: vendor payments are a plane
--     this platform does not have, and inventing half of it inside a logistics migration would be worse than naming
--     it. `freight_invoices.payout_id` (0070) stays null and the console says why.
--   • **A carrier rate card.** Two of W242's four dispute reasons need one — the distance slab ("billed
--     inter-district — pincode is 10–30 km slab") and the weight surcharge ("AWB shows 48 kg, surcharge starts
--     50 kg"). There is no per-carrier lane table, no slab, no negotiated rate, and `shipments` has NO WEIGHT COLUMN
--     at all (`capacity_kg` belongs to a vehicle, not to a consignment). Adding a rate card is a founder decision
--     about who negotiates what, at what granularity — so the classifier names those two `not_evidenced` and the
--     operator writes the reason.
--   • **A 7-day dispute clock.** W242's settlement path promises a "7-day response window". Nothing here keeps it:
--     no deadline column, no carrier SLA, no chaser job. The console states the window and says the platform does
--     not keep the clock, rather than printing a date nothing enforces.
--
-- ---------------------------------------------------------------------------------------------
-- AND THE COLUMN THE WHOLE COMPARISON DEPENDS ON IS EMPTY
-- ---------------------------------------------------------------------------------------------
-- W241's column header is literally "Expected (Σ charge_minor)". **NOTHING ON THIS PLATFORM WRITES
-- `shipments.charge_minor`**: it is an optional field on `CreateShipmentDto`, and `OrderConfirmedHandler` — the path
-- that creates virtually every shipment in production — calls `Shipment.create({ id, tenantId, orderId })` with no
-- charge at all. So the expected side of this desk's comparison is null for every auto-created shipment, and a naive
-- rollup would print ₹0 against a real carrier bill and call the whole invoice leakage.
--
-- No default is invented for it (a made-up expected cost turns a recon into a random-number generator). Instead the
-- read model reports a PARTIAL sum with the count of lines it could not price, and the COMMENT below records the
-- decision where the next reader will look.
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 153.1 · freight_invoice_lines: the evidence, the coded class, the order the carrier printed
-- ---------------------------------------------------------------------------------------------
ALTER TABLE freight_invoice_lines ADD COLUMN IF NOT EXISTS awb_no varchar(60);
ALTER TABLE freight_invoice_lines ADD COLUMN IF NOT EXISTS line_no integer NOT NULL DEFAULT 0;
ALTER TABLE freight_invoice_lines ADD COLUMN IF NOT EXISTS billed_attempts smallint;
ALTER TABLE freight_invoice_lines ADD COLUMN IF NOT EXISTS dispute_reason_code varchar(30);
ALTER TABLE freight_invoice_lines ADD COLUMN IF NOT EXISTS evidence jsonb;

-- ---------------------------------------------------------------------------------------------
-- 153.1a · THE COLUMN THAT CANNOT HOLD "WE DO NOT KNOW"
-- ---------------------------------------------------------------------------------------------
-- 0070 declared `freight_invoice_lines.expected_minor bigint NOT NULL` — no default — with the comment
-- "shipments.charge_minor snapshot at match time". But `shipments.charge_minor` is NULLABLE and, as this migration's
-- header records, nothing writes it. So at the moment the matcher finds our shipment and copies its charge across,
-- the value it has to store is **NULL**, and the column refuses it.
--
-- The only ways to satisfy 0070's constraint are to store 0 or to skip the line. Both are worse than they look:
-- zero says "we expected this consignment to be free", which against a ₹1,680 billed line prints a ₹1,680 variance
-- and a 100% leakage figure on a shipment nobody has priced; skipping the line hides a billed row from a
-- reconciliation, which is the one thing a reconciliation may never do. **"Unpriced" and "expected zero" are
-- different facts, and this wave's entire expected-side argument is that a desk which cannot tell them apart is
-- worse than no desk.** So the NOT NULL is dropped and NULL means exactly one thing: nobody has recorded what this
-- shipment should have cost.
--
-- Found before the live run rather than by it: 0070's DDL was read against the insert this wave wrote. Same class as
-- 0151's `orders.deleted_at` and 0152's `vehicles.is_active` — a query the database will refuse — and this
-- programme's third instance of it, which is why the DDL is now read column by column before the insert is trusted.
ALTER TABLE freight_invoice_lines ALTER COLUMN expected_minor DROP NOT NULL;

COMMENT ON COLUMN freight_invoice_lines.expected_minor IS
  'PC-56 TENANT-5c. What WE expected this consignment to cost — a snapshot of shipments.charge_minor taken when the matcher found the shipment. NULL means UNPRICED: no shipment matched the carrier''s AWB, or the shipment matched and carries no charge (which is every auto-created shipment on this platform — see the COMMENT on shipments.charge_minor). 0070 declared this NOT NULL, which forced a 0 for the unknown case; a zero expected against a real billed line prints the whole line as leakage, so the NOT NULL was dropped rather than the difference lost. variance_minor is GENERATED from (billed - expected) and is therefore NULL for an unpriced line — correct, and the read model reports the count of such lines beside every partial sum.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_freight_line_reason_code') THEN
    ALTER TABLE freight_invoice_lines
      ADD CONSTRAINT ck_freight_line_reason_code CHECK (
        dispute_reason_code IS NULL OR dispute_reason_code IN
          ('extra_attempt_billed','cancelled_in_transit','not_shipped','unpriced_line','not_evidenced'));
  END IF;
END $$;

-- A disputed line must carry BOTH a coded class and the words an operator wrote. Written so the CHECK cannot
-- evaluate to NULL for the rows it governs (a NULL CHECK passes — this programme has been caught by that before):
-- every branch compares a status to a literal, so the result is always true or false.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_freight_line_dispute_evidence') THEN
    ALTER TABLE freight_invoice_lines
      ADD CONSTRAINT ck_freight_line_dispute_evidence CHECK (
        dispute_status <> 'disputed'
        OR (dispute_reason_code IS NOT NULL AND dispute_reason IS NOT NULL AND evidence IS NOT NULL));
  END IF;
END $$;

-- A resolved line must say who resolved it and when — the same both-or-neither shape 0152 used for the route
-- approval, and for the same reason: "resolved" that cannot name a person is not a record of a decision.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_freight_line_resolution_pair') THEN
    ALTER TABLE freight_invoice_lines
      ADD CONSTRAINT ck_freight_line_resolution_pair CHECK (
        dispute_status <> 'resolved' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_freight_line_billed_attempts') THEN
    ALTER TABLE freight_invoice_lines
      ADD CONSTRAINT ck_freight_line_billed_attempts CHECK (billed_attempts IS NULL OR (billed_attempts >= 1 AND billed_attempts <= 20));
  END IF;
END $$;

-- One line per (invoice, line_no) — so a re-upload cannot silently interleave with the first attempt's rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_line_no
  ON freight_invoice_lines (invoice_id, line_no) WHERE deleted_at IS NULL;
-- The matcher reads by AWB (a carrier bills under its own number; our uuid never appears on its paperwork).
CREATE INDEX IF NOT EXISTS idx_freight_lines_awb
  ON freight_invoice_lines (tenant_id, awb_no) WHERE awb_no IS NOT NULL AND deleted_at IS NULL;
-- The recovery figure W241 quotes reads resolved lines' own evidence.
CREATE INDEX IF NOT EXISTS idx_freight_lines_resolved
  ON freight_invoice_lines (tenant_id, resolved_at DESC) WHERE dispute_status = 'resolved' AND deleted_at IS NULL;

COMMENT ON COLUMN freight_invoice_lines.awb_no IS
  'PC-56 TENANT-5c. The carrier''s OWN reference for the consignment, as printed on its invoice. The matcher joins on this first and on shipment_id second, because a carrier has never heard of our shipment uuid. Kept even when it matches nothing: an AWB with no shipment behind it IS the evidence for the "we never shipped this" dispute, which is the leakage class neither W241 nor W242 draws and the most expensive one there is.';
COMMENT ON COLUMN freight_invoice_lines.dispute_reason_code IS
  'PC-56 TENANT-5c. The coded class behind a dispute, classified from facts we hold: extra_attempt_billed (5a''s shipments.delivery_attempts vs what the carrier claimed), cancelled_in_transit (the shipment''s own status), not_shipped (no such AWB), unpriced_line (shipments.charge_minor is null, so the price cannot be checked at all), and not_evidenced — which is where W242''s distance-slab and weight-surcharge reasons land, because there is no carrier rate card anywhere and shipments has no weight column. Free text alone cannot be grouped, counted or exported as a dispute pack.';
COMMENT ON COLUMN freight_invoice_lines.evidence IS
  'PC-56 TENANT-5c. The facts behind the verdict, snapshotted at dispute time, and after a resolution also the recovery (resolvedOutcome, recoveredMinor, agreedMinor) — so W241''s "last quarter recon recovered ₹11,840" is re-derivable from the rows a year later rather than from an event stream nobody kept. A verdict with no evidence is an assertion, and this one goes to a carrier with money attached.';

COMMENT ON COLUMN shipments.charge_minor IS
  'What this shipment is expected to COST (the carrier''s side), bigint minor units. PC-56 TENANT-5c: **nothing on this platform writes it.** It is an optional field on CreateShipmentDto, and OrderConfirmedHandler — the path that creates virtually every shipment in production — calls Shipment.create({ id, tenantId, orderId }) with no charge. So W241''s "Expected (Σ charge_minor)" column is null for every auto-created shipment, and the freight desk reports a PARTIAL sum with a count of unpriced lines rather than printing zero and calling a real bill 100% leakage. Making it real needs a carrier rate card (per carrier, per lane, per weight slab) which does not exist in this schema and is a founder decision. NOT to be confused with orders.delivery_fee_minor, which is what the BUYER was charged — revenue, not cost.';

-- ---------------------------------------------------------------------------------------------
-- 153.1b · THE MATCH HAD NO INDEX TO USE
-- ---------------------------------------------------------------------------------------------
-- The evidence read is the heart of this desk: for each of a carrier's billed lines, find OUR shipment by the
-- carrier's own AWB (`shipments.awb_no = ANY($2)`), because our uuid appears on nothing the carrier has ever seen.
--
-- **`shipments` had no index on `awb_no` anywhere** — not in 0007, not since. `EXPLAIN` on the live schema showed the
-- partition pruning working (Subplans Removed: 15, from the invoice period bound) and then a sequential scan inside
-- the surviving partitions. On a real tenant that is an 86-AWB lookup against every shipment created in a
-- three-month window, per recon pass, per re-run — a query that grows with the tenant rather than with the invoice.
-- Rule Zero: a query that scans a whole table per request caps scale, and it does so silently until the table is big.
--
-- Partial on `awb_no IS NOT NULL` because a shipment gets its AWB only when a carrier is assigned, and the un-assigned
-- rows are the majority early in a tenant's life. Created on the partitioned parent, so every partition (and every
-- future one) carries it.
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_awb
  ON shipments (tenant_id, awb_no) WHERE awb_no IS NOT NULL;

COMMENT ON COLUMN shipments.awb_no IS
  'The carrier''s own consignment reference (air waybill / docket number), as printed on its paperwork. PC-56 TENANT-5c: this is the JOIN KEY of the freight desk — a carrier bills under this number and has never seen our shipment uuid — and it had no index until 0153. NOT unique by design: a re-booked consignment can legitimately carry a re-used docket, and the matcher takes the shipment in the invoice''s own period window rather than assuming one AWB means one shipment for all time.';

-- ---------------------------------------------------------------------------------------------
-- 153.2 · the switch (Law 10 — OFF)
-- ---------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_freight_recon',
       'PC-56 TENANT-5c: the freight desk — W241''s carrier-invoice list and W242''s line-by-line reconciliation over freight_invoices/freight_invoice_lines, which 0070 created and no application code has ever touched. OFF means the desk does not exist, which is the pre-wave state; it does not gate the tables, which stay empty either way. Reconciling changes no money: there is no payout rail for a carrier payee (see this migration''s header), so closing a recon releases the hold and states what is ready to pay.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_freight_recon');

COMMIT;
