-- ============================================================================
-- MIGRATION 0082 — COD REMITTANCE LEDGER (rider cash → bank, PC-55 A2)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): Development_Program/PC54_BACKLOG.md W54-2 — "The full remittance LEDGER (deposit
-- marking, bank-ref recon) needs a migration batch → stays gated as `cod-remittance-ledger`."
-- PC55_COMPLETION_PROMPTS.md wave A2 is the build order.
--
-- WHY A JOIN TABLE, NOT AN ARRAY (the trust decision): a shipment's cash may be remitted EXACTLY ONCE, ever.
-- An array column cannot enforce that; a join table with a UNIQUE(shipment_id) can, and the database is the
-- only trustworthy place for a money-uniqueness rule (Law 2/11 — app code must never be the sole guard).
-- This same UNIQUE is what lets the W54-2 outstanding worksheet subtract remitted rows honestly instead of
-- double-counting a rider's cash forever.
--
-- MONEY: amount_minor is a bigint MINOR-UNIT total, always SERVER-COMPUTED as SUM(shipments.cod_minor) inside
-- one tx with the shipment rows locked. No client ever types this number (a typed cash total is a fraud path).
--
-- STATUS MACHINE (service-enforced; CHECK guards the vocabulary):
--   collected → deposited → reconciled          (cash in hand → banked with a ref → matched by a second human)
--   collected|deposited → cancelled             (mis-keyed batch; frees its shipments to be remitted again)
-- MAKER-CHECKER: reconcile is refused when reconciled_by = deposited_by (a human cannot check their own cash).
--
-- RLS: TENANT-SCOPED (tenant_id NOT NULL on both tables) via the idempotent tenant_isolation pass below —
-- the standard 0066 pattern. Rider confidentiality inside a tenant is an app-layer concern (logistics.manage).
-- ============================================================================

CREATE TABLE cod_remittances (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  rider_user_id   uuid NOT NULL REFERENCES users(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),     -- SERVER-COMPUTED sum; never client-supplied
  shipment_count  integer NOT NULL CHECK (shipment_count > 0),
  currency_code   char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  status          varchar(12) NOT NULL DEFAULT 'collected'
                  CHECK (status IN ('collected','deposited','reconciled','cancelled')),
  -- the banking trail
  deposit_ref     varchar(120),                                  -- bank slip / UTR / cash-office receipt no
  deposit_method  varchar(20) CHECK (deposit_method IN ('bank_branch','cash_office','upi','other') OR deposit_method IS NULL),
  deposited_at    timestamptz,
  deposited_by    uuid REFERENCES users(id),                     -- the operator who took/banked the cash (MAKER)
  -- the second pair of eyes
  reconciled_at   timestamptz,
  reconciled_by   uuid REFERENCES users(id),                     -- must differ from deposited_by (CHECKER)
  recon_note      text,
  cancelled_at    timestamptz,
  cancel_reason   text,
  idempotency_key varchar(120),
  version         integer NOT NULL DEFAULT 0
);
CALL add_std_columns('cod_remittances');
CREATE INDEX idx_cod_remittances_rider ON cod_remittances (tenant_id, rider_user_id, status);
CREATE INDEX idx_cod_remittances_open ON cod_remittances (tenant_id, status, created_at DESC);
CREATE UNIQUE INDEX uq_cod_remittances_idem ON cod_remittances (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- The once-only guard. A shipment's COD belongs to at most ONE live remittance; cancelling a batch releases
-- its rows (the service DELETEs the links on cancel) so a mis-keyed batch is fixable without orphaning cash.
CREATE TABLE cod_remittance_shipments (
  remittance_id uuid NOT NULL REFERENCES cod_remittances(id) ON DELETE CASCADE,
  shipment_id   uuid NOT NULL REFERENCES shipments(id),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  cod_minor     bigint NOT NULL CHECK (cod_minor > 0),           -- snapshot of the shipment's COD at remit time
  PRIMARY KEY (remittance_id, shipment_id)
);
CREATE UNIQUE INDEX uq_cod_remittance_shipment_once ON cod_remittance_shipments (shipment_id);
CREATE INDEX idx_cod_remittance_shipments_tenant ON cod_remittance_shipments (tenant_id);

-- RLS — re-run the idempotent tenant-isolation pass for the new tenant tables (0066 pattern, verbatim).
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

-- GRANTS — kv_app runs the operator endpoints (create/deposit/reconcile/read) under logistics.manage.
GRANT SELECT, INSERT, UPDATE ON cod_remittances TO kv_app;
GRANT SELECT, INSERT, DELETE ON cod_remittance_shipments TO kv_app;
