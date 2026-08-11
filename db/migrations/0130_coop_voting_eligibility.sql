-- ============================================================================
-- MIGRATION 0130 — ANY AUTHENTICATED USER COULD VOTE IN AN FPO's AGM (PC-56 TENANT-1e)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT IS ON THE DEMOCRATIC MACHINERY RATHER THAN THE MONEY
-- ---------------------------------------------------------------------------
-- W197 (tenant Governance) prints a panel headed "Voting eligibility (bylaws, as data)" with three ticked rules:
--
--     ✓ Holds >= 10 shares (Rs 2,000)
--     ✓ Member >= 6 months
--     ✓ One member, one vote — shares add capital, never extra votes (coop principle, ENFORCED)
--
-- And `POST /v1/governance/:id/vote` carries **no permission decorator and no eligibility check of any kind**.
-- `GovernanceService.vote` verifies that the resolution is open, that the voting window is current, and that this user has
-- not already voted. It never asks whether they are a MEMBER, whether they hold a single share, or how long they have
-- belonged.
--
-- **SO ANY AUTHENTICATED USER IN THE TENANT COULD CAST A BALLOT IN AN FPO's ANNUAL GENERAL MEETING.** A staff member. A
-- delivery partner. A buyer with a `customer` role. Somebody imported by a bulk file that morning who has never held a
-- share. On a screen whose own subtitle reads "the democratic machinery of your FPO, kept as carefully as the money".
--
-- `coop_share_registers.voting_eligible` has existed since 0009 as a boolean column, and **nothing in the codebase reads it
-- or writes it**. A column recording a decision no code makes — the tenth occurrence of that shape in this programme, and
-- the first on a governance path.
--
-- ---------------------------------------------------------------------------
-- WHY THE RULES ARE SETTINGS AND THE VERDICT IS DERIVED
-- ---------------------------------------------------------------------------
-- W197 says "bylaws, AS DATA" and it is right, for the reason every other vocabulary on this platform is data: a
-- co-operative's bylaws are its own, a Bangladeshi society's minimum shareholding is not Gujarat's, and a rule compiled into
-- TypeScript is a rule a founder cannot see or change. So the two thresholds become tenant settings.
--
-- **BUT THE VERDICT IS COMPUTED, NEVER STORED — WHICH MEANS `voting_eligible` STAYS UNREAD ON PURPOSE.** A stored boolean
-- goes stale the moment a member transfers shares away, and it would then say "eligible" for somebody who holds nothing.
-- TENANT-1c reached the same conclusion about the go-live checklist one wave ago, for the same reason: a second opinion
-- about a fact the database already holds is a second opinion that drifts. Shares held and membership age are both facts;
-- eligibility is a question asked of them at the moment of the vote.
--
-- The column is left in place (dropping it is a separate decision about a table an FPO's register depends on) and its
-- comment now says plainly that it is not the authority.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 130.1  THE BYLAWS, AS DATA
-- ---------------------------------------------------------------------------
-- `governance` risk class rather than `money_path`: these thresholds decide who may vote, not what anybody is paid. They do
-- change who controls the co-operative, so they are not `standard` either — ADMIN-11's registry treats a `security`-class
-- setting as one requiring a second administrator, and disenfranchising members is exactly that kind of act.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES
  ('governance.min_shares_to_vote', 'int', 'tenant', 'security', '10'::jsonb,
   'Minimum shares a member must hold to vote on a resolution. W197''s bylaw panel shows 10 (Rs 2,000 at Rs 200 face value). Zero means shareholding is not required — legitimate for a producer company that votes by membership alone.',
   'This decides who may vote in your AGM. Two administrators.'),
  ('governance.min_membership_months', 'int', 'tenant', 'security', '6'::jsonb,
   'How many months a member must have belonged before they may vote. W197''s "6-month tenure rule". Measured from their earliest active role grant in this tenant.',
   'This decides who may vote in your AGM. Two administrators.'),
  -- W198: "quorum 33% ✓ met". A quorum that nobody computes is a quorum nobody can fail, so the threshold has to exist
  -- before the arithmetic can mean anything.
  ('governance.quorum_bp', 'int', 'tenant', 'security', '3300'::jsonb,
   'Minimum share of ELIGIBLE members who must cast a vote for a resolution to carry, in basis points (3300 = 33%). Counted against eligible members, never against all members — a co-operative with many pending-allotment members would otherwise never reach quorum.',
   'This decides whether a resolution carries. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 130.2  A VOTE MAY BE CHANGED UNTIL THE WINDOW CLOSES
-- ---------------------------------------------------------------------------
-- W198 states it twice: "changeable until close, final at 18:00 Sunday" and "votes immutable after close". The code kept
-- neither half: `castVote` is a bare INSERT whose unique-violation is reported to the member as "you have already voted on
-- this resolution", so a farmer who tapped the wrong button on a feature phone was stuck with it — on a resolution that
-- decides how their own patronage bonus is distributed.
--
-- **AND A CHANGED VOTE MUST LEAVE THE PREVIOUS ONE VISIBLE, NOT OVERWRITE IT SILENTLY.** `coop_votes` is keyed
-- (resolution_id, member_user_id) — one live vote per member, which is the "one member, one vote" guarantee and must not be
-- relaxed. So the CHANGE is recorded on the row itself: what it was, when it was last changed, and how many times. A member
-- who believes their vote was altered can be shown the count.
ALTER TABLE coop_votes
  ADD COLUMN changed_at timestamptz,
  ADD COLUMN change_count integer NOT NULL DEFAULT 0,
  ADD COLUMN previous_choice varchar(20);

COMMENT ON COLUMN coop_votes.change_count IS
  'How many times this member changed their vote before the window closed (W198: "changeable until close"). The PRIMARY KEY still guarantees ONE live vote per member per resolution — changing is an UPDATE, never a second row.';
COMMENT ON COLUMN coop_votes.previous_choice IS
  'The immediately previous choice, kept so a member who disputes a change can be shown that one happened and what it replaced. Not a full history: a per-change audit row is the right home for that (TENANT-1e-Q2).';

COMMENT ON COLUMN coop_share_registers.voting_eligible IS
  '**NOT THE AUTHORITY, AND DELIBERATELY UNREAD (0130).** A stored eligibility flag goes stale the moment a member transfers shares away, and would then say "eligible" for somebody holding nothing. Eligibility is DERIVED at vote time from shares held, membership age and the tenant''s bylaw settings (governance.min_shares_to_vote, governance.min_membership_months). This column predates that decision; it is left in place because an FPO''s register depends on this table, and it must not be trusted by new code.';

-- ---------------------------------------------------------------------------
-- 130.3  THE DENOMINATOR AT THE MOMENT IT WAS TRUE
-- ---------------------------------------------------------------------------
-- W197's fourth tile reads "Last AGM turnout · 64% · app voting doubled participation vs 2024", and a turnout is a
-- FRACTION: votes cast over members who could have cast one. The numerator survives (`coop_votes` rows are permanent); the
-- denominator does not. Eligibility is derived from shares held and membership age, and both keep moving — members join,
-- shares transfer, suspensions land. So computing last year's turnout against TODAY's eligible roll gives a number that
-- changes every week for a vote that finished long ago.
--
-- **SO THE ELIGIBLE COUNT IS SNAPSHOTTED WHEN THE RESOLUTION CLOSES, AND ONLY THEN.** This is the one place a derived value
-- is written down in this migration, and the reason is exactly the reason 130.2 refuses to store `voting_eligible`: that
-- column would be a standing claim about a live fact, where this is a record of a fact AS IT WAS at an instant that will
-- never recur. Same shape as an invoice keeping the tax rate it was raised under.
--
-- Existing closed resolutions get NULL, not a backfilled guess — **unknown is not zero**, and a turnout tile showing "0%"
-- for a well-attended 2024 AGM would be a worse answer than "not recorded".
ALTER TABLE coop_resolutions ADD COLUMN eligible_at_close integer;

COMMENT ON COLUMN coop_resolutions.eligible_at_close IS
  'How many members were eligible to vote at the moment this resolution closed — the DENOMINATOR of its turnout, recorded because eligibility is derived from facts that keep changing (shares transfer, members join, suspensions land). Written once by the close transition; NULL for resolutions closed before 0130, which report turnout as unknown rather than as zero.';

-- While here: `share_value_minor` has had no writer since 0009 and therefore no defined meaning. W197's register row reads
-- "40 shares · Rs 8,000", so it is the TOTAL value of that member's holding, not a per-share face value. Stated now, before
-- the first writer exists, because a money column whose unit is guessed is a Law 2 violation waiting to happen.
COMMENT ON COLUMN coop_share_registers.share_value_minor IS
  'TOTAL value of this member''s holding in minor units (paise) — not the per-share face value. W197: "40 shares · Rs 8,000". Share capital is the SUM of this column; the per-share face value is derived (capital / total shares) and reported as unknown when the division is not exact, because shares issued in different years at different prices are a real co-operative, not a data error.';

-- ---------------------------------------------------------------------------
-- 130.4  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- **IT DOES NOT WEIGHT VOTES BY SHAREHOLDING, AND NO FUTURE MIGRATION SHOULD.** W197: "One member, one vote — shares add
-- capital, never extra votes (coop principle)." That is not a product preference, it is what makes a co-operative a
-- co-operative rather than a company, and it is protected in the only place it can be: the tally counts ROWS, and
-- `coop_votes` holds at most one row per member. A test asserts that a 40-share member and a 10-share member count the same.
--
-- NO PAPER-BALLOT INGESTION. W198 promises "paper fallback at the MCC counter for anyone — digital never disenfranchises",
-- and that needs an operator-assisted path with its own record of WHO entered the ballot on whose behalf. Real work, named
-- rather than half-built (TENANT-1e-Q1) — and a paper vote entered without recording the operator would be indistinguishable
-- from a staff member voting for a farmer, which is the exact thing 130.1 exists to prevent.
--
-- NO NOTICE-PERIOD ENFORCEMENT. W198's step 1 is "14 days before close, bylaw minimum". The notice period is a real bylaw
-- and belongs beside the other two settings, but nothing currently records when notice was SENT for a resolution, so a
-- setting alone would be a threshold measured against nothing (TENANT-1e-Q3).
--
-- IT DOES NOT BACKFILL `voting_eligible`. Setting it from today's facts would create exactly the stale value 130.2's comment
-- warns about, and code that reads it would then look correct in testing.
