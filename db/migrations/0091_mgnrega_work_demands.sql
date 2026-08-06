-- ============================================================================
-- MIGRATION 0091 — MGNREGA WORK DEMANDS (the statutory 15-day clock, PC-55 B2)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- FILED SHAPE (cite): canon W347-gov-work-demand.html ("Record a demand"), CANON_VS_CODE_LEDGER.md GW-5 rows,
-- which stood at MISSING-BACKEND ("MGNREGA module absent"). PC-54 W54-3 built the job-card slice and explicitly
-- left "work-demand/muster/wage sync gated"; PC-55 A4 then built works + musters + the 100-day ledger and again
-- left DEMAND out (0084's header: "work-demand/muster/wage-sync stay gated").
--
-- WHY THIS IS IN A CONSOLE WAVE (a deliberate scope call, recorded here so it is not mistaken for drift). B2's
-- order is "build the gov GW-5 console including work-demand recording". A demand is not a UI nicety: under
-- MGNREGA §3 and Schedule II, a registered household that DEMANDS work is entitled to employment within FIFTEEN
-- DAYS, and if the state fails to provide it an UNEMPLOYMENT ALLOWANCE becomes payable. A console form that
-- recorded a demand nowhere — or worse, drew a form and dropped it — would silently destroy the only evidence a
-- labourer has that their clock ever started. There is no honest cheap path, so this wave takes the expensive one
-- and builds the register properly (Rule Zero).
--
-- WHAT THIS TABLE IS AND IS NOT. It is the PLATFORM'S RECORD that a demand was made, by whom, on what date, for
-- how many days, and what happened next. It is NOT the state's register: the authoritative demand register and the
-- allowance payment both live in the state MGNREGA system (the same relationship 0084 established for the 100-day
-- ledger, where `authoritative: 'state_ledger'` is returned on every read). Consequently:
--   • the allowance is NEVER stored as a fact here. Whether an allowance is DUE is DERIVED at read time from
--     demanded_on + status + today (domain/mgnrega.rules.ts), and the surfaces say who actually pays it. A row
--     claiming "allowance paid" that this platform did not pay would be a lie a labourer could not disprove.
--   • no status here means "the state agreed". Allotment is recorded when an officer allots a real work
--     (allotted_work_id → mgnrega_works), so the record points at the work, not at a promise.
--
-- ONE DESK ENTRY PER CARD PER DAY (the data-error guard, in the DB): UNIQUE (tenant_id, job_card_id, demanded_on).
-- A household may lawfully demand work again later — that is a new date and a new row — but the same demand
-- recorded twice at the same desk on the same day is a double count that would distort both the queue and the
-- state's obligation. Deliberately NOT "one open demand per card": that would refuse a legitimate second demand.
--
-- RLS: tenant-scoped via the idempotent 0066 pass. Money: none stored (wages/allowances are bank- and state-side).
-- ============================================================================

CREATE TABLE mgnrega_work_demands (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  job_card_id       uuid NOT NULL REFERENCES mgnrega_job_cards(id),
  region_id         uuid REFERENCES admin_regions(id),          -- the gram panchayat/block the demand was filed in
  demanded_on       date NOT NULL,                              -- the date the CLOCK starts (never the entry date)
  days_requested    smallint NOT NULL CHECK (days_requested BETWEEN 1 AND 100),
  applicants        smallint NOT NULL DEFAULT 1 CHECK (applicants BETWEEN 1 AND 20), -- adults of the household demanding
  status            varchar(12) NOT NULL DEFAULT 'demanded'
                    CHECK (status IN ('demanded', 'allotted', 'withdrawn', 'closed')),
  allotted_work_id  uuid REFERENCES mgnrega_works(id),          -- a real work, not a promise
  allotted_on       date,
  closed_reason     text,                                       -- why a demand ended without work (said out loud)
  note              text,
  recorded_by       uuid NOT NULL REFERENCES users(id),          -- the officer at the desk; the trail of the entry
  source            varchar(20) NOT NULL DEFAULT 'operator'
                    CHECK (source IN ('operator', 'self', 'state_sync')),
  CONSTRAINT ck_mgnrega_demand_allotment CHECK (
    (status = 'allotted' AND allotted_work_id IS NOT NULL AND allotted_on IS NOT NULL)
    OR (status <> 'allotted' AND allotted_work_id IS NULL AND allotted_on IS NULL)),
  CONSTRAINT ck_mgnrega_demand_allotment_order CHECK (allotted_on IS NULL OR allotted_on >= demanded_on)
);
CALL add_std_columns('mgnrega_work_demands');

-- The desk double-entry guard (see the header).
CREATE UNIQUE INDEX uq_mgnrega_demand_card_day ON mgnrega_work_demands (tenant_id, job_card_id, demanded_on)
  WHERE deleted_at IS NULL;
-- The queue read the console lives on: oldest unmet demand first, which is also overdue-first by construction.
CREATE INDEX idx_mgnrega_demands_open ON mgnrega_work_demands (tenant_id, demanded_on)
  WHERE status = 'demanded' AND deleted_at IS NULL;
CREATE INDEX idx_mgnrega_demands_card ON mgnrega_work_demands (job_card_id, demanded_on DESC);
CREATE INDEX idx_mgnrega_demands_region ON mgnrega_work_demands (tenant_id, region_id, status);

-- ---------- RLS (idempotent sweep, identical to the 0066/0089 pass)
DO $$
DECLARE r RECORD;
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

GRANT SELECT, INSERT, UPDATE ON mgnrega_work_demands TO kv_app;
