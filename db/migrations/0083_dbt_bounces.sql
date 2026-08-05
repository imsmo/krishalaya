-- ============================================================================
-- MIGRATION 0083 — DBT BOUNCE LEDGER (benefit credit returned by the bank, PC-55 A3)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): Development_Program/PC54_BACKLOG.md W54-10 — "BOUNCE tracking needs a status column on
-- dbt_transfers → gated `dbt-bounce-ledger`." PC55_COMPLETION_PROMPTS.md wave A3 is the build order, and it
-- explicitly asked me to CHOOSE between columns-on-parent vs a side table "per 0011 partitioning reality and
-- record why". The choice and its reasons are recorded here, in the file, permanently:
--
-- DECISION: **SIDE TABLE** (`dbt_bounces`), NOT status columns on dbt_transfers. Four reasons:
--   1. TRUTH IS APPEND-ONLY. 0011 calls dbt_transfers "benefit credits observed/confirmed (PFMS)" — it is an
--      OBSERVATION log. A bounce is a SECOND, LATER observation from the same rail ("PFMS reported a credit on
--      the 3rd; the bank returned it on the 7th"). Mutating the original row would erase the fact that the
--      credit was ever reported — exactly the history a farmer disputing a scheme payment needs.
--   2. A BOUNCE HAS ITS OWN FACTS (reason code, bounced_on, bank narration, the re-credit that resolved it) and
--      can recur (credit → bounce → re-credit → bounce). Columns on the parent can hold only the last one.
--   3. PARTITIONED PARENT. dbt_transfers is PARTITION BY RANGE (created_at) with PK (id, created_at); UPDATEs
--      against old partitions are exactly the hot-table churn 0011's partitioning exists to avoid. Inserts into
--      a small side table are cheap and never touch history.
--   4. RE-CREDIT STAYS A NEW TRANSFER ROW (the existing per-application POST), so the money story remains
--      "observations in order" end to end — no in-place rewriting of a payment record, ever (Law 2/11).
--
-- FK: (transfer_id, transfer_created_at) → dbt_transfers(id, created_at) — the real composite PK. Postgres
-- supports foreign keys referencing partitioned tables (v12+; the repo runs 16), so integrity is the DB's job.
--
-- RLS: tenant-scoped via the idempotent 0066 pass (tenant_id present, nullable to mirror the parent's own
-- nullable tenant_id for platform-level gov rows).
-- ============================================================================

CREATE TABLE dbt_bounces (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid REFERENCES tenants(id),          -- nullable, mirroring dbt_transfers.tenant_id (0011)
  transfer_id           uuid NOT NULL,
  transfer_created_at   timestamptz NOT NULL,
  application_id        uuid,                                  -- denormalised for the bounce-desk read (no partition scan)
  scheme_id             uuid NOT NULL,
  user_id               uuid NOT NULL,
  amount_minor          bigint NOT NULL CHECK (amount_minor > 0),   -- the returned amount (Law 2 minor units)
  -- WHY it came back. Taxonomy from the real NPCI/PFMS return-reason families the canon screens show.
  reason_code           varchar(28) NOT NULL
                        CHECK (reason_code IN ('account_closed','account_frozen','invalid_account','name_mismatch',
                                               'ifsc_invalid','aadhaar_not_seeded','npci_mandate_absent',
                                               'bank_rejected','beneficiary_deceased','other')),
  reason_note           text,                                  -- the bank's narration verbatim (never invented)
  bounced_on            date NOT NULL,
  bank_ref              varchar(120),                          -- return UTR / PFMS failure ref
  -- HOW it was closed out. A bounce is open until a re-credit (a NEW dbt_transfer row) or a written closure.
  resolution            varchar(16) NOT NULL DEFAULT 'open'
                        CHECK (resolution IN ('open','recredited','abandoned')),
  resolved_at           timestamptz,
  resolved_by           uuid REFERENCES users(id),
  recredit_transfer_id  uuid,                                  -- the replacement observation, when it lands
  resolution_note       text,
  recorded_by           uuid REFERENCES users(id),
  idempotency_key       varchar(120),
  version               integer NOT NULL DEFAULT 0,
  CONSTRAINT fk_dbt_bounces_transfer FOREIGN KEY (transfer_id, transfer_created_at)
    REFERENCES dbt_transfers (id, created_at)
);
CALL add_std_columns('dbt_bounces');

-- One OPEN bounce per transfer (a credit can't be returned twice while the first return is unresolved).
CREATE UNIQUE INDEX uq_dbt_bounces_open_per_transfer ON dbt_bounces (transfer_id) WHERE resolution = 'open';
CREATE UNIQUE INDEX uq_dbt_bounces_idem ON dbt_bounces (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_dbt_bounces_desk ON dbt_bounces (resolution, bounced_on DESC);
CREATE INDEX idx_dbt_bounces_scheme ON dbt_bounces (scheme_id, resolution);
CREATE INDEX idx_dbt_bounces_application ON dbt_bounces (application_id);

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

GRANT SELECT, INSERT, UPDATE ON dbt_bounces TO kv_app;
