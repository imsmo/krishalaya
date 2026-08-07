-- ============================================================================
-- MIGRATION 0113 — THE LEDGER'S OWN TRUTH: A RECON TABLE THAT HAS ROWS, AND A HASH CHAIN SOMEBODY READS
-- (PC-56 ADMIN-6)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- DEFECT 1: `reconciliation_runs` IS EMPTY IN PRODUCTION, AND HAS BEEN ALL ALONG
-- ---------------------------------------------------------------------------
-- Four writers exist for this table. Three are dead code. The ONE that is scheduled —
-- `apps/worker/src/jobs/recon-zero-sum.job.ts` — writes this:
--
--     INSERT INTO reconciliation_runs (id, check_type, window_hours, checked_count, mismatch_count, ok,
--                                      started_at, finished_at) ...
--       .catch(() => { /* schema variance tolerated; the gauge is the alert source */ });
--
-- `check_type`, `window_hours`, `mismatch_count`, `ok` and `started_at` ARE NOT COLUMNS OF THIS TABLE. The real
-- columns are `run_type`, `period_start`, `period_end` — all three NOT NULL, all three omitted. Every execution has
-- raised 42703 undefined_column since the job shipped, and the `.catch(() => {})` swallowed it.
--
-- **SO W006 HAS BEEN AN EMPTY SCREEN, AND SO HAS EVERY RECON READ IN THE CONSOLE.** `GET /v1/recon/overview`,
-- `/recon/runs`, `/recon/runs/:id` all query a table with no rows. An operator opening the reconciliation console
-- sees nothing and has no way to tell "the ledger is clean" from "nothing has ever been checked".
--
-- AND THE ALERT DESIGNED TO CATCH EXACTLY THAT IS ITSELF BLIND. `WalletReconStale` fires on
-- `kv_recon_age_seconds > 7200`, and the job sets that gauge to **0** on every tick with the comment "fresh as of
-- this run". Nothing anywhere sets it high. So the series reads healthy while the table is empty: the gauge measures
-- whether the job RAN, not whether it RECORDED anything, and those came apart the day the INSERT broke.
--
-- The job fix is in apps/worker. What this migration adds is the thing that would have caught it: constraints, so a
-- wrong column list fails loudly rather than being swallowed, and the run types written down as data.
--
-- ---------------------------------------------------------------------------
-- DEFECT 2: THE HASH CHAIN IS WRITTEN AND NOBODY HAS EVER READ IT
-- ---------------------------------------------------------------------------
-- `ledger_entries.entry_hash` is `sha256(prev ‖ txn_id ‖ account_id ‖ amount_minor ‖ balance_after_minor)`, computed
-- in two places (`apps/wallet-service/src/ledger/hash-chain.ts` and a private duplicate in apps/api's in-process
-- client) and persisted on every entry. `wallet_accounts.last_entry_hash` holds the head.
--
-- **`prev_hash` IS NEVER SELECTED ANYWHERE IN THE CODEBASE.** Nothing recomputes a hash, nothing compares one, there
-- is no unique index on `entry_hash`, and no trigger asserts that a new entry's `prev_hash` equals the account's
-- current head. `last_entry_hash` is read in exactly one place — `lockAccount` — and only to EXTEND the chain.
--
-- W064 offers "Verify chain (period)". W065 offers "Verify hashes" and says a mismatch "is a P0 incident, not a
-- retry". W006 prints "hash chain intact". None of those had anything behind them: "tamper-evident" was a comment.
--
-- WHY THERE IS NO DATABASE-LEVEL FORK GUARD HERE, AND IT IS NOT AN OVERSIGHT. The obvious constraint is
-- `UNIQUE (account_id, prev_hash)` — it makes a forked chain unrepresentable. **Postgres will not accept it.**
-- `ledger_entries` is `PARTITION BY RANGE (created_at)`, and a unique index on a partitioned table must contain the
-- partition key; `UNIQUE (account_id, prev_hash, created_at)` would happily admit two entries sharing a `prev_hash`
-- a microsecond apart, which is exactly the fork it was meant to forbid. So the guarantee is what it always was — the
-- `FOR UPDATE` row lock on the account while the chain is extended — plus, from this migration on, a VERIFIER that
-- recomputes and a table that records what it found. Named rather than approximated.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `reconciliation_runs`: THE ENUMS THAT WERE COMMENTS, AND THE INDEX THE CONSOLE NEEDS
-- ---------------------------------------------------------------------------
-- 0006 documented `hourly_internal|daily_gateway|zero_sum_check` in a trailing comment and CHECKed nothing. Had this
-- constraint existed, the broken worker INSERT would have failed on a constraint rather than on a missing column —
-- but more usefully, the enum is now a fact a reader can rely on instead of a note that drifted.
--
-- FIVE TYPES, AND TWO OF THEM ARE NEW BECAUSE THE PLATFORM ACTUALLY RUNS THEM:
--   • `zero_sum_monitor` — the 5-minute bounded check the worker performs. It is genuinely NOT `zero_sum_check`: one
--     is a fast recent-window monitor feeding a gauge, the other is a full snapshot. Renaming the worker's rows to
--     `zero_sum_check` would have made a 5-minute sample look like a complete audit.
--   • `internal_balance` — the per-account `cached_balance_minor` vs `SUM(amount_minor)` drift check. The query has
--     existed twice since 0006 (`runInternalBalanceCheck`, in both wallet-service and apps/api) and NEITHER COPY HAS
--     EVER RUN. It is the only check that catches a denormalised balance drifting from the ledger, and it is wired in
--     this wave.
--   • `chain_verify` — the hash-chain recompute this migration makes recordable.
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_recon_run_type CHECK (
  run_type IN ('hourly_internal', 'daily_gateway', 'zero_sum_check', 'zero_sum_monitor', 'internal_balance', 'chain_verify')
) NOT VALID;
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_recon_status CHECK (
  status IN ('running', 'completed', 'ok', 'mismatch', 'failed')
) NOT VALID;
-- NOT VALID on both: the table is empty in production but a founder's staging box may carry hand-made fixtures, and a
-- validating scan that aborts the migration over one of them helps nobody. Same reasoning as 0108–0112.
--
-- `ok` and `mismatch` are kept alongside `completed` rather than normalised away. The two dead services write them
-- and this wave wires one of those services; collapsing them into `completed` would lose the distinction the service
-- already draws, and a migration is the wrong place to redesign a status vocabulary that three writers share.

-- W006's board reads the latest run PER TYPE (`DISTINCT ON (run_type) … ORDER BY run_type, created_at DESC`) and the
-- runs list pages by `created_at DESC`. Neither had an index: the table has only its primary key, so both were sorts
-- over the whole table. Harmless while it was empty, and the first thing to hurt once it is not.
CREATE INDEX idx_recon_runs_type_recent ON reconciliation_runs (run_type, created_at DESC);
CREATE INDEX idx_recon_runs_recent ON reconciliation_runs (created_at DESC, id);

COMMENT ON TABLE reconciliation_runs IS
  'Ledger integrity runs (W006). Every row is one execution of one check. UNTIL 0113 THIS TABLE WAS EMPTY IN PRODUCTION: the only scheduled writer INSERTed five columns that do not exist and swallowed the resulting 42703, so the whole reconciliation console showed nothing and could not distinguish a clean ledger from an unchecked one.';

-- ---------------------------------------------------------------------------
-- 2. THE HASH-CHAIN VERIFICATION RECORD
-- ---------------------------------------------------------------------------
-- W006 prints "hash chain intact" and W059 prints "intact" per platform account code. Those were assertions with
-- nothing behind them. A claim about tamper-evidence is worth exactly as much as the last time somebody checked, so
-- the console must be able to say WHEN — and "never" is the honest answer until a row exists here.
CREATE TABLE ledger_chain_verifications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- The account whose chain was walked. Bare uuid, no FK: `wallet_accounts` rows are never deleted, and a
  -- verification of an account that has since been archived is still a fact worth keeping.
  account_id      uuid NOT NULL,
  -- NULL = the whole chain from its first entry. Set when a bounded window was walked, because a verification of the
  -- last 24 hours must not be readable as a verification of everything.
  from_created_at timestamptz,
  to_created_at   timestamptz NOT NULL,

  entries_checked integer NOT NULL CHECK (entries_checked >= 0),
  outcome         varchar(16) NOT NULL CHECK (outcome IN ('intact', 'broken', 'incomplete')),
  -- `incomplete` is a first-class outcome and not a failure to report. A window that starts mid-chain cannot be
  -- verified from its first entry — the walk has no anchor — so it reports what it is rather than claiming intact.
  -- Same rule as every other unknown-vs-zero decision in this console.

  -- WHERE it broke, when it broke. The entry whose recomputed hash disagreed, and both values, so a P0 responder has
  -- the evidence in the row rather than having to re-run the thing that just failed.
  broken_at_entry_id  bigint,
  expected_hash    varchar(64),
  stored_hash      varchar(64),

  -- The head the account claimed when the walk finished, so a later reader can tell whether the chain has moved.
  head_hash        varchar(64),
  verified_by      uuid,            -- bare uuid: a platform operator, or NULL for a scheduled run
  run_id           uuid REFERENCES reconciliation_runs(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- A broken chain names the entry and both hashes. Without this, `broken` could mean "we think so".
  CONSTRAINT ck_lcv_broken_evidence CHECK (
    outcome <> 'broken'
    OR (broken_at_entry_id IS NOT NULL AND expected_hash IS NOT NULL AND stored_hash IS NOT NULL)
  ),
  -- …and an INTACT result must not carry break evidence, which would be a row disagreeing with itself.
  CONSTRAINT ck_lcv_intact_clean CHECK (
    outcome <> 'intact' OR (broken_at_entry_id IS NULL AND expected_hash IS NULL AND stored_hash IS NULL)
  ),
  CONSTRAINT ck_lcv_window CHECK (from_created_at IS NULL OR from_created_at <= to_created_at)
);
CREATE INDEX idx_lcv_account ON ledger_chain_verifications (account_id, created_at DESC);
-- The console's "when was anything last verified" read, and the one that finds breaks first.
CREATE INDEX idx_lcv_broken ON ledger_chain_verifications (created_at DESC) WHERE outcome = 'broken';

COMMENT ON TABLE ledger_chain_verifications IS
  'Append-only record of hash-chain recomputations over ledger_entries (W064 "Verify chain", W065 "Verify hashes"). Before 0113 nothing in the platform ever read prev_hash: the chain was written on every entry and never checked, so "tamper-evident" was a comment and W006''s "hash chain intact" had nothing behind it. A `broken` row is a P0 incident and carries the entry id and both hashes so a responder does not have to re-run the failing walk.';
COMMENT ON COLUMN ledger_chain_verifications.outcome IS
  'intact | broken | incomplete. `incomplete` means the window began mid-chain so the walk had no anchor — reported rather than claimed intact.';

REVOKE ALL ON ledger_chain_verifications FROM kv_app, kv_relay;
GRANT SELECT, INSERT ON ledger_chain_verifications TO kv_admin;
-- kv_relay INSERTs because the scheduled verifier runs in apps/worker under that role. SELECT too, so the job can
-- read its own last watermark and avoid re-walking what it walked five minutes ago.
GRANT SELECT, INSERT ON ledger_chain_verifications TO kv_relay;
GRANT SELECT ON ledger_chain_verifications TO kv_readonly;
-- No UPDATE and no DELETE for anybody. A verification result that can be edited is not evidence, and this is the
-- table a tamper investigation would start from.

-- ---------------------------------------------------------------------------
-- 3. THE READ THE VERIFIER NEEDS
-- ---------------------------------------------------------------------------
-- Walking one account's chain in order means `WHERE account_id = $1 AND created_at BETWEEN … ORDER BY created_at, id`.
-- `idx_ledger_account (account_id, created_at DESC)` exists (0006) and serves it backwards; a forward walk of a hash
-- chain has to start at the oldest entry, so it is read in ascending order over the same index. That is fine — but the
-- explorer's own list (W064: newest first, filtered by txn type and tenant) has no index at all beyond
-- `idx_ledger_txn (txn_id)`, so a filtered page is a partition scan.
CREATE INDEX idx_ledger_entries_created ON ledger_entries (created_at DESC, id);

-- W064 filters by TENANT and by txn type. Type lives on the transaction, tenant on both.
CREATE INDEX idx_ledger_txn_tenant_recent ON ledger_transactions (tenant_id, created_at DESC);
CREATE INDEX idx_ledger_txn_type_recent ON ledger_transactions (txn_type_id, created_at DESC);
-- And `idempotency_key` is already UNIQUE (0006), which is what makes W065's "Search by idempotency key — retried
-- operations share one txn" work without another index.

-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT ADDED
-- ---------------------------------------------------------------------------
--   • NO `UNIQUE (account_id, prev_hash)` FORK GUARD. Postgres requires a unique index on a partitioned table to
--     include the partition key, and `(account_id, prev_hash, created_at)` would admit the very fork it was meant to
--     forbid — two entries sharing a `prev_hash` a microsecond apart. The guarantee stays the `FOR UPDATE` lock plus
--     the verifier this migration makes recordable. Stated so nobody re-derives it as a missing constraint.
--
--   • NO UNIQUE ON `entry_hash`. The preimage is `prev ‖ txn_id ‖ account_id ‖ amount ‖ balance_after` and contains
--     no time and no sequence, so two genuinely identical legs of one transaction would hash identically and a unique
--     index would reject a lawful posting. Adding the entry id to the preimage would fix that and would invalidate
--     every hash already written, which is a migration that has to rewrite the ledger — a real decision with a real
--     cost, named as ADMIN-6-Q1 rather than taken in passing.
--
--   • NO CHECK TYING `mismatches` TO `status`. It is tempting to require a non-empty `mismatches` array whenever
--     `status = 'mismatch'`, and it would be wrong for `internal_balance`: that check can find drift it cannot fit in
--     the array (it is LIMITed to 1000 rows), so an empty array with a mismatch status is a truthful "more than we
--     listed". The count is what the console reads.
--
--   • NOTHING TOUCHES THE TWO HASH IMPLEMENTATIONS. `apps/wallet-service/src/ledger/hash-chain.ts` and the private
--     duplicate in `apps/api/src/core/wallet/wallet.client.inprocess.ts` compute the same formula in two places, and
--     the verifier added in this wave necessarily becomes a THIRD. Consolidating them is right and is not a migration:
--     it is a shared package, it touches the only two money writers on the platform, and it is named as ADMIN-6-Q2.
--     The verifier's copy carries a comment naming both originals so a change to the formula cannot silently make the
--     checker disagree with the writers.
