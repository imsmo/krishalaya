-- ============================================================================
-- MIGRATION 0132 — THE APPEALS TABLE GETS ITS WRITERS (PC-56 ADMIN-SWEEP-b1, W097 + W1953–W1955)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS FILE CLOSES, STATED PLAINLY
-- ---------------------------------------------------------------------------
-- 0067 built `appeals` in the canon's filed shape — including `chk_appeals_reviewer_neq`, which is W097's "a
-- different reviewer than the original decides — always" enforced in the database. **AND NOTHING HAS EVER WRITTEN
-- IT.** Every reference in the monorepo is a READ (a pending count and a 30-day outcome ratio in
-- trust-safety.repository.ts), so the trust overview's overturn rate — the platform's own measure of whether
-- moderation is fair to farmers — has been computed over a table nothing can fill, structurally 0/0. ADMIN-5d's
-- comment even warned about the shape: "an empty appeals register means nobody has appealed, or nobody CAN." The
-- second was the answer. A farmer whose listing the platform removed had no way to contest it, while every removal
-- notice since 0112 has told them they could ("You can appeal this decision", appeal_path '/help/appeal').
--
-- WHERE THE UNGRANTABLE PERMISSION GETS FIXED, AND WHY IT IS NOT HERE. `moderation.appeals` — named by W097's own
-- restricted state ("Deciding needs moderation.appeals") — existed only in 0067/0110 rationale comments: the same
-- shape TENANT-1b-3 found seven times, for the eighth time. But deciding an appeal is a PLATFORM act, and the
-- platform realm's permission rows are catalog lines in apps/admin-api/src/core/rbac/owner-roles.ts (Law 11:
-- granting a platform permission is a code review and a deploy; a database path that could do it would make the
-- catalog advisory). The catalog entry and its desk grants land in the same commit as this migration, and a
-- reachability spec (`owner-permission-reachability.spec.ts`) now enumerates the class for that realm the way
-- `tenant1b3-permission-reachability.spec.ts` does for this database's `permissions` table. What DOES belong in the
-- database is everything below: the tenant realm's right to submit, and the integrity rules the writers rely on.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 132.1  THE TENANT REALM MAY SUBMIT — AND ONLY SUBMIT
-- ---------------------------------------------------------------------------
-- 0110 revoked ALL on `appeals` from kv_app while the table had no writers anywhere. Submitting is the FARMER's act
-- (W097: "every moderation/risk action carries a one-tap appeal path"), and the farmer talks to apps/api, so kv_app
-- gets INSERT and SELECT back. **Deliberately no UPDATE and no DELETE**: deciding, assigning and overturning are
-- platform acts behind `moderation.appeals`, and a tenant-realm credential that could flip `status` to 'overturned'
-- would let a compromised api pod acquit its own fraud cases. `appeals` has no tenant_id (0067: appeals are reviewed
-- by platform staff across tenants), so there is no RLS policy on it; the appellant scoping lives in the repository
-- (`WHERE appellant = <caller>`) and this grant's narrowness is the database's half of that bargain.
GRANT SELECT, INSERT ON appeals TO kv_app;

-- ---------------------------------------------------------------------------
-- 132.2  INTEGRITY RULES THE WRITERS RELY ON (the table has been empty since 0067, so all are safe to add)
-- ---------------------------------------------------------------------------
-- ONE OPEN APPEAL PER (SUBJECT, APPELLANT). Submit is retried by phones on village networks; the unique index makes
-- resubmission a dedupe rather than a queue-flooding loop, exactly as `moderation_reports` does it (0067's sibling).
-- Partial on 'pending' so a farmer whose second removal was also wrong can appeal again after the first is decided.
CREATE UNIQUE INDEX uq_appeals_open_per_subject
  ON appeals (subject_ref, appellant)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- THE THREE ACTIONS THE CANON FILES APPEALS AGAINST (W097's queue rows: "listing removed", "review hidden",
-- "account restricted"). A CHECK rather than free text because the overturn contract is dispatched on this value —
-- an unknown action would be an appeal whose overturn restores nothing while reading as if it could. A fourth
-- appealable act adds a migration naming its restore path, not a new string.
ALTER TABLE appeals ADD CONSTRAINT chk_appeals_subject_action
  CHECK (subject_action IN ('listing_removed', 'review_hidden', 'account_restricted'));

-- A DECIDED APPEAL HAS A DECIDER, A TIME AND ITS REASONING — W097: "every closed appeal shows its reasoning to the
-- appellant — even upheld ones." Without this, 'upheld' could be written as a bare status flip and the appellant
-- would be owed a sentence nobody recorded. The 20-char floor is the same bar `moderation_action_notices.body`
-- already holds moderation prose to (0112).
ALTER TABLE appeals ADD CONSTRAINT chk_appeals_decided_shape
  CHECK (
    (status = 'pending' AND decided_at IS NULL)
    OR (status IN ('upheld', 'overturned')
        AND decided_at IS NOT NULL
        AND assigned_to IS NOT NULL
        AND length(btrim(COALESCE(decision_reason, ''))) >= 20)
  );

-- THE SLA CLOCK IS SET ON SUBMIT AND SERVES THE QUEUE. 0067 indexed pending rows by (status, sla_due_at); "Take
-- next" claims the oldest deadline with SKIP LOCKED, and this comment records that idx_appeals_status_sla is the
-- index that claim leans on — do not drop it in a later tidy.

-- ---------------------------------------------------------------------------
-- 132.3  APPEAL DECISIONS OWE A NOTICE — the third origin for moderation_action_notices
-- ---------------------------------------------------------------------------
-- W097's overturn contract: "notifies the appellant with an apology in their language". The delivery rail already
-- exists (0112: admin-api queues, the apps/api executor settles through the notification spine), but its origin
-- CHECK admitted exactly a listing order or a report. An appeal decision is a third origin — for BOTH outcomes,
-- because an upheld appeal owes its reasoning too.
ALTER TABLE moderation_action_notices ADD COLUMN appeal_id uuid REFERENCES appeals(id);
ALTER TABLE moderation_action_notices DROP CONSTRAINT ck_man_one_origin;
ALTER TABLE moderation_action_notices ADD CONSTRAINT ck_man_one_origin
  CHECK (num_nonnulls(order_id, report_id, appeal_id) = 1);
CREATE INDEX idx_man_appeal ON moderation_action_notices (appeal_id, created_at DESC) WHERE appeal_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 132.4  THE COACHING FEED — what an overturn teaches, recorded where a lead can read it
-- ---------------------------------------------------------------------------
-- W097: an overturned action "feeds the original decision into reviewer coaching (W055 pattern) — errors are
-- learning, not blame." The W055 machinery (`support_coaching_records`, 0100) cannot carry this: its
-- `agent_user_id` is FK'd to `users`, and 0110 dropped exactly that FK from `appeals.original_reviewer_id` because
-- platform operators are not tenant users. So the feed gets its own register: ONE row per overturned appeal, naming
-- the original decision and why it was wrong. It is a LESSONS register, not a sessions workflow — the reviewing
-- lead reads it per reviewer the way W055's queue reads low CSAT; scheduling a shadow session stays a human act.
CREATE TABLE moderation_review_lessons (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- one lesson per appeal, and the UNIQUE is the idempotency backstop for the overturn's fourth write.
  appeal_id             uuid NOT NULL UNIQUE REFERENCES appeals(id),
  -- the person whose decision was overturned. No FK, deliberately — 0110's reasoning: platform operators are not
  -- rows in `users`, and for a review hidden by a tenant moderator this IS a users id. Nullable because the canon's
  -- own queue shows system decisions ("system + Ravi T."): when no human made the original call, the lesson routes
  -- to the RULE that did, and `reviewer_source` says which reading applies.
  reviewer_id           uuid,
  reviewer_source       varchar(10) NOT NULL CHECK (reviewer_source IN ('human', 'system')),
  CONSTRAINT chk_mrl_reviewer_shape CHECK ((reviewer_source = 'human') = (reviewer_id IS NOT NULL)),
  -- what was decided and what reversing it taught. The reason is the decider's `decision_reason`, denormalised on
  -- purpose: a lesson must stay readable if the appeal row is later soft-deleted by retention.
  subject_action        varchar(60) NOT NULL,
  original_action_ref   uuid,
  lesson                text NOT NULL CHECK (length(btrim(lesson)) >= 20),
  -- who recorded it (the appeal's decider) — mandatory for the same reason 0100 makes author_admin_id mandatory:
  -- no statement about a named person's work may exist without a human who owns it.
  decided_by_admin_id   uuid NOT NULL
);
CALL add_std_columns('moderation_review_lessons');
CREATE INDEX idx_mrl_reviewer ON moderation_review_lessons (reviewer_id, created_at DESC) WHERE reviewer_id IS NOT NULL;

-- Grants follow 0110/0112's pattern for platform moderation tables: the god-mode realm writes, the tenant realm has
-- no business here at all (a lesson names a reviewer's error — that is platform staff performance data).
REVOKE ALL ON moderation_review_lessons FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON moderation_review_lessons TO kv_admin;
GRANT SELECT ON moderation_review_lessons TO kv_readonly;

COMMENT ON TABLE moderation_review_lessons IS
  'One row per overturned appeal: whose decision was reversed, on what, and the decider''s reasoning (W097 · W055 pattern — errors are learning, not blame). Fed atomically by the overturn transaction in apps/admin-api; read per reviewer by the moderation lead.';

COMMENT ON COLUMN appeals.sla_due_at IS
  'W097: "SLA 48h". Set on SUBMIT (now() + 48h) by apps/api — the clock a farmer''s appeal runs on starts when they ask, not when somebody picks it up.';
