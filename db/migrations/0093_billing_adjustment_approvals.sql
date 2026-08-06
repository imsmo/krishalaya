-- ============================================================================
-- MIGRATION 0093 — MAKER-CHECKER ON BILLING ADJUSTMENTS (closes PC-56 ADMIN-1-Q5)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- THE HOLE THIS FILLS. `billing_adjustments` (0035) records a manual money move — a goodwill credit or a clawback
-- debit, up to ₹10,00,000 a time — and until now ONE operator could apply one alone: the endpoint validated, called
-- the wallet-service, and the money was gone. Every other consequential money path on this platform is maker-checker
-- (co-op payouts, loan restructures, COD reconciliation, KCC write-offs), and the canon screen W014 shows this one as
-- maker-checker too. The control was missing in the schema, so no amount of UI could have supplied it.
--
-- DESIGN, AND WHY
--   • THE REQUEST AND THE MONEY ARE NOW SEPARATE FACTS. A row starts `awaiting_approval` with NO `wallet_txn_id`:
--     nothing has moved. Only `apply` (by a DIFFERENT operator) calls the wallet-service and stamps the txn id.
--     `wallet_txn_id` therefore stops being NOT NULL — the old constraint encoded the very assumption we are
--     removing, that a recorded adjustment is an executed one.
--   • MAKER ≠ CHECKER IS A DATABASE FACT, NOT A UI COURTESY. `ck_billing_adj_maker_ne_checker` refuses a row whose
--     approver is its requester. A guard that lives only in the service can be bypassed by the next caller written
--     against this table; a CHECK cannot.
--   • RETURNED, NOT JUST REJECTED. `returned` sends a request back for correction (it can be re-submitted);
--     `rejected` is terminal. Collapsing them would force a checker to reject work that only needed a better
--     reason, and people route around controls that make them look wrong.
--   • THE IDEMPOTENCY KEY MOVES WITH THE MONEY, NOT THE REQUEST. It stays UNIQUE (it is the wallet's replay guard)
--     but is now nullable and stamped at APPLY time, because that is when a wallet post can be retried. A key
--     minted at request time would be reused across an approve-reject-resubmit cycle and make the second, corrected
--     adjustment a silent no-op at the wallet — the worst possible failure: the paperwork says paid, the money never
--     moved.
--   • EXISTING ROWS ARE `applied`. They were applied — that is what the old table meant. Backfilling them to
--     `awaiting_approval` would put historical, already-moved money into an approval queue.
-- ============================================================================

-- ---------- the workflow state ------------------------------------------------------------------
CREATE TYPE billing_adjustment_status AS ENUM ('awaiting_approval','approved','applied','returned','rejected');

ALTER TABLE billing_adjustments
  ADD COLUMN status billing_adjustment_status NOT NULL DEFAULT 'awaiting_approval',
  ADD COLUMN requested_by  uuid REFERENCES users(id),
  ADD COLUMN decided_by    uuid REFERENCES users(id),
  ADD COLUMN decided_at    timestamptz,
  ADD COLUMN decision_note text,
  ADD COLUMN applied_at    timestamptz;

-- Existing rows are history: they were applied by whoever created them, and the money has moved.
UPDATE billing_adjustments
   SET status = 'applied',
       requested_by = created_by,
       applied_at = COALESCE(created_at, now())
 WHERE status = 'awaiting_approval';

-- ---------- the money is no longer implied by the row's existence -------------------------------
-- Before: wallet_txn_id NOT NULL — i.e. "a row means money moved". That is exactly the conflation this migration
-- removes, so the column becomes nullable and is instead REQUIRED BY STATUS (below).
ALTER TABLE billing_adjustments ALTER COLUMN wallet_txn_id DROP NOT NULL;
-- Same for the idempotency key: minted when the wallet is actually called (see header).
ALTER TABLE billing_adjustments ALTER COLUMN idempotency_key DROP NOT NULL;

-- Applied ⇔ money moved. Not applied ⇒ no txn id and no applied_at, so a half-written row cannot read as executed.
ALTER TABLE billing_adjustments ADD CONSTRAINT ck_billing_adj_applied_has_txn CHECK (
  (status = 'applied' AND wallet_txn_id IS NOT NULL AND idempotency_key IS NOT NULL AND applied_at IS NOT NULL)
  OR (status <> 'applied' AND wallet_txn_id IS NULL AND applied_at IS NULL)
);
-- A decision has a decider and a time; an undecided request has neither.
ALTER TABLE billing_adjustments ADD CONSTRAINT ck_billing_adj_decision CHECK (
  (status IN ('awaiting_approval') AND decided_by IS NULL AND decided_at IS NULL)
  OR (status IN ('approved','applied','returned','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
);
-- THE CONTROL ITSELF: the person who asked cannot be the person who agreed.
ALTER TABLE billing_adjustments ADD CONSTRAINT ck_billing_adj_maker_ne_checker CHECK (
  decided_by IS NULL OR requested_by IS NULL OR decided_by <> requested_by
);
-- A returned or rejected request must say why — "no" without a reason is not a review.
ALTER TABLE billing_adjustments ADD CONSTRAINT ck_billing_adj_refusal_note CHECK (
  status NOT IN ('returned','rejected') OR length(btrim(COALESCE(decision_note, ''))) >= 3
);

-- the approval queue read: oldest request first, so nothing waits behind newer work
CREATE INDEX idx_billing_adj_pending ON billing_adjustments (created_at, id)
  WHERE status = 'awaiting_approval' AND deleted_at IS NULL;
CREATE INDEX idx_billing_adj_status ON billing_adjustments (status, created_at DESC);

-- ---------- grants ------------------------------------------------------------------------------
-- 0035 created this table under the 0014/0018 default privileges; the new workflow columns do not change who may
-- write it, but the REVOKE is asserted here because a tenant-facing role must never be able to approve platform
-- money. Idempotent: revoking a privilege that was never granted is a no-op.
REVOKE ALL ON billing_adjustments FROM kv_app, kv_relay;
GRANT SELECT ON billing_adjustments TO kv_app;          -- a tenant may see adjustments made to its own account (RLS)
GRANT SELECT, INSERT, UPDATE ON billing_adjustments TO kv_admin;
GRANT SELECT ON billing_adjustments TO kv_readonly;
