-- ============================================================================
-- MIGRATION 0110 — THE TRUST & SAFETY TABLES, MADE OPERABLE BY THE REALM THAT OWNS THEM (PC-56 ADMIN-5d)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT: THREE TABLES BUILT FOR AN ADMIN REALM THAT CANNOT REACH THEM
-- ---------------------------------------------------------------------------
-- 0067 created `platform_blocklists`, `risk_rules` and `appeals` for DELTA-021/022/024, and its header states the
-- access model plainly: "operated only by the RLS-bypassing kv_admin role, every action audited", with the permissions
-- named — `risk.rules`, `risk.act`, `moderation.appeals`.
--
-- 0067 CONTAINS NO GRANT AND NO REVOKE. Not one line. The consequences, all three of them wrong, and all three the
-- opposite of what the header says:
--
--   1. `kv_admin` HAS NO GRANT ON ANY OF THE THREE. Its only grant is `GRANT ALL ON ALL TABLES` at 0014:147 — a
--      POINT-IN-TIME statement, not a default privilege — so it covers tables that existed in 0014 and nothing since.
--      kv_admin has no `ALTER DEFAULT PRIVILEGES` entry anywhere. The role the header names as SOLE OPERATOR cannot
--      SELECT a single row.
--   2. `kv_app` CAN WRITE ALL THREE, inheriting SELECT/INSERT/UPDATE from 0014's `ALTER DEFAULT PRIVILEGES`. The
--      tenant-facing role can insert a platform-wide device block and change the risk weights that gate access for
--      every user on the platform.
--   3. `kv_relay` CAN WRITE AND DELETE ALL THREE, from 0018's `GRANT ... ON ALL TABLES ... TO kv_relay`, and kv_relay
--      is `BYPASSRLS`. The outbox relay can delete the blocklist.
--
-- This is ADMIN-5c's `data_breaches` finding again and worse. There the README claimed kv_admin-only while kv_app had
-- a write grant nothing used — a documented claim contradicted by an unused privilege. Here the table is UNREACHABLE
-- by its owner, so the plane could not have been wired at all without this migration: the console this wave builds
-- would 42501 on its first SELECT.
--
-- ---------------------------------------------------------------------------
-- AND THE MAKER-CHECKER COLUMNS POINT AT THE WRONG PEOPLE
-- ---------------------------------------------------------------------------
-- W095 says "Submit change (checker)". W096 says "Add block (checker)". 0067 filed the columns for both —
-- `risk_rules.proposed_by`/`checked_by`, `platform_blocklists.checked_by`, `appeals.original_reviewer_id`/`assigned_to`
-- — and every one of them is `uuid REFERENCES users(id)`.
--
-- `users` is the FARMER/tenant-user table. A platform operator has no row in it: admin-api authenticates from a
-- self-contained admin JWT with no database identity at all (core/auth/admin-auth.guard.ts — "No tenant context exists
-- here; admin-api is a separate realm"). So an INSERT naming the operator who added a block **fails the foreign key**,
-- and the only way to satisfy it is to write somebody else's id into the checker column. A maker-checker field that can
-- only be filled with the wrong person's name is worse than no field.
--
-- This is ADMIN-2d's realm-identity finding for the third time (support reply, then the ticket ATTACH owner, now
-- these). The settled pattern is 0107's `countersigned_by uuid` and 0109's `dpo_signed_off_by uuid` — a BARE uuid, no
-- FK, because the id belongs to a principal in the other realm and the audit ledger is where it is resolved. These
-- columns are brought onto it.
--
-- Only `appeals.appellant` keeps its FK: an appellant IS a farmer, and that one is right.
--
-- ---------------------------------------------------------------------------
-- AND THEN THE CONSTRAINT THAT WAS DOCUMENTED AND NEVER WRITTEN
-- ---------------------------------------------------------------------------
-- 0067's header calls the pattern "the checker/maker-checker pattern the screens themselves require". `appeals` got a
-- real CHECK (`chk_appeals_reviewer_neq`). `platform_blocklists` and `risk_rules` got columns and nothing else — no
-- separation CHECK, no `checked_at` on the blocklist, and no constraint tying a proposal's three fields together. The
-- rule was a comment on two of the three tables it was written for.
--
-- These become the platform's SIXTH and SEVENTH maker-checker sites, on the idiom in
-- apps/admin-api/src/core/approval/two-person-rule.ts (`makerNeCheckerConstraint`), both NULL escapes included.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE GRANTS. Without these the rest of the wave cannot execute a query.
-- ---------------------------------------------------------------------------
-- Same shape as 0097/0100/0103/0109: revoke the inherited defaults, grant the operating realm explicitly, leave the
-- read-only role its SELECT. `kv_relay` is revoked outright — the outbox relay has no business in the blocklist, and
-- it holds BYPASSRLS, which makes an unused grant here the most dangerous kind of unused grant.
REVOKE ALL ON platform_blocklists, risk_rules, appeals FROM kv_app, kv_relay;
GRANT SELECT, INSERT, UPDATE ON platform_blocklists, risk_rules, appeals TO kv_admin;
GRANT SELECT ON platform_blocklists, risk_rules, appeals TO kv_readonly;

-- ONE EXCEPTION, AND IT IS ASYMMETRIC ON PURPOSE. `risk_rules` is a CONFIGURATION table read by the scorer, which
-- lives in apps/api under kv_app. That role must be able to READ the weights it scores with; it must never be able to
-- change them, because a weight is what decides whether somebody's payout is delayed. Read here, write only from the
-- realm that requires a second signature:
GRANT SELECT ON risk_rules TO kv_app;
-- `platform_blocklists` gets NO kv_app grant even though W096 says blocks "enforce at the gateway from cached rules" —
-- because nothing enforces them today, and a grant issued for a consumer that does not exist is how kv_app ended up
-- able to write all three of these tables in the first place. It is added by the wave that builds the enforcer.

-- No DELETE for anybody. A lifted block is `status='lifted'` and a withdrawn proposal is a cleared proposal — the
-- history of what was blocked and by whom is the point of the table, and on an appeal it is evidence.

-- ---------------------------------------------------------------------------
-- 2. THE ACTOR COLUMNS: DROP THE FKs THAT POINT AT THE WRONG TABLE
-- ---------------------------------------------------------------------------
-- Dropping a foreign key is not a loosening here — it is a correction. The constraint asserted that a platform
-- operator is a tenant user, which is false in this architecture, and asserting a falsehood in the schema does not
-- make the data safer; it makes the column unusable and pushes the truth somewhere unconstrained.
--
-- Constraint names are the PostgreSQL defaults (`<table>_<column>_fkey`), and IF EXISTS keeps this runnable against a
-- box where 0067 was applied by hand.
ALTER TABLE platform_blocklists DROP CONSTRAINT IF EXISTS platform_blocklists_checked_by_fkey;
ALTER TABLE risk_rules          DROP CONSTRAINT IF EXISTS risk_rules_proposed_by_fkey;
ALTER TABLE risk_rules          DROP CONSTRAINT IF EXISTS risk_rules_checked_by_fkey;
ALTER TABLE appeals             DROP CONSTRAINT IF EXISTS appeals_original_reviewer_id_fkey;
ALTER TABLE appeals             DROP CONSTRAINT IF EXISTS appeals_assigned_to_fkey;
-- `appeals.appellant` KEEPS its FK on purpose — the appellant is a farmer, and that reference is correct.

-- ---------------------------------------------------------------------------
-- 3. THE SIXTH MAKER-CHECKER SITE — platform_blocklists
-- ---------------------------------------------------------------------------
-- A blocklist entry shuts a device, an IP range or a phone out of the platform. W096's own rule is that blocks "grow
-- from confirmed clusters, never from suspicion alone", and the second signature is what makes that checkable.
ALTER TABLE platform_blocklists ADD COLUMN checked_at timestamptz;

ALTER TABLE platform_blocklists ADD CONSTRAINT ck_platform_blocklists_maker_ne_checker CHECK (
  checked_by IS NULL OR created_by IS NULL OR checked_by <> created_by
);
-- A signature is a person AND a time. Half of one is not a record of anything.
ALTER TABLE platform_blocklists ADD CONSTRAINT ck_platform_blocklists_check_pair CHECK (
  (checked_by IS NULL) = (checked_at IS NULL)
);
-- Lifting is a decision, and it needs its own note for the same reason `not_applicable` needed one in 0109: an
-- unexplained lift is indistinguishable from a mistake, and the appellant is entitled to the reason.
ALTER TABLE platform_blocklists ADD COLUMN lifted_at timestamptz;
ALTER TABLE platform_blocklists ADD COLUMN lifted_by uuid;
ALTER TABLE platform_blocklists ADD COLUMN lift_reason text;
ALTER TABLE platform_blocklists ADD CONSTRAINT ck_platform_blocklists_lift_evidence CHECK (
  status <> 'lifted' OR (lifted_at IS NOT NULL AND lift_reason IS NOT NULL AND length(trim(lift_reason)) > 0)
);

-- ---------------------------------------------------------------------------
-- 4. THE SEVENTH MAKER-CHECKER SITE — risk_rules, and the dry-run W095 will not ship without
-- ---------------------------------------------------------------------------
-- W095: "Every change is dry-run against yesterday's population before it can ship." 0067 filed `proposed_weight`,
-- `proposed_by`, `proposed_at`, `checked_by`, `checked_at` with nothing tying them together — a row could carry a
-- checker and no proposal, or a proposal with no proposer.
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_maker_ne_checker CHECK (
  checked_by IS NULL OR proposed_by IS NULL OR checked_by <> proposed_by
);
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_proposal_pair CHECK (
  (proposed_weight IS NULL) = (proposed_at IS NULL)
);
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_check_pair CHECK (
  (checked_by IS NULL) = (checked_at IS NULL)
);
-- A checker cannot approve what nobody proposed.
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_check_needs_proposal CHECK (
  checked_by IS NULL OR proposed_weight IS NOT NULL
);

-- THE DRY RUN IS STORED, NOT RECOMPUTED AT APPROVAL TIME. W095's dry-run panel says "Band drops 312 users · New
-- restricted 41 · includes 28 farmers with perishable stock", and the screen's whole argument is that a checker
-- approves a change having SEEN that number. Recomputing it when they click would mean they approved one figure and
-- shipped another; the population moves every day. The proposal carries the figures it was judged on, and the console
-- shows when they were computed.
ALTER TABLE risk_rules ADD COLUMN dry_run_at timestamptz;
ALTER TABLE risk_rules ADD COLUMN dry_run_band_drops integer;
ALTER TABLE risk_rules ADD COLUMN dry_run_new_restricted integer;
ALTER TABLE risk_rules ADD COLUMN dry_run_population integer;
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_dryrun_pair CHECK (
  (dry_run_at IS NULL) = (dry_run_band_drops IS NULL)
);
-- **A PROPOSAL WITHOUT A DRY RUN CANNOT BE APPROVED.** This is the constraint that makes W095's sentence true rather
-- than aspirational. The screen's failure state ("Dry run failed — yesterday's population snapshot unavailable;
-- changes cannot ship without a dry run") is the behaviour the canon asks for, and without this CHECK it would be a
-- message the console chose to show rather than a rule the platform enforces.
ALTER TABLE risk_rules ADD CONSTRAINT ck_risk_rules_check_needs_dryrun CHECK (
  checked_by IS NULL OR dry_run_at IS NOT NULL
);

-- `is_active` had no partial index and the scorer will read the live set on every recompute.
CREATE INDEX idx_risk_rules_active ON risk_rules (event_code) WHERE is_active AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. appeals — THE SAME PAIRING DISCIPLINE, AND NOTHING ELSE
-- ---------------------------------------------------------------------------
-- W097 is ADMIN-6's screen, not this wave's. What 0110 does here is the minimum that makes the OVERVIEW tile on W089
-- honest (it counts pending appeals and their SLA) and stops a decided appeal existing without its reasoning — the
-- canon's rule is "every closed appeal shows its reasoning to the appellant — even upheld ones", and 0067 left
-- `decision_reason` nullable next to a `status` that can already be `upheld`.
ALTER TABLE appeals ADD CONSTRAINT ck_appeals_decision_evidence CHECK (
  status = 'pending'
  OR (decided_at IS NOT NULL AND decision_reason IS NOT NULL AND length(trim(decision_reason)) > 0)
) NOT VALID;
-- NOT VALID: 0067 seeded no rows, but this runs on a founder's staging box that may carry hand-made fixtures, and a
-- validating scan that aborts the whole migration over one of them helps nobody. Same reasoning as 0108/0109.

-- ---------------------------------------------------------------------------
-- 6. risk_scores.band — FIVE FIXED VALUES HELD BY A COMMENT
-- ---------------------------------------------------------------------------
-- 0003 filed `band varchar(15) NOT NULL, -- trusted|standard|caution|restricted|blocked`. The five values are the
-- entire vocabulary of the access ladder W093 and W094 render, and a typo produces a band no screen has a colour for
-- and no gate has a rule for — which, on a table whose purpose is to decide what somebody may do, fails open.
ALTER TABLE risk_scores ADD CONSTRAINT ck_risk_scores_band CHECK (
  band IN ('trusted', 'standard', 'caution', 'restricted', 'blocked')
) NOT VALID;

-- W093's board is a census by band across every tenant, and W094 opens one user's profile. Neither read is served by
-- the PK or by UNIQUE (tenant_id, user_id).
CREATE INDEX idx_risk_scores_band ON risk_scores (band, score);
CREATE INDEX idx_risk_scores_user ON risk_scores (user_id);

-- ---------------------------------------------------------------------------
-- 7. user_blocks — A CORRECTION TO 0020'S RECORD, AND A HISTORY THAT SURVIVES AN UNBLOCK
-- ---------------------------------------------------------------------------
-- 0020_rls_backfill_post_0015.sql lists `user_blocks` among the tables it brought under RLS. IT DID NOT. The pass it
-- re-runs joins `information_schema.columns` on `column_name='tenant_id'`, and `user_blocks` has no tenant_id column —
-- so the table was skipped, silently, while the migration's own comment recorded it as covered. (`user_phone_changes`,
-- listed in the same sentence, is skipped for the same reason.)
--
-- THE RIGHT FIX IS NOT AN RLS POLICY. A user↔user chat block is not tenant data — the two people may belong to
-- different tenants, and the block must hold in both. It is correctly platform-scoped, exactly like the three 0067
-- tables. What was wrong is the RECORD, and this comment is the correction: the table is deliberately platform-scoped
-- and deliberately has no policy, which is a different fact from "we forgot".
--
-- WHAT IS ACTUALLY WRONG WITH THE TABLE: no std columns, so unblocking is a hard DELETE and the fact that A once
-- blocked B is then unrecoverable. In a harassment case — which is precisely what this table exists for, and which
-- W092 routes to a safety desk — a block that was placed and removed is evidence, and the removal is part of it.
CALL add_std_columns('user_blocks');

-- Blocking yourself was legal. It is not a security hole, it is a data-quality one — it inflates a count that a safety
-- desk reads as a signal about somebody's experience of the platform.
ALTER TABLE user_blocks ADD CONSTRAINT ck_user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id) NOT VALID;

-- W096's read-only user↔user tab, and the safety-desk read on a reported user.
CREATE INDEX idx_user_blocks_blocked ON user_blocks (blocked_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8. THE COMMENTS. 0001–0109 CARRY NONE ON ANY TRUST & SAFETY TABLE.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE platform_blocklists IS
  'Platform-wide device/IP-range/phone-hash blocks (DELTA-021). Identifiers stored hashed — raw values never stored. Every entry carries an expiry or a review date; indefinite blocks without review are prohibited by ck_platform_blocklists_expiry_or_review. Second-signature required (ck_platform_blocklists_maker_ne_checker, 0110). Operated by kv_admin only — before 0110 kv_admin had no grant at all and kv_app could write.';
COMMENT ON TABLE risk_rules IS
  'Configurable risk-event weights (DELTA-022), replacing module constants. A weight change is a proposal that must carry a stored dry run and be approved by a second operator (ck_risk_rules_check_needs_dryrun + ck_risk_rules_maker_ne_checker, 0110). Band thresholds are deliberately NOT stored here — see 0067.';
COMMENT ON TABLE appeals IS
  'Appeals against moderation and risk actions (DELTA-024). assigned_to <> original_reviewer_id is enforced. The workflow surface is W097 (ADMIN-6); 0110 only makes the register readable by the admin realm and stops a decided appeal existing without its reasoning.';
COMMENT ON COLUMN risk_scores.band IS
  'trusted|standard|caution|restricted|blocked (CHECK added 0110). ADVISORY ONLY as of this migration — nothing on the platform reads it. See 0110''s closing note.';

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO `band_thresholds` TABLE. 0067 declined it with a reason that still holds — the canon flags only the event
--     WEIGHTS as backend-pending (DELTA-022), never the thresholds — and inventing a shape the canon never filed as a
--     gap is how a schema grows surfaces nobody asked for. The thresholds stay in code, and this wave makes the ONE
--     place that holds them agree with the canon (see below).
--
--   • NO CLUSTERS TABLE (DELTA-023). W093 says so itself: "Cluster entities are UI-level (grouped risk_events by
--     correlation) — dedicated clusters table BACKEND PENDING". Building one now would be building the storage for a
--     correlation job that does not exist, and the console would render an empty table that looks like "no fraud
--     rings" rather than "nothing looks for them".
--
--   • NO CHECK ON `moderation_reports.status` / `action_taken` / `subject_type`, though all three are comment-only
--     enums. NOT an oversight: the app's own DTO already accepts SEVEN subject types (`listing, review, message, user,
--     resource, channel, live_session`) against the four the column comment names, so a CHECK written from the comment
--     would reject rows the platform currently produces. Which list is right is a decision about what may be reported,
--     it belongs with the queue screens, and it is named as ADMIN-5f rather than guessed at here.
--
--   • **NO CORRECTION TO THE WEIGHTS OR THE BAND THRESHOLDS, AND THE REASON IS W095'S OWN RULE.** Verifying against
--     the code turned up four disagreements between the configuration in this table and the behaviour of the platform:
--       – `dispute_lost` is seeded at −12 (matching the canon) and the handler that fires it hardcodes −15.
--       – `same_ip_bidding`, `fake_listing` and `duplicate_kyc` are configured and NOTHING ANYWHERE EMITS THEM.
--       – `order_completed` (+2) is emitted on every completed order and is not configured at all.
--       – `bandFor()` in apps/api uses thresholds 80/60/40/20; W095's band panel says 70/50/30/10. The code is
--         harsher at every boundary — a score of 35 is `caution` to the canon and `restricted` to the code.
--     Every one of those is a change to who gets restricted. W095 states the control for exactly this: "Every change
--     is dry-run against yesterday's population before it can ship." There is no population to dry-run against from
--     here, so quietly editing two constants would be the migration doing the precise thing the screen exists to
--     prevent — and doing it with no note, no checker and no figure anybody reviewed. The drift is RENDERED on W095
--     instead, which is the screen whose job it is, and the corrections are named as ADMIN-5d-Q2 for a wave that can
--     run the dry run.
--
--   • NOTHING ENFORCES A BAND. This migration adds a CHECK to `risk_scores.band` and an index to read it by, and that
--     is the whole of it. W094 states the band effects — "Restricted band would add: payout delay 48h, bid cap
--     ₹50,000" — and NO CODE ANYWHERE READS THE BAND: `RiskScoreRepository.findByUser` has zero callers, `RiskBand` is
--     imported by nothing, and the recompute job that produces the score is never invoked. The band is a number in a
--     table. Making it gate payouts and bids means touching the payout and auction paths in apps/api, which is a
--     money-and-access change with its own blast radius, and it is named as ADMIN-5d-Q1 with the console saying
--     plainly that the ladder is advisory — because a screen that draws a restriction the platform does not apply is
--     the most dangerous kind of trust theatre: it tells an operator the problem is handled.
