-- ============================================================================
-- MIGRATION 0087 — RIDER PAYOUT TERMS (what a delivery partner actually earns, PC-55 A7)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC54_BACKLOG.md W54-14 ruling — "statements are RESOLVED-BY-EXISTING (payouts GET list is
-- already self-scoped); operator-set TERMS need a table → gated `rider-payout-terms`."
-- PC55_COMPLETION_PROMPTS.md wave A7 is the build order.
--
-- WHY TERMS ARE VERSIONED, NOT EDITED (the fairness decision, recorded so nobody "simplifies" it later):
-- a rider's earnings for work ALREADY DONE must never change because an operator edited a number afterwards.
-- So terms are an EFFECTIVE-DATED SERIES: a change inserts a NEW row with a later effective_from, and a
-- statement prices every delivery with the terms that were in force ON ITS OWN DELIVERY DATE. Nothing is
-- updated in place, so a rider's past pay is arithmetically immune to a later policy change.
--
-- SCOPE: per tenant, optionally narrowed to ONE rider (rider_user_id NOT NULL ⇒ a personal deal that overrides
-- the tenant default for that person only). Both forms coexist; the resolver prefers the most specific,
-- most recent row that is effective on the delivery's date.
--
-- MONEY: per_drop_minor is bigint MINOR UNITS; pct_of_charge_bps is BASIS POINTS of the customer's own
-- delivery charge (10000 bps = 100%). Both may be set — the rider earns the SUM (a base per drop plus a share).
-- At least one must be non-zero, else the row would promise nothing.
--
-- LAW (stated here because it is the whole point of the honesty note this replaces): this table and the
-- statement built on it are LEDGERED ARITHMETIC ONLY. No payout is executed from here. Real disbursement rides
-- payout_batches/payouts (0006) once RazorpayX keys land, and the statement says so out loud.
--
-- RLS: tenant-scoped via the idempotent 0066 pass.
-- ============================================================================

CREATE TABLE rider_payout_terms (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  rider_user_id     uuid REFERENCES users(id),          -- NULL = the tenant-wide default for every rider
  terms_name        varchar(150) NOT NULL,
  per_drop_minor    bigint NOT NULL DEFAULT 0 CHECK (per_drop_minor >= 0),
  pct_of_charge_bps integer NOT NULL DEFAULT 0 CHECK (pct_of_charge_bps BETWEEN 0 AND 10000),
  -- Optional extras that real delivery agreements carry; zero means "not part of this deal".
  cod_handling_minor bigint NOT NULL DEFAULT 0 CHECK (cod_handling_minor >= 0),  -- per COD drop handled
  failed_attempt_minor bigint NOT NULL DEFAULT 0 CHECK (failed_attempt_minor >= 0), -- a genuine attempt is still work
  currency_code     char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  effective_from    date NOT NULL,
  notes             text,
  created_by        uuid REFERENCES users(id),
  CONSTRAINT ck_rider_terms_nonzero CHECK (per_drop_minor > 0 OR pct_of_charge_bps > 0 OR cod_handling_minor > 0 OR failed_attempt_minor > 0)
);
CALL add_std_columns('rider_payout_terms');

-- One terms row per (tenant, rider-or-default) per effective date — a second edit on the same day REPLACES
-- intent rather than creating an ambiguous tie. (Two rows with the same date would make pricing undecidable.)
CREATE UNIQUE INDEX uq_rider_terms_default_day ON rider_payout_terms (tenant_id, effective_from)
  WHERE rider_user_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_rider_terms_rider_day ON rider_payout_terms (tenant_id, rider_user_id, effective_from)
  WHERE rider_user_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_rider_terms_lookup ON rider_payout_terms (tenant_id, rider_user_id, effective_from DESC);

-- RLS — idempotent tenant-isolation pass (0066 pattern, verbatim).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON rider_payout_terms TO kv_app;
