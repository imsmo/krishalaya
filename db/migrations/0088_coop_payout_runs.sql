-- ============================================================================
-- MIGRATION 0088 — CO-OP PAYOUT RUNS (an activated dividend becomes real money owed, PC-55 A8)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC54_BACKLOG.md W54-7 — "Dividend/bonus EXECUTION (money) stays gated
-- (`coop-payout-runs`)". PC55_COMPLETION_PROMPTS.md wave A8 is the build order.
--
-- WHAT THIS ADDS (and what it deliberately does NOT):
--   • `coop_payout_runs` — the RUN HEADER that ties ONE activated resolution (0009 coop_resolutions) to ONE
--     payout_batches row (0006), so a co-op can always answer "which vote paid this money?".
--   • Two seeded `payout_purpose` lookup values — 'dividend' and 'patronage_bonus'. payouts.purpose_id is a FK
--     into that vocabulary, so without these rows the run could not be written at all.
--   • It creates NO new money primitive: per-member amounts land in the EXISTING payouts table with
--     status='queued', batch_id set, provider_code='razorpayx'. Execution is the existing payout pipeline's
--     job once RazorpayX keys land — this wave computes and queues, and says so in every response.
--
-- ONE RUN PER RESOLUTION (the double-payment guard, in the DB where it cannot be bypassed): a UNIQUE index on
-- resolution_id for non-cancelled runs. A co-op voting once must never pay twice because a button was tapped
-- twice or two officers acted at the same moment.
--
-- WHY MEMBERS CAN BE SKIPPED, HONESTLY: payouts.bank_account_id is NOT NULL (0006) — money cannot be queued to
-- a member with no penny-verified bank account. The run therefore records `skipped_no_bank_account` and the
-- names are readable in the run detail, so the co-op chases those members instead of silently short-paying
-- them. A skipped member is NOT paid and NOT forgotten.
--
-- RLS: tenant-scoped via the idempotent 0066 pass.
-- ============================================================================

CREATE TABLE coop_payout_runs (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  resolution_id     uuid NOT NULL REFERENCES coop_resolutions(id),
  batch_id          uuid REFERENCES payout_batches(id),
  purpose_code      varchar(24) NOT NULL CHECK (purpose_code IN ('dividend','patronage_bonus')),
  -- The formula ACTUALLY USED, snapshotted from the resolution payload at run time. The resolution can never be
  -- edited after activation, but snapshotting means the run explains itself without re-reading anything.
  formula_snapshot  jsonb NOT NULL DEFAULT '{}',
  total_minor       bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  member_count      integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  skipped_count     integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  skipped_detail    jsonb NOT NULL DEFAULT '[]',   -- [{userId, reason}] — who could not be queued, and why
  currency_code     char(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  status            varchar(12) NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','executing','completed','cancelled')),
  prepared_by       uuid REFERENCES users(id),     -- MAKER  (proposed/prepared the run)
  confirmed_by      uuid REFERENCES users(id),     -- CHECKER (must differ from prepared_by)
  confirmed_at      timestamptz,
  cancel_reason     text,
  idempotency_key   varchar(120),
  version           integer NOT NULL DEFAULT 0
);
CALL add_std_columns('coop_payout_runs');

-- ONE live run per resolution — the double-payment guard.
CREATE UNIQUE INDEX uq_coop_payout_runs_resolution ON coop_payout_runs (resolution_id) WHERE status <> 'cancelled';
CREATE UNIQUE INDEX uq_coop_payout_runs_idem ON coop_payout_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_coop_payout_runs_tenant ON coop_payout_runs (tenant_id, status, created_at DESC);

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

GRANT SELECT, INSERT, UPDATE ON coop_payout_runs TO kv_app;


-- The parent vocabulary this insert needs (`lookup_types` / `languages` / `integration_providers`) is
-- guaranteed by **0056a_reference_data_the_chain_depends_on.sql**, which exists because
-- `db/prod/apply.sh` runs migrate BEFORE seed and this statement's parent rows live in `db/seeds/core/`.
-- Read 0056a's header for the full finding: the chain halted at 0057 and migrations 0057-0149 had never
-- applied to any database. Not repeated per file, deliberately — one authority, one explanation.

-- The payout_purpose vocabulary rows this run needs (payouts.purpose_id is a FK into lookup_values).
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order) VALUES
 ('payout_purpose', NULL, 'dividend',        'Co-op dividend',        '{}', 20),
 ('payout_purpose', NULL, 'patronage_bonus', 'Patronage bonus',       '{}', 21)
ON CONFLICT DO NOTHING;
