-- ==================================================================================================================
-- MIGRATION 0250 — PC-56 TEST-1 · A BILLING ADJUSTMENT CAN BE APPROVED (0093's maker-checker could never decide anything).
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. MONEY-ADJACENT (a money table's guard): CODEOWNERS review.
-- ==================================================================================================================
--
-- WHAT WAS TRUE: 0078 made `billing_adjustments` strictly append-only (`billing_adjustments_append_only`, BEFORE UPDATE OR DELETE →
-- reject_ledger_entries_mutation(): every UPDATE refused). 0093, fifteen migrations LATER, turned the same table into a maker-checker
-- workflow whose whole design is two UPDATEs on the row: a second operator DECIDES (awaiting_approval → approved | returned |
-- rejected, stamping decided_by / decided_at / decision_note — BillingRepository.decideAdjustment) and APPLY stamps the money leg
-- (approved → applied with wallet_txn_id / idempotency_key / applied_at — BillingRepository.markAdjustmentApplied). 0093 never
-- touched 0078's trigger. So on a real database every decision failed:
--     error: ledger_entries is append-only (Golden Law 2): UPDATE is not permitted on billing_adjustments (id=…)
-- — a goodwill credit or clawback could be REQUESTED but never approved, returned, rejected or applied. Found by the admin-api
-- billing-ops integration spec (the 0093 maker-checker case), which had never run in CI.
--
-- WHAT IS TRUE NOW: the row is still immutable in everything that describes the money — tenant, subscription, invoice, direction,
-- amount, currency, reason, requester, creation — and still can never be DELETEd. Exactly the two 0093 transitions are admitted:
--   • awaiting_approval → approved | returned | rejected   (only the decision columns + updated_* change)
--   • approved          → applied                         (only the money-leg stamp + updated_* change; the decision is kept)
-- Anything else — a second decision, un-applying, editing an amount, any DELETE — is refused exactly as before. 0093's own CHECKs
-- (decision has a decider; maker ≠ checker; applied ⇔ txn id; refusal has a note) still bind every admitted UPDATE.
CREATE OR REPLACE FUNCTION kv_billing_adjustment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'billing_adjustments is append-only (Golden Law 2): DELETE is not permitted (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.subscription_id, NEW.invoice_id, NEW.direction, NEW.amount_minor, NEW.currency_code, NEW.reason,
      NEW.created_at, NEW.created_by, NEW.requested_by, NEW.deleted_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.subscription_id, OLD.invoice_id, OLD.direction, OLD.amount_minor, OLD.currency_code, OLD.reason,
      OLD.created_at, OLD.created_by, OLD.requested_by, OLD.deleted_at) THEN
    RAISE EXCEPTION 'billing_adjustments: what the adjustment IS cannot change after it is requested (id=%)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'awaiting_approval' AND NEW.status IN ('approved', 'returned', 'rejected')
     AND (NEW.wallet_txn_id, NEW.idempotency_key, NEW.applied_at) IS NOT DISTINCT FROM (OLD.wallet_txn_id, OLD.idempotency_key, OLD.applied_at) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'applied'
     AND (NEW.decided_by, NEW.decided_at, NEW.decision_note) IS NOT DISTINCT FROM (OLD.decided_by, OLD.decided_at, OLD.decision_note) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing_adjustments: % → % is not a transition this table admits (id=%)', OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS billing_adjustments_append_only ON billing_adjustments;
CREATE TRIGGER billing_adjustments_append_only
  BEFORE UPDATE OR DELETE ON billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION kv_billing_adjustment_guard();
