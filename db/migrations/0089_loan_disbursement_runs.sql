-- ============================================================================
-- MIGRATION 0089 — LOAN DISBURSEMENT RUNS (approved credit becomes queued money, PC-55 A9)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC54_BACKLOG.md W54-8 — "Disbursement BATCHES: no table (payout rails candidate) → gated
-- `loan-disbursement-batches`." PC55_COMPLETION_PROMPTS.md wave A9 is the build order.
--
-- FOUND WHILE BUILDING: 0006's payouts.purpose_id comment lists 'loan_disbursal' as an intended payout purpose,
-- but only 'settlement' and 'wage' were ever SEEDED into the payout_purpose vocabulary (0005). Since
-- payouts.purpose_id is a NOT NULL FK into lookup_values, a disbursement payout could not physically be written
-- until that row exists. It is seeded at the bottom of this file — the same gap A8 hit for dividends.
--
-- THE ANTI-PREDATORY RULE THIS TABLE MUST NOT BREAK (PRD §59.4): approving a loan opens a COOLING-OFF WINDOW
-- (loan_applications.cooling_off_until) during which the borrower may still walk away. Disbursing inside that
-- window would defeat the protection — money in the account is not a decision a farmer can take back. So the
-- run REFUSES any application whose cooling_off_until has not passed, and reports it as
-- 'skipped_cooling_off' with the timestamp, so a lender sees exactly when it becomes eligible rather than
-- wondering why it was left out. Rule Zero: the expensive-but-honest path.
--
-- ONE RUN PER APPLICATION (the double-disbursal guard, in the DB): a UNIQUE index on application_id across
-- non-cancelled runs. A farmer must never receive the same sanctioned loan twice because a button was tapped
-- twice or two officers acted at once. Per-payout idempotency also rides payouts.idempotency_key (UNIQUE, 0006).
--
-- NOTHING EXECUTES HERE: rows land in payout_batches/payouts as 'queued'. The execute step (which flips
-- applications → disbursed and creates the `loans` servicing mirror) is a SEPARATE, key-gated action —
-- modules/fintech/jobs/loan-disbursement-execute.handler.ts holds it, refusing to run without live payout
-- credentials rather than pretending money moved.
--
-- RLS: tenant-scoped via the idempotent 0066 pass.
-- ============================================================================

CREATE TABLE loan_disbursement_runs (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  batch_id          uuid REFERENCES payout_batches(id),
  total_minor       bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  loan_count        integer NOT NULL DEFAULT 0 CHECK (loan_count >= 0),
  skipped_count     integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  skipped_detail    jsonb NOT NULL DEFAULT '[]',   -- [{applicationId, reason, coolingOffUntil?}] — never silent
  currency_code     char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  status            varchar(12) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','executing','completed','cancelled')),
  prepared_by       uuid REFERENCES users(id),     -- MAKER
  confirmed_by      uuid REFERENCES users(id),     -- CHECKER (must differ from prepared_by)
  confirmed_at      timestamptz,
  executed_at       timestamptz,
  cancel_reason     text,
  idempotency_key   varchar(120),
  version           integer NOT NULL DEFAULT 0
);
CALL add_std_columns('loan_disbursement_runs');
CREATE UNIQUE INDEX uq_loan_disb_runs_idem ON loan_disbursement_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_loan_disb_runs_tenant ON loan_disbursement_runs (tenant_id, status, created_at DESC);

-- The per-application line: what each borrower is queued to receive under this run.
CREATE TABLE loan_disbursement_run_items (
  run_id          uuid NOT NULL REFERENCES loan_disbursement_runs(id) ON DELETE CASCADE,
  application_id  uuid NOT NULL REFERENCES loan_applications(id),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  borrower_user_id uuid NOT NULL REFERENCES users(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  payout_id       uuid REFERENCES payouts(id),
  loan_id         uuid,                            -- set on execute, when the servicing mirror row is created
  PRIMARY KEY (run_id, application_id)
);
-- ONE live disbursal per application, ever — the double-disbursal guard.
CREATE UNIQUE INDEX uq_loan_disb_item_once ON loan_disbursement_run_items (application_id);
CREATE INDEX idx_loan_disb_items_tenant ON loan_disbursement_run_items (tenant_id);

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

GRANT SELECT, INSERT, UPDATE ON loan_disbursement_runs TO kv_app;
GRANT SELECT, INSERT, UPDATE ON loan_disbursement_run_items TO kv_app;


-- The parent vocabulary this insert needs (`lookup_types` / `languages` / `integration_providers`) is
-- guaranteed by **0056a_reference_data_the_chain_depends_on.sql**, which exists because
-- `db/prod/apply.sh` runs migrate BEFORE seed and this statement's parent rows live in `db/seeds/core/`.
-- Read 0056a's header for the full finding: the chain halted at 0057 and migrations 0057-0149 had never
-- applied to any database. Not repeated per file, deliberately — one authority, one explanation.

-- The payout_purpose row a disbursement payout REQUIRES (see the note in this file's header).
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order) VALUES
 ('payout_purpose', NULL, 'loan_disbursal', 'Loan disbursal', '{}', 22)
ON CONFLICT DO NOTHING;
