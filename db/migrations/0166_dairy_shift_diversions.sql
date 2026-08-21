-- ==================================================================================================================
-- MIGRATION 0166 — THE DIVERSION: a shift's milk goes to another village, and the record says so (PC-56 TENANT-6d-6)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
--
-- W170's playbook, step 2: *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers,
-- Gujarati voice)"*, and its timeline: *"evening pours divert to MCC-AND-02 if not recovered by 16:30"*. Its restricted
-- state adds the authority: *"playbook overrides are operator + dairy lead together."*
--
-- TENANT-6d-1 shipped that playbook with every step marked `built: false` — honestly, because a diversion moves 87
-- families to another centre and nothing on this platform could record it. This migration is what recording it needs,
-- and the sweep for what a diversion would BREAK found the defect that makes the wave.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 1. **A POUR'S CENTRE WAS NEVER MEASURED — IT WAS INFERRED FROM THE MEMBER'S ROUTE.**
--
-- `MilkCollectionService.record` stamps `mcc_id: membership.toProps().mccId`. TENANT-6d-3's header says, of exactly
-- this column: *"`milk_collections.mcc_id` (0009) is stamped at the counter from the membership's route AT THAT MOMENT.
-- A pour knows where it happened."* That sentence was TRUE — and it was true only because no pour could ever happen
-- anywhere else. **The diversion is what falsifies it.** Divert Vanthali's evening shift to Bhesan and all 87 pours are
-- stamped VANTHALI: Bhesan's board shows an empty evening it worked through, Vanthali's shows milk it never received,
-- the quality flags name the wrong centre, and TENANT-6d-3's careful repair (a bill's centre comes from its own pours)
-- attributes the whole fortnight to a village the milk did not pass through.
--
-- **AND THERE IS A SECOND, NARROWER BUG IN THE SAME LINE, which the diversion did not cause and this wave fixes.**
-- `record()` reads the membership's CURRENT route while `collected_on` is a PARAMETER. A pour entered on Monday for
-- Saturday's shift, after the member moved on Sunday, is stamped with the NEW centre. TENANT-6d-3 repaired three READS
-- to answer as of the day and left the WRITE reading today — the same defect, on the other side of the seam.
--
-- So: `milk_collections.mcc_id` becomes a MEASURED fact. The counter may name the centre; when it names one that is not
-- the membership's route for that day, the pour is accepted ONLY if a live approved diversion permits it, and the pour
-- carries that diversion's id. Anything else is refused — an operator must not be able to record a member's milk at
-- another village quietly, and a cooperative must be able to answer *"who allowed this?"*.
--
-- ------------------------------------------------------------------------------------------------------------------
-- 2. **AN OVERRIDE NEEDS TWO PEOPLE, AND DAIRY HAD ONLY ONE VERB.**
--
-- W170: *"playbook overrides are operator + dairy lead together."* TENANT-6c-3 built the second signature on the bill
-- cycle and observed, in `db/seeds/core/0004_roles_permissions.sql`, that *"every sibling vertical in this file has two
-- verbs (loan.borrow / loan.manage, insurance.enrol / insurance.manage, contract.grow / contract.manage); dairy has
-- only the manage verb, which is why farmers were given it."* This migration adds dairy's second verb —
-- **`dairy.override`** — rather than borrowing `settlement.close`, which is a MONEY permission a cooperative may
-- reasonably have given to a treasurer who has no business moving a village's milk. Maker ≠ checker is a CHECK
-- constraint as well as a service refusal, exactly as 0159 did it.
--
-- ------------------------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO — 166.7. The member notice is the largest of them: W170's *"route notice to 87
-- pourers, Gujarati voice"* is counted by this wave and SENT by TENANT-6d-7.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 166.1  THE DIVERSION ITSELF
-- ------------------------------------------------------------------------------------------------------------------
-- ONE SHIFT, ONE DAY, ONE PAIR OF CENTRES. Not a date range: a cooperative diverting three days running makes three
-- decisions, each with its own reason and its own two signatures, and a range would let one afternoon's judgement
-- quietly cover a week. W170's own sentence is about the EVENING SHIFT of ONE DAY.
CREATE TABLE IF NOT EXISTS dairy_shift_diversions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  from_mcc_id   uuid NOT NULL REFERENCES mcc_centres(id),
  to_mcc_id     uuid NOT NULL REFERENCES mcc_centres(id),
  diverted_on   date NOT NULL,
  shift         milk_shift NOT NULL,
  -- WHY, in the words of whoever asked for it. Required, because a diversion an auditor cannot explain is a diversion
  -- a cooperative cannot defend — and because W170's own trigger is a temperature that will have changed by morning.
  reason        text NOT NULL,
  requested_by  uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  -- THE SECOND SIGNATURE. Null until the dairy lead agrees; the milk does not move on one person's word.
  approved_by   uuid REFERENCES users(id),
  approved_at   timestamptz,
  cancelled_by  uuid REFERENCES users(id),
  cancelled_at  timestamptz,
  cancel_reason text,
  CONSTRAINT ck_dairy_diversion_not_self CHECK (from_mcc_id <> to_mcc_id),
  -- Both ends or neither, three times over: a half-written approval is a diversion whose authority nobody can read.
  CONSTRAINT ck_dairy_diversion_approved CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CONSTRAINT ck_dairy_diversion_cancelled CHECK ((cancelled_by IS NULL) = (cancelled_at IS NULL)),
  CONSTRAINT ck_dairy_diversion_cancel_reason CHECK ((cancelled_at IS NULL) OR (cancel_reason IS NOT NULL)),
  -- MAKER ≠ CHECKER, in the database. 0159's ruling: the refusal is what an operator reads, and the constraint is what
  -- makes the rule true of the row whatever wrote it.
  CONSTRAINT ck_dairy_diversion_maker_ne_checker CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CALL add_std_columns('dairy_shift_diversions');

-- ONE LIVE DIVERSION PER CENTRE-SHIFT-DAY. A partial unique index rather than a plain one, for the reason 0163 and
-- 0164 both hit: a cancelled diversion is history and must stay, while a second live one would make *"where does this
-- member pour tonight"* a question with two answers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_diversion_live
  ON dairy_shift_diversions (tenant_id, from_mcc_id, diverted_on, shift)
  WHERE cancelled_at IS NULL AND deleted_at IS NULL;

-- The lookup the counter makes on every diverted pour: "is this centre-shift-day diverted, and to where".
CREATE INDEX IF NOT EXISTS idx_dairy_diversion_live
  ON dairy_shift_diversions (tenant_id, diverted_on, shift, from_mcc_id, to_mcc_id)
  WHERE cancelled_at IS NULL AND approved_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE dairy_shift_diversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dairy_shift_diversions ON dairy_shift_diversions;
CREATE POLICY p_dairy_shift_diversions ON dairy_shift_diversions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- APPEND-ONLY EXCEPT ITS TWO ENDINGS. `kv_app` may sign a diversion and cancel it, and may not rewrite what was asked
-- for, by whom, for which shift, or why — the columns an auditor reads to decide whether a village's milk was moved
-- properly. Same shape as 0163's custody register and 0164's route history.
REVOKE UPDATE ON dairy_shift_diversions FROM kv_app;
GRANT UPDATE (approved_by, approved_at, cancelled_by, cancelled_at, cancel_reason, updated_at, updated_by)
  ON dairy_shift_diversions TO kv_app;
REVOKE INSERT, UPDATE, DELETE ON dairy_shift_diversions FROM kv_relay;

COMMENT ON TABLE dairy_shift_diversions IS
  'PC-56 TENANT-6d-6 (W170 playbook step 2): one centre''s shift on one day sent to another centre, requested by an '
  'operator and signed by a dairy lead (dairy.override). A pour recorded away from the member''s route for that day '
  'must name a LIVE APPROVED row here, and carries its id — so milk_collections.mcc_id is a measured fact rather than '
  'an inference from the membership''s current routing.';

-- ------------------------------------------------------------------------------------------------------------------
-- 166.2  THE POUR NAMES THE DIVERSION THAT PERMITTED IT
-- ------------------------------------------------------------------------------------------------------------------
-- NULL means "poured where this member is routed for that day", which is almost every row ever written. A non-null
-- value is the audit trail of an exception: this member's milk was taken at another village, and here is the decision
-- that allowed it.
ALTER TABLE milk_collections
  ADD COLUMN IF NOT EXISTS diversion_id uuid REFERENCES dairy_shift_diversions(id);

CREATE INDEX IF NOT EXISTS idx_milkcoll_diversion
  ON milk_collections (tenant_id, diversion_id) WHERE diversion_id IS NOT NULL;

-- THE TRIGGER, because the service is not the only writer a table gets in five years. A pour that names a diversion
-- must actually MATCH it: same tenant, same day, same shift, and recorded at the centre the milk was sent TO. Without
-- this, a stamped `diversion_id` is decoration — and the one thing this column exists to prove is that the exception
-- was authorised for THIS shift and not for some other evening.
CREATE OR REPLACE FUNCTION assert_collection_diversion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  IF NEW.diversion_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO d FROM dairy_shift_diversions
   WHERE id = NEW.diversion_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'milk_collections.diversion_id % is not a diversion of tenant %', NEW.diversion_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF d.approved_at IS NULL OR d.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'diversion % is not live (approved_at %, cancelled_at %) — a pour may not cite an unsigned or cancelled diversion',
      d.id, d.approved_at, d.cancelled_at USING ERRCODE = 'check_violation';
  END IF;
  IF d.diverted_on <> NEW.collected_on OR d.shift <> NEW.shift OR d.to_mcc_id <> NEW.mcc_id THEN
    RAISE EXCEPTION 'diversion % covers % % to centre %, not % % at centre %',
      d.id, d.diverted_on, d.shift, d.to_mcc_id, NEW.collected_on, NEW.shift, NEW.mcc_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_collection_diversion ON milk_collections;
CREATE TRIGGER trg_collection_diversion
  BEFORE INSERT OR UPDATE OF diversion_id, mcc_id, shift, collected_on ON milk_collections
  FOR EACH ROW EXECUTE FUNCTION assert_collection_diversion();

-- ------------------------------------------------------------------------------------------------------------------
-- 166.3  DAIRY'S SECOND VERB
-- ------------------------------------------------------------------------------------------------------------------
-- The seed states the desired grant matrix for a fresh install; this is what repairs one that has already run. Both are
-- needed and they are not two mechanisms for one fact (0159's own words).
INSERT INTO permissions (code, default_name, module_code)
VALUES ('dairy.override','Approve dairy playbook overrides (divert a shift)','M16')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'dairy.override' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 166.4  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_shift_diversion',
   'PC-56 TENANT-6d-6 (W170 playbook step 2): record a centre''s shift as diverted to another centre - requested by an '
   'operator, signed by a dairy lead - and allow the counter to record a pour at the centre the milk actually reached. '
   'OFF means the playbook step stays marked as not built (where TENANT-6d-1 left it), the routes answer not-found, and '
   'the counter accepts a pour ONLY at the member''s own route for that day. Nothing about the monitor, the alerting or '
   'a member''s money depends on this flag.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 166.5  THE NOTICE'S EVENT (its copy lives in the seed, above the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
-- W170: *"route notice to 87 pourers, Gujarati voice"*. TENANT-6d-6 COUNTS those pourers - from the route history as
-- of the diverted day, because a member who moved last week is not on tonight's list - and says on the confirm screen
-- that they are NOT told by this act. TENANT-6d-7 sends the notice. The event is catalogued HERE so the count and the
-- eventual send name the same thing, and so that a deployment can see what is coming.
--
-- `user_can_opt_out = false`: this is not marketing. A member who is not told that tonight's collection has moved
-- village carries their milk to a locked door.
-- `default_channels` puts `ivr` first because that is the canon's own word (*"Gujarati voice"*) and because the people
-- who need this most are the ones without a smartphone.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('dairy.shift_diverted', 'Collection moved to another centre', 'critical', '["ivr","sms","push"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 166.6  WHAT THE BOARD HAS TO BE ABLE TO SAY
-- ------------------------------------------------------------------------------------------------------------------
-- A diversion makes two of TENANT-6a's numbers disagree ON PURPOSE: the receiving centre takes pours from members who
-- are not on its roll, and the sending centre has a roll with no pours. Before this wave those two figures could only
-- disagree because something was wrong. The read-model now reports both sides of a diversion by name
-- (`divertedIn` / `divertedOut`), so the board explains itself instead of looking broken. No DDL is needed for that -
-- it is a join through this table - and it is recorded here because a reader of 0166 will want to know why a new table
-- changed a two-wave-old screen.

-- ------------------------------------------------------------------------------------------------------------------
-- 166.7  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • **It does not tell the members.** The notice is counted, named on the screen and catalogued above; sending it -
--     with its three channels, its Gujarati voice leg, its recipient resolution through route history and its delivery
--     report - is TENANT-6d-7. A diversion recorded but unannounced is still worth recording: the cooperative made the
--     decision by loudspeaker and phone tree, and this is the platform finally able to say where the milk went.
--   • **It does not move the memberships.** A diversion is NOT a transfer: the member's route, card and history are
--     untouched (TENANT-6d-3's table is not written by this act), because they still belong to Vanthali and will pour
--     there tomorrow morning. Anything else would rewrite a family's record for one warm evening.
--   • **It does not advance the union pickup.** W170's playbook step 3 - *"dairy-union pickup advanced; batch tested
--     before pooling"* - has no entity on this platform: no union, no pickup, no batch test. It stays `built: false`
--     and the screen keeps saying so.
--   • **It does not fire itself.** The playbook SUGGESTS a diversion at the tenant's own threshold; a human requests it
--     and another human signs it. An automatic diversion would move 87 families' evening on a sensor reading, and W170
--     itself says the overrides are two people together.
--   • **It does not backdate.** A diversion may be recorded for today or a future shift, never for a day whose pours
--     are already in - that would retro-authorise an attribution nobody agreed to at the time. The service refuses it;
--     the reason is that an audit trail whose authority arrives after the act is not an audit trail.
