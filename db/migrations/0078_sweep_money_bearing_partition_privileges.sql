-- ============================================================================
-- MIGRATION 0078 — SWEEP + FIX: default-privilege leaks across EVERY money-bearing
-- partitioned/ledger-like relation (fix-forward 0078)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied
-- migration — 0014/0018/0065/0069/0071/0076/0077 stay byte-untouched; this is a fix-forward,
-- full stop (KRISHI_VERSE_DEV_CONTRACT.md v1.1, Law 5 / Prohibitions §7).
--
-- ── DISCOVERY CHAIN ──────────────────────────────────────────────────────────────────────
-- DEV-32 QA (2026-07-29, qa_dev32_audit.md §3) first proved kv_app/kv_relay could write
-- directly to ledger_entries/wallet_accounts/ledger_transactions/reconciliation_runs because
-- migrations 0014/0018's ALTER DEFAULT PRIVILEGES silently re-grant every NEW partition,
-- and 0018 never narrowed kv_relay's blanket ALL grant at all. DEV-35 shipped migration 0077
-- to close that exact 4-table P0. DEV-35's own independent QA pass (DEV_TRACKER.md's "DEV-35
-- QA — STATE BLOCK") then found the IDENTICAL bug class still alive on kcc_drawl_ledger's
-- EXISTING partitions (migration 0069 only revoked kv_app's UPDATE/DELETE at the PARENT,
-- never touched kv_relay at all, and never propagated to already-created partitions) --
-- flagging it as its own P0-severity item and the origin of this batch (founder order:
-- "same privilege-class fix for kcc_drawl_ledger + sweep all money-bearing partitioned
-- tables").
--
-- ── THE SWEEP (this migration's real value — not a hand-picked table list) ─────────────
-- A systematic audit query was run against a fresh embedded-Postgres 18.4 instance (DEV-30/35
-- method, /tmp/kv-dev47) with migrations 0001-0077 applied, deriving the money-bearing
-- candidate set from the LIVE SCHEMA itself (not grep, not memory):
--   (a) every table with a column literally named amount_minor
--       (SELECT DISTINCT table_name FROM information_schema.columns WHERE column_name='amount_minor')
--   (b) every table whose name matches *_ledger / *_wallet / *_account(s) / ^ledger_ / ^wallet_
--       (regex over pg_tables)
-- union, deduped, then EVERY relation (parent + every pg_inherits-discovered partition) was
-- probed for kv_app/kv_relay INSERT/UPDATE/DELETE grants via information_schema.role_table_grants.
-- Full methodology + raw output: Development_Program/spec_dev47.md + dev47_report.md.
--
-- RESULT: 15 base relations flagged across 207 individual relations (parent+partitions),
-- proving a THIRD, FOURTH... FIFTEENTH instance of the exact same bug class beyond the
-- kcc_drawl_ledger escalation that opened this batch. 6 of the 15 are PARTITIONED (carry the
-- full partition-non-propagation bug): aeps_service_events, ambassador_earnings, dbt_transfers,
-- group_ledger_entries, kcc_drawl_ledger, milk_collections. The other 9 are NOT partitioned
-- (a one-time REVOKE/GRANT fully closes the gap, no ongoing exposure): bank_accounts, bids,
-- billing_adjustments, commission_plans_ambassador, coupon_redemptions, payments, payouts,
-- upi_mandate_executions, worker_advances. (ledger_entries/wallet_accounts/ledger_transactions/
-- reconciliation_runs were already fixed by 0077 and are excluded from this candidate set --
-- re-verified clean, untouched here.)
--
-- ── PER-TABLE LEGITIMATE-ACCESS DETERMINATION (code-read, not assumed) ──────────────────
-- Every table below was checked against the REAL repository/job code before deciding what
-- kv_app (request-tier, RLS-bound) and kv_relay (apps/worker's BYPASSRLS role, per
-- apps/worker/src/config.ts's own "worker must connect as kv_relay... NEVER kv_app" comment)
-- genuinely need, so this migration narrows only what is proven illegitimate:
--   kcc_drawl_ledger      — LEDGER-class (0069's own canon banner: "the ledger is append-only
--                           and safe"). No app code exists yet (grep-confirmed: zero repository/
--                           service file references outside its own RLS test spec) but 0069's
--                           header forward-declares kv_app INSERT for the lending module's future
--                           servicing writes -- preserved. kv_relay: zero legitimate need (0069
--                           never granted it anything on purpose; the ALL access it holds today
--                           is pure 0018 leak). FULL APPEND-ONLY TRIGGER ADDED (Law 2, zero
--                           mutable field in the schema — a correction is a new reversing entry).
--   group_ledger_entries  — LEDGER-class by name and design ("internal savings/lending book").
--                           Already correctly INSERT-only for kv_app at the PARENT since 0014's
--                           own explicit append-only list (line ~153) -- never propagated to its
--                           partitions. No app code exists yet (zero repository files). kv_relay:
--                           zero legitimate need (0014 never granted it anything; 0018's blanket
--                           grant is the sole source). FULL APPEND-ONLY TRIGGER ADDED.
--   dbt_transfers         — Confirmed govt-scheme benefit credits, observed/append-only by
--                           design (no mutable field in the schema; DbtTransferRepository has
--                           exactly one INSERT method, zero UPDATE/DELETE, confirmed by direct
--                           read). Already correctly INSERT-only for kv_app at the PARENT since
--                           0014 -- never propagated to its partitions. kv_relay: zero legitimate
--                           need (no worker job references dbt_transfers at all). FULL
--                           APPEND-ONLY TRIGGER ADDED.
--   ambassador_earnings   — LEDGER-class with ONE proven narrow exception: the weekly payout
--                           batch worker job (apps/api/src/modules/ambassadors/jobs/
--                           weekly-payout-batch.job.ts, header: "Connected as the BYPASSRLS
--                           relay role") calls AmbassadorEarningRepository.markPaid(), which
--                           runs `UPDATE ambassador_earnings SET payout_id=... WHERE payout_id
--                           IS NULL` — a genuine, narrow, legitimate mutation. This is the SAME
--                           restricted-column-update doctrine 0014 already established for
--                           outbox_events(status,published_at)/notifications(...) and 0071
--                           established for aeps_service_events(synced_at) — NOT a case for a
--                           full blocking trigger (which would break real payout settlement).
--                           kv_app: INSERT only (already correct at the parent since 0014's
--                           append-only list — never propagated to partitions). kv_relay:
--                           column-restricted UPDATE(payout_id) only, propagated to partitions
--                           via the enhanced sync_partition_privileges below.
--   aeps_service_events   — Already self-documented by 0071 as "APPEND-ONLY (partial, NOT full
--                           LEDGER-class)": kv_app legitimately needs INSERT + column-restricted
--                           UPDATE(synced_at) (the kiosk offline-sync landing timestamp) — this
--                           was correctly done at the PARENT by 0071 but never propagated to its
--                           partitions (the identical bug). kv_relay: zero legitimate need (zero
--                           app/worker code references this table outside its own test spec —
--                           re-confirmed by grep). No full trigger (0071's own documented
--                           rationale stands).
--   milk_collections      — Confirmed STATE-transition-once table: MilkCollectionRepository's
--                           only UPDATE (`SET milk_bill_id=...`) is explicitly the worker's
--                           method (apps/api/src/modules/dairy/jobs/milk-bill-cycle-close.job.ts,
--                           header: "Worker job (kv_relay)") marking a collection billed —
--                           a genuine, narrow, legitimate kv_relay mutation. kv_app currently
--                           holds unrestricted UPDATE too (a real over-grant — narrowed here to
--                           INSERT-only, since the counter-entry INSERT is the only kv_app-side
--                           write any code performs). No full trigger (milk_bill_id must remain
--                           mutable by design).
--   bank_accounts         — Mutable KYC/payment-instrument metadata (is_primary toggled,
--                           penny_verified_at set) via identity/repositories/bank-account.
--                           repository.ts, genuine kv_app INSERT+UPDATE. kv_relay: zero
--                           legitimate need (no worker job references bank_accounts) — its
--                           current ALL grant is pure 0018 leak, revoked.
--   bids                  — Already self-documented "-- IMMUTABLE (grants in file 13)" in its
--                           own 0005 DDL comment and already correctly INSERT-only for kv_app
--                           (0014's append-only list, non-partitioned so already fully closed
--                           for kv_app). kv_relay: zero legitimate need (auctions worker jobs —
--                           release-losing-emd.job.ts etc. — release EMD via wallet elevation,
--                           never write the bids row itself, confirmed by grep) — pure leak,
--                           revoked.
--   billing_adjustments   — The REAL writer is admin-api's manual-adjustment.service.ts, which
--                           connects as `kv_admin` (apps/admin-api/src/core/admin-core.module.ts
--                           header: "the @Global core of the god-mode realm... kv_admin"), a
--                           SEPARATE role untouched by this migration (pre-existing, out of
--                           scope, same class as the DEV-35 QA-flagged kv_admin residual item).
--                           Neither kv_app nor kv_relay is ever used to write this table (grep-
--                           confirmed) — both fully revoked. FULL APPEND-ONLY TRIGGER ADDED as
--                           defense-in-depth (a billing adjustment is a create-once audit record
--                           correlated 1:1 with a wallet_txn_id, the same "history is physics"
--                           doctrine as a ledger entry — extends Law 2 protection to this
--                           adjacent money-adjustment record, binding kv_admin too exactly as
--                           0077's ledger_entries trigger binds kv_wallet/kv_admin).
--   commission_plans_ambassador — Mutable RATE-CONFIG table (tenant admin sets/edits commission
--                           plans via commission-plan.service.ts), NOT a ledger — genuine kv_app
--                           INSERT+UPDATE. kv_relay: zero legitimate need — pure leak, revoked.
--   coupon_redemptions    — Already self-documented append-only via 0014's list (correctly
--                           INSERT-only for kv_app, non-partitioned so already fully closed).
--                           kv_relay: zero legitimate need (promotions worker jobs --
--                           promo-budget-watch.job.ts, festival-campaign-scheduler.job.ts --
--                           read promotions/promotion budgets, never write coupon_redemptions,
--                           confirmed by grep) — pure leak, revoked.
--   payments              — STATE-MACHINE table (status transitions via the synchronous
--                           Razorpay webhook handler, an ordinary apps/api HTTP request —
--                           razorpay-webhook.handler.ts runs on the request-tier kv_app
--                           connection, not a worker tick). Genuine kv_app INSERT+UPDATE.
--                           kv_relay: zero legitimate need (grep-confirmed: no *.job.ts file
--                           anywhere writes to payments) — pure leak, revoked.
--   payouts               — STATE-MACHINE table with a GENUINE SPLIT: payout creation
--                           (insertIdempotent) is request-tier (kv_app); claiming + executing
--                           (claimQueued, the generic update() after gateway response) is
--                           explicitly "Runs on the privileged relay/worker connection" per
--                           payout.repository.ts's own doc-comments, i.e. kv_relay. Both are
--                           real, current call paths (confirmed by direct read of
--                           payout.repository.ts + payout-execution.job.ts +
--                           payout-queue-monitor.job.ts + wage-priority-lane.job.ts). kv_app:
--                           INSERT+UPDATE preserved. kv_relay: UPDATE preserved, INSERT revoked
--                           (the worker never creates a payout, only claims/executes ones a
--                           request already created). DELETE revoked from both (grep-confirmed:
--                           no code anywhere deletes a payout row).
--   upi_mandate_executions — STATE-MACHINE table (pending->collected/failed), transitions via
--                           mandate-execution.repository.ts on the request/webhook tier only —
--                           genuine kv_app INSERT+UPDATE. kv_relay: zero legitimate need (grep-
--                           confirmed: no job file anywhere references mandate executions) —
--                           pure leak, revoked.
--   worker_advances       — No application code exists yet (grep-confirmed: zero repository/
--                           service file references) but the schema's own status/recovered_minor
--                           columns forward-declare a mutable case record (advance requested ->
--                           approved -> disbursed -> recovered), the same class as
--                           upi_mandate_executions/payouts, NOT a ledger — kv_app INSERT+UPDATE
--                           preserved for the future servicing module (mirrors the kcc_drawl_
--                           ledger forward-declaration precedent from 0069). kv_relay: zero
--                           legitimate need — pure leak, revoked.
--
-- Every REVOKE/GRANT/CALL below is idempotent (re-running is a no-op or a defensive re-
-- assertion; CREATE OR REPLACE / DROP TRIGGER IF EXISTS throughout). DELETE is revoked from
-- BOTH kv_app and kv_relay on ALL 15 tables without exception — grep across apps/api, apps/
-- worker, apps/admin-api, apps/wallet-service confirms zero DELETE statement targets any of
-- them anywhere in the codebase.
--
-- ── WHY 0014/0018/0065/0069/0071/0076/0077 ARE UNTOUCHED (Law 5) ────────────────────────
-- Every one of those is an APPLIED migration; this fix-forward adds new REVOKE/GRANT/CALL
-- statements and two new triggers (reusing 0077's existing, generic reject_ledger_entries_
-- mutation() function — it already parameterises on TG_TABLE_NAME/OLD.id, so attaching it to
-- 4 more tables needs no function change) plus one CREATE OR REPLACE PROCEDURE (sync_partition_
-- privileges, replacing 0077's own body with an enhanced one — precedent: 0077 itself CREATE
-- OR REPLACE'd 0014's ensure_partitions(); 0053 ALTER PROCEDURE'd it before that. Replacing a
-- procedure body via a new migration is the established, sanctioned pattern for this repo).
--
-- ── A SECOND-ORDER BUG FOUND WHILE BUILDING THIS FIX (not in the original escalation) ───
-- 0077's own sync_partition_privileges(parent, child) — the mechanism meant to future-proof
-- every partition going forward — reads information_schema.role_table_grants only, which
-- reports TABLE-WIDE privileges. A column-restricted grant (e.g. `GRANT UPDATE (synced_at) ON
-- aeps_service_events TO kv_app`, the exact pattern 0014/0071 use for outbox_events/
-- notifications/aeps_service_events) does NOT appear there — it lives in information_schema.
-- column_privileges. Left as-is, every FUTURE aeps_service_events/milk_collections/
-- ambassador_earnings partition created by ensure_partitions() would silently come up WITHOUT
-- its narrow legitimate column-level grant — the exact same "grants don't propagate to
-- partitions" bug class, one level deeper. STEP 0 below fixes sync_partition_privileges itself
-- to also copy column-level grants, closing this for good (verified live in dev47_report.md's
-- probe matrix: a partition created after 0078 correctly carries kv_relay's UPDATE(milk_bill_id)
-- and kv_app's UPDATE(synced_at)).
--
-- ── REVERSIBILITY ─────────────────────────────────────────────────────────────────────────
-- Every REVOKE here can be reversed by a future fix-forward migration re-granting the specific
-- privilege (the exact grants removed are enumerated above, table by table) — nothing here is
-- destructive to data, only to write-privilege scope. The two new triggers can be disabled by a
-- founder-reviewed fix-forward `ALTER TABLE ... DISABLE TRIGGER ...` migration per contract §8
-- (same reversal path 0077 documented for its own trigger).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 0 — enhance sync_partition_privileges (0077) to ALSO propagate column-level grants,
-- closing the second-order gap discovered while building this fix. Idempotent: CREATE OR
-- REPLACE of an existing procedure, same sanctioned pattern 0077 itself used on 0014's
-- ensure_partitions().
-- ────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE sync_partition_privileges(p_parent text, p_child text) AS $$
DECLARE
  role_name text;
  privs text[];
  col_privs record;
  roles text[] := ARRAY['kv_app', 'kv_wallet', 'kv_admin', 'kv_readonly', 'kv_ingest', 'kv_relay'];
BEGIN
  FOREACH role_name IN ARRAY roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      SELECT array_agg(DISTINCT privilege_type) INTO privs
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = p_parent AND grantee = role_name;

      EXECUTE format('REVOKE ALL ON %I FROM %I', p_child, role_name);
      IF privs IS NOT NULL THEN
        EXECUTE format('GRANT %s ON %I TO %I', array_to_string(privs, ', '), p_child, role_name);
      END IF;

      -- [DEV-47 fix] column-level grants (outbox_events.status/published_at, notifications.*,
      -- aeps_service_events.synced_at, milk_collections.milk_bill_id, ambassador_earnings.
      -- payout_id) never appear in role_table_grants -- table_privileges is table-wide only.
      -- Without this block a role's column-restricted UPDATE silently vanishes on every new
      -- partition. Only re-assert a column grant if the role doesn't ALREADY have that same
      -- privilege table-wide (avoids a redundant/conflicting narrower grant).
      FOR col_privs IN
        SELECT cp.privilege_type, array_agg(DISTINCT cp.column_name ORDER BY cp.column_name) AS cols
        FROM information_schema.column_privileges cp
        WHERE cp.table_schema = 'public' AND cp.table_name = p_parent AND cp.grantee = role_name
        GROUP BY cp.privilege_type
      LOOP
        IF privs IS NULL OR NOT (col_privs.privilege_type = ANY (privs)) THEN
          EXECUTE format('GRANT %s (%s) ON %I TO %I', col_privs.privilege_type,
                          array_to_string(col_privs.cols, ', '), p_child, role_name);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;

ALTER PROCEDURE sync_partition_privileges(text, text) SECURITY DEFINER;
ALTER PROCEDURE sync_partition_privileges(text, text) SET search_path = public, pg_temp;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 1 — fix each PARENT relation's ACL to its correct, code-verified target (per the
-- header determination above), for the 6 PARTITIONED money-bearing tables.
-- ────────────────────────────────────────────────────────────────────────────────────────

-- kcc_drawl_ledger: kv_app INSERT-only (unchanged from 0069's intent); kv_relay loses
-- everything (pure 0018 leak, zero legitimate need).
REVOKE ALL ON kcc_drawl_ledger FROM kv_relay;
REVOKE UPDATE, DELETE ON kcc_drawl_ledger FROM kv_app;   -- re-assert 0069's own intent defensively
GRANT INSERT ON kcc_drawl_ledger TO kv_app;

-- group_ledger_entries: kv_app INSERT-only (0014's own intent, never propagated); kv_relay
-- loses everything (0014 never granted it anything; 0018's blanket grant is the sole source).
REVOKE ALL ON group_ledger_entries FROM kv_relay;
REVOKE UPDATE, DELETE ON group_ledger_entries FROM kv_app;
GRANT INSERT ON group_ledger_entries TO kv_app;

-- dbt_transfers: kv_app INSERT-only (0014's own intent, never propagated); kv_relay loses
-- everything.
REVOKE ALL ON dbt_transfers FROM kv_relay;
REVOKE UPDATE, DELETE ON dbt_transfers FROM kv_app;
GRANT INSERT ON dbt_transfers TO kv_app;

-- ambassador_earnings: kv_app INSERT-only (0014's own intent, never propagated); kv_relay
-- gets the proven narrow WRITE need -- UPDATE(payout_id), the weekly payout-batch settlement
-- -- PLUS table-wide SELECT. Confirmed necessary (not an over-grant) by direct code read:
-- weekly-payout-batch.job.ts (kv_relay pool) runs `SELECT DISTINCT tenant_id, ambassador_id
-- FROM ambassador_earnings WHERE payout_id IS NULL` directly, and the same tx then calls
-- AmbassadorEarningRepository.lockUnpaid() (`SELECT id, tenant_id, ambassador_id, plan_id,
-- event_code, reference_type, reference_id, amount_minor, payout_id, created_at ... FOR
-- UPDATE`) and .markPaid() (`UPDATE ... SET payout_id=... WHERE id=$1 AND created_at=$2 AND
-- payout_id IS NULL`) on the SAME connection -- Postgres requires SELECT on every column
-- referenced in a query's WHERE/SET-source/RETURNING clause, independent of which columns the
-- UPDATE privilege itself covers, so a column-restricted UPDATE(payout_id) ALONE (no SELECT)
-- would deny this legitimate, narrow, already-in-production write path. Verified live: with
-- SELECT withheld, `UPDATE ambassador_earnings SET payout_id=...` was DENIED even though
-- UPDATE(payout_id) was granted; re-tested after adding SELECT and it succeeded (see
-- dev47_report.md §2 for the reproduction). No INSERT/DELETE for kv_relay (accrual is
-- kv_app-only, still Law 2 append-only).
REVOKE ALL ON ambassador_earnings FROM kv_relay;
GRANT SELECT ON ambassador_earnings TO kv_relay;
GRANT UPDATE (payout_id) ON ambassador_earnings TO kv_relay;
REVOKE UPDATE, DELETE ON ambassador_earnings FROM kv_app;

-- aeps_service_events: re-assert 0071's own intent defensively (kv_app INSERT +
-- UPDATE(synced_at) only); kv_relay loses everything (zero legitimate need, confirmed).
REVOKE ALL ON aeps_service_events FROM kv_relay;
REVOKE UPDATE, DELETE ON aeps_service_events FROM kv_app;
GRANT UPDATE (synced_at) ON aeps_service_events TO kv_app;

-- milk_collections: kv_app narrowed to INSERT-only (its only proven write path is the counter
-- entry); kv_relay gets the proven narrow WRITE need -- UPDATE(milk_bill_id), the milk-bill
-- cycle-close job marking collections billed -- PLUS table-wide SELECT. Same rule as
-- ambassador_earnings above applies: milk-bill-cycle-close.job.ts (kv_relay) runs
-- MilkCollectionRepository.findMembershipsToBill() (`SELECT DISTINCT tenant_id,
-- membership_id ... WHERE ... milk_bill_id IS NULL`), .aggregateUnbilledForUpdate()
-- (`SELECT id, collected_on, weight_kg, amount_minor ... FOR UPDATE`), then
-- .attachToBill() (`UPDATE ... SET milk_bill_id=... WHERE id=$1 AND collected_on=$2 AND
-- tenant_id=$3`) on the same connection -- a column-restricted UPDATE(milk_bill_id) alone,
-- without SELECT, denies this real job (reproduced live, see dev47_report.md §2). ESCALATED
-- SEPARATELY (not fixed here, out of this migration's scope -- app-code, not privilege):
-- attachToBill()'s own SQL also sets `updated_at=now()`, but milk_collections has no
-- updated_at column in its DDL (0009_livestock_dairy.sql) -- a genuine pre-existing
-- application bug, unrelated to and not caused by this privilege fix.
REVOKE ALL ON milk_collections FROM kv_relay;
GRANT SELECT ON milk_collections TO kv_relay;
GRANT UPDATE (milk_bill_id) ON milk_collections TO kv_relay;
REVOKE UPDATE, DELETE ON milk_collections FROM kv_app;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 2 — backfill EVERY EXISTING partition of the 6 tables above to match their (now-
-- corrected) parent ACL, using 0077's own sync_partition_privileges procedure (enhanced in
-- STEP 0 to also carry column-level grants). This is the actual fix for the escalation:
-- FUTURE partitions were already protected by 0077's ensure_partitions() rewrite calling this
-- same procedure at CREATE TABLE time -- EXISTING partitions, created before that protection
-- existed, were never retroactively brought into line until now.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  parent_name text;
  parents text[] := ARRAY['kcc_drawl_ledger', 'group_ledger_entries', 'dbt_transfers',
                           'ambassador_earnings', 'aeps_service_events', 'milk_collections'];
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

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 3 — the 9 NON-PARTITIONED money-bearing tables: one-time REVOKE/GRANT per table fully
-- closes the gap (no ongoing partition exposure).
-- ────────────────────────────────────────────────────────────────────────────────────────

-- bank_accounts: kv_app INSERT+UPDATE genuinely needed (KYC/instrument metadata mutation);
-- kv_relay loses everything (no worker job touches it).
REVOKE ALL ON bank_accounts FROM kv_relay;
REVOKE DELETE ON bank_accounts FROM kv_app;

-- bids: kv_app INSERT-only re-asserted defensively (0014's own intent); kv_relay loses
-- everything (EMD release happens via wallet elevation, never a bids-row write).
REVOKE ALL ON bids FROM kv_relay;
REVOKE UPDATE, DELETE ON bids FROM kv_app;

-- billing_adjustments: neither kv_app nor kv_relay ever writes this table (the real writer is
-- kv_admin, a separate untouched role) -- both fully revoked.
REVOKE ALL ON billing_adjustments FROM kv_app;
REVOKE ALL ON billing_adjustments FROM kv_relay;

-- commission_plans_ambassador: kv_app INSERT+UPDATE genuinely needed (tenant-admin rate
-- config); kv_relay loses everything.
REVOKE ALL ON commission_plans_ambassador FROM kv_relay;
REVOKE DELETE ON commission_plans_ambassador FROM kv_app;

-- coupon_redemptions: kv_app INSERT-only re-asserted defensively (0014's own intent);
-- kv_relay loses everything.
REVOKE ALL ON coupon_redemptions FROM kv_relay;
REVOKE UPDATE, DELETE ON coupon_redemptions FROM kv_app;

-- payments: kv_app INSERT+UPDATE genuinely needed (synchronous webhook handler, request-tier);
-- kv_relay loses everything (no job anywhere writes payments).
REVOKE ALL ON payments FROM kv_relay;
REVOKE DELETE ON payments FROM kv_app;

-- payouts: kv_app keeps INSERT+UPDATE (creation + webhook-tier transitions); kv_relay keeps
-- UPDATE only (claim/execute), loses INSERT (the worker never creates a payout) and DELETE.
GRANT UPDATE ON payouts TO kv_relay;
REVOKE INSERT, DELETE ON payouts FROM kv_relay;
REVOKE DELETE ON payouts FROM kv_app;

-- upi_mandate_executions: kv_app INSERT+UPDATE genuinely needed (request/webhook-tier state
-- machine); kv_relay loses everything.
REVOKE ALL ON upi_mandate_executions FROM kv_relay;
REVOKE DELETE ON upi_mandate_executions FROM kv_app;

-- worker_advances: kv_app INSERT+UPDATE preserved (forward-declared servicing module, mirrors
-- the kcc_drawl_ledger precedent); kv_relay loses everything.
REVOKE ALL ON worker_advances FROM kv_relay;
REVOKE DELETE ON worker_advances FROM kv_app;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 4 — DB-ENFORCE LAW 2 on the genuinely append-only relations found by this sweep, using
-- the SAME generic trigger function 0077 already created (it parameterises on TG_TABLE_NAME/
-- OLD.id, so no function change is needed -- purely additive CREATE TRIGGER statements).
-- NOT applied to ambassador_earnings/aeps_service_events/milk_collections (each has one proven
-- legitimate narrow mutation -- a full block would break real production behavior; the
-- restricted-column GRANT above is the correct mechanism for those three, matching the
-- existing outbox_events/notifications precedent from 0014).
-- ────────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS kcc_drawl_ledger_append_only ON kcc_drawl_ledger;
CREATE TRIGGER kcc_drawl_ledger_append_only
  BEFORE UPDATE OR DELETE ON kcc_drawl_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();

DROP TRIGGER IF EXISTS group_ledger_entries_append_only ON group_ledger_entries;
CREATE TRIGGER group_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON group_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();

DROP TRIGGER IF EXISTS dbt_transfers_append_only ON dbt_transfers;
CREATE TRIGGER dbt_transfers_append_only
  BEFORE UPDATE OR DELETE ON dbt_transfers
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();

DROP TRIGGER IF EXISTS billing_adjustments_append_only ON billing_adjustments;
CREATE TRIGGER billing_adjustments_append_only
  BEFORE UPDATE OR DELETE ON billing_adjustments
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();
