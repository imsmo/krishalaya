-- ============================================================================
-- MIGRATION 0084 — MGNREGA WORKS & MUSTERS (PRD §31.10 convergence, PC-55 A4)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): PC54_BACKLOG.md W54-3 — "work-demand/muster/wage-sync stay gated (`mgnrega-works`,
-- needs state-ledger integration)". PC55_COMPLETION_PROMPTS.md wave A4 is the build order.
--
-- SCOPING DECISION (recorded because it is a trust decision, not a preference):
--   • `mgnrega_job_cards` (0008) has NO tenant_id — a job card number is NATIONAL and nationally unique. That
--     stays exactly as it is; this migration does not re-scope it.
--   • `mgnrega_works` and `mgnrega_musters` ARE tenant-scoped (tenant_id NOT NULL). A government work is a
--     government fact, but what this platform stores is a TENANT'S RECORD of its members' participation in that
--     work. Two co-ops may legitimately record the same official work_code — each keeps its own attendance
--     truth, and RLS guarantees neither can read or mutate the other's. A shared, un-scoped works table would
--     let any tenant edit another's records: unacceptable (Rule Zero — breaks trust).
--
-- THE 100-DAY GUARANTEE, HONESTLY (why two numbers exist and neither is faked):
--   The STATE ledger (NREGASoft) is authoritative for days used. 0008 already models that as
--   job_cards.days_used_fy + last_synced_at. This migration adds musters, from which the platform can compute
--   days it OBSERVED. The ledger endpoint returns BOTH — observed-here vs state-mirrored — and says which is
--   authoritative. days_used_fy is only ever RAISED to at least the observed count (never lowered, never
--   invented) and last_synced_at is left untouched, because only a real state sync may claim to have synced.
--
-- WAGES: wage_minor is BANK-SIDE INFORMATIONAL (minor units, Law 2). MGNREGA wages are paid by the state into
-- the worker's account; this platform NEVER moves that money and no ledger entry is written from these rows.
-- ============================================================================

CREATE TABLE mgnrega_works (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  work_code         varchar(60) NOT NULL,                  -- official NREGASoft work code (as printed on the board)
  work_name         varchar(250) NOT NULL,
  work_category     varchar(40),                           -- 'water_conservation','rural_connectivity','plantation',…
  region_id         uuid REFERENCES admin_regions(id),     -- panchayat/block the work belongs to
  site_note         text,                                  -- where exactly (unicode; any script)
  sanctioned_days   integer CHECK (sanctioned_days IS NULL OR sanctioned_days >= 0),  -- person-days sanctioned
  sanctioned_amount_minor bigint CHECK (sanctioned_amount_minor IS NULL OR sanctioned_amount_minor >= 0),
  status            varchar(16) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('planned','active','completed','suspended')),
  starts_on         date,
  ends_on           date,
  version           integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_mgnrega_works_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CALL add_std_columns('mgnrega_works');
-- One record per official work per tenant (a tenant cannot double-register the same government work).
CREATE UNIQUE INDEX uq_mgnrega_works_code ON mgnrega_works (tenant_id, work_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_mgnrega_works_region ON mgnrega_works (tenant_id, region_id, status);

CREATE TABLE mgnrega_musters (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  work_id       uuid NOT NULL REFERENCES mgnrega_works(id),
  job_card_id   uuid NOT NULL REFERENCES mgnrega_job_cards(id),
  muster_no     varchar(60),                               -- official muster roll number when known
  attended_on   date NOT NULL,
  attended      boolean NOT NULL DEFAULT true,             -- present/absent for that day
  day_fraction  numeric(3,2) NOT NULL DEFAULT 1.00
                CHECK (day_fraction > 0 AND day_fraction <= 1),   -- half-days are real on MGNREGA sites
  wage_minor    bigint CHECK (wage_minor IS NULL OR wage_minor >= 0),  -- BANK-SIDE informational only (never our ledger)
  recorded_by   uuid REFERENCES users(id),
  source        varchar(12) NOT NULL DEFAULT 'operator'
                CHECK (source IN ('operator','state_sync')),  -- who asserted this row (never conflated)
  version       integer NOT NULL DEFAULT 0
);
CALL add_std_columns('mgnrega_musters');
-- A person cannot be mustered twice for the same work on the same day (the attendance-fraud guard, in the DB).
CREATE UNIQUE INDEX uq_mgnrega_muster_day ON mgnrega_musters (tenant_id, work_id, job_card_id, attended_on) WHERE deleted_at IS NULL;
CREATE INDEX idx_mgnrega_musters_card ON mgnrega_musters (job_card_id, attended_on DESC);
CREATE INDEX idx_mgnrega_musters_work ON mgnrega_musters (tenant_id, work_id, attended_on DESC);

-- RLS — idempotent tenant-isolation pass (0066 pattern, verbatim). mgnrega_job_cards is untouched (national).
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

GRANT SELECT, INSERT, UPDATE ON mgnrega_works TO kv_app;
GRANT SELECT, INSERT, UPDATE ON mgnrega_musters TO kv_app;
-- days_used_fy mirror maintenance (raise-only, never lowered — see the header note).
GRANT UPDATE (days_used_fy) ON mgnrega_job_cards TO kv_app;
