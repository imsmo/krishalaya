-- ============================================================================
-- MIGRATION 0057 — UPI AUTOPAY MANDATE EXECUTIONS (autopay debit collection, P0-4)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- An EXECUTION is one collection against an active mandate: the PSP pulls up to the mandate's per-debit cap
-- from the user's bank and the confirmed amount lands in the user's wallet (a mandate-funded top-up). The actual
-- money move happens ONLY through the wallet-service ledger (Law 2/11) — this table is the audit/idempotency
-- record that links a collection attempt to its ledger txn. It NEVER holds money itself. tenant-scoped + RLS.
-- Execution is gated by the `autopay_execution` feature flag (fail-closed) until a live UPI-AutoPay PSP is wired.
-- ============================================================================

CREATE TABLE upi_mandate_executions (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  mandate_id           uuid NOT NULL REFERENCES upi_mandates(id),
  user_id              uuid NOT NULL REFERENCES users(id),
  amount_minor         bigint NOT NULL CHECK (amount_minor > 0),   -- the requested/collected amount (≤ mandate cap)
  currency_code        char(3) NOT NULL DEFAULT 'INR',
  status               varchar(16) NOT NULL DEFAULT 'pending'      -- pending→collected|failed
                       CHECK (status IN ('pending','collected','failed')),
  provider_payment_ref varchar(120),                               -- tokenised PSP collection id (NULL until collected)
  ledger_txn_id        uuid,                                       -- the wallet-service txn that moved the money
  idempotency_key      varchar(120) NOT NULL,                      -- caller/job key — one collection per key (Law 3)
  failure_reason       text
);
CALL add_std_columns('upi_mandate_executions');
-- Idempotency: one execution row per (tenant, idempotency_key). A replay returns the same row, never double-collects.
CREATE UNIQUE INDEX uq_mandate_exec_idem ON upi_mandate_executions(tenant_id, idempotency_key);
CREATE INDEX idx_mandate_exec_mandate ON upi_mandate_executions(mandate_id, created_at DESC);


-- The parent vocabulary this insert needs (`lookup_types` / `languages` / `integration_providers`) is
-- guaranteed by **0056a_reference_data_the_chain_depends_on.sql**, which exists because
-- `db/prod/apply.sh` runs migrate BEFORE seed and this statement's parent rows live in `db/seeds/core/`.
-- Read 0056a's header for the full finding: the chain halted at 0057 and migrations 0057-0149 had never
-- applied to any database. Not repeated per file, deliberately — one authority, one explanation.

-- ledger_txn_type value for the collection move. Guarded by NOT EXISTS (the UNIQUE index treats NULL tenant_id
-- as distinct, so ON CONFLICT wouldn't dedupe a platform value — this is the safe idempotent form).
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'ledger_txn_type', NULL, 'autopay_collection', 'UPI AutoPay collection (mandate debit → wallet)', '{}', 19
WHERE NOT EXISTS (
  SELECT 1 FROM lookup_values WHERE type_code='ledger_txn_type' AND tenant_id IS NULL AND code='autopay_collection'
);

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant table.
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
