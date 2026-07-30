-- ============================================================================
-- MIGRATION 0080 — RESTORE kv_app's WRITE ACCESS ON THE 2 TABLES WHERE 0078/0079's
-- "a kv_relay job is the real caller" PREMISE WAS FALSE (DEV-54, founder-reviewed per
-- contract §8: "Yes start DEV-54" — money-table privilege change).
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied
-- migration — 0014...0079 stay byte-untouched; this is a fix-forward, full stop
-- (KRISHI_VERSE_DEV_CONTRACT.md v1.1, Law 5 / Prohibitions §7).
--
-- ── THE SYMPTOM ───────────────────────────────────────────────────────────────────────────
-- MilkBillService.generate() — the core dairy money-out path — throws live:
--   `error: permission denied for table milk_collections` (SQLSTATE 42501)
-- on the exact statement DEV-49 (2026-07-29) fixed the COLUMN NAME of:
--   UPDATE milk_collections SET milk_bill_id=$4 WHERE id=$1 AND collected_on=$2::date
--     AND tenant_id=$3
-- DEV-49's fix was necessary (milk_collections genuinely has no updated_at column, so the
-- PRE-fix SQL failed with 42703 undefined column) but not sufficient — the corrected SQL
-- still cannot execute as kv_app on current main, because kv_app holds ZERO UPDATE
-- privilege on milk_collections at all.
--
-- ── THE CAUSAL CHAIN (DEV-QA-R1, 2026-07-30, DEV_TRACKER.md's DEV-QA-R1 STATE block +
--    qa_dev_qa_r1_audit.md) ────────────────────────────────────────────────────────────────
-- Migration 0078 (DEV-47) revoked ALL of kv_app's UPDATE/DELETE on milk_collections and
-- granted a column-restricted `UPDATE(milk_bill_id)` + table-wide SELECT to kv_relay
-- instead (0078 lines 301-318), on the documented belief that
-- `milk-bill-cycle-close.job.ts` — which holds a kv_relay connection — is attachToBill()'s
-- caller "on the same connection" as its other queries. Migration 0079 (DEV-48) re-verified
-- and preserved that same grant shape unchanged (it re-derived the full privilege census
-- from scratch and confirmed this table was "ALREADY correctly remediated by 0077/0078",
-- 0079 header line ~65 — i.e. 0079 inherited 0078's premise without re-deriving it, exactly
-- as this migration's own header discloses about 0078/0079 not being re-opened). DEV-49
-- (2026-07-29) then fixed attachToBill()'s `updated_at` column bug without re-checking the
-- privilege layer at all (out of that batch's stated scope). DEV-QA-R1 (2026-07-30, retro-QA
-- of DEV-49) is what finally re-traced the actual call graph end-to-end and found 0078's
-- premise false:
--
-- ── THE WRITER→ROLE→COLUMN MATRIX (code-read, this batch, every writer of milk_collections
--    traced independently — not just attachToBill()) ─────────────────────────────────────
--   writer                                              | connection (proven)     | columns written
--   -----------------------------------------------------|--------------------------|----------------------------
--   MilkCollectionRepository.insert()                    | kv_app (UnitOfWork,      | id,tenant_id,mcc_id,
--     called by MilkCollectionService.record()            | PgUnitOfWork.run() →     | membership_id,shift,
--     (apps/api/src/modules/dairy/services/               | pools.writer(shardId),   | collected_on,weight_kg,
--     milk-collection.service.ts:58)                      | i.e. AppConfig.db.       | fat_pct,snf_pct,water_flag,
--                                                          | writerUrl — ALWAYS,      | adulteration_flags,
--                                                          | never kv_relay)          | rate_card_id,amount_minor,
--                                                          |                          | entered_by (INSERT, all cols)
--   MilkCollectionRepository.aggregateUnbilledForUpdate() | kv_app (same uow.run(),  | SELECT id,collected_on,
--     called by MilkBillService.generate()                | called INSIDE            | weight_kg,amount_minor
--     (milk-bill.service.ts:50)                            | generate()'s tx)         | FOR UPDATE (WHERE tenant_id,
--                                                          |                          | membership_id,collected_on)
--   MilkCollectionRepository.attachToBill()               | kv_app (SAME uow.run()   | UPDATE milk_bill_id only
--     called by MilkBillService.generate()                | tx as the aggregate      | (WHERE id,collected_on,
--     (milk-bill.service.ts:56) — reached from BOTH        | above — one ACID tx,     | tenant_id — all 3 need
--     the interactive controller AND                       | Law 4 outbox-in-tx)      | SELECT for the WHERE clause)
--     MilkBillCycleCloseJob.run() (which only uses its     |                          |
--     OWN kv_relay systemPool for findMembershipsToBill,    |                          |
--     commits+releases that connection, THEN calls          |                          |
--     `this.bills.generate()` — a completely separate       |                          |
--     NestJS-injected service call that opens its OWN       |                          |
--     UnitOfWork transaction, always on kv_app)              |                          |
--   MilkCollectionRepository.findMembershipsToBill()        | kv_relay (job's OWN raw | SELECT tenant_id,
--     called by MilkBillCycleCloseJob.run()                 | systemPool.connect(),   | membership_id (WHERE
--     (milk-bill-cycle-close.job.ts:21) — the ONE real,     | genuinely never          | collected_on,milk_bill_id)
--     legitimate, narrow kv_relay read on this table         | UnitOfWork)              |
--   MilkCollectionRepository.listFor()                       | read-replica pool       | SELECT (all display cols)
--     called by MilkCollectionService.list()                 | (kv_app-authenticated,  |
--     (milk-collection.service.ts:68)                         | READ_REPLICA provider)  |
--
-- CONCLUSION: kv_relay is NEVER the connection attachToBill() (or aggregateUnbilledForUpdate,
-- or insert) runs on, in either the interactive or job-triggered path — its ONLY genuine need
-- on this table is the SELECT findMembershipsToBill() issues on its own raw connection,
-- already correctly granted (0078: `GRANT SELECT ON milk_collections TO kv_relay`, unchanged
-- here). The `UPDATE(milk_bill_id)` grant 0078 gave kv_relay is, and always was, DEAD —
-- no code path ever exercises it — the exact mirror-image mistake of the P0 itself (a grant
-- to the wrong role instead of a missing grant to the right one). Both sides are fixed here:
-- kv_app gets the write it actually needs; kv_relay loses the write it never used (tightening,
-- not weakening, its posture — Rule Zero).
--
-- ── SIBLING AUDIT: 0078's FULL REVOKE LIST RE-CHECKED FOR THE SAME FALSE PREMISE ──────────
-- 0078 fully revoked ALL of kv_app's UPDATE/DELETE (i.e., kv_app's write ability depends
-- ENTIRELY on the kv_relay grant being real) on 6 partitioned + 9 non-partitioned relations.
-- Every one was re-traced this batch, the same way milk_collections was:
--   kcc_drawl_ledger, group_ledger_entries, dbt_transfers — NO application code exists for
--     any of the three (grep-confirmed, again, zero repository/service file references
--     outside their own test specs) — kv_app's INSERT-only forward-declaration is inert;
--     nothing calls an UPDATE; not this bug class. NOT TOUCHED.
--   aeps_service_events — 0078 did NOT fully cut off kv_app here (it kept
--     `UPDATE(synced_at)` for kv_app at the parent) — the "kv_app fully cut off" precondition
--     for this bug class does not apply. NOT TOUCHED.
--   ambassador_earnings — **THE SIBLING, CONFIRMED THE IDENTICAL BUG.**
--     `weekly-payout-batch.job.ts`'s `runWeeklyPayout()` uses its OWN `relayPool.query(SELECT
--     DISTINCT tenant_id, ambassador_id FROM ambassador_earnings WHERE payout_id IS NULL)` —
--     a genuine, narrow, legitimate kv_relay SELECT (unchanged, still needed, still correct).
--     But the actual settlement — `AmbassadorEarningService.payoutAmbassador()`
--     (apps/api/src/modules/ambassadors/services/ambassador-earning.service.ts:51-67) — is a
--     separate NestJS-injected service call that opens its OWN `this.uow.run(tenantId, ...)`
--     transaction (line 54), inside which `AmbassadorEarningRepository.markPaid()`
--     (ambassador-earning.repository.ts:36-38) runs `UPDATE ambassador_earnings SET
--     payout_id=$3 WHERE id=$1 AND created_at=$2 AND payout_id IS NULL` — on kv_app,
--     PgUnitOfWork.run()'s only possible pool, NEVER kv_relay, exactly the same
--     architecture as milk-bill-cycle-close.job.ts → MilkBillService.generate(). 0078
--     revoked ALL of kv_app's UPDATE/DELETE on ambassador_earnings and gave kv_relay
--     `UPDATE(payout_id)` instead — a grant markPaid() can never use. **The weekly
--     ambassador-commission payout path is broken on current main by the exact same
--     mechanism as DEV-54's headline finding, live-reproduced below.** Fixed in this
--     migration alongside milk_collections — this is the batch's real value (the task
--     brief's own framing: "do not fix only the one table QA happened to find").
--   bank_accounts, bids, billing_adjustments, commission_plans_ambassador,
--   coupon_redemptions, payments, upi_mandate_executions, worker_advances — 0078 preserved
--     kv_app's INSERT+UPDATE on every one of these (only DELETE, or in billing_adjustments'
--     case ALL, was revoked from kv_app) — the "kv_app fully cut off" precondition does not
--     apply; kv_app can always write these regardless of whatever kv_relay holds. NOT
--     TOUCHED.
--   payouts — 0078 preserved kv_app's INSERT+UPDATE unchanged. kv_relay's UPDATE-only grant
--     WAS independently verified this batch to be genuinely used: `PayoutRepository.
--     claimQueued()` (payout.repository.ts:96-102) runs its `UPDATE payouts SET
--     status='processing'...` directly on `PayoutExecutionJob`'s OWN raw `systemPool`
--     connection (payout-execution.job.ts:17-23) — never through a Service's UnitOfWork —
--     the CORRECT pattern milk-bill-cycle-close.job.ts/weekly-payout-batch.job.ts should
--     have followed for their own mutations. Confirmed sound, NOT the same bug, NOT TOUCHED.
--
-- Also spot-checked (0079, not 0078, therefore out of this migration's direct remit since
-- kv_app already retains full INSERT+UPDATE on every 0079-touched relation — the "kv_app
-- fully cut off" precondition never applies to any 0079 table, so none of them can exhibit
-- this specific bug class regardless of what kv_relay holds): `insurance_claims`'s 0079
-- citation ("surveyor-dispatch.handler.ts calls getForUpdate() then .update()") does NOT
-- match the current file (it calls `.getById()` only, no `.update(` call at all, confirmed
-- by direct read) — kv_relay's SELECT+UPDATE grant there is therefore also unused, but this
-- is a harmless OVER-grant (kv_app already holds full INSERT+UPDATE independently, so no
-- write path is broken) — disclosed here as a candidate for a future DEV-53-adjacent
-- forensic pass, deliberately NOT touched in this S-sized, surgically-scoped migration to
-- avoid unrelated blast radius.
--
-- ── WHY 0001-0079 ARE UNTOUCHED (Law 5) ──────────────────────────────────────────────────
-- Every one is an APPLIED migration. This fix-forward only adds/narrows GRANT/REVOKE
-- statements on 2 already-swept relations and calls 0078's own unchanged
-- `sync_partition_privileges` procedure — no function/procedure body changes needed (0078's
-- column-grant-aware version already handles this correctly).
--
-- ── REVERSIBILITY ─────────────────────────────────────────────────────────────────────────
-- Every statement below can be reversed by a future fix-forward migration re-stating 0078's
-- original grant shape (enumerated in this file's own history + 0078's header). Nothing here
-- is destructive to data — only to write-privilege scope, and only in the narrowing
-- direction for kv_relay (its now-proven-dead column grants) plus the minimal restoring
-- direction for kv_app (exactly the one column each writer proven above actually needs).
--
-- Idempotent throughout (GRANT/REVOKE are naturally idempotent; sync_partition_privileges is
-- itself idempotent per 0077/0078).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 1 — milk_collections: kv_app gets back exactly the column MilkCollectionRepository.
-- attachToBill() writes (milk_bill_id) + a defensive re-assertion of the table-wide SELECT
-- it needs for that UPDATE's own WHERE clause (id, collected_on, tenant_id) — never actually
-- revoked by 0078, restated here idempotently so this migration is correct standalone.
-- kv_relay loses the column UPDATE it never used (findMembershipsToBill's SELECT, its one
-- genuine need, is untouched).
-- ────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON milk_collections TO kv_app;
GRANT UPDATE (milk_bill_id) ON milk_collections TO kv_app;
REVOKE UPDATE (milk_bill_id) ON milk_collections FROM kv_relay;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 2 — ambassador_earnings: the sibling fix, identical shape. kv_app gets back exactly
-- the column AmbassadorEarningRepository.markPaid() writes (payout_id) + the same defensive
-- SELECT re-assertion (never actually revoked by 0078) for markPaid()'s own WHERE clause
-- (id, created_at, payout_id). kv_relay loses the column UPDATE it never used
-- (weekly-payout-batch.job.ts's SELECT DISTINCT, its one genuine need, is untouched).
-- ────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT ON ambassador_earnings TO kv_app;
GRANT UPDATE (payout_id) ON ambassador_earnings TO kv_app;
REVOKE UPDATE (payout_id) ON ambassador_earnings FROM kv_relay;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 3 — backfill EVERY EXISTING partition of both tables to match their (now-corrected)
-- parent ACL, via 0078's own `sync_partition_privileges(parent, child)` — no new mechanism,
-- reusing the exact column-grant-aware procedure 0078 shipped (its REVOKE-ALL-then-re-GRANT
-- body correctly narrows a child's stale column grant that no longer matches the parent, so
-- kv_relay's now-removed UPDATE(*) is also correctly dropped from every existing partition
-- by this same call, not just the parent). FUTURE partitions are already covered the moment
-- `ensure_partitions()` creates them (0077/0078 wired it to call this same procedure at
-- CREATE TABLE time) — this migration closes the retroactive gap for partitions that existed
-- before this fix, exactly as 0078/0079 did for their own tables.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  parent_name text;
  parents text[] := ARRAY['milk_collections', 'ambassador_earnings'];
  child record;
BEGIN
  FOREACH parent_name IN ARRAY parents LOOP
    FOR child IN
      SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class p ON p.oid = i.inhparent AND p.relname = parent_name
      JOIN pg_class c ON c.oid = i.inhrelid
    LOOP
      CALL sync_partition_privileges(parent_name, child.relname);
    END LOOP;
  END LOOP;
END $$;
