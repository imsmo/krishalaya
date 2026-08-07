-- ============================================================================
-- MIGRATION 0114 — THE MONEY DOOR: A PAYOUT BATCH THAT IS A GATE RATHER THAN A REPORT
-- (PC-56 ADMIN-6b)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: PAYOUTS EXECUTE ON A FIVE-MINUTE TIMER AND THE EXECUTOR DOES NOT KNOW BATCHES EXIST
-- ---------------------------------------------------------------------------
-- `apps/api/src/modules/payments/jobs/payout-execution.cadence-job.ts` runs every 5 minutes and drives
-- `PayoutRepository.claimQueued`, which is this, in full:
--
--     UPDATE payouts SET status='processing', updated_at=now()
--       WHERE id IN (SELECT id FROM payouts WHERE status='queued'
--                    ORDER BY priority ASC, created_at ASC FOR UPDATE SKIP LOCKED LIMIT $1)
--
-- There is no mention of `batch_id`. No mention of a batch's status. **So a payout inside an unapproved batch is
-- disbursed by the timer exactly as if the batch did not exist.**
--
-- W066 states the rule in its own subtitle: "every batch checker-approved before execution". W067 renders
-- "Approve & execute" with "maker Priya S. ≠ checker (you) enforced". Built over today's schema those controls would
-- be theatre of the worst kind — an operator would press Approve believing they were the gate, and the money would
-- already have left on a tick that ran before they opened the page. That is the FOURTH occurrence of the pattern this
-- programme keeps finding (ADMIN-5's erasure, 5c's breach notification, 5f's listing removal) — a control recording an
-- act no code performs — and it is the first time the act is money leaving the platform.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: `payout_batches` IS EMPTY IN PRODUCTION, FOR A DIFFERENT REASON THAN 0113's TABLE
-- ---------------------------------------------------------------------------
-- The only caller of `PayoutBatchService.runBatch` anywhere in the repository is `WagePriorityLaneJob`, and that job
-- is registered in no module, no worker registry and no SCHEDULED_JOB_REGISTRY. The cadence job's own header says so
-- outright: "WAGE-PRIORITY LANE (WagePriorityLaneJob) — GA-DEFERRED, not wired here".
--
-- So there has never been a payout batch. 0113 found an empty table caused by a broken INSERT whose error was
-- swallowed; this is an empty table caused by a writer nobody scheduled. Two mechanisms, one result, and the result is
-- the same kind of screen: a list with a filter bar and a pager over nothing.
--
-- ---------------------------------------------------------------------------
-- DEFECT 3: `payout.approve` — "Approve payouts" — HAS EXISTED SINCE SEED 0004 AND ONLY EVER GUARDED READS
-- ---------------------------------------------------------------------------
-- db/seeds/core/0004_roles_permissions.sql:47 seeds ('payout.approve','Approve payouts','M05'), and grants it to
-- `tenant_admin`. Its only two uses in the codebase are `@Get('batches')` and `@Get('batches/:id')`. **There is no
-- approve endpoint on any payout path in any app.** A permission named for an act nothing performs is the same defect
-- as a status column naming one, one layer up: it makes an access review read as though the control exists.
--
-- ---------------------------------------------------------------------------
-- DEFECT 4: W067's PREFLIGHT IS FOUR CLAIMS AND NONE OF THEM IS CHECKED AT EXECUTION
-- ---------------------------------------------------------------------------
-- The screen prints "Preflight PASS · no frozen accounts · no KYC gaps" and "214 · all bank-verified accounts".
-- `PayoutService.execute` re-checks NONE of them:
--   • KYC is asserted in `requestPayout` ONLY (the S3 review fix). A farmer verified in March whose `kyc_status`
--     lapsed to 'expired' in July is still paid in August, because nothing looks again.
--   • `bank_accounts.penny_verified_at` is never read on the payout path at all. `loan-disbursement.repository.ts`
--     and `coop-payout.repository.ts` both require it; payouts do not. So "all bank-verified accounts" is a sentence
--     about a column this flow ignores.
--   • `wallet_accounts.is_frozen` blocks a debit inside wallet-service — but a payout's success legs debit
--     PLATFORM payouts and credit PLATFORM gateway. The farmer's own account was debited at REQUEST time. **So
--     freezing a farmer's wallet for suspected fraud does not stop a payout they already requested.** The freeze
--     control in the recon console and the money leaving are, today, unconnected.
-- This migration adds the evidence columns; the re-checks are in apps/api, where the execution is.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES *NOT* DO
-- ---------------------------------------------------------------------------
-- IT DOES NOT REQUIRE A BATCH FOR EVERY PAYOUT, and that is a deliberate line rather than a gap. A farmer requesting
-- their own wallet withdrawal is giving an instruction about their own money: already KYC-gated at request, already
-- funded out of their own reserved balance, and already theirs. Putting a platform checker in front of it would mean a
-- labourer waits for a Krishalaya employee to approve their own wages leaving their own wallet — a control that
-- protects nobody and blocks the thing the platform exists to do. What needs two people is a BATCH: money the platform
-- moves on many people's behalf in one act. So the gate is scoped to batched payouts, and an unbatched payout stays on
-- the timer.
--
-- IT DOES NOT ADD A STATUS COLUMN TO `settlement_statements`. A statement has no lifecycle of its own: it is generated
-- once from lines that are then linked so they cannot be double-counted, and after that it is a document. What W062's
-- cycle chips actually need is the identity of the RUN that produced it, which is `settlement_runs` below. Inventing
-- `settlement_statements.status` would be a column recording transitions no code makes — the exact thing three of the
-- last four waves were spent removing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · THE BATCH BECOMES AN APPROVAL OBJECT
-- ---------------------------------------------------------------------------
-- Realm-identity, for the FIFTH time (ADMIN-2d's support reply, the ticket ATTACH, 0067's checker columns, 0112's
-- `handled_by_admin_id`, now this). A platform operator authenticates from admin-api's self-contained JWT and HAS NO
-- `users` ROW, so these are bare `uuid` columns with no FK — the same shape and the same reason. The three wrong fixes
-- ADMIN-2d enumerated are still the three wrong fixes: invent a platform account inside every tenant's user table,
-- record a tenant's admin instead, or point the FK somewhere it does not belong.
ALTER TABLE payout_batches
  ADD COLUMN IF NOT EXISTS opened_by_admin_id   uuid,
  ADD COLUMN IF NOT EXISTS approved_by_admin_id uuid,
  ADD COLUMN IF NOT EXISTS approved_at          timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by_admin_id uuid,
  ADD COLUMN IF NOT EXISTS returned_at          timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason        text,
  -- The preflight OUTCOME, recorded at approval time rather than recomputed for display later. A checker approved what
  -- they were shown; if the set drifts afterwards the disagreement must be visible, which is impossible if the only
  -- copy of the figures is a live query. Same reasoning as 0112 keeping the hold-time value beside the recomputed one.
  ADD COLUMN IF NOT EXISTS preflight            jsonb,
  ADD COLUMN IF NOT EXISTS preflight_at         timestamptz;

-- THE TENTH MAKER-CHECKER SITE. Shape from `makerNeCheckerConstraint` in
-- apps/admin-api/src/core/approval/two-person-rule.ts — both NULL escapes are load-bearing: every batch row that
-- predates this migration has NULL in both columns, and a constraint without them fails the migration on lawful data.
ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS ck_payout_batches_maker_ne_checker;
ALTER TABLE payout_batches
  ADD CONSTRAINT ck_payout_batches_maker_ne_checker CHECK (
    approved_by_admin_id IS NULL OR opened_by_admin_id IS NULL OR approved_by_admin_id <> opened_by_admin_id);

-- W066 ASKS FOR THIS EXPLICITLY. Its own footnote: "payout_batches.status is unCHECKed varchar (default open) — canon
-- shows open|executed; exact state set to be ratified (BACKEND CONFIRM, catalog note)." Ratified here as the union of
-- what the code's state machine already has (`payout-batch.state.ts`: open|executing|executed|failed) and the two
-- states an approval gate requires. The canon's two-value list was describing the screen's badges, not the lifecycle.
--   open      — created by a maker; payouts may still be claimed into it. NOT executable.
--   approved  — a second operator has signed. THE ONLY STATE FROM WHICH MONEY MAY LEAVE.
--   returned  — sent back to the maker with a reason; terminal (a corrected run is a NEW batch, so the returned one
--               stays on the record as evidence that somebody looked and said no).
--   executing — disbursement in progress.
--   executed  — the run finished; total_minor + count are final.
--   failed    — abandoned before or during execution; reopened as a new batch.
-- NOT VALID: existing rows carry 'open' and are fine, but the platform has never written this table, so validating
-- costs nothing and claiming a validated constraint over data nobody has looked at is worse than being explicit.
ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS ck_payout_batch_status;
ALTER TABLE payout_batches
  ADD CONSTRAINT ck_payout_batch_status CHECK (
    status IN ('open','approved','returned','executing','executed','failed')) NOT VALID;

-- AN APPROVAL WITHOUT AN APPROVER IS THE THING THIS WAVE EXISTS TO MAKE UNREPRESENTABLE. Both directions: a batch that
-- claims to be approved must name who and when, and a batch naming an approver must not still read as open. Without
-- the second half, `status` and `approved_by_admin_id` could disagree, and the console would have to choose which to
-- believe — which is how a status column starts recording an act no code performs.
ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS ck_payout_batch_approval_evidence;
ALTER TABLE payout_batches
  ADD CONSTRAINT ck_payout_batch_approval_evidence CHECK (
    (status IN ('approved','executing','executed')
       AND approved_by_admin_id IS NOT NULL AND approved_at IS NOT NULL)
    OR (status IN ('open','returned','failed'))
  ) NOT VALID;

-- AN `executed_at` ON A BATCH THAT HAS NOT EXECUTED, and this constraint exists because a mutation test asked for it.
-- A console guard refusing to summarise an execution that has not happened survived a deliberate deletion, because every
-- test case had `status` and `executed_at` agreeing — and the reason the guard is load-bearing is precisely that these
-- are two columns nothing forced to agree. `executed_at` is set by `markExecuted` in apps/api and nothing ever clears it,
-- so a batch that failed after a partial run, or a row touched by hand, can carry a timestamp its status contradicts.
-- That is the same defect shape as a status column recording an act no code performed, in miniature: a date recording an
-- act the status denies.
ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS ck_payout_batch_executed_at;
ALTER TABLE payout_batches
  ADD CONSTRAINT ck_payout_batch_executed_at CHECK (
    executed_at IS NULL OR status IN ('executed', 'failed')) NOT VALID;

-- A RETURN OWES THE MAKER A REASON. 20 characters for the same reason 0112 set that floor on a moderation reason: the
-- sentence is read by the person whose work was refused, and "no" is not a review.
ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS ck_payout_batch_return_reason;
ALTER TABLE payout_batches
  ADD CONSTRAINT ck_payout_batch_return_reason CHECK (
    status <> 'returned'
    OR (returned_by_admin_id IS NOT NULL AND returned_at IS NOT NULL AND char_length(btrim(return_reason)) >= 20)
  ) NOT VALID;

-- W066's list is "Created ▾" over a 30-day window with a status filter, and W067's alert strip is "PB-…-02 awaits
-- checker" read across every open batch. Neither had an index; the table is small today and will not stay small at
-- 15,000 tenants.
CREATE INDEX IF NOT EXISTS idx_payout_batches_recent ON payout_batches (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_payout_batches_awaiting ON payout_batches (created_at)
  WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 2 · THE GATE ITSELF, IN THE DATABASE
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A `WHERE` CLAUSE. Fixing `claimQueued`'s SQL is necessary and is done in apps/api — but a
-- money gate that lives in one repository method is one careless query away from being gone, and there is no CHECK
-- constraint that can express it because the condition is in ANOTHER TABLE. Postgres offers exactly one mechanism for
-- a cross-row invariant, so this is that mechanism. 0111 set the precedent with the correction-draft zero-sum: when
-- the rule matters more than the convenience, it goes in a trigger.
--
-- IT FIRES ONLY ON THE TRANSITION OUT OF 'queued', which is the moment money is committed to leaving. Not on INSERT
-- (a payout is legitimately created before any batch exists), not on the later status updates (`processing` →
-- `success` records what the gateway did, and refusing THAT would strand money already sent), and not on a payout with
-- no batch — see the header's note on why an unbatched payout stays on the timer.
CREATE OR REPLACE FUNCTION assert_payout_batch_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_status text;
BEGIN
  -- Only the claim transition. `OLD.status = 'queued' AND NEW.status <> 'queued'` is the whole of it.
  IF OLD.status <> 'queued' OR NEW.status = 'queued' THEN
    RETURN NEW;
  END IF;
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO batch_status FROM payout_batches WHERE id = NEW.batch_id;

  -- A batch_id pointing at no row is not a pass. The FK makes it unreachable today; if a future migration ever drops
  -- or defers that FK, the safe direction on a money gate is to refuse.
  IF batch_status IS NULL THEN
    RAISE EXCEPTION 'payout % names batch % which does not exist; a batched payout cannot execute without an approved batch',
      NEW.id, NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF batch_status NOT IN ('approved','executing') THEN
    RAISE EXCEPTION 'payout % belongs to batch % in status %; money may only leave an approved batch (two-person rule)',
      NEW.id, NEW.batch_id, batch_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 'executing' is accepted as well as 'approved' because the batch is moved to 'executing' BEFORE its payouts are
-- claimed — the run marks itself in progress and then disburses. Accepting only 'approved' would make the trigger
-- refuse every payout in a run that had correctly announced itself, which is the shape of bug that gets a money guard
-- disabled rather than fixed.
DROP TRIGGER IF EXISTS trg_payout_batch_approved ON payouts;
CREATE TRIGGER trg_payout_batch_approved
  BEFORE UPDATE OF status ON payouts
  FOR EACH ROW
  EXECUTE FUNCTION assert_payout_batch_approved();

-- The gate's read: given a set of claimed payouts, which batch are they in and is it approved. `claimQueued` joins on
-- this on every tick.
CREATE INDEX IF NOT EXISTS idx_payouts_batch ON payouts (batch_id) WHERE batch_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3 · THE SETTLEMENT CYCLE GETS AN IDENTITY
-- ---------------------------------------------------------------------------
-- W062 is built entirely around a cycle: "Cycle: 13 Jul", "1,102 statements generated", "Run settlement cycle",
-- "Cycle failed mid-run — completed ones stand, the rest retry. Job log attached", "No statements this cycle — the
-- cycle runs at 18:00 IST daily". `SettlementStatementsJob` already does exactly this work on a cadence and returns
-- `{ generated, skipped, failed }` — TO A LOG LINE. Nothing is persisted, so a cycle has no id, no outcome, and no way
-- to be asked about tomorrow. The counts on that screen were the only unbuildable part of it.
--
-- Deliberately NOT partitioned and NOT tenant-scoped: a cycle spans tenants (the job's scan is cross-tenant), and one
-- row per day is a table that will hold a few thousand rows in a decade. Same shape as `reconciliation_runs`.
CREATE TABLE IF NOT EXISTS settlement_runs (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The cycle window, as the job takes it: [period_start, period_end). Dates, not timestamps — a settlement cycle is a
  -- business day, and the 18:00 IST boundary is the job's schedule rather than a property of the period.
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'running',
  -- Three counts, kept separate for the same reason 0113 separated `checked_count` from `mismatches`: "1,102
  -- generated" and "1,102 looked at, 3 of which failed" are different sentences, and a screen that can only say the
  -- second as the first cannot show W062's mid-run failure state at all.
  sellers_scanned   integer NOT NULL DEFAULT 0,
  generated_count   integer NOT NULL DEFAULT 0,
  failed_count      integer NOT NULL DEFAULT 0,
  gross_minor       bigint  NOT NULL DEFAULT 0,
  commission_minor  bigint  NOT NULL DEFAULT 0,
  tax_minor         bigint  NOT NULL DEFAULT 0,
  net_minor         bigint  NOT NULL DEFAULT 0,
  -- NULL until the run stops. A run that crashed has a NULL here for ever, which is exactly the signal W062's
  -- "Cycle failed mid-run" state needs and is indistinguishable from a run still going only for the length of one tick.
  finished_at       timestamptz,
  -- Who asked. NULL for the cadence, an admin uuid for the on-demand run from the console. Bare uuid, no FK: the
  -- realm-identity rule again.
  triggered_by_admin_id uuid,
  failure_detail    text
);
CALL add_std_columns('settlement_runs');

ALTER TABLE settlement_runs
  ADD CONSTRAINT ck_settlement_run_status CHECK (status IN ('running','completed','partial','failed'));
-- 'partial' is its own status rather than 'completed with failures', because W062's copy is precise about what it
-- means — "Settlement is transactional per statement — completed ones stand, the rest retry" — and an operator needs to
-- know at a glance whether a cycle needs a second look. Folding it into 'completed' would hide the one state that
-- requires action.
ALTER TABLE settlement_runs
  ADD CONSTRAINT ck_settlement_run_finished CHECK (
    (status = 'running' AND finished_at IS NULL) OR (status <> 'running' AND finished_at IS NOT NULL));
ALTER TABLE settlement_runs
  ADD CONSTRAINT ck_settlement_run_period CHECK (period_end >= period_start);
ALTER TABLE settlement_runs
  ADD CONSTRAINT ck_settlement_run_counts CHECK (
    sellers_scanned >= 0 AND generated_count >= 0 AND failed_count >= 0
    AND generated_count + failed_count <= sellers_scanned);

CREATE INDEX IF NOT EXISTS idx_settlement_runs_recent ON settlement_runs (created_at DESC, id DESC);
-- One cycle per period is the intent, but NOT a unique index: a failed cycle is legitimately re-run for the same
-- period, and a UNIQUE (period_start, period_end) would make the retry W062 offers impossible. Partial unique on the
-- successful ones instead — two COMPLETED runs for one day would mean statements generated twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_run_completed_period
  ON settlement_runs (period_start, period_end) WHERE status = 'completed';

-- The statement's link back to the cycle that made it. Nullable, because every statement generated before this
-- migration has no run to point at, and backfilling one would be inventing a cycle that never had an identity.
ALTER TABLE settlement_statements
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES settlement_runs(id);
CREATE INDEX IF NOT EXISTS idx_settlement_statements_run ON settlement_statements (run_id) WHERE run_id IS NOT NULL;
-- W062's list is "cycle 13 Jul, 1,102 statements, tenant filter, keyset pager". `settlement_statements` had no index
-- serving it — the only indexes on the table are the PK and `UNIQUE (tenant_id, statement_no)`.
CREATE INDEX IF NOT EXISTS idx_settlement_statements_period
  ON settlement_statements (period_end DESC, created_at DESC, id DESC);

-- W442's ANCHOR. The screen says the PDF is "hash-anchored to the zero-sum ledger", prints "sha256 88ac…17fe", and has
-- a CHECKSUM MISMATCH state — "File no longer matches the ledger hash — quarantined, alert raised; ledger remains the
-- truth." `settlement_statements` has `pdf_media_id` and no hash column, so that state could not be reached even in
-- principle. ADMIN-5c built the digest facility (`core/export/receipt.ts`); this gives the statement somewhere to keep
-- one. NULL means never computed and is reported as such — the ADMIN-6 rule about a claim with no date behind it.
ALTER TABLE settlement_statements
  ADD COLUMN IF NOT EXISTS pdf_sha256 char(64),
  ADD COLUMN IF NOT EXISTS pdf_hashed_at timestamptz;
ALTER TABLE settlement_statements
  DROP CONSTRAINT IF EXISTS ck_settlement_stmt_pdf_hash;
ALTER TABLE settlement_statements
  ADD CONSTRAINT ck_settlement_stmt_pdf_hash CHECK (
    (pdf_sha256 IS NULL AND pdf_hashed_at IS NULL)
    OR (pdf_sha256 ~ '^[0-9a-f]{64}$' AND pdf_hashed_at IS NOT NULL)) NOT VALID;

-- ---------------------------------------------------------------------------
-- 4 · GRANTS
-- ---------------------------------------------------------------------------
-- The 0014/0018 `ALTER DEFAULT PRIVILEGES` trap: a new table is granted to roles nobody named, so every REVOKE below
-- is explicit and deliberate rather than defensive noise.
--
-- `settlement_runs` is written by the JOB (kv_relay, which already owns settlement_statements generation per 0079) and
-- read by the console. kv_admin also INSERTs, because W062's "Run settlement cycle" is an operator act and the run row
-- must name them — a console-triggered cycle whose row said `triggered_by_admin_id IS NULL` would be
-- indistinguishable from the cadence.
REVOKE ALL ON settlement_runs FROM kv_app;
GRANT SELECT, INSERT, UPDATE ON settlement_runs TO kv_relay;
GRANT SELECT, INSERT, UPDATE ON settlement_runs TO kv_admin;
GRANT SELECT ON settlement_runs TO kv_readonly;
-- No DELETE to anybody. A settlement cycle is a financial record; the correction for a wrong one is another run.

-- `payout_batches` — kv_admin must now WRITE it, which it could not before. This is the 0067 finding in miniature
-- (a table built for an operator who had no grant on it): the approval columns above are useless to a realm that can
-- only read.
GRANT SELECT, INSERT, UPDATE ON payout_batches TO kv_admin;
-- The console must read the payouts inside a batch to render W067's line items and compute the preflight. READ ONLY:
-- admin-api is not a money writer and must never become one — `wallet-service` is the only writer (Law 2) and the
-- payout executor lives in apps/api. An UPDATE grant here would let the god-mode realm mark a payout succeeded
-- without a gateway ever having been called.
GRANT SELECT ON payouts TO kv_admin;
REVOKE INSERT, UPDATE, DELETE ON payouts FROM kv_admin;
-- W063's order lines and W062's totals.
GRANT SELECT ON settlement_statements TO kv_admin;
GRANT SELECT ON settlement_lines TO kv_admin;
-- W067's preflight needs the bank account's verification state and nothing else about it. SELECT only, and the console
-- must project `penny_verified_at IS NOT NULL` rather than any account detail — a batch review is not a reason to see
-- 214 farmers' account numbers.
GRANT SELECT ON bank_accounts TO kv_admin;

-- ---------------------------------------------------------------------------
-- 5 · RLS SWEEP
-- ---------------------------------------------------------------------------
-- `settlement_runs` is cross-tenant by nature (the cycle scans every tenant), so it carries no `tenant_id` and gets no
-- policy — the same reasoning as `reconciliation_runs` and `ledger_chain_verifications` (0113). Recorded explicitly
-- because 0020 once claimed RLS on a table that had none, and the correction cost a wave's detour to find.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'settlement_runs' AND rowsecurity
  ) THEN
    RAISE NOTICE 'settlement_runs has RLS enabled; it is a cross-tenant operational table and should not';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6 · THE NOTIFICATION THE FARMER WAS NEVER SENT
-- ---------------------------------------------------------------------------
-- 0068 seeded `payout.credited` ("Payout credited", important, push|sms|email) as part of the DELTA-051 event family.
-- **NOTHING IN THE CODEBASE EMITS IT.** `PayoutService.execute` writes `payments.payout_succeeded` to the outbox — a
-- different code, consumed by no notification handler. So W063's "Farmer SMS queued — celebratory Gujarati message
-- sends on payout success" and W067's "farmers get the celebratory SMS on success" describe a message that has never
-- been sent to anybody.
--
-- AND THE TEMPLATES ARE THE HALF THAT WOULD HAVE FAILED SILENTLY. 0101's header warned about this and 0112 hit it:
-- `NotificationService.fanout` is fail-closed on an unknown event code, and `dispatchOne` renders
-- `{ subject: null, body: '' }` when no template row matches. An emitter without templates means a farmer receives a
-- genuine Krishalaya notification CONTAINING NOTHING while the row says delivered. So the templates ship here, in the
-- migration that the emitter depends on, because a seed can be skipped and a migration cannot.
--
-- `{{amount}}` is rendered from the payout's `amount_minor` by the emitter — a bigint formatted once, server-side,
-- never a float. The bank reference is the last four digits only.
INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, provider_template_ref, is_active)
SELECT v.event_code, v.channel, v.language_code, NULL, v.subject, v.body, NULL, true
FROM (VALUES
  ('payout.credited', 'inapp', 'en', 'Money sent to your bank',
    '{{amount}} has been sent to your bank account ending {{last4}}. It usually arrives within a few hours.'),
  ('payout.credited', 'inapp', 'hi', 'Aapke bank mein paisa bhej diya gaya',
    '{{amount}} aapke bank account (…{{last4}}) mein bhej diya gaya hai. Aam taur par kuch ghanton mein pahunch jata hai.'),
  ('payout.credited', 'inapp', 'gu', 'Tamara bank ma paisa mokli didha',
    '{{amount}} tamara bank account (…{{last4}}) ma mokli didha chhe. Sadharan rite thoda kalak ma pahonchi jay chhe.'),
  ('payout.credited', 'push', 'en', 'Krishalaya · {{amount}} sent', 'Sent to your bank account ending {{last4}}.'),
  ('payout.credited', 'push', 'hi', 'Krishalaya · {{amount}} bheja', 'Aapke bank account …{{last4}} mein bhej diya.'),
  ('payout.credited', 'push', 'gu', 'Krishalaya · {{amount}} mokalyu', 'Tamara bank account …{{last4}} ma mokli didhu.')
) AS v(event_code, channel, language_code, subject, body)
WHERE EXISTS (SELECT 1 FROM languages l WHERE l.code = v.language_code)
ON CONFLICT DO NOTHING;

-- NO SMS ROW. Third migration running that this omission has to be written down: an Indian transactional SMS needs a
-- DLT-registered template id, the ids do not exist, 0101's placeholders had to be deactivated the day they shipped,
-- and 0112 declined for the same reason. W063 and W067 both say SMS specifically — so this is a HALF-KEPT promise and
-- the console says which half. The farmer is told in-app and by push today; SMS is one INSERT the day the ids arrive.
-- Named as ADMIN-6b-Q1 rather than papered over with a row that renders to nothing.

-- ---------------------------------------------------------------------------
-- 7 · THE OWNER-REALM PERMISSIONS THESE SCREENS NAME
-- ---------------------------------------------------------------------------
-- Recorded here as a comment because owner-realm permissions are code, not rows — `apps/admin-api/src/core/rbac/
-- owner-roles.ts` is the register, and admin-api has NO database identity by design (that is the whole point of the
-- two-realm split). The tenant-side `payout.approve` in seed 0004 is a DIFFERENT permission in a DIFFERENT realm and
-- is deliberately left alone: it governs a tenant admin approving their own members' payouts, which is not what W066
-- describes. This wave adds `payout.approve` and `settlement.read` to the OWNER register, plus `ledger.settle` which
-- W062's restricted state names for running a cycle.
--
-- ---------------------------------------------------------------------------
-- 8 · THE NOT VALID CONSTRAINTS, AND WHY
-- ---------------------------------------------------------------------------
-- `ck_payout_batch_status`, `ck_payout_batch_approval_evidence`, `ck_payout_batch_return_reason` and
-- `ck_settlement_stmt_pdf_hash` are NOT VALID: they bind every future write immediately and do not scan existing rows.
-- The batch ones are safe by inspection (the table has never been written), and the statement hash one is safe by
-- construction (both new columns are NULL everywhere). VALIDATE CONSTRAINT belongs in a later migration run against
-- real data with a look at the distinct values first — the standing debt item that now covers 0110–0114.
