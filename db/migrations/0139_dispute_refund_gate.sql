-- ============================================================================
-- MIGRATION 0139 — THE DISPUTE & RETURN MONEY DOOR: A SCOPE THAT EXISTS, AND A SECOND PAIR OF EYES
-- (PC-56 TENANT-3b · W140, W141, W142 + W2581–W2590 + W2748–W2750)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one (Law 9).
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: THE DISPUTED AMOUNT HAS NO COLUMN, SO "ONLY THIS AMOUNT IS FROZEN" IS A SENTENCE ABOUT A FIELD
--           THAT DOES NOT EXIST
-- ---------------------------------------------------------------------------
-- W140 prints a "Disputed value" column (₹12,820 · ₹6,600 · ₹1,84,000). W141's subtitle reads "disputed value
-- ₹12,820 (2 of 10 qtl) — only this amount is frozen". The `disputes` table (0005) carries exactly one money column,
-- `resolution_amount_minor`, and it is written at RESOLUTION time by the moderator who decides. **So the figure both
-- screens show at RAISE time cannot be stored, cannot be listed, and cannot bound anything.** A buyer who disputes 2
-- of 10 quintals and a buyer who disputes the whole load are, in today's schema, the same row.
--
-- This migration gives the claim a SCOPE — amount and quantity, recorded when the dispute is raised — and never
-- backfills it. A dispute raised before today has no recorded scope, and NULL is allowed to mean that. Guessing the
-- order total would be worse than the gap: it would convert "nobody wrote this down" into "the buyer disputed
-- everything", which is a claim against a farmer that nobody made.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2 (NAMED, NOT FIXED): THE PARTIAL FREEZE ITSELF IS NOT BUILT — AND THE SCREENS MUST SAY SO
-- ---------------------------------------------------------------------------
-- W140's subtitle: "Money frozen for the disputed amount only — never the whole wallet." W141's money card:
-- "₹12,820 frozen in escrow (disputed 2 qtl only)" beside "₹51,280 for the delivered 8 qtl already paid out to
-- Vithal Bhai P. on schedule — a dispute never starves a farmer of undisputed money".
--
-- What the code does: `orders` sets the order to 'disputed' when disputes.dispute_opened arrives, and the buyer's
-- payment sits in platform escrow as ONE amount for the whole order. There is no per-line escrow, no partial
-- release, and `DisputeResolvedHandler` reverses the ENTIRE settlement leg-for-leg before refunding. **The undisputed
-- ₹51,280 is not paid out early; it is held with everything else.**
--
-- SO THIS MIGRATION DOES NOT ADD A `frozen_amount_minor` COLUMN, and that refusal is the honest half of this wave.
-- A column named for the frozen figure would be believed. Splitting escrow per order line is a SETTLEMENT change
-- (settlement_lines are written per order, once, from the order's gross) and it belongs to the wave that owns
-- settlement — not to a dispute console. TENANT-3b's surfaces therefore READ what is actually held (the payment,
-- and whether a settlement line exists) and print that, with its basis, instead of printing the canon's sentence.
-- The recorded scope makes the disputed part visible and bounds the refund; it does not pretend to move money early.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: THREE SCREENS PROMISE MAKER-CHECKER ON REFUNDS. NO REFUND PATH HAS EVER HAD ONE.
-- ---------------------------------------------------------------------------
--   W140: "Handling needs dispute.resolve; refund execution adds maker-checker ≥ ₹10,000."
--   W141: "refund = ledger reversal txn (resolution_txn_id) · ≥ ₹10,000 needs checker"
--   W142: "refund execution needs order.refund + maker-checker ≥ ₹10,000."
-- Today ONE person holding `dispute.resolve` calls POST /v1/disputes/:id/resolve with resolutionType='refund_full',
-- and `DisputeResolvedHandler` reverses the settlement and pays the buyer. The same one person calls
-- POST /v1/returns/:id/refund. There is no proposal, no second signature, no threshold, nothing that reads an amount
-- and asks for another human. This is the ELEVENTH maker-checker site in the platform and the first one inside a
-- tenant's own console (the other ten are admin-api's).
--
-- ---------------------------------------------------------------------------
-- DEFECT 4: `order.refund` IS NOT A PERMISSION. IT IS A STRING ON TWO SCREENS.
-- ---------------------------------------------------------------------------
-- W142 and W133 both name `order.refund` as the key that guards moving money back. It is seeded in NO file:
-- `grep -rn "order\.refund" db/ apps/ packages/` returns nothing outside canon HTML. This is the promise-with-no-grant
-- class again (0120's `analytics.read`, ADMIN-SWEEP's `listing.approve`, TENANT-2a's QC verbs) with the sharpest
-- edge yet: an access review of who can move a farmer's money back returns an empty set today, and reads as though
-- the control exists because the screen names it.
--
-- ---------------------------------------------------------------------------
-- DEFECT 5: A RETURN HAS NO AMOUNT AND NO INSPECTION, WHILE W142 SHOWS A COLUMN OF AMOUNTS AND AN INSPECT BUTTON
-- ---------------------------------------------------------------------------
-- `returns` (0005) is: id, tenant_id, order_id, dispute_id, status, reason_id, refund_txn_id. W142's table has a
-- "Refund value" column (₹4,180 · ₹6,250 · ₹2,940) with no column behind it, and its `received` row says
-- "inspect within 24h → refund" with nothing to write an inspection to. Worse: **`disputes.return_refunded` HAS NO
-- SUBSCRIBER ANYWHERE.** `ReturnService.refund` sets status='refunded', emits the event, and no handler in any app
-- consumes it — `Return.refund(null)` is the only call site, so `refund_txn_id` has never been written either. W142's
-- "Refunds are ledger reversals (refund_txn_id) — the money trail always closes" describes a trail that does not
-- start. A terminal status recording an act nobody performs, for the fifth time in this programme, and this time the
-- act is a buyer's money coming back.
--
-- ---------------------------------------------------------------------------
-- DEFECT 6: THE ₹10,000 THRESHOLD IS AN INDIAN NUMBER, SO IT IS A SETTING (LAW 6)
-- ---------------------------------------------------------------------------
-- A checker threshold is exactly the kind of string a tenant admin should control: an FPO turning over ₹40L a month
-- and a co-operative turning over ₹4L do not want the same figure, and after an incident it must be tightenable
-- without a deploy. It lands in `setting_definitions` with risk_class 'money_path' (0121) — so changing it needs two
-- administrators, which is the same rule the threshold itself enforces one layer down.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 139.1  THE DISPUTED SCOPE — RECORDED AT RAISE, NEVER BACKFILLED
-- ---------------------------------------------------------------------------
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS disputed_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS disputed_quantity     numeric(14,3);

ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_disputed_amount;
ALTER TABLE disputes
  ADD CONSTRAINT ck_disputes_disputed_amount CHECK (disputed_amount_minor IS NULL OR disputed_amount_minor > 0);
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_disputed_quantity;
ALTER TABLE disputes
  ADD CONSTRAINT ck_disputes_disputed_quantity CHECK (disputed_quantity IS NULL OR disputed_quantity > 0);

-- A resolution cannot refund more than was disputed WHERE A SCOPE WAS RECORDED. Where none was recorded the
-- constraint is silent rather than permissive-by-accident: the API refuses the refund and says which field is
-- missing, because a database constraint cannot tell "no claim was made" from "the claim was everything".
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS ck_disputes_resolution_within_scope;
ALTER TABLE disputes
  ADD CONSTRAINT ck_disputes_resolution_within_scope CHECK (
    resolution_amount_minor IS NULL
    OR disputed_amount_minor IS NULL
    OR resolution_amount_minor <= disputed_amount_minor
  ) NOT VALID;

COMMENT ON COLUMN disputes.disputed_amount_minor IS
  'The value the raiser is actually contesting, in minor units (0139). W141: "disputed value ₹12,820 (2 of 10 qtl)". NULL means the scope was NOT recorded — every dispute raised before 0139, and any raised without one. NULL is never read as "the whole order": the console says "scope not recorded" and the refund path refuses to bound itself by a number nobody wrote.';
COMMENT ON COLUMN disputes.disputed_quantity IS
  'How much of the order is contested, in the order line''s own unit (0139). W141''s "(2 of 10 qtl)". Advisory beside disputed_amount_minor — the money column is the one the refund gate reads.';

-- ---------------------------------------------------------------------------
-- 139.2  A RETURN GETS THE AMOUNT W142 PRINTS, AND THE INSPECTION W142 ASKS FOR
-- ---------------------------------------------------------------------------
-- NO CURRENCY COLUMN. The order carries `currency_code` and a second copy on the return could disagree with it —
-- and a refund denominated differently from the payment it reverses is a defect that survives every test written
-- against a single-currency tenant. The read models join the order for the currency.
ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS refund_amount_minor bigint,
  ADD COLUMN IF NOT EXISTS inspected_at        timestamptz,
  ADD COLUMN IF NOT EXISTS inspected_by        uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS inspection_note     text;

ALTER TABLE returns DROP CONSTRAINT IF EXISTS ck_returns_refund_amount;
ALTER TABLE returns
  ADD CONSTRAINT ck_returns_refund_amount CHECK (refund_amount_minor IS NULL OR refund_amount_minor > 0);

-- An inspection is a person, a time and a sentence, or it is nothing. 20 characters for the same reason 0112 set
-- that floor on a moderation reason and 0114 on a batch return: the note is read by the buyer whose refund it
-- decides, and "ok" is not an inspection.
ALTER TABLE returns DROP CONSTRAINT IF EXISTS ck_returns_inspection_shape;
-- **THE `IS NOT NULL` ON THE NOTE IS LOAD-BEARING, AND A LIVE APPLY IS HOW IT GOT THERE.** Written as
-- `char_length(btrim(inspection_note)) >= 20` alone, a row carrying a person and a time but NO note evaluates that
-- term to NULL, the branch to NULL, and the whole CHECK to NULL — which Postgres treats as SATISFIED. The constraint
-- would have accepted exactly the row it exists to forbid: an inspection with a signature and no finding.
ALTER TABLE returns
  ADD CONSTRAINT ck_returns_inspection_shape CHECK (
    (inspected_at IS NULL AND inspected_by IS NULL AND inspection_note IS NULL)
    OR (inspected_at IS NOT NULL AND inspected_by IS NOT NULL
        AND inspection_note IS NOT NULL AND char_length(btrim(inspection_note)) >= 20)
  );

-- W142: "Refund fires only on received — money follows goods", and its received row: "inspect within 24h → refund".
-- NOT VALID because rows may already sit in 'refunded' from before this wave, and failing the migration on lawful
-- historical data to enforce a rule the code did not have is the wrong trade.
ALTER TABLE returns DROP CONSTRAINT IF EXISTS ck_returns_refunded_needs_inspection;
ALTER TABLE returns
  ADD CONSTRAINT ck_returns_refunded_needs_inspection CHECK (
    status <> 'refunded' OR inspected_at IS NOT NULL) NOT VALID;

COMMENT ON COLUMN returns.refund_amount_minor IS
  'What this return is worth, in the order''s minor units (0139) — W142''s "Refund value" column, which had no column behind it. Recorded when the buyer requests the return and bounded by the order total server-side. NULL = not recorded (pre-0139 rows); the refund path refuses rather than assuming the order total.';
COMMENT ON COLUMN returns.inspection_note IS
  'What the person who opened the parcel found (0139). W142''s "Inspect" action had nowhere to write. Required (≥20 chars, with inspected_by/at) before a refund may be executed on a received return.';

-- W140/W142's queues, and the keyset both pages page with. `returns` carried no index but its primary key.
CREATE INDEX IF NOT EXISTS idx_returns_tenant_active ON returns (tenant_id, status)
  WHERE status NOT IN ('refunded', 'rejected');
CREATE INDEX IF NOT EXISTS idx_returns_tenant_recent ON returns (tenant_id, created_at DESC, id DESC);
-- W140's SLA sort ("9h left" ascending) and its "closed (90d)" tab, neither of which had an index.
CREATE INDEX IF NOT EXISTS idx_disputes_tenant_sla ON disputes (tenant_id, sla_due_at)
  WHERE status NOT IN ('resolved', 'rejected', 'withdrawn');
CREATE INDEX IF NOT EXISTS idx_disputes_tenant_resolved ON disputes (tenant_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 139.3  THE REFUND APPROVAL PLANE — ONE TABLE FOR BOTH DOORS
-- ---------------------------------------------------------------------------
-- ONE table covers dispute refunds and return refunds, because they are the same act: tenant money going back to a
-- buyer, decided by one person and signed by another. Two tables would mean two thresholds, two audit shapes and
-- two places to forget the maker≠checker rule.
CREATE TABLE IF NOT EXISTS refund_approvals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  -- 'dispute' | 'return'. No FK: the subject lives in one of two tables, and a polymorphic FK is not expressible.
  -- The service reads the subject in the same transaction it decides, so the id is verified where it is used.
  subject_type    varchar(10) NOT NULL,
  subject_id      uuid NOT NULL,
  order_id        uuid NOT NULL,
  -- The EXACT amount the checker is signing for. A proposal approved at ₹12,820 cannot be applied at ₹64,100:
  -- the apply path re-reads this row and compares, so an amount edited after approval invalidates the signature.
  amount_minor    bigint NOT NULL,
  -- dispute only: refund_full | refund_partial. NULL for a return (a return refunds its recorded amount).
  resolution_type varchar(30),
  status          varchar(10) NOT NULL DEFAULT 'pending',
  proposed_by     uuid NOT NULL REFERENCES users(id),
  proposed_at     timestamptz NOT NULL DEFAULT now(),
  proposal_note   text NOT NULL,
  -- **THE THRESHOLD IN FORCE WHEN THE PROPOSAL WAS MADE, PINNED ON THE ROW.** Same reasoning as 0114 pinning a
  -- batch's preflight: a tenant who lowers the threshold next month must not make last month's approvals look
  -- unnecessary, and one who raises it must not make them look invented.
  threshold_minor bigint NOT NULL,
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  decision_note   text,
  applied_at      timestamptz
);
CALL add_std_columns('refund_approvals');

ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_subject;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_subject CHECK (subject_type IN ('dispute', 'return'));
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_status;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_status CHECK (status IN ('pending', 'approved', 'rejected', 'applied'));
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_amount;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_amount CHECK (amount_minor > 0 AND threshold_minor >= 0);

-- THE ELEVENTH MAKER-CHECKER SITE, and the first inside a tenant's own console. Shape from admin-api's
-- `makerNeCheckerConstraint` (core/approval/two-person-rule.ts), with the NULL escape it always carries: a pending
-- proposal has no checker yet, and a constraint without the escape would refuse every insert.
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_maker_ne_checker;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_maker_ne_checker CHECK (
    decided_by IS NULL OR decided_by <> proposed_by);

-- A decision without a decider is the thing this table exists to make unrepresentable — both directions, so status
-- and decided_by can never disagree and no reader has to choose which to believe (0114's lesson, restated).
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_decision_evidence;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_decision_evidence CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved', 'rejected', 'applied') AND decided_by IS NOT NULL AND decided_at IS NOT NULL));

-- A proposal owes the checker a sentence, and a refusal owes the proposer one.
--
-- **AND THE `decision_note IS NOT NULL` IS THE WHOLE CONSTRAINT.** The first version of this line read
-- `status <> 'rejected' OR char_length(btrim(decision_note)) >= 20`, and the live apply refused a refusal with no
-- note... except it did not: with `decision_note` NULL the length term is NULL, `false OR NULL` is NULL, and a CHECK
-- that evaluates to NULL PASSES. A `UPDATE … SET status='rejected'` with no note committed cleanly. Three-valued
-- logic turned the rule into a comment — the same class of defect this programme keeps finding one layer up, and it
-- was caught by applying the migration to a real Postgres and trying the thing it forbids.
ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_notes;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_notes CHECK (
    proposal_note IS NOT NULL AND char_length(btrim(proposal_note)) >= 20
    AND (status <> 'rejected'
         OR (decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20)));

ALTER TABLE refund_approvals DROP CONSTRAINT IF EXISTS ck_refund_approval_applied;
ALTER TABLE refund_approvals
  ADD CONSTRAINT ck_refund_approval_applied CHECK (
    (applied_at IS NULL AND status <> 'applied') OR (applied_at IS NOT NULL AND status = 'applied'));

-- ONE OPEN PROPOSAL PER SUBJECT. Two pending proposals on one dispute means two checkers can each approve a
-- different amount and whichever applies first wins — a race decided by network latency over a farmer's money.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_approval_open
  ON refund_approvals (subject_type, subject_id)
  WHERE status = 'pending' AND deleted_at IS NULL;
-- AND ONE APPLIED PROPOSAL PER SUBJECT, which is the double-refund guard stated in the schema rather than trusted
-- to the wallet's idempotency key. The key would catch a replay of the SAME refund; this catches a second, larger
-- one approved after the first was applied.
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_approval_applied
  ON refund_approvals (subject_type, subject_id)
  WHERE status = 'applied' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refund_approvals_pending
  ON refund_approvals (tenant_id, proposed_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- Append-only for the platform realm, writable by the tenant app that proposes and signs. A refund approval trail
-- the approver can delete is not a trail (0119/0121/0123/0126's rule).
REVOKE ALL ON refund_approvals FROM kv_relay;
REVOKE DELETE, TRUNCATE ON refund_approvals FROM kv_app, kv_admin;
REVOKE INSERT, UPDATE ON refund_approvals FROM kv_admin;
GRANT SELECT, INSERT, UPDATE ON refund_approvals TO kv_app;
GRANT SELECT ON refund_approvals TO kv_readonly;

-- RLS: this carries tenant_id, so 0014's idempotent sweep picks it up. Stated because a reader checking grants and
-- not policies would think one tenant could read another's refund approvals.
ALTER TABLE refund_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_reads_own_refund_approvals ON refund_approvals;
CREATE POLICY tenant_reads_own_refund_approvals ON refund_approvals
  FOR ALL
  USING (tenant_id = current_tenant_id());

COMMENT ON TABLE refund_approvals IS
  'Maker-checker for tenant refunds — dispute and return alike (0139, PC-56 TENANT-3b). W140/W141/W142 all promise "maker-checker ≥ Rs 10,000"; no refund path had one. propose (dispute.resolve) → approve/reject (order.refund, a DIFFERENT person) → apply, which is the refund itself. The threshold in force is pinned per row so a later change cannot rewrite what a signature meant.';

-- ---------------------------------------------------------------------------
-- 139.4  `order.refund` — THE PERMISSION TWO SCREENS NAME AND NO FILE SEEDS
-- ---------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('order.refund', 'Execute a refund — the money leg of a dispute or return', 'M06')
ON CONFLICT (code) DO NOTHING;

-- WHO HOLDS IT, AND WHY `support_agent` DOES NOT. Seed 0004 grants `dispute.resolve` to both tenant_admin and
-- support_agent — correct: a support agent should be able to work a dispute to a decision. Moving money is a
-- different act, and the whole point of splitting the two keys is that the person who decides the outcome is not
-- automatically the person who releases the cash. A tenant that wants a senior agent to hold it grants it through
-- `staff_permission_overrides` (0003), deliberately, per person.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'tenant_admin' AND p.code = 'order.refund'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 139.5  THE THRESHOLD AS DATA (LAW 6)
-- ---------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES
  ('disputes.refund_checker_threshold_minor', 'int', 'tenant', 'money_path', '1000000'::jsonb,
   'At or above this refund amount (minor units — 1000000 = Rs 10,000) a refund needs a SECOND person: proposed by the resolver, approved by a different holder of order.refund. W140/W141/W142 all print "maker-checker >= Rs 10,000". Zero means every refund needs a checker; a very large value means none do, which is a decision a tenant admin is allowed to make and is recorded when they make it.',
   'This decides when a refund needs two people. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 139.6  WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
-- ---------------------------------------------------------------------------
-- IT DOES NOT ADD `disputes.frozen_amount_minor` — see DEFECT 2. The frozen figure is read from the payment and the
-- settlement line, or it is said to be unknown. A stored copy would be believed and would drift from the ledger.
--
-- IT DOES NOT ADD A `dispute_evidence` TABLE. W141's "Evidence — both sides, side by side" is already
-- `dispute_messages` (author + body, append-only since 0005) plus media through the existing attachment path; the
-- side-by-side layout is a READ over that thread grouped by party, which TENANT-3b builds. Inventing a second
-- evidence store would split one dispute's record across two tables and neither would be complete.
--
-- IT DOES NOT MAKE `returns.refund_amount_minor` NOT NULL. Backfilling it from the order total would assert that
-- every historical return was a full refund — a money claim nobody made, on rows nobody can re-examine.
--
-- IT DOES NOT ADD AN SLA-BREACH COLUMN for W140's "9h left". `sla_due_at` and `seller_respond_by` are written at
-- raise time already; the clock is arithmetic against now(), and a stored "breached" boolean would be a second
-- truth needing a job to keep it honest — the ADMIN-10 shape this programme has refused four times.
-- ============================================================================
