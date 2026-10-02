-- ==================================================================================================================
-- MIGRATION 0187 — PC-56 TENANT-11b · LABOUR — A DAY WORKED IS A DAY PAID, AND THE MONEY IS SET ASIDE BEFORE ANYONE TRAVELS
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0008, 0014, 0175, 0186 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISION (brief_t11b.md, 2026-10-02): WAGES ARE ESCROWED AT ROSTER CONFIRM, plus a FLAT ₹20 PLATFORM FEE per
-- booking. The SAME-DAY FAIRNESS FEE is REFUSED BY NAME (the founder has not set its rule) — nothing here models it.
--
-- What the survey proved at d0f4afe (survey_t11.md): `payWages` paid ONE wage unit per accepted worker whatever the days,
-- hours, overtime or attendance — a 3-day ₹420/day job paid ₹420 and a no-show was paid the same (F-5); the attendance
-- cycle it claimed to read could not complete, because clock-out and the employer's confirm matched `created_at` with a
-- millisecond JS Date against a microsecond column (F-6); `attendance_records.wage_payout_id` had no writer; the employer's
-- wallet was touched only at pay, so a worker travelled on a promise (canon W164: "escrowed on confirm"); tenant_admin
-- could post nothing for anyone (F-8) and no consent was recorded for any on-behalf act (F-20); women-only was stored and
-- never checked, transport / meals / toilet were not writable (F-18); `minimum_wages` — the dignity floor for every tenant —
-- was writable by kv_app with no tenant wall (F-22).
--
-- THE MONEY MODEL THIS FILE MAKES RECORDABLE (every move is a balanced, idempotency-keyed WalletPort post):
--   • ROSTER CONFIRM: employer Main −(expected + fee) → employer Hold +expected, platform Fees +fee, key
--     `labour-escrow:<bookingId>`, txn `labour_escrow`. expected = Σ accepted assignments × planned days (per_day) or
--     planned hours (per_hour) or 1 (per_task) × that assignment's rate. fee = the active `labour_fee_rules` row (₹20 flat).
--     An employer whose Main cannot cover it is refused (EMPLOYER_FUNDS_UNAVAILABLE) and NOTHING moves.
--   • PAY RUN: per assignment, Σ CONFIRMED attendance not yet paid: per_day → days × rate; per_hour → regular hours × rate;
--     per_task → rate once, on completion; overtime = OT hours × hourly base × the booking's multiplier (per_day hourly base
--     = rate ÷ daily_hours; per_task prices no overtime). Base: employer Hold −w → worker Main +w, key
--     `wage:<assignmentId>:<sha256(sorted attendance ids)>`, txn `wage_payout`; overtime `wage-ot:<…same…>`. When the
--     escrow cannot cover a run, a TOP-UP employer Main → employer Hold is posted first (`labour-escrow-topup:<bookingId>:<n>`,
--     txn `labour_escrow_topup`); an unfunded top-up pays the base it can and records the rest as awaiting top-up.
--   • RELEASE: the pay run on a COMPLETED booking returns what is left of the escrow — employer Hold → employer Main,
--     `labour-escrow-release:<bookingId>`, txn `labour_escrow_release` — and the booking becomes `paid`. A cancel before
--     start releases the whole escrow the same way; THE PLATFORM FEE IS KEPT (canon is silent; the screen says so).
--   • A booking started before 0187 has no escrow row: its pay run debits the employer's Main directly (the old source),
--     with the corrected amounts. Named, so nobody reads "escrowed" on a booking that never was.
--   The employer's Hold account is POOLED (an auction EMD may sit in it too), so `labour_escrows` is the ledger-of-record
--   for each booking's share: nothing ever debits Hold beyond what that row says the booking still holds.
--
-- WHAT THIS FILE DOES
--   187.1  VOCABULARY — ledger txn types `labour_escrow`, `labour_escrow_topup`, `labour_escrow_release` (also seed core/0005);
--          lookup type `labour_cancel_reason` with the canon's three reasons + `other` (text required — app rule).
--   187.2  `labour_bookings` — the declarations (drinking water, woman supervisor, transport pickup point + time join the
--          0008 transport / meals / toilet columns), the cancel record (reason id + text + who/when), the roster confirm
--          stamp, `on_behalf`; `booking_no` becomes `JOB-<mmdd>-<nn>` per tenant per India day, assigned BY TRIGGER (old
--          `LB-…` values are kept and stay readable).
--   187.3  `labour_fee_rules` — the platform fee as data (one platform row: flat 2000 minor; cap NOT SET).
--   187.4  `labour_escrows` — one row per roster-confirmed booking: expected, fee, top-ups, paid, released, the txns.
--   187.5  `labour_wage_payouts` — one row per (assignment, pay run): the attendance it paid, days / hours, base / OT
--          minor, the txns, and why a row paid 0. `attendance_records.wage_payout_id` points at it.
--   187.6  `labour_consents` — the employer's recorded consent for an act the labour desk performed for them (post,
--          fill, confirm roster, cancel). Append-only.
--   187.7  `minimum_wages` — kv_app keeps SELECT only (F-22).
--   187.8  PERMISSIONS (also seed 0004) — `labour.desk` (tenant_admin, fpo_coordinator), `labour.wages.approve`
--          (tenant_admin).
--   187.9  NOTIFICATION CATALOGUE — `labour.booking_cancelled`, `labour.roster_confirmed` (templates in seed core/0007).
--   187.10 Indexes.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • No same-day fairness fee (founder: rule not set). No crews / crew broadcast, no invite fan-out / radius, no wage-run
--     object (W166, TENANT-SWEEP), no skill-match score, no 7-year retention act.
--   • The `booking_status` enum is unchanged: a roster-confirmed booking uses the existing value `accepted` (the roster
--     is accepted by the employer and the money is held). draft / pending_worker / rejected / disputed / no_show stay
--     unused on a booking.
--
-- RLS DECISION: four new tables. `labour_escrows`, `labour_wage_payouts`, `labour_consents` are tenant tables (tenant_id
-- NOT NULL): ENABLE + FORCE + the 0175 split (SELECT / INSERT WITH CHECK / UPDATE USING + WITH CHECK bound to the tenant,
-- an admin-realm policy TO kv_admin). `labour_fee_rules` carries a NULLABLE tenant_id (NULL = the platform rule): ENABLE +
-- FORCE, SELECT admits the platform row and the tenant's own, and the tenant realm has NO write (kv_app SELECT only) — the
-- exact 0175 shape for platform-authored data. No grant to kv_relay anywhere: the respond-timeout job reads only `tenants`
-- as kv_relay (granted since 0014) and claims bookings per tenant inside kv_app's unit of work.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 187.1  VOCABULARY
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('ledger_txn_type', 'labour_escrow',         'Labour wages escrowed at roster confirm (employer main -> employer hold) + platform fee (-> platform fees)', '{}', 27),
    ('ledger_txn_type', 'labour_escrow_topup',   'Labour escrow top-up for wages beyond the escrow (employer main -> employer hold)', '{}', 28),
    ('ledger_txn_type', 'labour_escrow_release', 'Labour escrow remainder returned on completion or cancel (employer hold -> employer main)', '{}', 29)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable)
VALUES ('labour_cancel_reason', 'Labour job cancel reason', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
    ('labour_cancel_reason', 'rain_reschedule', 'Rain forecast — rescheduling', '{}', 1),
    ('labour_cancel_reason', 'not_needed',      'Work no longer needed',        '{}', 2),
    ('labour_cancel_reason', 'filled_offline',  'Filled offline',               '{}', 3),
    ('labour_cancel_reason', 'other',           'Other (reason written by the employer)', '{"textRequired": true}', 4)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code);

-- ------------------------------------------------------------------------------------------------------------------
-- 187.2  labour_bookings — DECLARATIONS, CANCEL RECORD, ROSTER STAMP, THE JOB NUMBER
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS drinking_water         boolean NOT NULL DEFAULT false;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS woman_supervisor       boolean NOT NULL DEFAULT false;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS transport_pickup_point varchar(150);
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS transport_pickup_time  time;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS village_label          varchar(120);
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS cancel_reason_text     text;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS cancelled_by           uuid REFERENCES users(id);
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS roster_confirmed_at    timestamptz;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS roster_confirmed_by    uuid REFERENCES users(id);
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS on_behalf              boolean NOT NULL DEFAULT false;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS started_at             timestamptz;
ALTER TABLE labour_bookings ADD COLUMN IF NOT EXISTS completed_at           timestamptz;

ALTER TABLE labour_bookings DROP CONSTRAINT IF EXISTS ck_lb_cancel_text;
ALTER TABLE labour_bookings ADD CONSTRAINT ck_lb_cancel_text CHECK (cancel_reason_text IS NULL OR length(cancel_reason_text) BETWEEN 3 AND 300);
ALTER TABLE labour_bookings DROP CONSTRAINT IF EXISTS ck_lb_cancel_whole;
-- A reason is never recorded without the cancellation it explains (rows cancelled before 0187 carry neither).
ALTER TABLE labour_bookings ADD CONSTRAINT ck_lb_cancel_whole CHECK ((cancel_reason_id IS NULL AND cancel_reason_text IS NULL) OR cancelled_at IS NOT NULL);
ALTER TABLE labour_bookings DROP CONSTRAINT IF EXISTS ck_lb_pickup_whole;
ALTER TABLE labour_bookings ADD CONSTRAINT ck_lb_pickup_whole CHECK (transport_pickup_time IS NULL OR transport_pickup_point IS NOT NULL);
ALTER TABLE labour_bookings DROP CONSTRAINT IF EXISTS ck_lb_roster_whole;
ALTER TABLE labour_bookings ADD CONSTRAINT ck_lb_roster_whole CHECK ((roster_confirmed_at IS NULL) = (roster_confirmed_by IS NULL));

COMMENT ON COLUMN labour_bookings.roster_confirmed_at IS
  'PC-56 TENANT-11b (0187, founder decision: escrow at roster confirm): when the employer (or the labour desk with the employer''s recorded consent) confirmed the roster and the wages were moved employer main -> employer hold (labour_escrows). The booking status is then `accepted`; start() requires it.';
COMMENT ON COLUMN labour_bookings.on_behalf IS
  'PC-56 TENANT-11b (0187, F-8 / F-20): the booking was POSTED by the labour desk for the employer, with the employer''s recorded consent (labour_consents act=post). created_by names the desk user. Pay on such a booking needs labour.wages.approve (or the employer themself).';

-- THE JOB NUMBER. `JOB-<mmdd>-<nn>`: the India calendar day the job was posted and its sequence within that tenant (two
-- digits, three past 99). The canon's format carries no year, so the count is per tenant per mmdd ACROSS years — the
-- next year's 13 July continues from this year's last number and a number never repeats. Assigned BY TRIGGER at INSERT
-- (only when the writer did not supply one), serialised per (tenant, mmdd) by a transaction-scoped advisory lock; the
-- unique index is the second wall. Rows written before 0187 keep their `LB-…` number, readable as before.
CREATE OR REPLACE FUNCTION assign_labour_booking_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d      date := ((COALESCE(NEW.created_at, now())) AT TIME ZONE 'Asia/Kolkata')::date;
  prefix text := 'JOB-' || to_char(d, 'MMDD') || '-';
  n      integer;
BEGIN
  IF NEW.booking_no IS NOT NULL AND NEW.booking_no <> '' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('labour_booking_no:' || NEW.tenant_id::text || ':' || prefix));
  SELECT COALESCE(max(substring(booking_no FROM length(prefix) + 1)::integer), 0) + 1 INTO n
    FROM labour_bookings
   WHERE tenant_id = NEW.tenant_id AND booking_no LIKE prefix || '%' AND substring(booking_no FROM length(prefix) + 1) ~ '^[0-9]+$';
  NEW.booking_no := prefix || lpad(n::text, 2, '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lb_assign_no ON labour_bookings;
CREATE TRIGGER trg_lb_assign_no BEFORE INSERT ON labour_bookings FOR EACH ROW EXECUTE FUNCTION assign_labour_booking_no();
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_tenant_no ON labour_bookings (tenant_id, booking_no);

-- ------------------------------------------------------------------------------------------------------------------
-- 187.3  labour_fee_rules — THE PLATFORM FEE, AS DATA
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_fee_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid REFERENCES tenants(id),              -- NULL = the platform rule
  code            varchar(40) NOT NULL,
  kind            varchar(20) NOT NULL CHECK (kind IN ('flat_per_booking')),
  amount_minor    bigint NOT NULL CHECK (amount_minor >= 0),
  cap_minor       bigint CHECK (cap_minor IS NULL OR cap_minor >= 0),
  cap_rule_note   text NOT NULL,
  effective_from  date NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lfr UNIQUE NULLS NOT DISTINCT (tenant_id, code, effective_from)
);
COMMENT ON TABLE labour_fee_rules IS
  'PC-56 TENANT-11b (0187, founder decision): the labour platform fee per booking, charged once at roster confirm into platform Fees. One platform row (tenant_id NULL): flat 2000 minor (₹20). The canon''s "₹100 cap rule" names no cap amount or trigger, so cap_minor is NULL and the console prints the cap rule as "not set".';

INSERT INTO labour_fee_rules (tenant_id, code, kind, amount_minor, cap_minor, cap_rule_note, effective_from, is_active)
VALUES (NULL, 'platform_flat', 'flat_per_booking', 2000, NULL,
        'Canon W164 says "flat ₹20 per booking · ₹100 cap rule" and states no cap amount, base or trigger; no cap is applied until the founder sets one.',
        DATE '2026-01-01', true)
ON CONFLICT ON CONSTRAINT uq_lfr DO NOTHING;

ALTER TABLE labour_fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_fee_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lfr_read ON labour_fee_rules;
DROP POLICY IF EXISTS lfr_admin_realm ON labour_fee_rules;
CREATE POLICY lfr_read        ON labour_fee_rules FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY lfr_admin_realm ON labour_fee_rules FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON labour_fee_rules FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON labour_fee_rules TO kv_app, kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.4  labour_escrows — WHAT EACH BOOKING HOLDS IN THE EMPLOYER'S (POOLED) HOLD
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_escrows (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  booking_id        uuid NOT NULL UNIQUE REFERENCES labour_bookings(id),
  employer_user_id  uuid NOT NULL REFERENCES users(id),
  expected_minor    bigint NOT NULL CHECK (expected_minor > 0),
  fee_minor         bigint NOT NULL CHECK (fee_minor >= 0),
  fee_rule_id       uuid REFERENCES labour_fee_rules(id),
  escrow_txn_id     uuid NOT NULL,
  topped_up_minor   bigint NOT NULL DEFAULT 0 CHECK (topped_up_minor >= 0),
  topup_count       integer NOT NULL DEFAULT 0 CHECK (topup_count >= 0),
  paid_minor        bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  released_minor    bigint NOT NULL DEFAULT 0 CHECK (released_minor >= 0),
  release_txn_id    uuid,
  status            varchar(10) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released')),
  release_reason    varchar(12) CHECK (release_reason IS NULL OR release_reason IN ('completed', 'cancelled')),
  released_at       timestamptz,
  confirmed_by      uuid NOT NULL REFERENCES users(id),
  on_behalf         boolean NOT NULL DEFAULT false,
  consent_id        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_le_conserved CHECK (paid_minor + released_minor <= expected_minor + topped_up_minor),
  CONSTRAINT ck_le_release_whole CHECK ((status = 'released') = (released_at IS NOT NULL) AND (status = 'released') = (release_reason IS NOT NULL)),
  CONSTRAINT ck_le_release_txn CHECK (released_minor = 0 OR release_txn_id IS NOT NULL),
  CONSTRAINT ck_le_consent CHECK (NOT on_behalf OR consent_id IS NOT NULL)
);
COMMENT ON TABLE labour_escrows IS
  'PC-56 TENANT-11b (0187, founder decision: escrow at roster confirm + ₹20 fee): one row per roster-confirmed booking. expected = Σ accepted × planned units × rate, moved employer main -> employer hold (labour-escrow:<booking>) with the fee to platform fees. held now = expected + topped_up - paid - released. The employer''s hold is pooled; nothing debits it beyond this row''s held amount.';

-- The money facts of an escrow are FROZEN at INSERT; the counters only grow; a released escrow is final.
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
  IF NEW.topped_up_minor < OLD.topped_up_minor OR NEW.topup_count < OLD.topup_count OR NEW.paid_minor < OLD.paid_minor OR NEW.released_minor < OLD.released_minor THEN
    RAISE EXCEPTION 'labour_escrows: escrow % counters only grow', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'released' AND (NEW.status <> OLD.status OR NEW.paid_minor <> OLD.paid_minor OR NEW.released_minor <> OLD.released_minor
     OR NEW.topped_up_minor <> OLD.topped_up_minor OR NEW.release_txn_id IS DISTINCT FROM OLD.release_txn_id) THEN
    RAISE EXCEPTION 'labour_escrows: escrow % is already released', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_le_moves ON labour_escrows;
CREATE TRIGGER trg_le_moves BEFORE UPDATE OR DELETE ON labour_escrows FOR EACH ROW EXECUTE FUNCTION assert_labour_escrow_moves();

ALTER TABLE labour_escrows ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_escrows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS le_read ON labour_escrows;
DROP POLICY IF EXISTS le_insert_own ON labour_escrows;
DROP POLICY IF EXISTS le_update_own ON labour_escrows;
DROP POLICY IF EXISTS le_admin_realm ON labour_escrows;
CREATE POLICY le_read        ON labour_escrows FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY le_insert_own  ON labour_escrows FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY le_update_own  ON labour_escrows FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY le_admin_realm ON labour_escrows FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON labour_escrows FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON labour_escrows TO kv_app;
GRANT UPDATE (topped_up_minor, topup_count, paid_minor, released_minor, release_txn_id, status, release_reason, released_at, updated_at) ON labour_escrows TO kv_app;
GRANT SELECT ON labour_escrows TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.5  labour_wage_payouts — ONE ROW PER (ASSIGNMENT, PAY RUN)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_wage_payouts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  booking_id        uuid NOT NULL REFERENCES labour_bookings(id),
  assignment_id     uuid NOT NULL REFERENCES booking_assignments(id),
  worker_id         uuid NOT NULL REFERENCES worker_profiles(id),
  worker_user_id    uuid NOT NULL REFERENCES users(id),
  run_key           char(64) NOT NULL,                        -- sha256 hex of the sorted attendance ids it covers
  wage_kind         varchar(15) NOT NULL CHECK (wage_kind IN ('per_day', 'per_hour', 'per_task')),
  rate_minor        bigint NOT NULL CHECK (rate_minor > 0),
  attendance_ids    uuid[] NOT NULL DEFAULT '{}',
  days_confirmed    integer NOT NULL DEFAULT 0 CHECK (days_confirmed >= 0),
  hours_regular     numeric(8,2) NOT NULL DEFAULT 0,
  hours_overtime    numeric(8,2) NOT NULL DEFAULT 0,
  base_minor        bigint NOT NULL DEFAULT 0 CHECK (base_minor >= 0),
  ot_minor          bigint NOT NULL DEFAULT 0 CHECK (ot_minor >= 0),
  base_txn_id       uuid,
  ot_txn_id         uuid,
  status            varchar(16) NOT NULL CHECK (status IN ('paid', 'partial', 'awaiting_topup', 'zero')),
  ot_status         varchar(16) NOT NULL CHECK (ot_status IN ('none', 'paid', 'awaiting_topup', 'not_priced')),
  source            varchar(14) NOT NULL CHECK (source IN ('escrow', 'employer_main')),
  zero_reason       varchar(40) CHECK (zero_reason IS NULL OR zero_reason IN ('no_confirmed_attendance', 'task_paid_once')),
  paid_by           uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lwp_run UNIQUE (assignment_id, run_key),
  CONSTRAINT ck_lwp_zero CHECK ((status = 'zero') = (zero_reason IS NOT NULL)),
  CONSTRAINT ck_lwp_base_txn CHECK (base_minor = 0 OR status = 'awaiting_topup' OR base_txn_id IS NOT NULL),
  CONSTRAINT ck_lwp_ot_txn CHECK (ot_status <> 'paid' OR ot_txn_id IS NOT NULL)
);
COMMENT ON TABLE labour_wage_payouts IS
  'PC-56 TENANT-11b (0187, F-5): one row per (assignment, pay run). base = confirmed days × rate (per_day) | regular hours × rate (per_hour) | rate once on completion (per_task); OT = OT hours × hourly base × the booking multiplier. Paid escrow hold -> worker main (wage:<assignment>:<run_key>, wage-ot:<…>). A worker with no confirmed attendance gets one zero row saying why. attendance_records.wage_payout_id points here.';

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
DROP TRIGGER IF EXISTS trg_lwp_moves ON labour_wage_payouts;
CREATE TRIGGER trg_lwp_moves BEFORE UPDATE OR DELETE ON labour_wage_payouts FOR EACH ROW EXECUTE FUNCTION assert_labour_wage_payout_moves();

ALTER TABLE labour_wage_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_wage_payouts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lwp_read ON labour_wage_payouts;
DROP POLICY IF EXISTS lwp_insert_own ON labour_wage_payouts;
DROP POLICY IF EXISTS lwp_update_own ON labour_wage_payouts;
DROP POLICY IF EXISTS lwp_admin_realm ON labour_wage_payouts;
CREATE POLICY lwp_read        ON labour_wage_payouts FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY lwp_insert_own  ON labour_wage_payouts FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lwp_update_own  ON labour_wage_payouts FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lwp_admin_realm ON labour_wage_payouts FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON labour_wage_payouts FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON labour_wage_payouts TO kv_app;
GRANT UPDATE (base_txn_id, ot_txn_id, status, ot_status, paid_by, updated_at) ON labour_wage_payouts TO kv_app;
GRANT SELECT ON labour_wage_payouts TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.6  labour_consents — THE EMPLOYER SAID YES, AND HERE IS HOW WE KNOW
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labour_consents (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  booking_id        uuid NOT NULL REFERENCES labour_bookings(id),
  employer_user_id  uuid NOT NULL REFERENCES users(id),
  act               varchar(16) NOT NULL CHECK (act IN ('post', 'fill', 'confirm_roster', 'cancel')),
  channel           varchar(10) NOT NULL CHECK (channel IN ('voice', 'otp', 'written')),
  media_id          uuid,
  note              text CHECK (note IS NULL OR length(note) <= 500),
  recorded_by       uuid NOT NULL REFERENCES users(id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_lc_evidence CHECK (channel = 'otp' OR media_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_lc_booking ON labour_consents (tenant_id, booking_id, act, recorded_at DESC);
COMMENT ON TABLE labour_consents IS
  'PC-56 TENANT-11b (0187, F-8 / F-20): the employer''s recorded consent for an act the labour desk performed for them — posting the job, filling a seat, confirming the roster (which moves their money into escrow), cancelling. A voice or written consent carries its evidence media; an otp consent is the verification itself. Append-only by trigger.';

CREATE OR REPLACE FUNCTION labour_consents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'labour_consents is append-only — a recorded consent is never edited or removed (PC-56 TENANT-11b, 0187)'
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_lc_append_only ON labour_consents;
CREATE TRIGGER trg_lc_append_only BEFORE UPDATE OR DELETE ON labour_consents FOR EACH ROW EXECUTE FUNCTION labour_consents_append_only();
DROP TRIGGER IF EXISTS trg_lc_no_truncate ON labour_consents;
CREATE TRIGGER trg_lc_no_truncate BEFORE TRUNCATE ON labour_consents FOR EACH STATEMENT EXECUTE FUNCTION labour_consents_append_only();

ALTER TABLE labour_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lc_read ON labour_consents;
DROP POLICY IF EXISTS lc_insert_own ON labour_consents;
DROP POLICY IF EXISTS lc_admin_realm ON labour_consents;
CREATE POLICY lc_read        ON labour_consents FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY lc_insert_own  ON labour_consents FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY lc_admin_realm ON labour_consents FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE ALL ON labour_consents FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT ON labour_consents TO kv_app;
GRANT SELECT ON labour_consents TO kv_readonly;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.7  minimum_wages — THE DIGNITY FLOOR IS READ, NEVER WRITTEN, BY THE APP ROLE (F-22)
-- ------------------------------------------------------------------------------------------------------------------
-- No route writes it (survey §0.1; `grep -rn "minimum_wages" apps/api/src` → the read-only repository only). The admin
-- plane / seeds write it. SELECT stays.
REVOKE INSERT, UPDATE, DELETE ON minimum_wages FROM kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.8  PERMISSIONS — rows here AND in seed 0004
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('labour.desk', 'Labour desk: post, fill, confirm the roster of and cancel a job FOR an employer, each with the employer''s recorded consent', 'M28'),
  ('labour.wages.approve', 'Run the wage pay for a desk-run labour job (moves escrowed wages to workers)', 'M28')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (p.code = 'labour.desk' AND r.code IN ('tenant_admin', 'fpo_coordinator'))
    OR (p.code = 'labour.wages.approve' AND r.code = 'tenant_admin')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.9  NOTIFICATION CATALOGUE (templates: seed core/0007, above the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('labour.booking_cancelled', 'A job you accepted was cancelled',              'important', '["push","inapp"]', true, false),
  ('labour.roster_confirmed',  'Your job is confirmed and wages are set aside', 'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 187.10 INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lb_tenant_recent ON labour_bookings (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lb_due_respond ON labour_bookings (respond_by) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_ba_booking ON booking_assignments (tenant_id, booking_id, status);
CREATE INDEX IF NOT EXISTS idx_lwp_booking ON labour_wage_payouts (tenant_id, booking_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_attendance_unpaid ON attendance_records (tenant_id, assignment_id) WHERE confirmed_by_employer AND wage_payout_id IS NULL;
