-- =============================================================================================
-- 0143_payout_approval_gate.sql · PC-56 TENANT-4b — MONEY OUT TO FARMERS GETS THE GATE ITS SCREENS PROMISE
-- =============================================================================================
-- W145 (Payouts) and W146 (Payout Batch Approval) are the FPO paying its members and workers.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): THERE IS NO APPROVAL. MONEY MOVES WITH ZERO HUMANS, NOT TWO.
-- ---------------------------------------------------------------------------------------------
-- W146: "Approve batch (maker-checker)" - "Maker: Priya S. (finance staff, prepared 14:02). You are the
-- checker." - "After 17:30 the batch locks; unapproved batches roll to tomorrow - MONEY NEVER MOVES
-- WITHOUT TWO HUMANS." W145 repeats it: "payouts execute only through batch approval (maker-checker)".
--
-- The batch state machine is `open -> executing -> executed | failed`. There is no approved state, no
-- rejected state, no maker, no checker, no cut-off, no scheduled execution time, and no decision note.
-- `PayoutBatchService.runBatch` opens a batch, claims queued payouts, marks it executing and disburses
-- every one of them inside a single function call. A cron tick is the only actor. The screens describe a
-- two-person control over a farmer's money that exists in no file.
--
-- And `payout.approve` - seeded in 0004 and granted to tenant_admin - guards exactly two things today:
-- `GET /v1/payouts/batches` and `GET /v1/payouts/batches/:id`. A permission named "Approve payouts" that
-- confers the right to LOOK at them. Same class as 0139's `order.refund` (a string on two screens) with
-- the inverse shape: the key exists, the lock does not.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: THE BATCH READS ARE NOT TENANT-SCOPED. THIS ONE IS LIVE AND IT LEAKS.
-- ---------------------------------------------------------------------------------------------
-- `PayoutBatchRepository.list` builds `WHERE 1=1` and adds only status/batchType/cursor. `getById` is
-- `WHERE id=$1`. Neither takes a tenant id, and the controller passes none. `payout_batches` sits outside
-- tenant RLS as an operational table, so any holder of `payout.approve` in tenant A can list tenant B's
-- payout runs with their totals and counts, and open any batch by id. That is a Law 1 breach in shipped
-- code and a Rule Zero breach (a query that reads every tenant). 0143 closes it in the database as well
-- as in the code: RLS with an explicit policy, because the worker roles hold BYPASSRLS (0018) and are
-- unaffected, while kv_app must never again see another tenant's run.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: W146's FOUR PRE-FLIGHT CHECKS - ONE EXISTS, ONE IS ARITHMETIC NOBODY DOES, TWO HAVE NO SOURCE
-- ---------------------------------------------------------------------------------------------
--   "42/42 payees KYC-verified with verified bank accounts"  -> the per-payout KYC gate EXISTS
--                                                               (domain/payout-kyc.ts) but is never
--                                                               aggregated over a batch before a run.
--   "Sum of items = batch total (server-verified, not UI math)" -> nothing computes it; the batch total is
--                                                               ACCUMULATED as payouts succeed, so before
--                                                               a run there is no total to compare.
--   "Batch total <= main available"                          -> never checked at batch level. Each payout
--                                                               fails individually on insufficient funds,
--                                                               which is how a run half-pays a village.
--   "No payee flagged by risk desk - no frozen accounts"     -> THERE IS NO RISK DESK. `grep -rn
--                                                               "risk_flag|risk_desk"` over db/ returns
--                                                               nothing. The frozen-account half is real
--                                                               (wallet_accounts.is_frozen).
-- The pre-flight is therefore recorded as EVIDENCE with a verdict per check, and a check whose source does
-- not exist reports `unverifiable` - never a tick. 4a's rule, applied to a control that stops money.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: THE TENANT CONSOLE'S /payouts IS THE STAFF MEMBER'S OWN WITHDRAWAL FORM
-- ---------------------------------------------------------------------------------------------
-- Second instance of the class TENANT-4a named (right-shaped figure, wrong subject): the page under a
-- sidebar reading "Money > Payouts" lets the signed-in user withdraw from their OWN wallet to their OWN
-- bank account. W145 is the FPO's outbound queue - 42 farmers, wage lane, milk-bill cycle. The personal
-- surface is real and keeps working; it moves to /payouts/my and the org queue takes /payouts.
--
-- ---------------------------------------------------------------------------------------------
-- ROLLOUT (Law 10, and the reason this is a flag rather than a hard switch)
-- ---------------------------------------------------------------------------------------------
-- Requiring approval changes when money moves in a running pilot. `payout_batch_approval` (default OFF)
-- decides whether the executor REFUSES an unapproved tenant batch. Two things happen regardless of the
-- flag, because neither can be justified for a single day longer: a batch whose approval was REJECTED is
-- never executed, and the batch reads are tenant-scoped.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 143.1  THE BATCH BECOMES SOMETHING A HUMAN SIGNS
-- ---------------------------------------------------------------------------------------------
ALTER TABLE payout_batches
  ADD COLUMN IF NOT EXISTS prepared_by             uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS prepared_at             timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by              uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decided_at              timestamptz,
  ADD COLUMN IF NOT EXISTS decision_note           text,
  ADD COLUMN IF NOT EXISTS cut_off_at              timestamptz,
  ADD COLUMN IF NOT EXISTS execute_at              timestamptz,
  -- The threshold IN FORCE when the signature was given, pinned per row: a later settings change must not
  -- rewrite what a signature meant (0139's rule, and the reason an audit of a past run is answerable).
  ADD COLUMN IF NOT EXISTS checker_threshold_minor bigint,
  -- The pre-flight evidence AS AT the decision. Not a cache of today's answer - the checker signed for
  -- what was true when they signed, and a re-computed panel months later cannot tell an auditor that.
  ADD COLUMN IF NOT EXISTS preflight               jsonb,
  ADD COLUMN IF NOT EXISTS items_total_minor       bigint;

COMMENT ON COLUMN payout_batches.items_total_minor IS
  'PC-56 TENANT-4b: the sum of the CLAIMED payouts at preparation time. total_minor accumulates as payouts SUCCEED, so before a run it is 0 and cannot be the figure a checker approves. W146''s "sum of items = batch total (server-verified, not UI math)" compares these two.';
COMMENT ON COLUMN payout_batches.status IS
  'open (platform sweep, no tenant approval plane) | pending_approval | approved | rejected | expired (cut-off passed unapproved - rolls to tomorrow as a NEW batch) | executing | executed | failed.';

-- ---------------------------------------------------------------------------------------------
-- 143.2  THE CONSTRAINTS THAT MAKE THE PROMISE STRUCTURAL
-- ---------------------------------------------------------------------------------------------
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_status;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_status
  CHECK (status IN ('open', 'pending_approval', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed'));

-- MAKER <> CHECKER, in the schema and not only in the service. NOTE THE ORDER OF THE PREDICATE: both
-- columns are asserted NOT NULL *first*. `decided_by <> prepared_by` alone evaluates to NULL when either
-- is NULL, and A CHECK THAT EVALUATES TO NULL PASSES - the defect 0139's note floors shipped with and the
-- live apply caught. Below the threshold the same person may sign their own batch (see 143.4), so the
-- distinctness is required only when a threshold was pinned and the total reached it.
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_maker_ne_checker;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_maker_ne_checker
  CHECK (
    decided_by IS NULL
    OR checker_threshold_minor IS NULL
    OR COALESCE(items_total_minor, 0) < checker_threshold_minor
    OR (prepared_by IS NOT NULL AND decided_by <> prepared_by)
  );

-- A DECISION CARRIES ITS REASON. Same NOT-NULL-first shape, same 20-character floor as every other note
-- in this programme (refunds 0139, charges 0141) so an operator who has learned one has learned all.
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_decision_note;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_decision_note
  CHECK (
    status <> 'rejected'
    OR (decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20)
  );

-- A DECIDED BATCH HAS A DECIDER, AND AN APPROVED ONE HAS A TIME IT WILL RUN.
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_decision_shape;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_decision_shape
  CHECK (
    status NOT IN ('approved', 'rejected')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  );
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_execute_window;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_execute_window
  CHECK (cut_off_at IS NULL OR execute_at IS NULL OR cut_off_at <= execute_at);

-- A TENANT BATCH IN THE APPROVAL PLANE IS PREPARED BY SOMEBODY. A platform sweep (tenant_id IS NULL,
-- status 'open') has no maker, and this is where those two shapes are kept apart.
ALTER TABLE payout_batches DROP CONSTRAINT IF EXISTS ck_payout_batch_plane;
ALTER TABLE payout_batches ADD CONSTRAINT ck_payout_batch_plane
  CHECK (
    status IN ('open', 'executing', 'executed', 'failed')
    OR (tenant_id IS NOT NULL AND prepared_by IS NOT NULL AND prepared_at IS NOT NULL)
  );

-- ONE OPEN BATCH PER (tenant, type): two makers cannot prepare two batches over the same queue and have
-- a checker approve both, paying every farmer twice. The race guard 0139 needed for refunds, here for runs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_batch_pending
  ON payout_batches (tenant_id, batch_type)
  WHERE status IN ('pending_approval', 'approved');

-- ---------------------------------------------------------------------------------------------
-- 143.3  THE ISOLATION FIX (DEFECT 2) - IN THE DATABASE, NOT ONLY IN THE QUERY
-- ---------------------------------------------------------------------------------------------
-- The worker's roles hold BYPASSRLS (kv_relay, 0018) so the disbursement path is untouched. kv_app now
-- cannot see another tenant's run even if a future query forgets its predicate - and the read-model's
-- funnel is still written as though the policy did not exist, because two independent gates is the point.
ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payout_batches ON payout_batches;
DROP POLICY IF EXISTS payout_batches_read ON payout_batches;
CREATE POLICY payout_batches_read ON payout_batches FOR SELECT
  USING (tenant_id = current_tenant_id());
-- Deliberately NO write policy for kv_app: a batch is prepared and decided through the service, which runs
-- as the app role, so the two write policies below are scoped to the caller's own tenant and nothing else.
DROP POLICY IF EXISTS payout_batches_insert ON payout_batches;
CREATE POLICY payout_batches_insert ON payout_batches FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS payout_batches_update ON payout_batches;
CREATE POLICY payout_batches_update ON payout_batches FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- A run is history. It is never deleted, by anybody.
REVOKE DELETE, TRUNCATE ON payout_batches FROM kv_app;

CREATE INDEX IF NOT EXISTS idx_payout_batch_tenant_status
  ON payout_batches (tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 143.4  THE KEYS AND THE THRESHOLD
-- ---------------------------------------------------------------------------------------------
-- The MAKER's key. W146: "Maker: Priya S. (finance staff, prepared 14:02)". Preparing a batch is not
-- approving one, and 0004 has no permission for it - so `payout.approve` was doing both jobs badly (in
-- fact neither: it gated two GETs). tenant_admin holds both by default; an FPO that wants a finance clerk
-- to prepare runs without signing them grants ONLY this one, per person, through staff_permission_overrides.
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('payout.prepare', 'Prepare a payout batch for approval (maker)', 'M05')
ON CONFLICT (code) DO NOTHING;

-- roles is a PLATFORM table with no tenant_id column (TENANT-4a learned this the hard way, from a live
-- apply). Predicate matches 0139's, which is the one that has actually run.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'payout.prepare' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- W145: "batch approval needs payout.approve + checker above Rs 1,00,000." A SETTING, not a constant
-- (Law 6), on the money path, and pinned per batch at signature time. Note the honest reading of the two
-- screens together: W146 says "money never moves without two humans" unconditionally while W145 states a
-- threshold. The threshold is what the platform ships as its default; a tenant that wants every batch
-- double-signed sets it to 0, and the screen prints the rule actually in force rather than a slogan.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'payouts.batch_checker_threshold_minor', 'int', 'tenant', 'money_path', '10000000'::jsonb,
       'Batch total (minor units) at or above which the approver MUST be a different person than the maker. Default Rs 1,00,000 per W145. Set 0 to require two humans on every batch.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'payouts.batch_checker_threshold_minor');

-- W146's "cut-off 17:30 - executes 18:00". Stored as MINUTES BEFORE EXECUTION rather than a wall-clock
-- time, because a wall-clock default is a hidden timezone assumption and this platform ships to five
-- countries by Y7 (Rule Zero). The maker submits the execution instant from a console that renders it in
-- their own locale; the cut-off is derived.
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description)
SELECT 'payouts.batch_cut_off_minutes', 'int', 'tenant', 'money_path', '30'::jsonb,
       'Minutes before execution at which a prepared batch locks. After the cut-off an unapproved batch expires and rolls to a NEW batch (W146), so nobody signs a queue that has moved on.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'payouts.batch_cut_off_minutes');

-- ---------------------------------------------------------------------------------------------
-- 143.5  THE FLAG (Law 10) - default OFF, kill-switch, named for what it gates
-- ---------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'payout_batch_approval',
       'PC-56 TENANT-4b: the executor refuses a tenant payout batch that has not been approved (W146). OFF keeps the pilot''s cron-driven sweep behaviour. A REJECTED batch is never executed regardless of this flag.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'payout_batch_approval');

-- ---------------------------------------------------------------------------------------------
-- 143.6  DEFECT 5: "AUTO-RETRY WITH BACKOFF" HAS NO ATTEMPT COUNTER AND NO RETRY TIME
-- ---------------------------------------------------------------------------------------------
-- W145's failed tab: "bank-side; auto-retry with backoff, farmer notified honestly" and, on the row
-- itself, "retry 16:00 - priority lane". `payouts` records `failure_code` and `failure_reason` and NOTHING
-- about attempts: no counter, no next-attempt time. So backoff cannot exist (there is no attempt number to
-- back off from), a retry cannot be scheduled (there is nowhere to put the time), and the screen cannot
-- print "16:00" because nothing knows it. The state machine's `failed -> queued` edge means a requeued
-- payout is claimed by the very next 5-minute tick - which is not backoff, it is a tight loop against a
-- bank that just said no.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS auto_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

COMMENT ON COLUMN payouts.auto_attempts IS
  'PC-56 TENANT-4b: how many times this payout has been requeued after a failure. Bounded by the domain (4 attempts at 15m/1h/4h/24h); beyond that the row says a human must look rather than showing "retrying" forever.';
COMMENT ON COLUMN payouts.next_retry_at IS
  'PC-56 TENANT-4b: the exact time the next attempt becomes claimable - W145 prints it ("retry 16:00"). The claim queries filter on it, so a requeued payout is not picked up by the next tick.';

CREATE INDEX IF NOT EXISTS idx_payout_claimable
  ON payouts (status, priority, created_at)
  WHERE batch_id IS NULL;

ALTER TABLE payouts DROP CONSTRAINT IF EXISTS ck_payout_retry_shape;
ALTER TABLE payouts ADD CONSTRAINT ck_payout_retry_shape
  CHECK (auto_attempts >= 0 AND (next_retry_at IS NULL OR auto_attempts > 0));
