-- ==================================================================================================================
-- MIGRATION 0164 — THE MOVE: a membership's route becomes a history (PC-56 TENANT-6d-3 · W171)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
--
-- W171: *"A membership is a route + a card + a cycle preference. Moving house? The membership moves centres without
-- losing history — the member_code changes, the person's record never resets."*
--
-- TENANT-6d-2 built the centres board and deliberately shipped NO transfer button, because the move is the easy half.
-- The hard half is the sentence's own promise: *without losing history.* A sweep of every read that attributes a fact
-- to a centre or to a card found three that would start lying the moment a membership could move, and three that are
-- already safe — and the difference between the two groups is the whole design of this migration.
--
-- ALREADY SAFE, BECAUSE THE FACT CARRIES ITS OWN ATTRIBUTION
--   • `milk_collections.mcc_id` (0009) is stamped at the counter from the membership's route AT THAT MOMENT. A pour
--     knows where it happened.
--   • `milk_quality_reviews.mcc_id` (0156) likewise.
--   • The farmer-360 income tile, the member-detail dairy tile and the co-op patronage basis all join
--     `dairy_memberships` only to reach `farmer_user_id` — the PERSON, which a move does not change. That is the
--     canon's *"the person's record never resets"*, already true.
--
-- WOULD START LYING — the three this migration exists for
--   1. **THE CYCLE REGISTER** (TENANT-6c-6): `SELECT m.member_code, mc.code AS mcc_code … JOIN dairy_memberships m ON
--      m.id = b.membership_id LEFT JOIN mcc_centres mc ON mc.id = m.mcc_id`. `milk_bills` HAS NO CENTRE COLUMN AT ALL
--      (0009), so a bill's centre is read from wherever the member is routed TODAY. The first transfer silently
--      re-attributes every fortnight that has already closed — and a fortnight in which a member moved was poured at
--      two centres, so no single stored value would have been right either.
--   2. **THE QUALITY DESK's `reviewContext`**: the centre comes from the review row (correct) and the member_code from
--      the membership now. A flag from June would print the card the member was given in August.
--   3. **THE COUNTER BOARD's per-centre roll**: `SELECT mcc_id, count(*) FROM dairy_memberships … GROUP BY mcc_id`,
--      used as *"104 pourers against a roll of 108"* — for a board whose day is a PARAMETER. Last Tuesday's board
--      already counts today's roll; after a transfer it would count it at the wrong centre too.
--
-- THE SHAPE: A ROUTE IS A PERIOD, NOT A COLUMN
-- `dairy_memberships.mcc_id` and `.member_code` stay as the CURRENT values (every write path and every current-state
-- read depends on them, and `UNIQUE (tenant_id, mcc_id, member_code)` is a real guard at the counter). What this
-- migration adds is the history behind them: one row per period a membership spent at one centre under one card, so
-- *"which centre and which card on 14 June"* has an answer. Same shape as 0163's custody register, for the same reason.
--
-- IN WHOLE DAYS, NOT INSTANTS. A pour is dated (`collected_on date`), a cycle is a date window, and a card is handed
-- over at a counter in the morning. 0157 made the same ruling for `payday`: *"counted in whole days by the people
-- waiting for it, not in the platform's timezone."* An instant here would force every as-of join to compare a date
-- against a timestamptz and choose a timezone to do it in.
--
-- WHAT THIS MIGRATION REFUSES TO DO
--   • **It does not stamp a centre onto `milk_bills`.** A bill for a fortnight in which the member moved belongs to
--     TWO centres, so a single column would be wrong exactly when it mattered. The register reads the centres from the
--     bill's own collections instead — the pours already know, and the answer can be *"MCC-AND-01 (9) · MCC-AND-02
--     (5)"*, which is what actually happened.
--   • **It does not backfill a route history it cannot know.** Every existing membership gets ONE open row from its
--     current `mcc_id`/`member_code`, opening at the membership's own `created_at::date` — which is true for every
--     membership that has never moved, and every membership on this platform has never moved, because until this wave
--     nothing could move one. That is stated in the row's own reason, so no future reader mistakes it for evidence
--     that the member was at that centre from that day.
--   • **It does not touch `default_animal_type` or `payment_cycle`.** Both are read as CURRENT values for windows that
--     have closed (`DairyQualityRepository.animalMix` reports a past window's herd from today's default;
--     `membershipsToBillForCycle` selects a closed window's members by today's preference). Both are the same class of
--     defect as the three above and neither is caused or worsened by a move — named here, not fixed here, because
--     versioning a payment preference changes which members a cadence bills and that needs its own proof.
--   • **It does not merge two memberships.** A farmer who is enrolled at two centres has two memberships and two
--     cards; the canon's sentence is about one membership moving, not about consolidating a person's records.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 164.1  THE ROUTE HISTORY
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dairy_membership_routes (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  membership_id uuid NOT NULL REFERENCES dairy_memberships(id),

  -- WHERE the member poured, and WHICH CARD they carried while doing it. Both together, because they change together:
  -- W171's own sentence is that the code changes when the centre does (the destination's numbering is the
  -- destination's, and `UNIQUE (tenant_id, mcc_id, member_code)` would refuse a duplicate anyway).
  mcc_id        uuid NOT NULL REFERENCES mcc_centres(id),
  member_code   varchar(40) NOT NULL,

  -- The period, in the cooperative's own calendar, INCLUSIVE at both ends. `valid_to IS NULL` = still current.
  valid_from    date NOT NULL,
  valid_to      date,

  -- Who moved them and why. A route change with no reason is the row nobody can interpret two years later, and this
  -- table's whole purpose is being interpretable two years later.
  moved_by      uuid REFERENCES users(id),
  reason        varchar(300),

  CONSTRAINT ck_route_window CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CALL add_std_columns('dairy_membership_routes');

-- ONE CURRENT ROUTE PER MEMBERSHIP. A partial unique index rather than a plain one: a membership has exactly one place
-- it pours today, and two open rows would let a read pick either depending on the sort.
--
-- The key contains no nullable column (`tenant_id` and `membership_id` are both NOT NULL), so unlike the 6c-4 trap
-- this index constrains every row it covers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dairy_route_current
  ON dairy_membership_routes (tenant_id, membership_id)
  WHERE valid_to IS NULL AND deleted_at IS NULL;

-- AND NO TWO ROUTES MAY CLAIM THE SAME DAY. The partial index above stops two OPEN rows; this stops the subtler
-- corruption — a closed row overlapping the next one — which is what makes "where was this member on 14 June" a
-- question with one answer. btree_gist (0001) lets uuid equality share a GiST index with range overlap; 0141 uses the
-- same construction for a charge definition in force.
ALTER TABLE dairy_membership_routes DROP CONSTRAINT IF EXISTS ex_dairy_route_no_overlap;
ALTER TABLE dairy_membership_routes
  ADD CONSTRAINT ex_dairy_route_no_overlap EXCLUDE USING gist (
    membership_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (deleted_at IS NULL);

-- ONE CARD AT ONE COUNTER AT A TIME. `dairy_memberships` guards the CURRENT state
-- (`UNIQUE (tenant_id, mcc_id, member_code)`); this guards history, which is where the damage would be invisible. Two
-- farmers holding card 108 at Vanthali in the same week is a mis-paid slip that nobody can reconstruct afterwards, and
-- re-issuing a departed member's card number to somebody else is exactly how it would happen.
ALTER TABLE dairy_membership_routes DROP CONSTRAINT IF EXISTS ex_dairy_route_card_once;
ALTER TABLE dairy_membership_routes
  ADD CONSTRAINT ex_dairy_route_card_once EXCLUDE USING gist (
    tenant_id WITH =,
    mcc_id WITH =,
    member_code WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (deleted_at IS NULL);

-- The as-of read: "this membership, on this date". Every one of the three repaired reads is this lookup.
CREATE INDEX IF NOT EXISTS idx_dairy_route_asof
  ON dairy_membership_routes (tenant_id, membership_id, valid_from DESC)
  WHERE deleted_at IS NULL;

-- The counter board's per-centre roll, as of a day: "who was routed to this centre on that date".
CREATE INDEX IF NOT EXISTS idx_dairy_route_centre_day
  ON dairy_membership_routes (tenant_id, mcc_id, valid_from, valid_to)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE dairy_membership_routes IS
  'PC-56 TENANT-6d-3 (W171): where a membership poured and which card it carried, over time. Inclusive whole-day '
  'periods in the cooperative''s own calendar (0157''s ruling on payday: a date is counted by the people waiting for '
  'it). dairy_memberships.mcc_id/member_code remain the CURRENT values; this answers as-of questions, which is what '
  'makes "the membership moves centres without losing history" true rather than a sentence on a screen.';

ALTER TABLE dairy_membership_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dairy_membership_routes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_dairy_membership_routes ON dairy_membership_routes;
CREATE POLICY tenant_isolation_dairy_membership_routes ON dairy_membership_routes
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0157's finding, applied from the start: ALTER DEFAULT PRIVILEGES grants kv_app INSERT+SELECT+UPDATE and kv_relay
-- INSERT+SELECT+UPDATE+DELETE on every new table at CREATE TABLE time, and a table-level UPDATE supersedes every
-- column grant. REVOKE first or the narrowing is decoration.
REVOKE UPDATE, DELETE ON dairy_membership_routes FROM kv_app;
REVOKE ALL ON dairy_membership_routes FROM kv_relay;
GRANT SELECT, INSERT ON dairy_membership_routes TO kv_app;
-- WHERE A MEMBER POURED IS APPEND-ONLY. Only the CLOSING of a period moves, because a move has to end the old row and
-- open the new one; the centre, the card and the start date of a period that has happened are not editable by the API.
-- A route history whose past can be rewritten cannot answer the question it exists for — and this one is read by the
-- register that decides what a member was paid.
GRANT UPDATE (valid_to, updated_at, updated_by) ON dairy_membership_routes TO kv_app;
GRANT SELECT ON dairy_membership_routes TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 164.2  THE BACKFILL — one open route per membership, and honest about what it knows
-- ------------------------------------------------------------------------------------------------------------------
-- `created_at::date` is the opening day. That is TRUE for every membership on this platform, because until this wave
-- no membership could move — but it is true by that argument rather than by evidence, so the reason column says so.
-- A read that finds a pour EARLIER than its membership's first route (a back-dated collection) therefore knows it is
-- looking at a gap in the record rather than at a member who was somewhere else.
INSERT INTO dairy_membership_routes (tenant_id, membership_id, mcc_id, member_code, valid_from, moved_by, reason, created_by)
SELECT m.tenant_id, m.id, m.mcc_id, m.member_code, m.created_at::date, m.created_by,
       'opened by migration 0164 from the membership''s current route — no membership could move before TENANT-6d-3, so this is the only route it has ever had',
       m.created_by
  FROM dairy_memberships m
 WHERE m.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM dairy_membership_routes r
                    WHERE r.membership_id = m.id AND r.deleted_at IS NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 164.3  THE AS-OF READ, AS A FUNCTION
-- ------------------------------------------------------------------------------------------------------------------
-- Three repositories need the same answer, and three copies of a date-range predicate is how they come to disagree
-- about the boundary day. STABLE and read-only, so the planner can inline it inside a LATERAL join.
--
-- `valid_to IS NULL OR p_on <= valid_to` — INCLUSIVE, matching `daterange(…, '[]')` in the exclusion constraints
-- above. The day a member moves belongs to the NEW route, and the day before to the old one; a half-open convention
-- here and an inclusive one in the constraint would leave one day a year attributable to two centres.
CREATE OR REPLACE FUNCTION dairy_route_asof(p_tenant uuid, p_membership uuid, p_on date)
RETURNS TABLE (mcc_id uuid, member_code varchar(40), valid_from date, valid_to date)
LANGUAGE sql STABLE AS $$
  SELECT r.mcc_id, r.member_code, r.valid_from, r.valid_to
    FROM dairy_membership_routes r
   WHERE r.tenant_id = p_tenant
     AND r.membership_id = p_membership
     AND r.deleted_at IS NULL
     AND r.valid_from <= p_on
     AND (r.valid_to IS NULL OR r.valid_to >= p_on)
   ORDER BY r.valid_from DESC
   LIMIT 1;
$$;

COMMENT ON FUNCTION dairy_route_asof(uuid, uuid, date) IS
  'PC-56 TENANT-6d-3: which centre and which card a membership had on a given DAY. Inclusive at both ends, matching '
  'ex_dairy_route_no_overlap. Returns no row for a date before the membership''s first route, which is a real answer: '
  'a back-dated pour predates the record and must not be attributed to the earliest route by default.';

-- ------------------------------------------------------------------------------------------------------------------
-- 164.4  THE FLAG (Law 10)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES
  ('dairy_membership_transfer',
   'PC-56 TENANT-6d-3 (W171): move a membership between collection centres, keeping its history - the route and the '
   'card become an effective-dated record, and the cycle register, the quality desk and the counter board read the '
   'centre and the card AS OF the day in question rather than as of today. OFF means the centres board keeps naming '
   'the move as not built, which is where TENANT-6d-2 left it. The three repaired READS do not depend on this flag: '
   'once a route history exists they are more correct with it whether or not anybody may move a membership.',
   false, 100, 'experiment')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 164.5  WHAT THIS MIGRATION DOES NOT DO
-- ------------------------------------------------------------------------------------------------------------------
--   • No centre column on `milk_bills` (see the header): a bill spanning a move belongs to two centres, and the
--     register now says so from the pours themselves.
--   • No version history for `payment_cycle` or `default_animal_type` — named in the header, with the reason.
--   • No merge of two memberships belonging to one person.
--   • No transfer of a membership between TENANTS. A cooperative's member moving to another cooperative is a new
--     enrolment there and an ending here; carrying a membership across a tenant boundary would carry its bills,
--     its consents and its deductions with it, and none of those are the receiving cooperative's business.
--   • It does not re-date a pour. A collection recorded at the old centre keeps its own `mcc_id` and `collected_on`
--     for ever; the service refuses an effective date that would contradict one rather than editing the slip.
