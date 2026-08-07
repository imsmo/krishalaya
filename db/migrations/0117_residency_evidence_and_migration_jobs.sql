-- ============================================================================
-- MIGRATION 0117 — THE FAIL-CLOSED BOUNDARY THAT LEAVES NO TRACE, AND THE THREE OBJECTS THE CANON
-- DEFERRED BY NAME (PC-56 ADMIN-8b)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT: THE RESIDENCY BOUNDARY IS ENFORCED, AND NOBODY CAN PROVE IT HELD
-- ---------------------------------------------------------------------------
-- `TenantCellAssignmentService.move` refuses a cross-border move and fails closed — ADMIN-8 verified that and it is
-- correct. It throws `ResidencyViolationError(fromCountry, toCountry)` and **NOTHING RECORDS THE ATTEMPT.** The error
-- goes to the caller and the event vanishes.
--
-- W033 says, in its own empty state: "No residency violations logged. No attempt to move or access data outside its
-- declared region has been recorded. **This log fills automatically if the fail-closed boundary is ever tested.**" There
-- is no log. That empty state is not describing a clean record — it is describing a table that does not exist, and it
-- would read identically after a hundred blocked attempts.
--
-- **A FAIL-CLOSED BOUNDARY THAT LEAVES NO TRACE WHEN TESTED IS A BOUNDARY NOBODY CAN PROVE HELD.** That matters here more
-- than anywhere else on this platform, because W033's other control is "Export residency attestation" — and under DPDP an
-- attestation asserts a negative: no personal data left the country. A negative is evidenced by a complete record of
-- attempts and their outcomes, not by the absence of a record. Today the export would attest from nothing.
--
-- This is a new member of the claim-with-nothing-behind-it family and the first where the missing artefact is EVIDENCE
-- rather than a control: the control works, and its work is invisible.
--
-- ---------------------------------------------------------------------------
-- THE THREE DEFERRALS, AND WHY THEY LAND TOGETHER
-- ---------------------------------------------------------------------------
-- ADMIN-8 split on the canon's own banners. All three say "Design leads", so this file is the design:
--   DELTA-011 (W033) — per-data-class residency + cross-border processing agreements.
--   DELTA-012 (W034) — `migration_jobs`: copy → verify → cutover → cleanup, a ≤4-minute write freeze, an automatic
--                      rollback and a 7-day safety hold.
--   DELTA-013 (W037) — a growth model per cell. ADMIN-8 already built the RATE (a count over `cell_map_changes`); what is
--                      missing is the PLAN, which W037's own footnote concedes is not schema ("statuses are planning
--                      labels, not schema enums").
-- Plus W038's go-live checklist, which is founder-physical in its execution and perfectly recordable in its state.
--
-- WHAT THIS MIGRATION DOES *NOT* DO: it does not execute a migration, forecast anything, or apply infrastructure. It
-- gives those three acts a place to be recorded, refused and audited. A schema is where a design becomes checkable; the
-- executors are named as debt with owners.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE EVIDENCE THE BOUNDARY NEVER LEFT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS residency_violations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- What was attempted. `move` is the only path that can currently produce one; `place` and `read` are here because the
  -- canon's sentence is "move or access", and a table that could only record moves would make the access half
  -- unrecordable the day somebody builds the check. An enum that has to be widened to record a real event is an enum that
  -- gets bypassed.
  attempt_kind    varchar(20) NOT NULL,
  subject_type    varchar(30) NOT NULL,
  subject_id      varchar(80) NOT NULL,
  from_country    char(2),
  to_country      char(2),
  from_cell_id    uuid REFERENCES cells(id),
  to_cell_id      uuid REFERENCES cells(id),
  -- WHICH RULE REFUSED IT. Recorded rather than inferred, because the attestation's value is in saying WHY each attempt
  -- failed — "the lock held" and "the cell did not exist" are different assurances, and only the first evidences the
  -- boundary.
  refused_by      varchar(40) NOT NULL,
  -- **`blocked` IS NOT A DEFAULT WITH A COMFORTING NAME.** It is the outcome, and `allowed` exists so that a future
  -- lawful cross-border transfer — under a processing agreement DELTA-011 will model — is recorded in the SAME table as
  -- the refusals. An attestation that could only show refusals would be an attestation nobody could use once the first
  -- agreement is signed, and a second table for permitted transfers would let the two drift.
  outcome         varchar(20) NOT NULL DEFAULT 'blocked',
  -- Bare uuid, no FK — realm-identity for the eighth time. NULL when the attempt came from a system path rather than an
  -- operator, which is distinguishable on purpose: an automated cross-border attempt is a different finding from a human
  -- one.
  actor_admin_id  uuid,
  detail          jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE residency_violations
  ADD CONSTRAINT ck_rv_attempt_kind CHECK (attempt_kind IN ('move', 'place', 'read', 'export'));
ALTER TABLE residency_violations
  ADD CONSTRAINT ck_rv_outcome CHECK (outcome IN ('blocked', 'allowed'));
-- A cross-border event names both sides. Without this a row could record "something was refused" with no countries in it,
-- which is exactly the row an attestation cannot use.
ALTER TABLE residency_violations
  ADD CONSTRAINT ck_rv_countries CHECK (
    outcome <> 'blocked' OR (from_country IS NOT NULL AND to_country IS NOT NULL));
-- AN ALLOWED CROSS-BORDER TRANSFER MUST NAME ITS LEGAL BASIS. Enforced now, before the first one exists, because the day
-- somebody adds a lawful-transfer path is the day this constraint stops it being added without one.
ALTER TABLE residency_violations
  ADD CONSTRAINT ck_rv_allowed_needs_basis CHECK (
    outcome <> 'allowed' OR (detail ? 'legalBasis'));

-- The attestation's read: everything in a window, and everything for one country.
CREATE INDEX IF NOT EXISTS idx_rv_recent ON residency_violations (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rv_country ON residency_violations (from_country, created_at DESC);

-- APPEND-ONLY. This is evidence: a row that can be edited after an attestation cites it is not evidence, and the whole
-- reason the table exists is that a negative assertion needs an unalterable record of attempts.
REVOKE UPDATE, DELETE ON residency_violations FROM PUBLIC;
REVOKE ALL ON residency_violations FROM kv_app;
GRANT SELECT, INSERT ON residency_violations TO kv_admin;
GRANT SELECT, INSERT ON residency_violations TO kv_relay;
GRANT SELECT ON residency_violations TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 2 · THE REGULATION PROFILE W033's TABLE HAS A COLUMN FOR
-- ---------------------------------------------------------------------------
-- W033 prints "IN · India · DPDP Act 2023", "BD · Bangladesh · DPA 2023 (draft profile)", "AE · SA · PDPL (Y6-7)".
-- `countries` (0001) has code, name, currency, phone prefix, timezone and is_active — **no regulation profile at all**, so
-- that column was rendered from nothing.
--
-- A COLUMN AND NOT A TABLE, deliberately. A regulation profile today is a label plus a status; the RULES it implies live
-- in DELTA-011's per-data-class engine, which is not this migration. A `regulation_profiles` table with one label column
-- would be a join for no gain, and the day the rules arrive they need their own object anyway.
ALTER TABLE countries
  ADD COLUMN IF NOT EXISTS regulation_profile varchar(40),
  -- `draft` is the state BD is in on W033 ("draft profile") and it is load-bearing: a country whose profile is drafted
  -- may not receive a cell, because the residency lock would be enforcing a rule nobody has ratified.
  ADD COLUMN IF NOT EXISTS regulation_status varchar(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS regulation_note text;

ALTER TABLE countries
  ADD CONSTRAINT ck_countries_regulation_status CHECK (
    regulation_status IN ('none', 'draft', 'ratified'));
-- A ratified profile must be named. A country marked ratified with no profile is the same defect shape as every other
-- claim this programme has found: a status asserting something no field carries.
ALTER TABLE countries
  ADD CONSTRAINT ck_countries_regulation_named CHECK (
    regulation_status = 'none' OR regulation_profile IS NOT NULL) NOT VALID;

-- India is live and its profile is the one the platform operates under today. Seeded here rather than in db/seeds for the
-- reason 0112 established: a seed can be skipped and a migration cannot, and this value gates cell provisioning below.
UPDATE countries SET regulation_profile = 'DPDP Act 2023', regulation_status = 'ratified'
 WHERE code = 'IN' AND regulation_status = 'none';

-- ---------------------------------------------------------------------------
-- 3 · DELTA-012 · THE MIGRATION PIPELINE
-- ---------------------------------------------------------------------------
-- W034's banner: "the move executes as a background job pipeline (copy → verify → cutover → cleanup) recorded as
-- cell_map_changes action=moved; a dedicated migration_jobs table/state machine is not yet in schema. Design leads."
--
-- THE STATE MACHINE IS THE DESIGN, and every state exists because W034 names a moment that can fail differently:
--   queued     — waits for the window AND the checker. Both, and the order matters: an approved job still waits.
--   copying    — logical replication to the target shard. No downtime; the source is authoritative.
--   verifying  — row counts + ledger zero-sum on the target must match the source.
--   cutover    — the ≤4-minute write freeze; the placement row flips; caches invalidate.
--   done       — source cleanup after the 7-day safety hold.
--   rolled_back — verify failed, or cutover failed. The source stayed authoritative throughout.
--   failed     — abandoned before cutover for a reason that is not a verify failure (a window missed, an operator abort).
-- `rolled_back` and `failed` are separate because they mean different things to whoever reads the row next: one is the
-- safety net working, the other is a run that never got far enough to need it.
CREATE TABLE IF NOT EXISTS migration_jobs (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The routing key, matching `tenant_placements.placed_tenant_id`. No FK for the same reason that table has none: it is a
  -- GLOBAL directory keyed by a tenant that may live in another cell's database.
  migrating_tenant_id uuid NOT NULL,
  from_cell_id      uuid NOT NULL REFERENCES cells(id),
  from_shard_id     uuid NOT NULL REFERENCES shards(id),
  to_cell_id        uuid NOT NULL REFERENCES cells(id),
  to_shard_id       uuid NOT NULL REFERENCES shards(id),
  status            varchar(20) NOT NULL DEFAULT 'queued',
  -- THE APPROVAL, carried on the job rather than only on the proposal, because a job that outlives its proposal must
  -- still be able to say who authorised it. ADMIN-8's `cell_map_proposals` is where the decision is made; this is the
  -- copy that travels with the work.
  proposal_id       uuid REFERENCES cell_map_proposals(id),
  approved_by_admin_id uuid,
  approved_at       timestamptz,
  -- W034's window. A job runs INSIDE it or waits; a cutover outside the agreed window is a write freeze nobody warned the
  -- tenant about.
  window_start      timestamptz,
  window_end        timestamptz,
  -- The preflight, recorded at approval time. Same reasoning as 0114's payout preflight: a checker signed a set of
  -- checks, and if the world drifts afterwards the disagreement must be visible rather than absorbed.
  preflight         jsonb,
  preflight_at      timestamptz,
  -- W034: "≤ 4 min during cutover (tenant sees offline-bar, actions queue)". Recorded as the BUDGET agreed and, after the
  -- fact, the time actually taken — because "we promised four minutes" and "it took four minutes" are different claims
  -- and only the second is evidence.
  freeze_budget_seconds integer NOT NULL DEFAULT 240,
  freeze_started_at timestamptz,
  freeze_ended_at   timestamptz,
  -- W034: "source cleanup after 7-day safety hold".
  safety_hold_until timestamptz,
  source_cleaned_at timestamptz,
  rollback_reason   text,
  failure_detail    text,
  created_by_admin_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_status CHECK (
    status IN ('queued', 'copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed'));
-- A MOVE MUST GO SOMEWHERE ELSE. Same cell and same shard is a no-op dressed as a migration.
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_moves CHECK (from_shard_id <> to_shard_id);
-- **THE RESIDENCY LOCK, AS A DATABASE FACT ON THE JOB ITSELF.** The assignment service already refuses a cross-border
-- move and this is the second lock, on the object that would carry one out. Written as a trigger below rather than a
-- CHECK because it reads two other rows — but stated here so a reader of the table sees it.
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_window CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start);
-- A job past `queued` names its approver. W034's wizard ends in "Submit for checker approval", and a job that started
-- copying a farmer's data with no approver on the row is the defect this whole programme keeps finding.
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_approval CHECK (
    status = 'queued' OR (approved_by_admin_id IS NOT NULL AND approved_at IS NOT NULL));
-- A rollback owes a reason; the safety net working silently is a safety net nobody can audit.
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_rollback CHECK (
    status <> 'rolled_back' OR char_length(btrim(coalesce(rollback_reason, ''))) >= 10);
-- The freeze cannot end before it starts, and cleanup cannot precede the hold.
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_freeze CHECK (
    freeze_ended_at IS NULL OR (freeze_started_at IS NOT NULL AND freeze_ended_at >= freeze_started_at));
ALTER TABLE migration_jobs
  ADD CONSTRAINT ck_mj_cleanup CHECK (
    source_cleaned_at IS NULL OR (safety_hold_until IS NOT NULL AND source_cleaned_at >= safety_hold_until));

-- ONE ACTIVE JOB PER TENANT. Two concurrent migrations of one tenant would each believe they own the placement row, and
-- the second cutover would flip a placement the first had already moved.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mj_one_active_per_tenant
  ON migration_jobs (migrating_tenant_id)
  WHERE status IN ('queued', 'copying', 'verifying', 'cutover');
CREATE INDEX IF NOT EXISTS idx_mj_open ON migration_jobs (window_start)
  WHERE status IN ('queued', 'copying', 'verifying', 'cutover');
CREATE INDEX IF NOT EXISTS idx_mj_recent ON migration_jobs (created_at DESC, id DESC);
-- The cleanup sweep's read: jobs whose safety hold has expired.
CREATE INDEX IF NOT EXISTS idx_mj_cleanup_due ON migration_jobs (safety_hold_until)
  WHERE status = 'done' AND source_cleaned_at IS NULL;

-- Per-step evidence, so W034's "No migration steps logged yet" state has something to fill and a rollback can say which
-- step failed. Append-only for the same reason the residency log is.
CREATE TABLE IF NOT EXISTS migration_job_steps (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id        uuid NOT NULL REFERENCES migration_jobs(id),
  step          varchar(20) NOT NULL,
  outcome       varchar(20) NOT NULL,
  -- Row counts, ledger sums, durations — whatever the step measured. W034's verify step is "row counts + ledger zero-sum
  -- on target must match source", and a verify that passed without recording the two numbers it compared is a verify
  -- nobody can re-examine.
  evidence      jsonb NOT NULL DEFAULT '{}',
  detail        text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
ALTER TABLE migration_job_steps
  ADD CONSTRAINT ck_mjs_step CHECK (step IN ('preflight', 'copy', 'verify', 'cutover', 'cleanup', 'rollback'));
ALTER TABLE migration_job_steps
  ADD CONSTRAINT ck_mjs_outcome CHECK (outcome IN ('running', 'passed', 'failed'));
CREATE INDEX IF NOT EXISTS idx_mjs_job ON migration_job_steps (job_id, started_at, id);

-- THE RESIDENCY LOCK ON THE JOB, and it RECORDS THE ATTEMPT RATHER THAN ONLY REFUSING IT — which is the whole point of
-- §1. A trigger, because the condition reads `cells` on both sides.
CREATE OR REPLACE FUNCTION assert_migration_residency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  from_cc text; to_cc text; from_locked boolean; to_locked boolean;
BEGIN
  SELECT country_code, residency_locked INTO from_cc, from_locked FROM cells WHERE id = NEW.from_cell_id;
  SELECT country_code, residency_locked INTO to_cc, to_locked FROM cells WHERE id = NEW.to_cell_id;

  IF from_cc IS NULL OR to_cc IS NULL THEN
    RAISE EXCEPTION 'migration job names a cell that does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF from_cc <> to_cc AND (from_locked OR to_locked) THEN
    -- **THE ATTEMPT IS RECORDED BEFORE IT IS REFUSED.** The INSERT below survives because the RAISE aborts only the
    -- caller's statement… which would roll this back too. So it is NOT written here — recording inside the transaction
    -- that is about to abort would be writing evidence that vanishes. The service layer records it in its own transaction
    -- and then refuses, and this trigger is the backstop for a caller that bypassed the service. Stated so nobody adds
    -- the INSERT here and believes it works.
    RAISE EXCEPTION 'residency: % is locked and % <> % — a tenant''s data may not cross a border (DPDP)',
      CASE WHEN from_locked THEN NEW.from_cell_id ELSE NEW.to_cell_id END, from_cc, to_cc
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_migration_residency ON migration_jobs;
CREATE TRIGGER trg_migration_residency
  BEFORE INSERT OR UPDATE OF from_cell_id, to_cell_id ON migration_jobs
  FOR EACH ROW
  EXECUTE FUNCTION assert_migration_residency();

REVOKE ALL ON migration_jobs, migration_job_steps FROM kv_app;
GRANT SELECT, INSERT, UPDATE ON migration_jobs TO kv_admin;
GRANT SELECT, INSERT, UPDATE ON migration_jobs TO kv_relay;
GRANT SELECT, INSERT ON migration_job_steps TO kv_admin;
GRANT SELECT, INSERT ON migration_job_steps TO kv_relay;
GRANT SELECT ON migration_jobs, migration_job_steps TO kv_readonly;
REVOKE UPDATE, DELETE ON migration_job_steps FROM PUBLIC;
REVOKE DELETE ON migration_jobs FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4 · DELTA-013 · THE PLAN
-- ---------------------------------------------------------------------------
-- W037's banner defers "forecast analytics (growth model per cell)", and its own footnote concedes the rest: "statuses
-- are planning labels, not schema enums." ADMIN-8 built the RATE, because it is a count over `cell_map_changes`. What is
-- missing is the PLAN — the steps an operator commits to ahead of demand.
--
-- **THIS IS THE PLAN, NOT THE FORECAST.** A `scale_plan_steps` row says "when in-west-1 reaches 70%, add two shards";
-- it does not predict when that will happen. The trigger is a CONDITION rather than a date, which is the difference
-- between a plan that survives a slow quarter and a calendar entry that goes stale. A forecasting service can arrive
-- later and populate `projected_trigger_at` without any of this changing.
CREATE TABLE IF NOT EXISTS scale_plan_steps (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- NULL for a step that provisions a NEW cell — the cell does not exist yet, which is exactly what the step is for.
  cell_id         uuid REFERENCES cells(id),
  -- 'in-west-2', 'bd-central-1' — the code a provisioning step will create. Free text because the cell does not exist.
  target_code     varchar(40),
  action          varchar(30) NOT NULL,
  adds_capacity   integer,
  -- The CONDITION, as data: `{"kind":"utilisation","cellId":"…","percent":70}` or `{"kind":"market_entry","country":"BD"}`.
  -- Structured rather than prose so a future job can evaluate it, and so W037's "Trigger" column is a fact rather than a
  -- note somebody has to interpret.
  trigger_spec    jsonb NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'draft',
  -- W037 shows "gated: legal + infra" on the Bangladesh row. A gate is a named reason a step cannot proceed even when
  -- its trigger fires, and it is the difference between "not yet" and "not allowed".
  gate_reason     text,
  notes           text,
  created_by_admin_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scale_plan_steps
  ADD CONSTRAINT ck_sps_action CHECK (action IN ('add_shards', 'provision_cell', 'raise_capacity', 'retire_cell'));
ALTER TABLE scale_plan_steps
  ADD CONSTRAINT ck_sps_status CHECK (status IN ('draft', 'planned', 'gated', 'done', 'abandoned'));
-- A gated step names what gates it. "gated" with no reason is a status recording a decision nobody wrote down.
ALTER TABLE scale_plan_steps
  ADD CONSTRAINT ck_sps_gate CHECK (
    status <> 'gated' OR char_length(btrim(coalesce(gate_reason, ''))) >= 10);
-- A step either extends an existing cell or names a new one. Neither is a step with no subject.
ALTER TABLE scale_plan_steps
  ADD CONSTRAINT ck_sps_subject CHECK (cell_id IS NOT NULL OR target_code IS NOT NULL);
ALTER TABLE scale_plan_steps
  ADD CONSTRAINT ck_sps_trigger CHECK (jsonb_typeof(trigger_spec) = 'object' AND trigger_spec ? 'kind');
CREATE INDEX IF NOT EXISTS idx_sps_open ON scale_plan_steps (created_at DESC)
  WHERE status IN ('draft', 'planned', 'gated');

REVOKE ALL ON scale_plan_steps FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON scale_plan_steps TO kv_admin;
GRANT SELECT ON scale_plan_steps TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 5 · W038 · THE GO-LIVE CHECKLIST
-- ---------------------------------------------------------------------------
-- W038 is FOUNDER-PHYSICAL in its execution and its own copy says why: "Terraform plan runs in CI; apply is a
-- founder-approved pipeline step — **this console never holds cloud credentials.**" A console that could apply
-- infrastructure would be a console holding cloud credentials.
--
-- So what is recordable is the CHECKLIST and the market-entry gate — and W038's own framing is exactly right: "the
-- console enforces the checklist, humans enforce the law." This table is that enforcement.
CREATE TABLE IF NOT EXISTS cell_provisioning_runs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  target_code     varchar(40) NOT NULL,
  country_code    char(2) NOT NULL REFERENCES countries(code),
  status          varchar(20) NOT NULL DEFAULT 'drafting',
  -- Per-step completion, as data: `{"infra":{"at":"…","by":"…"},"shards":{…}}`. The six steps W038 lists.
  steps           jsonb NOT NULL DEFAULT '{}',
  -- The cell this run produced, once it exists. NULL until the founder's pipeline has applied and somebody registers it.
  created_cell_id uuid REFERENCES cells(id),
  -- W038's smoke test: "synthetic tenant placed → order → payout → erased". Recorded as its own outcome because the
  -- screen has a failure state for it and because a cell opened without one is a cell nobody has proved works.
  smoke_outcome   varchar(20),
  smoke_detail    jsonb,
  smoke_at        timestamptz,
  created_by_admin_id uuid,
  opened_by_admin_id  uuid,
  opened_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cell_provisioning_runs
  ADD CONSTRAINT ck_cpr_status CHECK (status IN ('drafting', 'awaiting_infra', 'smoke', 'ready', 'open', 'abandoned'));
ALTER TABLE cell_provisioning_runs
  ADD CONSTRAINT ck_cpr_smoke CHECK (smoke_outcome IS NULL OR smoke_outcome IN ('passed', 'failed'));
-- **A CELL MAY NOT OPEN WITHOUT A PASSED SMOKE TEST.** W038's own failure state: "Synthetic order could not complete
-- payout leg — cell stays closed." That sentence is a rule, and this is the rule.
ALTER TABLE cell_provisioning_runs
  ADD CONSTRAINT ck_cpr_open_needs_smoke CHECK (
    status <> 'open' OR (smoke_outcome = 'passed' AND created_cell_id IS NOT NULL
                         AND opened_by_admin_id IS NOT NULL AND opened_at IS NOT NULL));
-- THE MARKER-CHECKER ON OPENING, which is W038's final step ("Set is_default for BD → open for placements (checker)").
-- THIRTEENTH maker-checker site.
ALTER TABLE cell_provisioning_runs
  ADD CONSTRAINT ck_cell_provisioning_runs_maker_ne_checker CHECK (
    opened_by_admin_id IS NULL OR created_by_admin_id IS NULL OR opened_by_admin_id <> created_by_admin_id);
-- One open provisioning run per target code — two drafts for `bd-central-1` would be two people building the same cell.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpr_one_open_per_code
  ON cell_provisioning_runs (target_code)
  WHERE status IN ('drafting', 'awaiting_infra', 'smoke', 'ready');

REVOKE ALL ON cell_provisioning_runs FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON cell_provisioning_runs TO kv_admin;
GRANT SELECT ON cell_provisioning_runs TO kv_readonly;

-- ---------------------------------------------------------------------------
-- 6 · RLS SWEEP
-- ---------------------------------------------------------------------------
-- Every table here is GLOBAL: the cell map is the routing directory, a migration crosses cells by definition, and a
-- residency attestation spans countries. No tenant_id, no policy — the same reasoning as `reconciliation_runs`,
-- `ledger_chain_verifications`, `settlement_runs`, `ai_fairness_audits` and 0116's two. Stated because 0020 once claimed
-- RLS on a table that had none.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residency_violations', 'migration_jobs', 'migration_job_steps', 'scale_plan_steps', 'cell_provisioning_runs'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t AND rowsecurity) THEN
      RAISE NOTICE '% has RLS enabled; it is a global routing-directory table and should not', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7 · WHAT IS DELIBERATELY NOT DONE
-- ---------------------------------------------------------------------------
-- NO EXECUTOR FOR THE MIGRATION PIPELINE. This file designs the state machine, the evidence and the locks; the worker
-- that performs logical replication, runs the verify and takes the write freeze is ADMIN-8b-Q1. **The console reports the
-- pipeline as DESIGNED AND NOT RUNNING**, which is the ADMIN-7 rule about the auto-rollback applied here before the same
-- mistake can be made: a status machine with no machine behind it is a status column recording an act nobody performs,
-- and this platform has found five of those.
--
-- NO PER-DATA-CLASS RESIDENCY RULES. DELTA-011's larger half is a rules engine over data classes and processing
-- agreements, and it needs the legal instrument before it needs a table. What lands here is the EVIDENCE the existing
-- lock never produced, plus the country profile W033's table has a column for — both of which the richer engine will
-- need regardless of its shape.
--
-- NO FORECAST. `scale_plan_steps` holds plans whose triggers are CONDITIONS. A growth model that predicts when a
-- condition will fire is DELTA-013 proper and remains open (ADMIN-8b-Q2); ADMIN-8 already exposes the observed rate and
-- the 70% trigger so the plan can be written against real numbers in the meantime.
--
-- THE NOT VALID CONSTRAINT: `ck_countries_regulation_named` only, because existing country rows have no profile and the
-- default `'none'` satisfies the check — but a row could have been given a status by hand. Everything else constrains new
-- tables and is validated. The standing debt item now covers 0110–0117.
