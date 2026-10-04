-- ==================================================================================================================
-- 0198 · PC-56 TENANT-SW-b · LABOUR WAGES, AMBASSADOR PAY, SCHEMES
--        canon W160 / W161 + W2478–W2480 (people/ambassadors[/earnings]) · W165 + W2495–W2497 (ops/labour/attendance)
--        · W166 + W2821–W2823 (ops/labour/wages) · W202 / W203 + W2751–W2753 (ops/schemes[/code])
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (Law 5 — fix forward).
-- MONEY — Law 9, founder review owed. This file adds two ledger_txn_type codes and no ledger table / ledger grant.
--
-- Founder decisions (2026-10-03), built as decided:
--   • AMBASSADOR PAY FROM THE TENANT WALLET UNDER MAKER-CHECKER (closes 10a F-23 / SWEEP F-17) — a weekly run is PREPARED
--     (by the Thursday 23:00 IST job, or by a person holding ambassador.payout.prepare) and CONFIRMED by a DIFFERENT
--     tenant_admin; each line is ONE balanced WalletPort txn tenant Main → ambassador Main (`ambrun:<run>:<ambassador>`).
--     The platform Fees account no longer pays a tenant's village agents (10a's platform(Fees) leg is REPLACED).
--   • OUT-OF-FENCE CLOCK-IN IS RECORDED AND REVIEWED (SWEEP F-12) — the day is written `needs_review`; it cannot be confirmed
--     without a vouch; nobody may confirm (or vouch for) their own day (dual-confirm law, enforced HERE, not in TypeScript).
--   • DAILY 18:00 IST WAGE RUN WITH ADVANCES RECOVERED ≤ 25 % (SWEEP F-11) — the run is a recorded object with lines and a
--     retry ladder; an advance (≤ 50 % of the expected wage) leaves the employer's escrow and is recovered from later wages.
--   • F-8 — `schemes` (and the registry tables admin-api owns) lose INSERT / UPDATE / DELETE for kv_app and kv_relay.
--
-- SECTIONS
--   198.1  vocabulary — ledger_txn_type `ambassador_run`, `wage_advance`; permissions `ambassador.payout.prepare`,
--          `advance.approve`, `scheme.desk` (+ grants; also seed core/0004 / core/0005); notification `ambassador.message`
--   198.2  A  ambassador_payout_runs (+ trigger: maker ≠ checker, one open run per tenant), ambassador_payout_run_lines,
--             ambassador_stipend_payments (UNIQUE (ambassador, month))
--   198.3  B  attendance_records — review_status, vouch, confirmer, paper backfill; `fence_distance_m` (the canon's name for
--             the server-computed clock_in_distance_m); the dual-confirm trigger
--   198.4  C1 labour_wage_runs, labour_wage_run_lines (retry ladder); labour_wage_payouts.advance_recovery_minor + wage_run_id
--   198.5  C2 worker_advances (status → varchar; the ≤ 50 % cap, approver ≠ requester, write-off refused — by trigger),
--             worker_advance_recoveries; labour_escrows.advanced_minor (+ the escrow trigger and conservation CHECK, fixed
--             forward); labour_consents may record an `advance` consent
--   198.6  D  schemes registry REVOKE (F-8); scheme_eligibility_sweeps + rows (a call list — never an application)
--   198.7  indexes
--
-- RLS DECISION: every new table is a tenant table (tenant_id NOT NULL): ENABLE + FORCE + the 0175 split (SELECT /
-- INSERT WITH CHECK / UPDATE USING + WITH CHECK bound to current_tenant_id(), an admin-realm policy TO kv_admin), REVOKE ALL
-- from kv_app / kv_relay / kv_readonly, then the narrowest grants (kv_app SELECT + INSERT, column UPDATE where a row moves).
-- No grant to kv_relay anywhere: every new job reads only `tenants` as kv_relay and works per tenant in kv_app's UoW.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 198.1  VOCABULARY
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('ledger_txn_type', 'ambassador_run', 'Ambassador weekly run line: commission + stipend (tenant main -> ambassador main), confirmed by a second tenant_admin', '{}', 210),
    ('ledger_txn_type', 'wage_advance',   'Worker wage advance from the booking escrow (employer hold -> worker main), recovered from later wages', '{}', 211)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('ambassador.payout.prepare', 'Ambassador pay: prepare a weekly (or one-ambassador exception) run for a second tenant_admin to confirm', NULL),
  ('advance.approve', 'Labour: approve a worker wage advance from the booking escrow (never the requester; the desk needs employer consent)', 'M28'),
  ('scheme.desk', 'Schemes desk: pipeline, eligibility sweep (a call list, never an application), per-field form reveal', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (p.code IN ('ambassador.payout.prepare', 'advance.approve', 'scheme.desk') AND r.code IN ('tenant_admin', 'fpo_coordinator'))
ON CONFLICT DO NOTHING;

INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('ambassador.message', 'A message from your cooperative''s member desk', 'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 198.2  A · AMBASSADOR PAY RUNS
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ambassador_payout_runs (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  kind                    varchar(10) NOT NULL CHECK (kind IN ('weekly', 'exception')),
  ambassador_id           uuid REFERENCES ambassador_profiles(id),        -- the one ambassador of an exception run
  period_start            timestamptz,                                    -- the previous weekly run's period_end (NULL = from the first unpaid)
  period_end              timestamptz NOT NULL,                           -- earnings created at or before this instant
  pay_date                date NOT NULL,                                  -- the Friday the canon names ("pays Friday")
  status                  varchar(16) NOT NULL DEFAULT 'prepared'
                          CHECK (status IN ('prepared', 'confirmed', 'refused', 'paid', 'partially_paid', 'unfunded')),
  prepared_by             uuid REFERENCES users(id),                      -- NULL = the Thursday 23:00 IST job (the maker)
  prepared_at             timestamptz NOT NULL DEFAULT now(),
  prepare_reason          text NOT NULL CHECK (length(btrim(prepare_reason)) BETWEEN 3 AND 300),
  confirmed_by            uuid REFERENCES users(id),
  confirmed_at            timestamptz,
  confirm_reason          text CHECK (confirm_reason IS NULL OR length(btrim(confirm_reason)) BETWEEN 3 AND 300),
  refused_by              uuid REFERENCES users(id),
  refused_at              timestamptz,
  refuse_reason           text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 3 AND 300),
  total_commission_minor  bigint NOT NULL CHECK (total_commission_minor >= 0),
  total_stipend_minor     bigint NOT NULL CHECK (total_stipend_minor >= 0),
  line_count              integer NOT NULL CHECK (line_count >= 0),
  funding_check           jsonb NOT NULL,                                 -- the tenant Main balance READ at prepare vs the total
  last_pay_check          jsonb,                                          -- the balance read at the last pay attempt
  paid_minor              bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  last_paid_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_apr_exception_target CHECK ((kind = 'exception') = (ambassador_id IS NOT NULL)),
  CONSTRAINT ck_apr_confirm_whole CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT ck_apr_refuse_whole CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_apr_paid_le_total CHECK (paid_minor <= total_commission_minor + total_stipend_minor)
);
COMMENT ON TABLE ambassador_payout_runs IS
  'PC-56 TENANT-SW-b (0198, founder decision: ambassador pay from the TENANT wallet under maker-checker). One weekly run per tenant per Thursday 23:00 IST (prepared by the job, prepared_by NULL) or prepared by a person holding ambassador.payout.prepare; an exception run carries ONE ambassador (the 10a manual payout, now under a checker). CONFIRMED by a different active tenant_admin (trg_apr_moves); paying posts one txn per line, tenant Main -> ambassador Main (ambrun:<run>:<ambassador>). funding_check is the real tenant Main balance read at prepare. Only one open run (prepared / confirmed / partially_paid / unfunded) per tenant.';

CREATE OR REPLACE FUNCTION assert_ambassador_payout_run_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '[AMB_RUN_APPEND_ONLY] ambassador_payout_runs is append-only — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'prepared' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.paid_minor <> 0 THEN
      RAISE EXCEPTION '[AMB_RUN_BORN_PREPARED] a run is born prepared — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    -- a person in session may never write an anonymous ("job") run: that would let one person be both maker and checker
    IF me IS NOT NULL AND NEW.prepared_by IS NULL THEN
      RAISE EXCEPTION '[AMB_RUN_PREPARER_REQUIRED] a run prepared in a person''s session names that person as the maker — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.prepared_by <> me THEN
      RAISE EXCEPTION '[AMB_RUN_NOT_YOURS] a run is prepared in the preparer''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('ambassador_payout_run_open:' || NEW.tenant_id::text));
    IF EXISTS (SELECT 1 FROM ambassador_payout_runs r WHERE r.tenant_id = NEW.tenant_id AND r.status IN ('prepared', 'confirmed', 'partially_paid', 'unfunded')) THEN
      RAISE EXCEPTION '[AMB_RUN_ALREADY_OPEN] this cooperative already has an open ambassador run — confirm, refuse or finish paying it first — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: what was prepared is final
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.ambassador_id IS DISTINCT FROM OLD.ambassador_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end <> OLD.period_end OR NEW.pay_date <> OLD.pay_date
     OR NEW.prepared_by IS DISTINCT FROM OLD.prepared_by OR NEW.prepared_at <> OLD.prepared_at OR NEW.prepare_reason <> OLD.prepare_reason
     OR NEW.total_commission_minor <> OLD.total_commission_minor OR NEW.total_stipend_minor <> OLD.total_stipend_minor
     OR NEW.line_count <> OLD.line_count OR NEW.funding_check <> OLD.funding_check OR NEW.created_at <> OLD.created_at
     OR NEW.paid_minor < OLD.paid_minor THEN
    RAISE EXCEPTION '[AMB_RUN_FINAL] what a run prepared is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('refused', 'paid') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION '[AMB_RUN_CLOSED] the run is already % — PC-56 TENANT-SW-b', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.confirmed_by IS NOT NULL AND (NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION '[AMB_RUN_FINAL] a run''s confirmation is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'prepared' AND NEW.status NOT IN ('prepared', 'confirmed', 'refused') THEN
    RAISE EXCEPTION '[AMB_RUN_NEEDS_CHECKER] a prepared run pays only after a second tenant_admin confirms it — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('confirmed', 'paid', 'partially_paid', 'unfunded') AND NEW.confirmed_by IS NULL THEN
    RAISE EXCEPTION '[AMB_RUN_NEEDS_CHECKER] a run pays only after a second tenant_admin confirms it — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.confirmed_by IS NULL AND NEW.confirmed_by IS NOT NULL THEN
    IF OLD.status <> 'prepared' THEN
      RAISE EXCEPTION '[AMB_RUN_CLOSED] only a prepared run can be confirmed — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    -- THE MAKER-CHECKER WALL. The preparer (a person) may never confirm their own run; a job-prepared run (prepared_by NULL) is
    -- confirmed by any active tenant_admin — the job is the maker, the admin the checker (canon W161: "Maker: member desk
    -- (auto-prepared Thu 23:00). Checker: you.").
    IF OLD.prepared_by IS NOT NULL AND NEW.confirmed_by = OLD.prepared_by THEN
      RAISE EXCEPTION '[AMB_RUN_CHECKER_IS_MAKER] the person who prepared this run cannot also confirm it — a second tenant_admin must — PC-56 TENANT-SW-b maker-checker' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[AMB_RUN_CHECKER_NOT_ADMIN] only an active tenant_admin confirms an ambassador run — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[AMB_RUN_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'refused' AND OLD.status <> 'refused' THEN
    IF OLD.status <> 'prepared' THEN
      RAISE EXCEPTION '[AMB_RUN_CLOSED] only a prepared run can be refused — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[AMB_RUN_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_apr_moves ON ambassador_payout_runs;
CREATE TRIGGER trg_apr_moves BEFORE INSERT OR UPDATE OR DELETE ON ambassador_payout_runs FOR EACH ROW EXECUTE FUNCTION assert_ambassador_payout_run_moves();
DROP TRIGGER IF EXISTS trg_apr_no_truncate ON ambassador_payout_runs;
CREATE TRIGGER trg_apr_no_truncate BEFORE TRUNCATE ON ambassador_payout_runs FOR EACH STATEMENT EXECUTE FUNCTION assert_ambassador_payout_run_moves();
-- the second wall behind the trigger's check
CREATE UNIQUE INDEX IF NOT EXISTS uq_apr_one_open_run ON ambassador_payout_runs (tenant_id) WHERE status IN ('prepared', 'confirmed', 'partially_paid', 'unfunded');
CREATE INDEX IF NOT EXISTS idx_apr_tenant_recent ON ambassador_payout_runs (tenant_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_apr_weekly_period ON ambassador_payout_runs (tenant_id, period_end) WHERE kind = 'weekly' AND status <> 'refused';

CREATE TABLE IF NOT EXISTS ambassador_payout_run_lines (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  run_id              uuid NOT NULL REFERENCES ambassador_payout_runs(id),
  ambassador_id       uuid NOT NULL REFERENCES ambassador_profiles(id),
  ambassador_user_id  uuid NOT NULL REFERENCES users(id),
  commission_minor    bigint NOT NULL CHECK (commission_minor >= 0),
  earning_count       integer NOT NULL CHECK (earning_count >= 0),
  stipend_minor       bigint NOT NULL DEFAULT 0 CHECK (stipend_minor >= 0),
  stipend_month       date,                                               -- the first day of the month the stipend is for
  status              varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'unfunded', 'failed')),
  shortfall_minor     bigint CHECK (shortfall_minor IS NULL OR shortfall_minor > 0),
  failure_code        varchar(60),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payout_id           uuid,                                               -- = this line's id once paid: what ambassador_earnings.payout_id carries
  txn_id              uuid,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_aprl_run_ambassador UNIQUE (run_id, ambassador_id),
  CONSTRAINT ck_aprl_positive CHECK (commission_minor + stipend_minor > 0),
  CONSTRAINT ck_aprl_stipend_month CHECK ((stipend_minor > 0) = (stipend_month IS NOT NULL)),
  CONSTRAINT ck_aprl_paid_whole CHECK ((status = 'paid') = (txn_id IS NOT NULL AND paid_at IS NOT NULL AND payout_id IS NOT NULL)),
  CONSTRAINT ck_aprl_unfunded_shortfall CHECK ((status = 'unfunded') = (shortfall_minor IS NOT NULL))
);
COMMENT ON TABLE ambassador_payout_run_lines IS
  'PC-56 TENANT-SW-b (0198): one line per ambassador in a run — the unpaid earnings up to the run''s period_end + a monthly stipend (only for an ambassador active the WHOLE month; pro-rata refused by name). Paid = one ambrun:<run>:<ambassador> txn tenant Main -> ambassador Main; the earnings are stamped with payout_id = this line id (10a markPaid, rowCount asserted). Unfunded = the tenant Main could not cover it (the shortfall is recorded, nothing moved).';

CREATE OR REPLACE FUNCTION assert_ambassador_run_line_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[AMB_RUN_APPEND_ONLY] ambassador_payout_run_lines is append-only — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.run_id <> OLD.run_id OR NEW.ambassador_id <> OLD.ambassador_id
     OR NEW.ambassador_user_id <> OLD.ambassador_user_id OR NEW.commission_minor <> OLD.commission_minor OR NEW.earning_count <> OLD.earning_count
     OR NEW.stipend_minor <> OLD.stipend_minor OR NEW.stipend_month IS DISTINCT FROM OLD.stipend_month OR NEW.created_at <> OLD.created_at
     OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION '[AMB_RUN_FINAL] the money facts of a run line are final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'paid' AND (NEW.status <> 'paid' OR NEW.txn_id IS DISTINCT FROM OLD.txn_id OR NEW.payout_id IS DISTINCT FROM OLD.payout_id) THEN
    RAISE EXCEPTION '[AMB_RUN_LINE_PAID] a paid line is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_aprl_moves ON ambassador_payout_run_lines;
CREATE TRIGGER trg_aprl_moves BEFORE UPDATE OR DELETE ON ambassador_payout_run_lines FOR EACH ROW EXECUTE FUNCTION assert_ambassador_run_line_moves();

CREATE TABLE IF NOT EXISTS ambassador_stipend_payments (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  ambassador_id  uuid NOT NULL REFERENCES ambassador_profiles(id),
  month          date NOT NULL CHECK (month = date_trunc('month', month)::date),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  run_id         uuid NOT NULL REFERENCES ambassador_payout_runs(id),
  line_id        uuid NOT NULL REFERENCES ambassador_payout_run_lines(id),
  txn_id         uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_asp_ambassador_month UNIQUE (ambassador_id, month)
);
COMMENT ON TABLE ambassador_stipend_payments IS
  'PC-56 TENANT-SW-b (0198): a monthly stipend paid — once per (ambassador, month), the UNIQUE is the wall. Written in the same transaction as the ambrun line txn that carried it. Append-only.';
CREATE OR REPLACE FUNCTION ambassador_stipend_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[AMB_STIPEND_APPEND_ONLY] a paid stipend is never edited or removed — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_asp_append_only ON ambassador_stipend_payments;
CREATE TRIGGER trg_asp_append_only BEFORE UPDATE OR DELETE ON ambassador_stipend_payments FOR EACH ROW EXECUTE FUNCTION ambassador_stipend_append_only();

-- ------------------------------------------------------------------------------------------------------------------
-- 198.3  B · ATTENDANCE — RECORDED AND REVIEWED, DUAL-CONFIRMED BY THE DATABASE
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS review_status   varchar(14) NOT NULL DEFAULT 'none';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS vouched_by      uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS vouch_reason    text;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS vouched_at      timestamptz;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS confirmed_by    uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS recorded_by     uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS backfill_media_id uuid;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS backfill_reason text;
-- The canon names it `fence_distance_m`; the server has always computed it into clock_in_distance_m (0008). One fact, two
-- names would be two answers — so the canon's name is a GENERATED column over the existing one, never written by anyone.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS fence_distance_m integer GENERATED ALWAYS AS (clock_in_distance_m) STORED;

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS ck_ar_review_status;
ALTER TABLE attendance_records ADD CONSTRAINT ck_ar_review_status CHECK (review_status IN ('none', 'needs_review', 'vouched', 'refused'));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS ck_ar_method;
ALTER TABLE attendance_records ADD CONSTRAINT ck_ar_method CHECK (clock_in_method IN ('self', 'supervisor_biometric', 'paper_backfill', 'supervisor_vouch'));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS ck_ar_vouch_whole;
ALTER TABLE attendance_records ADD CONSTRAINT ck_ar_vouch_whole CHECK (review_status NOT IN ('vouched', 'refused') OR (vouched_by IS NOT NULL AND vouched_at IS NOT NULL AND length(btrim(COALESCE(vouch_reason, ''))) BETWEEN 10 AND 500));
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS ck_ar_backfill_whole;
ALTER TABLE attendance_records ADD CONSTRAINT ck_ar_backfill_whole CHECK (clock_in_method <> 'paper_backfill' OR (recorded_by IS NOT NULL AND backfill_media_id IS NOT NULL AND length(btrim(COALESCE(backfill_reason, ''))) BETWEEN 10 AND 500));
COMMENT ON COLUMN attendance_records.review_status IS
  'PC-56 TENANT-SW-b (0198, founder decision: out-of-fence clock-in RECORDED AND REVIEWED): none (in-fence self clock-in) | needs_review (clocked in beyond the 100 m fence, or a paper backfill) | vouched (a reviewer who is not the worker, and for a backfill not its recorder, vouched with a reason) | refused (the day will not be confirmed). A needs_review or refused day can never be confirmed (trg_ar_review).';
COMMENT ON COLUMN attendance_records.fence_distance_m IS
  'PC-56 TENANT-SW-b (0198): the canon''s name (W165) for clock_in_distance_m — the server-computed metres from the farm at clock-in. GENERATED; never written.';

CREATE OR REPLACE FUNCTION assert_attendance_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  worker_user uuid;
  me uuid := kv_session_user();
BEGIN
  SELECT wp.user_id INTO worker_user
    FROM booking_assignments ba JOIN worker_profiles wp ON wp.id = ba.worker_id
   WHERE ba.id = NEW.assignment_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.confirmed_by_employer THEN
      RAISE EXCEPTION '[ATTENDANCE_BORN_UNCONFIRMED] a day is born unconfirmed — the employer confirms it after — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.clock_in_method = 'self' AND COALESCE(NEW.clock_in_distance_m, 0) > 100 AND NEW.review_status <> 'needs_review' THEN
      RAISE EXCEPTION '[ATTENDANCE_OUT_OF_FENCE_NEEDS_REVIEW] a clock-in beyond the 100 m fence is recorded needs_review — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.clock_in_method = 'paper_backfill' AND NEW.review_status <> 'needs_review' THEN
      RAISE EXCEPTION '[ATTENDANCE_BACKFILL_NEEDS_REVIEW] a paper backfill is recorded needs_review — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.clock_in_method = 'paper_backfill' AND NEW.recorded_by IS NOT DISTINCT FROM worker_user THEN
      RAISE EXCEPTION '[ATTENDANCE_SELF_BACKFILL] nobody records their own day from paper — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.review_status IN ('vouched', 'refused') THEN
      RAISE EXCEPTION '[ATTENDANCE_BORN_UNREVIEWED] a day is reviewed after it is recorded — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.confirmed_by_employer AND (NOT NEW.confirmed_by_employer OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.review_status <> OLD.review_status) THEN
    RAISE EXCEPTION '[ATTENDANCE_CONFIRMED_FINAL] a confirmed day is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.clock_in_method <> OLD.clock_in_method OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR NEW.backfill_media_id IS DISTINCT FROM OLD.backfill_media_id
     OR NEW.backfill_reason IS DISTINCT FROM OLD.backfill_reason OR NEW.clock_in_distance_m IS DISTINCT FROM OLD.clock_in_distance_m THEN
    RAISE EXCEPTION '[ATTENDANCE_EVIDENCE_FINAL] how a day was recorded is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.review_status <> OLD.review_status THEN
    IF OLD.review_status <> 'needs_review' OR NEW.review_status NOT IN ('vouched', 'refused') THEN
      RAISE EXCEPTION '[ATTENDANCE_REVIEW_MOVE] a review moves needs_review -> vouched | refused, once — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.vouched_by IS NOT DISTINCT FROM worker_user THEN
      RAISE EXCEPTION '[ATTENDANCE_SELF_VOUCH] you cannot vouch for your own attendance (dual-confirm law) — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.clock_in_method = 'paper_backfill' AND NEW.vouched_by IS NOT DISTINCT FROM OLD.recorded_by THEN
      RAISE EXCEPTION '[ATTENDANCE_BACKFILL_VOUCH_IS_RECORDER] the person who recorded a paper day cannot also vouch for it — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.vouched_by <> me THEN
      RAISE EXCEPTION '[ATTENDANCE_NOT_YOURS] a review is made in the reviewer''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.vouched_by IS DISTINCT FROM OLD.vouched_by OR NEW.vouch_reason IS DISTINCT FROM OLD.vouch_reason OR NEW.vouched_at IS DISTINCT FROM OLD.vouched_at THEN
    RAISE EXCEPTION '[ATTENDANCE_REVIEW_FINAL] a review is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmed_by_employer AND NOT OLD.confirmed_by_employer THEN
    IF NEW.confirmed_by IS NULL THEN
      RAISE EXCEPTION '[ATTENDANCE_CONFIRMER_REQUIRED] a confirmation names who confirmed — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    -- THE DUAL-CONFIRM LAW: the confirming actor is never the assigned worker (the labour desk path included).
    IF NEW.confirmed_by IS NOT DISTINCT FROM worker_user THEN
      RAISE EXCEPTION '[ATTENDANCE_SELF_CONFIRM] you cannot confirm your own attendance (dual-confirm law) — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    -- RECORD AND REVIEW: a day beyond the fence (or from paper) is confirmed only after a vouch; a refused day never.
    IF NEW.review_status = 'needs_review' THEN
      RAISE EXCEPTION '[ATTENDANCE_NEEDS_VOUCH] this day was recorded for review (outside the fence, or from paper) — it is confirmed only after someone other than the worker vouches for it — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.review_status = 'refused' THEN
      RAISE EXCEPTION '[ATTENDANCE_REFUSED] this day was refused on review and will not be confirmed — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[ATTENDANCE_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT NEW.confirmed_by_employer AND (NEW.confirmed_by IS NOT NULL OR NEW.confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION '[ATTENDANCE_CONFIRMER_REQUIRED] a confirmer is recorded only with the confirmation — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ar_review ON attendance_records;
CREATE TRIGGER trg_ar_review BEFORE INSERT OR UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION assert_attendance_review();

-- the labour desk's employer consents may now also cover an advance approval
ALTER TABLE labour_consents DROP CONSTRAINT IF EXISTS labour_consents_act_check;
ALTER TABLE labour_consents ADD CONSTRAINT labour_consents_act_check CHECK (act IN ('post', 'fill', 'confirm_roster', 'cancel', 'advance'));

-- ------------------------------------------------------------------------------------------------------------------
-- 198.4  C1 · THE DAILY WAGE RUN
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_wage_runs (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  run_date               date NOT NULL,                                    -- the IST day whose 18:00 the run belongs to
  status                 varchar(16) NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'paid', 'partially_paid', 'failed')),
  prepared_by            uuid REFERENCES users(id),                        -- NULL = the 18:00 job
  bookings_considered    integer NOT NULL DEFAULT 0 CHECK (bookings_considered >= 0),
  line_count             integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  gross_minor            bigint NOT NULL DEFAULT 0 CHECK (gross_minor >= 0),
  advance_recovery_minor bigint NOT NULL DEFAULT 0 CHECK (advance_recovery_minor >= 0),
  net_minor              bigint NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
  started_at             timestamptz NOT NULL DEFAULT now(),
  finished_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lwr_tenant_day UNIQUE (tenant_id, run_date),
  CONSTRAINT ck_lwr_net CHECK (net_minor + advance_recovery_minor = gross_minor)
);
COMMENT ON TABLE labour_wage_runs IS
  'PC-56 TENANT-SW-b (0198, founder decision: DAILY 18:00 IST WAGE RUN). One run per tenant per IST day: every confirmed-but-unpaid day across every booking is paid through the 11b pay run (escrow Hold -> worker Main, wage:<assignment>:<sha256(days)>). Totals are what the lines moved; a line that failed retries at 16:00 IST on the following days (three retries) and is then named failed.';

CREATE TABLE IF NOT EXISTS labour_wage_run_lines (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  run_id                 uuid NOT NULL REFERENCES labour_wage_runs(id),
  booking_id             uuid NOT NULL REFERENCES labour_bookings(id),
  assignment_id          uuid NOT NULL REFERENCES booking_assignments(id),
  worker_id              uuid NOT NULL REFERENCES worker_profiles(id),
  payout_id              uuid REFERENCES labour_wage_payouts(id),
  gross_minor            bigint NOT NULL DEFAULT 0 CHECK (gross_minor >= 0),
  advance_recovery_minor bigint NOT NULL DEFAULT 0 CHECK (advance_recovery_minor >= 0),
  net_minor              bigint NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
  days_confirmed         integer NOT NULL DEFAULT 0 CHECK (days_confirmed >= 0),
  status                 varchar(18) NOT NULL CHECK (status IN ('paid', 'retrying', 'failed', 'skipped_unfunded')),
  attempts               integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  next_retry_at          timestamptz,
  last_error             varchar(80),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lwrl_run_assignment UNIQUE (run_id, assignment_id),
  CONSTRAINT ck_lwrl_net CHECK (net_minor + advance_recovery_minor = gross_minor),
  CONSTRAINT ck_lwrl_recovery_cap CHECK (advance_recovery_minor * 4 <= gross_minor),
  CONSTRAINT ck_lwrl_retry CHECK ((status = 'retrying') = (next_retry_at IS NOT NULL)),
  CONSTRAINT ck_lwrl_paid CHECK (status <> 'paid' OR payout_id IS NOT NULL)
);
COMMENT ON TABLE labour_wage_run_lines IS
  'PC-56 TENANT-SW-b (0198): one line per assignment a run paid or tried to pay: gross (base + overtime paid in that run) · advance recovery (≤ 25 % of gross, CHECK) · net (what reached the worker). paid | skipped_unfunded (the escrow and the employer''s Main could not cover it — the 11b awaiting-top-up row) | retrying (the booking''s pay transaction failed; next attempt 16:00 IST next day) | failed (the ladder — one retry a day, three days — is exhausted).';

CREATE OR REPLACE FUNCTION assert_wage_run_line_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[WAGE_RUN_APPEND_ONLY] labour_wage_run_lines is append-only — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.run_id <> OLD.run_id OR NEW.assignment_id <> OLD.assignment_id
     OR NEW.booking_id <> OLD.booking_id OR NEW.created_at <> OLD.created_at OR NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION '[WAGE_RUN_FINAL] a wage run line''s identity is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('paid', 'failed') AND (NEW.status <> OLD.status OR NEW.gross_minor <> OLD.gross_minor OR NEW.net_minor <> OLD.net_minor) THEN
    RAISE EXCEPTION '[WAGE_RUN_LINE_CLOSED] the line is already % — PC-56 TENANT-SW-b', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lwrl_moves ON labour_wage_run_lines;
CREATE TRIGGER trg_lwrl_moves BEFORE UPDATE OR DELETE ON labour_wage_run_lines FOR EACH ROW EXECUTE FUNCTION assert_wage_run_line_moves();

ALTER TABLE labour_wage_payouts ADD COLUMN IF NOT EXISTS advance_recovery_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE labour_wage_payouts ADD COLUMN IF NOT EXISTS wage_run_id uuid REFERENCES labour_wage_runs(id);
ALTER TABLE labour_wage_payouts DROP CONSTRAINT IF EXISTS ck_lwp_recovery;
-- ≤ 25 % of the payout's gross (base + overtime), and never more than the base leg it is taken from
ALTER TABLE labour_wage_payouts ADD CONSTRAINT ck_lwp_recovery CHECK (advance_recovery_minor >= 0 AND advance_recovery_minor <= base_minor AND advance_recovery_minor * 4 <= base_minor + ot_minor);
COMMENT ON COLUMN labour_wage_payouts.advance_recovery_minor IS
  'PC-56 TENANT-SW-b (0198, founder decision: advances recovered ≤ 25 %): the part of this payout''s base that recovered an outstanding wage advance — the worker received base − recovery (the wage leg), the employer''s Hold released only base − recovery (the advance had already left it). worker_advance_recoveries itemises it.';
COMMENT ON COLUMN labour_wage_payouts.wage_run_id IS
  'PC-56 TENANT-SW-b (0198): the daily wage run that paid this row; NULL = a manual pay act (11b, an exception — listed as "manual").';

-- fix forward: 0187's payout trigger, with the two new columns in the frozen set (recovery may be set only while the base is unpaid)
CREATE OR REPLACE FUNCTION assert_labour_wage_payout_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'labour_wage_payouts is append-only: payout % cannot be deleted (PC-56 TENANT-11b, 0187)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.booking_id <> OLD.booking_id OR NEW.assignment_id <> OLD.assignment_id
     OR NEW.worker_id <> OLD.worker_id OR NEW.worker_user_id <> OLD.worker_user_id OR NEW.run_key <> OLD.run_key OR NEW.wage_kind <> OLD.wage_kind
     OR NEW.rate_minor <> OLD.rate_minor OR NEW.attendance_ids <> OLD.attendance_ids OR NEW.days_confirmed <> OLD.days_confirmed
     OR NEW.hours_regular <> OLD.hours_regular OR NEW.hours_overtime <> OLD.hours_overtime OR NEW.base_minor <> OLD.base_minor
     OR NEW.ot_minor <> OLD.ot_minor OR NEW.source <> OLD.source OR NEW.zero_reason IS DISTINCT FROM OLD.zero_reason OR NEW.created_at <> OLD.created_at
     OR NEW.wage_run_id IS DISTINCT FROM OLD.wage_run_id
     OR (OLD.base_txn_id IS NOT NULL AND NEW.advance_recovery_minor <> OLD.advance_recovery_minor)
     OR (OLD.base_txn_id IS NOT NULL AND NEW.base_txn_id IS DISTINCT FROM OLD.base_txn_id)
     OR (OLD.ot_txn_id IS NOT NULL AND NEW.ot_txn_id IS DISTINCT FROM OLD.ot_txn_id) THEN
    RAISE EXCEPTION 'labour_wage_payouts: the money facts of payout % are final; only an awaiting part may be paid', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('paid', 'zero') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'labour_wage_payouts: payout % is already %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 198.5  C2 · WORKER ADVANCES (the table 0008 forward-declared and nothing ever wrote)
-- ------------------------------------------------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_advances_worker;
ALTER TABLE worker_advances ALTER COLUMN status DROP DEFAULT;
ALTER TABLE worker_advances ALTER COLUMN status TYPE varchar(14) USING (CASE status::text WHEN 'partially_recovered' THEN 'recovering' ELSE status::text END);
ALTER TABLE worker_advances ALTER COLUMN status SET DEFAULT 'requested';
ALTER TABLE worker_advances DROP CONSTRAINT IF EXISTS ck_wa_status;
ALTER TABLE worker_advances ADD CONSTRAINT ck_wa_status CHECK (status IN ('requested', 'approved', 'disbursed', 'recovering', 'recovered', 'written_off', 'rejected'));
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS assignment_id       uuid REFERENCES booking_assignments(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS worker_user_id      uuid REFERENCES users(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS employer_user_id    uuid REFERENCES users(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS expected_wage_minor bigint;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS requested_by        uuid REFERENCES users(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS request_reason      text;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS approved_by         uuid REFERENCES users(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS approved_at         timestamptz;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS approve_reason      text;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS consent_id          uuid REFERENCES labour_consents(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS disbursed_at        timestamptz;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS disbursal_txn_id    uuid;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS rejected_by         uuid REFERENCES users(id);
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS rejected_at         timestamptz;
ALTER TABLE worker_advances ADD COLUMN IF NOT EXISTS reject_reason       text;
ALTER TABLE worker_advances DROP CONSTRAINT IF EXISTS ck_wa_recovered_le;
ALTER TABLE worker_advances ADD CONSTRAINT ck_wa_recovered_le CHECK (recovered_minor >= 0 AND recovered_minor <= amount_minor);
ALTER TABLE worker_advances DROP CONSTRAINT IF EXISTS ck_wa_disbursed_whole;
ALTER TABLE worker_advances ADD CONSTRAINT ck_wa_disbursed_whole CHECK (status NOT IN ('disbursed', 'recovering', 'recovered') OR (disbursal_txn_id IS NOT NULL AND disbursed_at IS NOT NULL AND approved_by IS NOT NULL));
COMMENT ON TABLE worker_advances IS
  'PC-56 TENANT-SW-b (0198, founder decision: advances recovered ≤ 25 %). A worker''s advance against one assignment, employer-funded from the booking escrow: at approval it is disbursed wage-advance:<id> employer Hold -> worker Main (labour_escrows.advanced_minor grows); each later wage payout recovers min(outstanding, 25 % of that payout''s gross) by paying the worker gross − recovery (worker_advance_recoveries). Σ advances on an assignment ≤ 50 % of its expected wage (days × rate) and the approver is never the requester nor the worker — both by trg_wa_moves. Write-off is REFUSED BY NAME (founder). disbursal_payout_id (0008) is unused: an advance is a wallet leg, never a bank payout.';

-- expected wage of an assignment = planned units × rate (the 11b escrow arithmetic: per_day days, per_hour days × daily_hours, per_task 1)
CREATE OR REPLACE FUNCTION kv_assignment_expected_wage_minor(p_assignment uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE b.wage_kind::text
           WHEN 'per_day'  THEN ((b.end_date - b.start_date) + 1)::bigint * ba.wage_minor
           WHEN 'per_hour' THEN round(((b.end_date - b.start_date) + 1) * b.daily_hours * ba.wage_minor)::bigint
           ELSE ba.wage_minor
         END
    FROM booking_assignments ba JOIN labour_bookings b ON b.id = ba.booking_id
   WHERE ba.id = p_assignment
$$;
COMMENT ON FUNCTION kv_assignment_expected_wage_minor(uuid) IS
  'PC-56 TENANT-SW-b (0198): the expected wage of one assignment — the 11b escrow''s planned units × that assignment''s rate. The advance cap (≤ 50 %) is judged against it in the database, not against a figure the caller supplies.';

CREATE OR REPLACE FUNCTION assert_worker_advance_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected bigint;
  others bigint;
  me uuid := kv_session_user();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[ADVANCE_APPEND_ONLY] a worker advance is never deleted — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'requested' OR NEW.approved_by IS NOT NULL OR NEW.recovered_minor <> 0 THEN
      RAISE EXCEPTION '[ADVANCE_BORN_REQUESTED] an advance is born requested — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.assignment_id IS NULL OR NEW.requested_by IS NULL OR NEW.worker_user_id IS NULL OR NEW.employer_user_id IS NULL
       OR length(btrim(COALESCE(NEW.request_reason, ''))) NOT BETWEEN 3 AND 300 THEN
      RAISE EXCEPTION '[ADVANCE_INCOMPLETE] an advance names its assignment, worker, employer, requester and reason — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.requested_by <> me THEN
      RAISE EXCEPTION '[ADVANCE_NOT_YOURS] an advance is requested in the requester''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('worker_advance:' || NEW.assignment_id::text));
    expected := kv_assignment_expected_wage_minor(NEW.assignment_id);
    IF expected IS NULL OR expected <= 0 THEN
      RAISE EXCEPTION '[ADVANCE_NO_EXPECTED_WAGE] the assignment has no expected wage to advance against — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum(a.amount_minor), 0) INTO others FROM worker_advances a
     WHERE a.assignment_id = NEW.assignment_id AND a.status NOT IN ('rejected') AND a.id <> NEW.id;
    -- THE CAP: every advance on the assignment together is at most HALF the expected wage
    IF (others + NEW.amount_minor) * 2 > expected THEN
      RAISE EXCEPTION '[ADVANCE_OVER_CAP] advances on one job may total at most 50%% of the expected wage (% minor) — PC-56 TENANT-SW-b', expected USING ERRCODE = 'check_violation';
    END IF;
    NEW.expected_wage_minor := expected;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.worker_id <> OLD.worker_id
     OR NEW.worker_user_id IS DISTINCT FROM OLD.worker_user_id OR NEW.employer_user_id IS DISTINCT FROM OLD.employer_user_id
     OR NEW.amount_minor <> OLD.amount_minor OR NEW.expected_wage_minor IS DISTINCT FROM OLD.expected_wage_minor
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.request_reason IS DISTINCT FROM OLD.request_reason
     OR NEW.recovered_minor < OLD.recovered_minor
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
     OR (OLD.disbursal_txn_id IS NOT NULL AND NEW.disbursal_txn_id IS DISTINCT FROM OLD.disbursal_txn_id) THEN
    RAISE EXCEPTION '[ADVANCE_FINAL] what an advance requested, and who approved it, is final — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'written_off' AND OLD.status <> 'written_off' THEN
    RAISE EXCEPTION '[ADVANCE_WRITE_OFF_REFUSED] writing an advance off is not a recorded act on this platform (founder: refused by name) — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('rejected', 'recovered') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION '[ADVANCE_CLOSED] the advance is already % — PC-56 TENANT-SW-b', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.approved_by IS NULL AND NEW.approved_by IS NOT NULL THEN
    IF OLD.status <> 'requested' THEN
      RAISE EXCEPTION '[ADVANCE_CLOSED] only a requested advance is approved — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    -- maker ≠ checker: the person who asked for the money is never the person who lets it go, and the worker never approves their own
    IF NEW.approved_by = OLD.requested_by THEN
      RAISE EXCEPTION '[ADVANCE_APPROVER_IS_REQUESTER] the person who requested this advance cannot also approve it — PC-56 TENANT-SW-b maker-checker' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.approved_by = OLD.worker_user_id THEN
      RAISE EXCEPTION '[ADVANCE_APPROVER_IS_WORKER] a worker never approves their own advance — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.approved_by <> me THEN
      RAISE EXCEPTION '[ADVANCE_NOT_YOURS] an approval is made in the approver''s own session — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status = 'recovered' AND NEW.recovered_minor <> NEW.amount_minor THEN
    RAISE EXCEPTION '[ADVANCE_NOT_RECOVERED] an advance is recovered only when every paisa came back — PC-56 TENANT-SW-b' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_wa_moves ON worker_advances;
CREATE TRIGGER trg_wa_moves BEFORE INSERT OR UPDATE OR DELETE ON worker_advances FOR EACH ROW EXECUTE FUNCTION assert_worker_advance_moves();

CREATE TABLE IF NOT EXISTS worker_advance_recoveries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  advance_id    uuid NOT NULL REFERENCES worker_advances(id),
  payout_id     uuid NOT NULL REFERENCES labour_wage_payouts(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_war_advance_payout UNIQUE (advance_id, payout_id)
);
COMMENT ON TABLE worker_advance_recoveries IS
  'PC-56 TENANT-SW-b (0198): how much of one wage payout recovered one advance (oldest advance first). Σ per payout = labour_wage_payouts.advance_recovery_minor. Append-only.';
CREATE OR REPLACE FUNCTION worker_advance_recoveries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[ADVANCE_APPEND_ONLY] a recorded recovery is never edited or removed — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_war_append_only ON worker_advance_recoveries;
CREATE TRIGGER trg_war_append_only BEFORE UPDATE OR DELETE ON worker_advance_recoveries FOR EACH ROW EXECUTE FUNCTION worker_advance_recoveries_append_only();

-- the escrow knows what advances took out of the booking's share of the pooled Hold
ALTER TABLE labour_escrows ADD COLUMN IF NOT EXISTS advanced_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE labour_escrows DROP CONSTRAINT IF EXISTS ck_le_advanced;
ALTER TABLE labour_escrows ADD CONSTRAINT ck_le_advanced CHECK (advanced_minor >= 0);
ALTER TABLE labour_escrows DROP CONSTRAINT IF EXISTS ck_le_conserved;
ALTER TABLE labour_escrows ADD CONSTRAINT ck_le_conserved CHECK (paid_minor + released_minor + advanced_minor <= expected_minor + topped_up_minor);
COMMENT ON COLUMN labour_escrows.advanced_minor IS
  'PC-56 TENANT-SW-b (0198): wage advances disbursed from this booking''s share of the Hold (wage-advance:<id>). held now = expected + topped_up − paid − released − advanced. A recovered advance never comes back into the Hold: the wages it pre-paid are simply released net of it (the worker gets gross − recovery).';

CREATE OR REPLACE FUNCTION assert_labour_escrow_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'labour_escrows is append-only: escrow % cannot be deleted (PC-56 TENANT-11b, 0187)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.booking_id <> OLD.booking_id OR NEW.employer_user_id <> OLD.employer_user_id
     OR NEW.expected_minor <> OLD.expected_minor OR NEW.fee_minor <> OLD.fee_minor OR NEW.fee_rule_id IS DISTINCT FROM OLD.fee_rule_id
     OR NEW.escrow_txn_id <> OLD.escrow_txn_id OR NEW.confirmed_by <> OLD.confirmed_by OR NEW.on_behalf <> OLD.on_behalf
     OR NEW.consent_id IS DISTINCT FROM OLD.consent_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'labour_escrows: the money facts of escrow % are final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.topped_up_minor < OLD.topped_up_minor OR NEW.topup_count < OLD.topup_count OR NEW.paid_minor < OLD.paid_minor
     OR NEW.released_minor < OLD.released_minor OR NEW.advanced_minor < OLD.advanced_minor THEN
    RAISE EXCEPTION 'labour_escrows: escrow % counters only grow', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'released' AND (NEW.status <> OLD.status OR NEW.paid_minor <> OLD.paid_minor OR NEW.released_minor <> OLD.released_minor
     OR NEW.topped_up_minor <> OLD.topped_up_minor OR NEW.advanced_minor <> OLD.advanced_minor OR NEW.release_txn_id IS DISTINCT FROM OLD.release_txn_id) THEN
    RAISE EXCEPTION 'labour_escrows: escrow % is already released', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 198.6  D · SCHEMES — THE REGISTRY IS ADMIN-API'S (F-8); THE SWEEP IS A CALL LIST
-- ------------------------------------------------------------------------------------------------------------------
-- The only writer of these four tables is apps/admin-api (schemes-registry-ops, as kv_admin); apps/api and apps/worker only SELECT
-- (grep: scheme.repository / scheme-version.repository / scheme-authority.repository are read-only). The 0190 / 0192 class:
-- the request tier and the relay keep SELECT and nothing else.
REVOKE INSERT, UPDATE, DELETE ON schemes FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON scheme_versions FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON scheme_authorities FROM kv_app, kv_relay;
REVOKE INSERT, UPDATE, DELETE ON scheme_registry_changes FROM kv_app, kv_relay;
GRANT SELECT ON schemes, scheme_versions, scheme_authorities TO kv_app;

CREATE TABLE IF NOT EXISTS scheme_eligibility_sweeps (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  scheme_id              uuid NOT NULL REFERENCES schemes(id),
  scheme_version         integer NOT NULL,
  run_date               date NOT NULL DEFAULT kv_ist_today(),
  status                 varchar(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_by           uuid NOT NULL REFERENCES users(id),
  reason                 text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  members_evaluated      integer NOT NULL DEFAULT 0 CHECK (members_evaluated >= 0),
  eligible_count         integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  eligible_not_applied   integer NOT NULL DEFAULT 0 CHECK (eligible_not_applied >= 0),
  started_at             timestamptz,
  finished_at            timestamptz,
  failure                varchar(200),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ses_once_a_day UNIQUE (tenant_id, scheme_id, run_date)
);
COMMENT ON TABLE scheme_eligibility_sweeps IS
  'PC-56 TENANT-SW-b (0198, canon W202 "The eligibility sweep never auto-applies: it produces a call list, and a human asks the member first"). One sweep per tenant per scheme per IST day (the UNIQUE is the rate limit). The sweep job evaluates the scheme''s eligibility_rules over the tenant''s members through the per-person evaluator (Scheme.evaluate) and writes rows — it never creates a scheme application.';

CREATE TABLE IF NOT EXISTS scheme_eligibility_sweep_rows (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  sweep_id         uuid NOT NULL REFERENCES scheme_eligibility_sweeps(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  eligible         boolean NOT NULL,
  reasons          jsonb NOT NULL DEFAULT '[]',
  inputs           jsonb NOT NULL DEFAULT '{}',
  already_applied  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sesr_sweep_user UNIQUE (sweep_id, user_id)
);
COMMENT ON TABLE scheme_eligibility_sweep_rows IS
  'PC-56 TENANT-SW-b (0198): one member''s verdict in a sweep — eligible + the evaluator''s reasons + which attributes were known (inputs: roles, landholding acres or null, gender known, age known). already_applied = the member already has an application for the scheme. The eligible, not-applied rows ARE the call list.';
CREATE OR REPLACE FUNCTION scheme_sweep_rows_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[SWEEP_APPEND_ONLY] a sweep verdict is never edited or removed — PC-56 TENANT-SW-b' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_sesr_append_only ON scheme_eligibility_sweep_rows;
CREATE TRIGGER trg_sesr_append_only BEFORE UPDATE OR DELETE ON scheme_eligibility_sweep_rows FOR EACH ROW EXECUTE FUNCTION scheme_sweep_rows_append_only();

-- ------------------------------------------------------------------------------------------------------------------
-- RLS + GRANTS for every new table (the 0175 split)
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ambassador_payout_runs', 'ambassador_payout_run_lines', 'ambassador_stipend_payments', 'labour_wage_runs',
                           'labour_wage_run_lines', 'worker_advance_recoveries', 'scheme_eligibility_sweeps', 'scheme_eligibility_sweep_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
  END LOOP;
END $$;
GRANT UPDATE (status, confirmed_by, confirmed_at, confirm_reason, refused_by, refused_at, refuse_reason, last_pay_check, paid_minor, last_paid_at, updated_at) ON ambassador_payout_runs TO kv_app;
GRANT UPDATE (status, shortfall_minor, failure_code, attempts, payout_id, txn_id, paid_at, updated_at) ON ambassador_payout_run_lines TO kv_app;
GRANT UPDATE (status, bookings_considered, line_count, gross_minor, advance_recovery_minor, net_minor, finished_at, updated_at) ON labour_wage_runs TO kv_app;
GRANT UPDATE (payout_id, gross_minor, advance_recovery_minor, net_minor, days_confirmed, status, attempts, next_retry_at, last_error, updated_at) ON labour_wage_run_lines TO kv_app;
GRANT UPDATE (status, members_evaluated, eligible_count, eligible_not_applied, started_at, finished_at, failure, updated_at) ON scheme_eligibility_sweeps TO kv_app;
-- the moving columns of the extended 0187 / 0008 tables
GRANT UPDATE (advanced_minor) ON labour_escrows TO kv_app;
GRANT UPDATE (advance_recovery_minor) ON labour_wage_payouts TO kv_app;
REVOKE ALL ON worker_advances FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON worker_advances TO kv_app;
GRANT UPDATE (status, approved_by, approved_at, approve_reason, consent_id, disbursed_at, disbursal_txn_id, recovered_minor, rejected_by, rejected_at, reject_reason, updated_at, updated_by) ON worker_advances TO kv_app;
GRANT UPDATE (review_status, vouched_by, vouch_reason, vouched_at, confirmed_by, confirmed_at) ON attendance_records TO kv_app;

-- worker_advances keeps its 0014 blanket tenant policy (tenant_id NOT NULL — no NULL-tenant row can exist); make the split explicit anyway
DROP POLICY IF EXISTS tenant_isolation_worker_advances ON worker_advances;
DROP POLICY IF EXISTS worker_advances_read ON worker_advances;
DROP POLICY IF EXISTS worker_advances_insert_own ON worker_advances;
DROP POLICY IF EXISTS worker_advances_update_own ON worker_advances;
DROP POLICY IF EXISTS worker_advances_admin_realm ON worker_advances;
ALTER TABLE worker_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_advances FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_advances_read        ON worker_advances FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY worker_advances_insert_own  ON worker_advances FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY worker_advances_update_own  ON worker_advances FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY worker_advances_admin_realm ON worker_advances FOR ALL TO kv_admin USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 198.7  INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_aprl_run ON ambassador_payout_run_lines (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_aprl_ambassador ON ambassador_payout_run_lines (tenant_id, ambassador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lwr_tenant_recent ON labour_wage_runs (tenant_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_lwrl_run ON labour_wage_run_lines (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS idx_lwrl_retry ON labour_wage_run_lines (tenant_id, next_retry_at) WHERE status = 'retrying';
CREATE INDEX IF NOT EXISTS idx_lwp_manual ON labour_wage_payouts (tenant_id, created_at DESC) WHERE wage_run_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_wa_assignment ON worker_advances (tenant_id, assignment_id) WHERE status IN ('disbursed', 'recovering');
CREATE INDEX IF NOT EXISTS idx_wa_tenant_recent ON worker_advances (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ar_review ON attendance_records (tenant_id, review_status) WHERE NOT confirmed_by_employer;
CREATE INDEX IF NOT EXISTS idx_ses_tenant_scheme ON scheme_eligibility_sweeps (tenant_id, scheme_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ses_queued ON scheme_eligibility_sweeps (tenant_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_sesr_sweep ON scheme_eligibility_sweep_rows (tenant_id, sweep_id, created_at DESC, id DESC);
