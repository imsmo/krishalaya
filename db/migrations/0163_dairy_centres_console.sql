-- ==================================================================================================================
-- MIGRATION 0163 — THE CENTRES: the hours a farmer walks to, and who is holding their milk (PC-56 TENANT-6d-2 · W171)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
--
-- W171: *"3 collection centres · 312 memberships … Operator: Bhavna Ben K. · +91 98••• ••334"*, and its restricted
-- state: *"Centre management needs dairy lead; **operator assignment is recorded (custody of member milk)**."*
--
-- `mcc_centres` has not been altered since 0009. It holds a code, a name, a point, ONE operator column, a capacity and
-- an analyzer — and three of W171's own sentences have nowhere to live:
--
--   • **THE HOURS.** W167 prints *"evening starts 17:00"* and its empty state *"Morning shift opens 06:00"*. TENANT-6a
--     refused to print either (`shiftClockVerdict()` → `not_recorded`, naming `mcc_shift_open_at` /
--     `mcc_shift_close_at`) and 0155 wrote down why: *"a per-centre shift window belongs with the centre (TENANT-6d) —
--     inventing one here would send people to a closed door."* This is that centre. The refusal becomes a window, and
--     the counter board stops refusing in the same wave — a screen that keeps saying "not recorded" after the thing
--     was built is the same defect as one that claims something untrue (TENANT-6c-6's own list).
--
--   • **CUSTODY.** `operator_user_id` is written ONCE, at create, and there is no path that changes it: if Bhavna Ben
--     leaves the village, this platform has no way to record who holds 108 families' milk now. Worse, the create path
--     defaults the column to `actor.userId` — so a dairy lead who adds three centres silently becomes the recorded
--     custodian of all three, which is precisely the claim W171 says must be *recorded* rather than assumed.
--
--   • **WHOSE OPERATOR.** `operator_user_id uuid REFERENCES users(id)` — and `users` is a PLATFORM-WIDE table (0003:
--     `phone varchar(20) UNIQUE`, no tenant column; a person's tenants live in `user_tenant_roles`). So the column
--     accepts ANY user on the platform, including one who belongs only to another cooperative. Nothing today would
--     notice, and the console this wave builds joins that row to print a name and a phone number: a cross-tenant PII
--     leak reached by writing a uuid into a custody field. That is Law 1 with a foreign key standing in for tenancy,
--     and 163.4 closes it in the database rather than only in the service that happens to be in front of it.
--
-- WHAT THIS MIGRATION REFUSES TO INVENT
--   • **A CENTRE'S OWN TIMEZONE.** The shift window is a LOCAL wall clock (`time`), read in the cooperative's own zone
--     exactly as 0157 resolves it (`tenants.country_code → countries.timezone`; there is still no per-tenant timezone
--     column on this platform, and there is certainly no per-centre one). A cooperative whose centres straddle a
--     timezone is a real thing and this is not it — named, not faked.
--   • **A SHIFT THAT CROSSES MIDNIGHT.** `ck_mcc_shift_*` requires close > open. A milk shift is a few hours in the
--     morning and a few in the evening; a window that wrapped past midnight would make "is the centre open now?" a
--     question with two answers, and the honest response to an operator who needs one is a refusal at write time.
--   • **A HISTORY OF SHIFT WINDOWS.** When a cooperative moves its evening shift an hour later, the old hours are
--     gone. Every existing pour keeps its own `shift` label and `collected_on` date, so no past record is re-judged —
--     but "what time did this centre open in June?" is unanswerable, and the read-model says so rather than implying
--     today's window applied then.
--   • **A MEMBERSHIP TRANSFER.** *"Moving house? The membership moves centres without losing history"* is W171's
--     other half and is TENANT-6d-3, because doing it safely means fixing a read that already exists: TENANT-6c-6's
--     bill register prints a centre from `dairy_memberships.mcc_id` — the membership's CURRENT centre — beside a bill
--     for a fortnight that closed months ago. Today no membership can move, so nothing is wrong; the moment one can,
--     every historical row silently re-attributes. Building the move without that fix would CREATE the defect.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 163.1  THE HOURS (the thing TENANT-6a named and refused to invent)
-- ------------------------------------------------------------------------------------------------------------------
-- Two shifts, because `milk_shift` (0009) is an ENUM of exactly two labels — 'morning' and 'evening' — and each has an
-- open and a close. TENANT-6a's refusal named two columns (`mcc_shift_open_at`, `mcc_shift_close_at`); two are not
-- enough, and shipping two would have printed the morning's hours over the evening queue.
--
-- ALL FOUR ARE NULLABLE, and null means UNRECORDED rather than closed. A cooperative that has never told this platform
-- its hours must not have a default invented for it (Law 6): 06:00 is the canon's number for one FPO in Gujarat, and a
-- centre in Assam printing it because a migration chose it is the "plausible value sends people to a closed door"
-- failure 0155 refused. The read-model keeps TENANT-6a's refusal for exactly those centres.
ALTER TABLE mcc_centres
  ADD COLUMN IF NOT EXISTS morning_opens_at  time,
  ADD COLUMN IF NOT EXISTS morning_closes_at time,
  ADD COLUMN IF NOT EXISTS evening_opens_at  time,
  ADD COLUMN IF NOT EXISTS evening_closes_at time;

-- A shift is BOTH ends or NEITHER. Half a window ("opens 06:00", closes unknown) is the worst of the three states: it
-- reads as knowledge on a screen and answers nothing an operator needs.
--
-- AND WHOLE MINUTES. `time` carries seconds, a screen prints "06:00", and a centre that stored 06:00:30 would have a
-- displayed opening time thirty seconds earlier than the real one — the same class of quiet inaccuracy 0162 refused
-- when it made temperatures integers in tenths. A shift boundary is a minute on a village noticeboard; the database
-- refuses the precision it cannot print rather than rounding it away at the seam.
ALTER TABLE mcc_centres
  DROP CONSTRAINT IF EXISTS ck_mcc_shift_morning,
  ADD  CONSTRAINT ck_mcc_shift_morning CHECK (
    (morning_opens_at IS NULL AND morning_closes_at IS NULL)
    OR (morning_opens_at IS NOT NULL AND morning_closes_at IS NOT NULL AND morning_closes_at > morning_opens_at
        AND EXTRACT(SECOND FROM morning_opens_at) = 0 AND EXTRACT(SECOND FROM morning_closes_at) = 0)),
  DROP CONSTRAINT IF EXISTS ck_mcc_shift_evening,
  ADD  CONSTRAINT ck_mcc_shift_evening CHECK (
    (evening_opens_at IS NULL AND evening_closes_at IS NULL)
    OR (evening_opens_at IS NOT NULL AND evening_closes_at IS NOT NULL AND evening_closes_at > evening_opens_at
        AND EXTRACT(SECOND FROM evening_opens_at) = 0 AND EXTRACT(SECOND FROM evening_closes_at) = 0));

COMMENT ON COLUMN mcc_centres.morning_opens_at IS
  'PC-56 TENANT-6d-2 (W171/W167): the morning shift''s LOCAL opening time at this centre. A wall clock, read in the '
  'cooperative''s zone via tenants.country_code -> countries.timezone (0157''s ruling: this platform has no per-tenant '
  'timezone column, and none per centre). NULL = never recorded, which is what TENANT-6a''s counter board reports; it '
  'is NOT "closed". No history: a cooperative that moves its hours cannot be asked what they were in June.';

-- ------------------------------------------------------------------------------------------------------------------
-- 163.2  CUSTODY: who is holding 108 families' milk, and since when
-- ------------------------------------------------------------------------------------------------------------------
-- W171 does not say the operator is *stored*; it says the assignment is **recorded**. Those are different tables. A
-- column answers "who is the operator" and destroys the previous answer; milk that went missing in June is a question
-- about who held the centre THEN, and a cooperative that cannot answer it has no custody record at all — it has a
-- current value.
--
-- Deliberately its own table rather than an audit_log read: `audit_log` is a trail for humans reviewing actions and is
-- not a queryable custody register (it holds a jsonb newValue, it is not constrained to one open holder, and nothing
-- stops two rows claiming the same instant). Custody is a state with a shape, so it gets a shape.
CREATE TABLE IF NOT EXISTS mcc_operator_assignments (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  mcc_id           uuid NOT NULL REFERENCES mcc_centres(id),
  operator_user_id uuid NOT NULL REFERENCES users(id),

  -- WHEN custody began, as an instant. Not a date: a handover happens at a shift boundary, and "which of these two
  -- people was holding the tank at 17:30" is the question this table exists to answer.
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid REFERENCES users(id),

  -- OPEN while null. Custody ends when the next person takes it, or when the cooperative says nobody holds it.
  ended_at         timestamptz,
  ended_by         uuid REFERENCES users(id),

  -- Why. A handover with no reason is the row nobody can interpret two years later, and W171's own copy is about the
  -- assignment being *recorded* — a record without its reason records half the thing. Free text, because "she moved to
  -- Rajkot" is not a value a lookup table can hold.
  reason           varchar(300),

  CONSTRAINT ck_mcc_custody_window CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  -- Closing a custody row names who closed it. Same rule as 0162's compressor claim: a stamped state with no author
  -- is a state nobody can be asked about.
  CONSTRAINT ck_mcc_custody_ended CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CALL add_std_columns('mcc_operator_assignments');

-- ONE open holder per centre. A partial unique index and not a plain one: the whole point is that custody is
-- exclusive at any instant, and two open rows would let the console print either name depending on the sort.
--
-- `deleted_at IS NULL` is inside the predicate for the reason TENANT-6c-4 learned the hard way — except here the key
-- has NO nullable column in it (tenant_id and mcc_id are both NOT NULL), so the index constrains every row it covers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcc_custody_open
  ON mcc_operator_assignments (tenant_id, mcc_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

-- The custody register for one centre, newest first — the console's "since" and the history behind it.
CREATE INDEX IF NOT EXISTS idx_mcc_custody_centre
  ON mcc_operator_assignments (tenant_id, mcc_id, assigned_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE mcc_operator_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcc_operator_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_mcc_operator_assignments ON mcc_operator_assignments;
CREATE POLICY tenant_isolation_mcc_operator_assignments ON mcc_operator_assignments
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0157's finding, applied from the start: ALTER DEFAULT PRIVILEGES grants kv_app INSERT+SELECT+UPDATE and kv_relay
-- INSERT+SELECT+UPDATE+DELETE on every new table at CREATE TABLE time, and a table-level UPDATE supersedes every
-- column grant. REVOKE first or the narrowing is decoration.
REVOKE UPDATE, DELETE ON mcc_operator_assignments FROM kv_app;
REVOKE ALL ON mcc_operator_assignments FROM kv_relay;
GRANT SELECT, INSERT ON mcc_operator_assignments TO kv_app;
-- WHO HELD THE MILK, AND WHEN, IS APPEND-ONLY. A handover is a new row; the only thing that moves on an existing row
-- is its ENDING, because custody that never closes would show two holders the moment the next one starts. Nothing can
-- rewrite `operator_user_id`, `assigned_at`, `assigned_by` or `reason` — a custody register whose past is editable is
-- a register that cannot answer the one question it exists for.
GRANT UPDATE (ended_at, ended_by, updated_at, updated_by) ON mcc_operator_assignments TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 163.3  THE BACKFILL — every centre that already names an operator gets a custody row
-- ------------------------------------------------------------------------------------------------------------------
-- Without this, the console would show a custodian whose custody has no beginning: "Bhavna Ben K., since —". The
-- honest start instant is the centre's own `created_at`, because that is when the column was written, and the honest
-- author is the centre's `created_by`. The reason says exactly where the row came from, so nobody reads it as a
-- handover that happened.
--
-- Only centres whose operator is a user WITH AN ACTIVE ROLE IN THAT TENANT are backfilled — 163.4's gate is added
-- straight after this, and a backfill that wrote rows the gate then rejects would leave the table in a state the
-- migration itself could not reproduce. A centre whose stored operator fails the gate keeps NO custody row and the
-- console reports the operator as unverified, which is the truth about it.
INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, assigned_at, assigned_by, reason, created_by)
SELECT c.tenant_id, c.id, c.operator_user_id, c.created_at, c.created_by,
       'backfilled by migration 0163 from mcc_centres.operator_user_id (custody before this wave was a column, not a record)',
       c.created_by
  FROM mcc_centres c
 WHERE c.operator_user_id IS NOT NULL
   AND c.deleted_at IS NULL
   AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                WHERE utr.user_id = c.operator_user_id AND utr.tenant_id = c.tenant_id
                  AND utr.is_active AND utr.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM mcc_operator_assignments a
                    WHERE a.mcc_id = c.id AND a.ended_at IS NULL AND a.deleted_at IS NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 163.4  THE TENANT GATE — an operator must belong to the cooperative whose milk they hold
-- ------------------------------------------------------------------------------------------------------------------
-- `users` is platform-wide, so a foreign key to it says nothing about tenancy (Law 1: RLS is the net, not the plan —
-- and RLS on `mcc_centres` cannot check a column that points OUT of the tenant). A composite foreign key is not
-- available either: the tenancy fact lives in `user_tenant_roles`, whose unique key is (user_id, tenant_id, role_id)
-- because one person holds several roles — so there is no (user_id, tenant_id) key to reference.
--
-- That leaves a trigger, which is how this codebase already enforces cross-table money rules (0114's payout batch
-- gate). It fires on the two places a custody claim can be written.
-- One function for both tables because both carry the same two columns (`operator_user_id`, `tenant_id`) and the rule
-- is one rule. Two copies of a tenancy check is how the two come to disagree.
CREATE OR REPLACE FUNCTION assert_mcc_operator_in_tenant() RETURNS trigger AS $$
BEGIN
  IF NEW.operator_user_id IS NULL THEN
    RETURN NEW;                      -- a centre with no operator named is a real state (nobody holds it yet)
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_tenant_roles utr
                  WHERE utr.user_id = NEW.operator_user_id AND utr.tenant_id = NEW.tenant_id
                    AND utr.is_active AND utr.deleted_at IS NULL) THEN
    RAISE EXCEPTION
      'mcc operator % holds no active role in tenant % — custody of member milk cannot be assigned across tenants (migration 0163)',
      NEW.operator_user_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION assert_mcc_operator_in_tenant() IS
  'PC-56 TENANT-6d-2: refuses an MCC operator who has no active role in the centre''s own tenant. users is a '
  'platform-wide table (0003), so REFERENCES users(id) is not a tenancy check; without this, writing another '
  'cooperative''s user id into a custody field makes the centres console print that person''s name and phone.';

DROP TRIGGER IF EXISTS trg_mcc_operator_in_tenant ON mcc_centres;
CREATE TRIGGER trg_mcc_operator_in_tenant
  BEFORE INSERT OR UPDATE OF operator_user_id ON mcc_centres
  FOR EACH ROW
  EXECUTE FUNCTION assert_mcc_operator_in_tenant();

DROP TRIGGER IF EXISTS trg_mcc_custody_in_tenant ON mcc_operator_assignments;
CREATE TRIGGER trg_mcc_custody_in_tenant
  BEFORE INSERT OR UPDATE OF operator_user_id ON mcc_operator_assignments
  FOR EACH ROW
  EXECUTE FUNCTION assert_mcc_operator_in_tenant();

-- ------------------------------------------------------------------------------------------------------------------
-- 163.5  THE READS THIS CONSOLE MAKES
-- ------------------------------------------------------------------------------------------------------------------
-- W171's board is one row per centre with a member COUNT ("108", "104", "100") and a footer that reconciles them
-- against the total ("3 centres · 312 memberships total"). That is a count per mcc_id over active memberships, and
-- `dairy_memberships` has no index on it: 0135 added one on `farmer_user_id` for the farmer-360 read and nothing on
-- the centre. At 312 memberships a scan is free; at a federation's 40,000 it is the whole table on every page load.
CREATE INDEX IF NOT EXISTS idx_dairy_memberships_mcc
  ON dairy_memberships (tenant_id, mcc_id)
  WHERE is_active AND deleted_at IS NULL;

-- The preference mix ("weekly 214 · fortnightly 64 · monthly 22 · daily 12"), which is a grouped count over the same
-- rows. Partial on the same predicate so the two reads share it.
CREATE INDEX IF NOT EXISTS idx_dairy_memberships_cycle
  ON dairy_memberships (tenant_id, payment_cycle)
  WHERE is_active AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 163.5b  THE RELAY TIER HAS NO BUSINESS HOLDING CUSTODY
-- ------------------------------------------------------------------------------------------------------------------
-- `mcc_centres` and `dairy_memberships` predate 0079's privilege sweep and were never touched by it: they are not
-- money-bearing, so they were not on that list. But `kv_relay` is `NOLOGIN BYPASSRLS` (0018) and holds
-- INSERT+UPDATE+DELETE on both by default — which, from this wave onwards, means the worker tier can reassign custody
-- of 108 families' milk and re-route a membership to another centre, without RLS in the way.
--
-- Nothing needs it. `grep -rln 'mcc_centres|dairy_memberships|MccCentreRepository|DairyMembershipRepository'` across
-- every `jobs/` and `events/handlers/` directory and the whole worker app returns NOTHING: the only writers are the
-- two request-tier services, which connect as `kv_app`. So the relay keeps SELECT (a future handler that needs to
-- READ a centre's name for a notification is a real thing) and nothing else.
--
-- The tenant gate above is what actually protects a BYPASSRLS role: a trigger fires for every role, and 163.4's does
-- not consult `current_tenant_id()`. Privileges narrow the blast radius; the trigger is the rule.
REVOKE INSERT, UPDATE, DELETE ON mcc_centres FROM kv_relay;
REVOKE INSERT, UPDATE, DELETE ON dairy_memberships FROM kv_relay;
GRANT SELECT ON mcc_centres, dairy_memberships TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 163.6  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_centres_console',
   'PC-56 TENANT-6d-2 (W171): the MCC centres board - every centre with its operator (custody, not a column), its '
   'recorded shift hours, its member count reconciled against the tenant total, its tank''s current condition, and '
   'the membership preference mix told from the cycles that actually exist. OFF means the dairy sub-nav''s Centres '
   'entry stays unbuilt and the only way to create a centre is the legacy operator console, which is where TENANT-6a '
   'left it. The counter board''s shift hours do NOT depend on this flag: a centre that has recorded its hours should '
   'print them whether or not this screen is switched on.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 163.7  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • It does not move a membership between centres (TENANT-6d-3, with the historical-attribution fix that has to
--     come with it).
--   • It does not record a shift window's history, so "what were the hours in June" stays unanswerable.
--   • It does not give a centre a second operator, a relief operator or a shift-level operator. Custody is exclusive
--     at an instant because that is what "who is holding the milk" means; a centre that really runs two operators on
--     two shifts needs a shift dimension on the custody row, and inventing one for a screen that shows a single name
--     would be a column nothing writes.
--   • It does not touch `mcc_centres.capacity_litres_shift` or the analyzer columns. W171 prints them and they are
--     already real (TENANT-6a's desk prints the analyzer's model and serial from here).
--   • It does not add a `dairy.lead` permission. W171's restricted state says *"centre management needs dairy lead"*,
--     and `dairy.manage` IS the dairy desk's verb (0004, narrowed in 0159). TENANT-6c-3's ruling stands: a second key
--     meaning the same thing is an access review nobody completes. What custody gets instead is a RECORD.
