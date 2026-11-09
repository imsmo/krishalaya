-- ==================================================================================================================
-- MIGRATION 0236 — PC-56 HOTFIX-13 · NOBODY SPENDS HER MONEY OR READS HER ANIMAL'S RECORD BUT HER — a machine hire
-- learns WHETHER THE RENTER CONFIRMED THE HOURS, WHO confirmed them and WHEN; the database refuses a confirmation by
-- anyone but the row's renter in her own session, refuses a settled hire that took more than the deposit without her
-- confirmation, and freezes the hours and the bill once she has confirmed them. Two columns, three CHECKs, one trigger,
-- three comments; no grant, no policy, no flag, no new table, no backfill.
-- (Founder decision Q1-A, 2026-11-09, answered by the founder himself: `05_OPS.md` "OPS-4 SPLIT"; `survey_ops4.md` §2
-- F-1/F-2/F-3, §3 OPS4-B1, §5 item 1 — "nothing beyond the deposit leaves the renter's wallet until she confirms the
-- hours herself, in her own session. Until then, the owner can be paid only from the deposit." Brief
-- `wave-reports/brief_hotfix13.md` §D/§E.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0235 are applied; nothing here edits them. 0010's
-- `equipment_bookings` table and `rental_status` enum, 0079's grants on it, and 0192's `kv_session_user()` are REUSED
-- UNCHANGED; 0233's NULL-tolerant CHECK shape, 0234's guard-trigger shape — the admin realm by `kv_admin` or
-- `pg_roles.rolsuper` (the 0203 rule), the session person by `kv_session_user()` — and 0188's NOT VALID + conditional
-- VALIDATE are copied.)
--
-- CLASS — MONEY PATH (Law 2/3; Law 9 / KRISHALAYA_DEV_CONTRACT.md §8 "a payment code path … always founder-reviewed
-- before merge"): this file moves NO rupee; it decides WHEN a hire may take more than the deposit from the renter's
-- wallet (only after HER confirmation). No ledger table, no wallet account and no posting is touched; the one money
-- column read (`total_minor` against `advance_minor`) is only compared, never written. CODEOWNERS; the founder's Law 9
-- review of every line stands before merge, in the REFUSING direction only.
--
-- ==================================================================================================================
--
-- WHY. Until this file the hours that set a hire bill were typed by the machine's owner alone (`complete`), and the
-- owner alone pressed settle, which took everything above the deposit straight from the renter's wallet
-- (`order_payment`, renter → owner) — she was never asked to agree the hours, not told, and could not dispute
-- (survey F-1, C-6). Nothing in the row could say whether she had agreed.
--
-- WHAT EXISTS AFTER THIS FILE
--   236.1  equipment_bookings.usage_confirmed_by uuid → users(id), usage_confirmed_at timestamptz — the renter's own
--          confirmation of the hours recorded by the owner (`POST /v1/equipment/rentals/:id/confirm-usage`).
--   236.2  THE RULE AS A ROW FACT:
--          ck_eqbook_usage_confirmed_by_renter  usage_confirmed_by IS NULL OR usage_confirmed_by = renter_user_id
--            — only the row's renter can be the person who confirmed.
--          ck_eqbook_usage_confirm_stamp        (usage_confirmed_by IS NULL) = (usage_confirmed_at IS NULL)
--            — a confirmation names both the person and the instant, or neither (stricter than the brief; added
--              because a time without a person, or a person without a time, is not a confirmation).
--          ck_eqbook_settled_shortfall_confirmed status <> 'settled' OR (total_minor IS NOT NULL AND total_minor <=
--              advance_minor) OR usage_confirmed_by IS NOT NULL
--            — a settled hire either took no more than the deposit, or she confirmed the hours. The brief's
--              `total_minor <= advance_minor` is made strict on one side: with a NULL total `NULL <= x` is NULL and a
--              CHECK passes NULL, so a settled row with no total could otherwise escape the rule.
--            Added NOT VALID and VALIDATED in the same file when no existing row breaks it (the 0188 shape): there is
--            no production database, but a fixture database may hold hires settled under the old rule; on such a
--            database the constraint enforces every future write and a NOTICE names the count — those settlements
--            happened, and rewriting or deleting them is not this file's decision.
--   236.3  equipment_bookings_hf13_guard (BEFORE INSERT OR UPDATE, outside the admin realm):
--          INSERT  a hire is born unconfirmed (no `usage_confirmed_by`, no `usage_confirmed_at`).
--          UPDATE  CONFIRMING (an unconfirmed row gaining its stamp): the confirmer is the person in THIS session
--                  (`kv_session_user()` — a session with no person cannot confirm), that person is the row's renter,
--                  the row was and stays `completed`, and the hours and the bill do not move in the same statement
--                  (she confirms the hours as they stand).
--                  A CONFIRMED ROW: the confirmation is never cleared or re-stamped, and the renter, the machine
--                  (`asset_id` — the owner who is paid is the machine's owner, 0010), the rate, the deposit, the hours
--                  (`actual_quantity`) and the bill (`total_minor`) never move again. (The brief names the hours and
--                  the bill; the renter, the machine, the rate and the deposit are frozen too because each changes who
--                  pays, who is paid, or how much is taken beyond the deposit. Refusing direction.)
--          The ADMIN REALM (kv_admin, or a superuser as pg_roles knows one — the 0203 rule) is exempt, exactly as
--          0234's guard is: an operator repairing data by hand, a migration, and the test harness's own fixtures.
--   236.4  COMMENTs naming the founder decision on each new column and on the table.
--
-- NO GRANT: kv_app already holds TABLE-level INSERT + UPDATE on equipment_bookings and no DELETE; kv_relay holds nothing
-- on it (0079:291-318), which covers the new columns. The live spec pins that kv_app cannot confirm as the owner
-- (CHECK / trigger) nor settle a shortfall unconfirmed (CHECK).
-- NO POLICY / NO NEW TABLE: adding columns needs no RLS change, so the RLS gate count is UNCHANGED (asserted in QA).
-- NO FLAG (Law 10 reasoning, the HOTFIX precedents): a refusal on a money path is not a feature; a kill-switch on it
-- would be a switch that re-opens the door. The whole module still sits behind `equipment` OFF (seed 0009_feature_flags).
-- NO NOTIFICATION (brief §D, survey F-12): nobody is told anything in this hotfix; the notice words are proposed to the
-- founder in the wave report.
-- NOTHING ON THE PARTNER AXIS (kv_partner, current_partner_id(), the partner definers) is touched.
--
-- OWNER: plain DDL on a tenant table; the guard is SECURITY INVOKER and reads nothing but the row and the session.
--
-- SHARDS: equipment_bookings carries tenant_id and lives on that tenant's shard; the columns, CHECKs and trigger are
-- per-row facts, so every shard runs this file unchanged and no cross-shard read exists.
--
-- REVERSAL (hand-run, never by the runner; revert the API's HOTFIX-13 code in modules/equipment FIRST — the service and
-- the repository read and write these columns, and settle refuses a shortfall without them):
--   DROP TRIGGER IF EXISTS equipment_bookings_hf13_guard ON equipment_bookings;
--   DROP FUNCTION IF EXISTS equipment_bookings_hf13_guard();
--   ALTER TABLE equipment_bookings
--     DROP CONSTRAINT IF EXISTS ck_eqbook_settled_shortfall_confirmed,
--     DROP CONSTRAINT IF EXISTS ck_eqbook_usage_confirm_stamp,
--     DROP CONSTRAINT IF EXISTS ck_eqbook_usage_confirmed_by_renter,
--     DROP COLUMN IF EXISTS usage_confirmed_at,
--     DROP COLUMN IF EXISTS usage_confirmed_by;
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 236.1  HER CONFIRMATION OF THE HOURS: who, and when
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE equipment_bookings
  ADD COLUMN IF NOT EXISTS usage_confirmed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS usage_confirmed_at timestamptz;

-- ------------------------------------------------------------------------------------------------------------------
-- 236.2  THE RULE, IN THE DATABASE (founder Q1-A)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE equipment_bookings DROP CONSTRAINT IF EXISTS ck_eqbook_usage_confirmed_by_renter;
ALTER TABLE equipment_bookings ADD CONSTRAINT ck_eqbook_usage_confirmed_by_renter
  CHECK (usage_confirmed_by IS NULL OR usage_confirmed_by = renter_user_id);

ALTER TABLE equipment_bookings DROP CONSTRAINT IF EXISTS ck_eqbook_usage_confirm_stamp;
ALTER TABLE equipment_bookings ADD CONSTRAINT ck_eqbook_usage_confirm_stamp
  CHECK ((usage_confirmed_by IS NULL) = (usage_confirmed_at IS NULL));

ALTER TABLE equipment_bookings DROP CONSTRAINT IF EXISTS ck_eqbook_settled_shortfall_confirmed;
ALTER TABLE equipment_bookings ADD CONSTRAINT ck_eqbook_settled_shortfall_confirmed
  CHECK (status <> 'settled' OR (total_minor IS NOT NULL AND total_minor <= advance_minor) OR usage_confirmed_by IS NOT NULL) NOT VALID;
DO $$
DECLARE settled_before int;
BEGIN
  SELECT count(*) INTO settled_before FROM equipment_bookings
   WHERE status = 'settled' AND NOT (total_minor IS NOT NULL AND total_minor <= advance_minor) AND usage_confirmed_by IS NULL;
  IF settled_before = 0 THEN
    ALTER TABLE equipment_bookings VALIDATE CONSTRAINT ck_eqbook_settled_shortfall_confirmed;
  ELSE
    RAISE NOTICE 'MIGRATION 0236: % hire(s) were settled for more than the deposit before this rule, without the renter''s confirmation (none can exist in production). ck_eqbook_settled_shortfall_confirmed stays NOT VALID here: it refuses every future write, and those past settlements are left as they happened.', settled_before;
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 236.3  THE GUARD — only the renter, in her own session, confirms; a confirmed hire's hours and bill are frozen
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION equipment_bookings_hf13_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  me    uuid := kv_session_user();
  realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);
BEGIN
  IF realm THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.usage_confirmed_by IS NOT NULL OR NEW.usage_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a machine hire is born with its hours unconfirmed (0236)' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.usage_confirmed_by IS NULL AND OLD.usage_confirmed_at IS NULL THEN
    IF NEW.usage_confirmed_by IS NOT NULL OR NEW.usage_confirmed_at IS NOT NULL THEN
      IF me IS NULL OR NEW.usage_confirmed_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'machine hire %: the hours are confirmed by the person in this session, in her own session (0236)', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF me IS DISTINCT FROM OLD.renter_user_id OR NEW.renter_user_id IS DISTINCT FROM OLD.renter_user_id THEN
        RAISE EXCEPTION 'machine hire %: only the renter confirms the hours (0236)', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status <> 'completed' OR NEW.status <> 'completed' THEN
        RAISE EXCEPTION 'machine hire %: hours are confirmed on a completed hire only (0236)', OLD.id USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.actual_quantity IS DISTINCT FROM OLD.actual_quantity OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
         OR NEW.rate_minor IS DISTINCT FROM OLD.rate_minor OR NEW.advance_minor IS DISTINCT FROM OLD.advance_minor
         OR NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
        RAISE EXCEPTION 'machine hire %: she confirms the hours as they stand — nothing else moves in the same write (0236)', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- OLD is confirmed: the confirmation is final, and what she confirmed is frozen.
  IF NEW.usage_confirmed_by IS DISTINCT FROM OLD.usage_confirmed_by OR NEW.usage_confirmed_at IS DISTINCT FROM OLD.usage_confirmed_at THEN
    RAISE EXCEPTION 'machine hire %: a confirmation of the hours is final (0236)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.actual_quantity IS DISTINCT FROM OLD.actual_quantity OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.rate_minor IS DISTINCT FROM OLD.rate_minor OR NEW.advance_minor IS DISTINCT FROM OLD.advance_minor
     OR NEW.renter_user_id IS DISTINCT FROM OLD.renter_user_id OR NEW.asset_id IS DISTINCT FROM OLD.asset_id THEN
    RAISE EXCEPTION 'machine hire %: the hours, the bill and its parties are frozen once the renter has confirmed them (0236)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS equipment_bookings_hf13_guard ON equipment_bookings;
CREATE TRIGGER equipment_bookings_hf13_guard BEFORE INSERT OR UPDATE ON equipment_bookings
  FOR EACH ROW EXECUTE FUNCTION equipment_bookings_hf13_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 236.4  WHAT EACH COLUMN MEANS
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON TABLE equipment_bookings IS
  'Machine hires (CHC rental, 0010). From PC-56 HOTFIX-13 (0236, founder Q1-A, 2026-11-09): the owner records the hours '
  '(actual_quantity, which sets total_minor); nothing beyond the deposit (advance_minor) leaves the renter''s wallet until '
  'SHE confirms those hours in her own session (usage_confirmed_by/at). Until then the owner can be paid only from the '
  'deposit (ck_eqbook_settled_shortfall_confirmed); a confirmed hire''s hours and bill are frozen (equipment_bookings_hf13_guard).';
COMMENT ON COLUMN equipment_bookings.usage_confirmed_by IS
  'PC-56 HOTFIX-13 (0236, founder Q1-A, 2026-11-09): the renter, who confirmed the hours recorded by the owner, in her own '
  'session. Never anyone else (ck_eqbook_usage_confirmed_by_renter; the guard checks the session person). NULL until she does.';
COMMENT ON COLUMN equipment_bookings.usage_confirmed_at IS
  'PC-56 HOTFIX-13 (0236): when the renter confirmed the hours. Set together with usage_confirmed_by, never alone.';
