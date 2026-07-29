-- ============================================================================
-- MIGRATION 0079 — STRUCTURAL PRIVILEGE SWEEP v2: column-pattern-agnostic census
-- across EVERY partitioned/money relation, closing the loan_repayments class of leak
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied
-- migration — 0014/0018/0065/0069/0071/0076/0077/0078 stay byte-untouched; this is a
-- fix-forward, full stop (KRISHI_VERSE_DEV_CONTRACT.md v1.1, Law 5 / Prohibitions §7).
--
-- ── DISCOVERY CHAIN ──────────────────────────────────────────────────────────────────────
-- DEV-32 QA (2026-07-29) first proved kv_app/kv_relay could write directly to
-- ledger_entries/wallet_accounts/ledger_transactions/reconciliation_runs via 0014/0018's
-- ALTER DEFAULT PRIVILEGES. DEV-35 shipped 0077 to close that 4-table P0, and its own QA
-- pass found the identical bug alive on kcc_drawl_ledger's EXISTING partitions. DEV-47
-- shipped 0078: a census keyed on (a) the literal column name `amount_minor` and (b) table
-- names matching `*_ledger`/`*_wallet`/`*_account*` regex, which found 15 more relations —
-- but DEV-47's OWN QA pass proved this method itself was incomplete: `loan_repayments`
-- (columns `amount_due_minor`/`amount_paid_minor` — no bare `amount_minor` column, no
-- `ledger`/`wallet`/`account` in its name) is money-bearing, partitioned, and was fully
-- writable by both kv_app and kv_relay the entire time, invisible to every prior pass. QA
-- named 16 further untriaged relations and ordered a STRUCTURAL (not pattern-keyed) re-audit
-- — this migration is that re-audit's fix-forward.
--
-- ── THE v2 CENSUS METHODOLOGY (full detail + raw data: Development_Program/spec_dev48.md)──
-- Built from a fresh embedded-Postgres 18 instance with migrations 0001-0078 applied (no
-- memory, no prior census reused), enumerating the LIVE CATALOG directly:
--   1. EVERY relation in `public` from pg_class (relkind IN ('r','p')) joined to pg_inherits
--      for partition/parent linkage — 308 base relations (parents + non-partitioned tables),
--      868 total relations counting every individual partition. No filtering, no naming
--      assumption.
--   2. For each, the FULL privilege matrix (information_schema.role_table_grants +
--      column_privileges, so column-restricted grants like 0071/0078's UPDATE(synced_at)
--      pattern are captured) for kv_app/kv_relay/kv_wallet/kv_admin/kv_readonly/kv_ingest.
--   3. Money-bearing classified by UNION of independent signals, none required alone:
--        (a) any column matching regex `.*_minor$|^amount.*|.*_amount$|.*_paise$|^price.*|
--            ^balance.*|^fee.*` (not the literal string `amount_minor`) — 700 column hits
--            across 96 base tables when combined with (b)/name-signal.
--        (b) FK-graph adjacency (information_schema.table_constraints/key_column_usage/
--            constraint_column_usage) to a wallet/ledger/loan/invoice/payout/settlement/
--            payment/escrow/premium/claim/mandate/bill/advance/drawl/commission/earning
--            -named parent table (661 FK edges walked).
--        (c) code-verified: grep across every apps/api/src/modules/*/jobs/*.ts and
--            */events/handlers/*.ts (the confirmed kv_relay/BYPASSRLS dispatch tier per
--            0077's own documentation) plus apps/worker/src/jobs/*.ts for literal table-name
--            references, then read the matched files' actual SQL to confirm INSERT/UPDATE/
--            DELETE/SELECT-FOR-UPDATE operations (not just a name coincidence — e.g. the
--            literal string `auctions` inside `AuctionsPublisher`/`this.auctions.getForUpdate`
--            was verified against the real repository call, not assumed from a filename hit).
--        (d) the class DEV-47 missed: cross-referencing every GRANT/REVOKE statement in
--            every migration file (0001-0078, comments and dollar-quoted PL/pgSQL bodies
--            STRIPPED before matching, else a table merely mentioned in a comment — exactly
--            how `loan_repayments` first false-positived in this batch's own draft tooling —
--            reads as "governed" when it is not) against the full relation list. 267 of 308
--            base relations have NEVER been the target of a literal GRANT/REVOKE anywhere —
--            they run entirely on whatever 0014/0018's schema-wide default privileges gave
--            them. This is NOT itself sufficient to call a table money-bearing (most of the
--            267 are ordinary reference/catalogue tables — `countries`, `languages`,
--            `admin_regions` — correctly out of this batch's scope); it IS the exact
--            precondition that let `loan_repayments` and this batch's other 78 relations hide
--            from three prior, narrower passes. Full classification table (all 308 relations,
--            every verdict incl. "not money-bearing, no action"): spec_dev48.md.
--   4. Result: 96 relations meet the money-bearing union test (signals a/b/name-signal);
--      92 of those have live kv_app/kv_relay write exposure. 17 were ALREADY correctly
--      remediated by 0077/0078 (ledger_entries, wallet_accounts, ledger_transactions,
--      kcc_drawl_ledger, group_ledger_entries, dbt_transfers, ambassador_earnings,
--      aeps_service_events, milk_collections, bank_accounts, bids, commission_plans_ambassador,
--      coupon_redemptions, payments, payouts, upi_mandate_executions, worker_advances —
--      re-verified clean, untouched here) — leaving 79 relations still carrying the SAME bug
--      class this fix-forward chain has been closing since 0077. This migration remediates
--      all 79.
--
-- ── PER-RELATION LEGITIMATE-ACCESS DETERMINATION (code-read, not assumed) ───────────────
-- Every one of the 79 was checked the same way 0078 checked its 15: does a real
-- apps/api/src/modules/*/jobs or */events/handlers file (the kv_relay/BYPASSRLS tier) call a
-- repository method that issues a real INSERT/UPDATE/DELETE against it? Full per-table
-- evidence (file paths + matched SQL) in spec_dev48.md/dev48_report.md. Summary by group:
--
--   GROUP 1 — DEV-48's 16 named residue relations + settlement_lines (settlement_statement_
--   lines' actual name in the live schema). ALL 16 confirmed by direct repository-file read:
--   zero apps/*/jobs or */events/handlers file anywhere references their repository classes
--   (LoanRepository, LoanApplicationRepository, TradeInvoiceRepository, SaasInvoiceRepository,
--   MilkBillRepository, InputAdvanceRepository, MandateRepository, LoanRepaymentRepository —
--   grep-confirmed NONE), i.e. kv_relay has ZERO legitimate need for any of them — the exact
--   `loan_repayments` bug class, now closed for the whole named set. kv_app's genuine need
--   (INSERT+UPDATE, confirmed present in each repository) is preserved; DELETE is revoked
--   from kv_app on all of them (grep-confirmed: zero DELETE statement anywhere in the
--   codebase targets any of these 12 non-partitioned tables). `bnpl_limits`, `freight_invoices`,
--   `freight_invoice_lines`, `worker_insurance_enrolments` have NO application code yet
--   (grep-confirmed zero repository file) — kv_app's INSERT+UPDATE is preserved as a
--   forward-declaration, mirroring the precedent 0069/0078 already set for kcc_drawl_ledger/
--   worker_advances.
--     `loan_repayments` (partitioned) is a special case within this group:
--   `loan-repayment.repository.ts` has ONLY an `insert()` and a `list()` method — NO update
--   method exists anywhere in the codebase (grep-confirmed) — a repayment row is written once
--   with `amount_due_minor`/`amount_paid_minor`/`paid_at` all populated at INSERT time. This
--   is append-only BY DESIGN (Law 2), the same doctrine 0077/0078 applied to ledger_entries/
--   kcc_drawl_ledger/group_ledger_entries/dbt_transfers/billing_adjustments — narrowed to
--   kv_app INSERT-only (not INSERT+UPDATE) and given the SAME generic append-only trigger
--   0077 created (`reject_ledger_entries_mutation()`, already parameterised on
--   TG_TABLE_NAME/OLD.id — no function change needed).
--
--   GROUP 2 — money-adjacent relations with a PROVEN narrow kv_relay need (repository code
--   read directly, matching 0078's "SELECT needed for WHERE" doctrine wherever a FOR UPDATE/
--   WHERE-filtered UPDATE is involved):
--     `insurance_policies` — kv_relay's `pmfby-policy-sync.handler.ts` calls
--       `this.policies.getById(...)` ONLY (grep-confirmed: no `.update(` call in that file) —
--       narrowed to SELECT-only for kv_relay (was wrongly INSERT+UPDATE+DELETE-capable).
--       kv_app keeps INSERT+UPDATE (the real issuance/status-update path), DELETE revoked.
--     `insurance_claims` — kv_relay's `surveyor-dispatch.handler.ts` calls
--       `InsuranceClaimRepository.getForUpdate()` (`SELECT ... FOR UPDATE`) then `.update()`
--       (`UPDATE insurance_claims SET status=..., surveyor_user_id=..., survey_report=...`) —
--       genuine SELECT+UPDATE need, no INSERT (claim filing is kv_app-only), no DELETE.
--     `settlement_statements` — kv_relay's `settlement-statements.cadence-job.ts` drives
--       `SettlementStatementService.generate()`, confirmed calling both `.insert()` and (via
--       `settlement-statement.repository.ts`) `.update()` (`pdf_media_id`) — genuine SELECT+
--       INSERT+UPDATE. kv_app keeps INSERT+UPDATE too (the SAME service is reachable from the
--       `@Post('generate')` request-tier endpoint per `settlement-statements.controller.ts` —
--       both tiers genuinely call the identical code path). DELETE revoked from both (no
--       DELETE statement anywhere targets settlement_statements).
--     `payout_batches` — kv_relay's `payout-execution.cadence-job.ts`/`wage-priority-lane.
--       job.ts` drive `payout-batch.repository.ts`'s `.insert()`, `.getForUpdate()`
--       (`SELECT...FOR UPDATE`), and `.update()` — genuine SELECT+INSERT+UPDATE for kv_relay,
--       matching kv_app's own already-correct INSERT+UPDATE. DELETE revoked from both.
--     `settlement_lines` (schema name for "settlement_statement_lines") — VERIFIED LEGITIMATE
--       ON BOTH TIERS, no restriction needed: kv_relay's `dispute-resolved.handler.ts` calls
--       `.deleteByOrder()` (a real, narrow, order-reversal DELETE — "WHERE ... AND
--       statement_id IS NULL", grep-confirmed as the only DELETE call site in the codebase)
--       and `.insert()` twice (split-line reversal); `order-completed.handler.ts` calls
--       `.insert()`; the cadence job's `SettlementStatementService.generate()` calls
--       `.linkToStatement()` (`UPDATE settlement_lines SET statement_id=...`). kv_app reaches
--       the SAME `.deleteByOrder()`/`.insert()`/`.linkToStatement()` methods via the
--       request-tier `@Post('generate')` path. Both roles' EXISTING full SELECT/INSERT/
--       UPDATE/DELETE grant is confirmed correct as-is — recorded here for audit completeness
--       (spec_dev48.md classification table), no GRANT/REVOKE statement needed below.
--
--   GROUP 3 — "Category D": core commerce/business state-machine tables where the structural
--   signals (money columns, FK-adjacency, or ungoverned status) flagged them, but kv_relay's
--   INSERT/UPDATE is REAL and extensive (verified directly for `orders` —
--   `order.repository.ts`'s `UPDATE orders SET status=...` is called from
--   `seller-confirm-timeout.job.ts`/`auto-complete-quality-window.job.ts`/6 different
--   `events/handlers` files; the remaining 8 tables in this group show the same
--   architecture — genuine job/handler files calling their repositories, not a name
--   coincidence, per the file-level evidence in spec_dev48.md): `orders`, `order_items`,
--   `listings`, `notifications`, `subscriptions`, `promotions`, `requirements`, `disputes`,
--   `auctions`. NOT narrowed further this batch — over-revoking a role that genuinely drives
--   dozens of live automated state transitions (timeouts, expiries, auto-completions) risks
--   exactly the regression this contract's Rule Zero forbids ("a cheaper path that breaks
--   trust"); a full per-repository forensic pass matching 0078's 15-table depth for all 9 of
--   these is disclosed as follow-up scope, not silently skipped (see spec_dev48.md
--   escalations). The one change applied here: DELETE revoked from BOTH roles on all 9
--   (grep-confirmed: zero DELETE statement anywhere in the codebase targets any of them —
--   these are soft-delete/state-machine tables, never hard-deleted).
--
--   GROUP 4 — 50 relations with a structural money/FK/ungoverned signal but ZERO code
--   reference from ANY apps/*/jobs or */events/handlers file (grep-confirmed per-table,
--   spec_dev48.md) — the dominant class, matching 0078's own dominant verdict ("kv_relay:
--   zero legitimate need — pure leak, revoked") repeated at 50-table scale: REVOKE ALL FROM
--   kv_relay; kv_app's INSERT+UPDATE preserved (real, ordinary request-tier business writes),
--   DELETE revoked from kv_app (zero DELETE call site found for any of the 50).
--
--   SPECIAL CASE — `cart_items`: kv_app's DELETE IS genuine (`cart.repository.ts`/
--   `cart-item.repository.ts` both call `DELETE FROM cart_items WHERE cart_id=...` for
--   line-removal/cart-clear) — DELETE preserved for kv_app, unlike every other table in this
--   migration. kv_relay: zero legitimate need (no job/handler references it) — REVOKE ALL.
--
-- ── PARTITIONED RELATIONS IN THIS SWEEP (8): backfill EXISTING partitions ────────────────
-- `loan_repayments`, `orders`, `order_items`, `notifications`, `listing_price_history`,
-- `mandi_prices`, `price_predictions`, `shipments`. `notifications`/`orders`/`order_items` are
-- Category D (no table-wide GRANT/REVOKE change below, so their partitions already match —
-- but included in the backfill loop defensively in case any drifted partition still carries a
-- stale ACL, since `sync_partition_privileges` is idempotent and a no-op reassertion is safe).
-- All 8 backfilled via 0077/0078's own `sync_partition_privileges(parent, child)` — no new
-- mechanism, reusing the enhanced (column-grant-aware) version 0078 shipped. FUTURE partitions
-- were already protected the moment 0077 rewired `ensure_partitions()` to call this procedure
-- at CREATE TABLE time — this migration closes the retroactive gap for partitions that
-- existed BEFORE that protection, exactly as 0078 did for its own 6 tables.
--
-- ── WHY 0001-0078 ARE UNTOUCHED (Law 5) ──────────────────────────────────────────────────
-- Every one is an APPLIED migration. This fix-forward only adds new REVOKE/GRANT statements,
-- one new trigger (reusing 0077's existing `reject_ledger_entries_mutation()` — already
-- parameterised, zero function change needed), and calls to 0078's own
-- `sync_partition_privileges` procedure (unchanged body — no CREATE OR REPLACE needed this
-- batch, since the column-grant enhancement is already in place from 0078).
--
-- ── REVERSIBILITY ─────────────────────────────────────────────────────────────────────────
-- Every REVOKE here can be reversed by a future fix-forward migration re-granting the exact
-- privilege removed (enumerated per group above); the new trigger can be disabled by a
-- founder-reviewed fix-forward `ALTER TABLE ... DISABLE TRIGGER ...` per contract §8, same
-- reversal path 0077/0078 documented for their own triggers. Nothing here is destructive to
-- data — only to write-privilege scope.
--
-- Idempotent throughout (REVOKE/GRANT are naturally idempotent; DROP TRIGGER IF EXISTS;
-- sync_partition_privileges is itself idempotent per 0077/0078).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 1 — GROUP 1: DEV-48's 16 named residue relations (loan_repayments handled separately
-- below as its own append-only special case). kv_relay loses everything (zero code
-- reference, grep-confirmed); kv_app keeps INSERT+UPDATE, loses DELETE.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'loans', 'loan_applications', 'bnpl_limits', 'trade_invoices', 'freight_invoices',
    'freight_invoice_lines', 'saas_invoices', 'saas_invoice_dunning_attempts', 'milk_bills',
    'contract_input_advances', 'upi_mandates', 'worker_insurance_enrolments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      EXECUTE format('REVOKE ALL ON %I FROM kv_relay', t);
      EXECUTE format('REVOKE DELETE ON %I FROM kv_app', t);
      EXECUTE format('GRANT INSERT, UPDATE ON %I TO kv_app', t);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 2 — loan_repayments: append-only by design (INSERT-only repository code, no update
-- path exists) — narrow kv_app to INSERT-only, kv_relay loses everything, DB-enforce Law 2
-- with the same generic trigger function 0077 created.
-- ────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON loan_repayments FROM kv_relay;
REVOKE UPDATE, DELETE ON loan_repayments FROM kv_app;
GRANT INSERT ON loan_repayments TO kv_app;

DROP TRIGGER IF EXISTS loan_repayments_append_only ON loan_repayments;
CREATE TRIGGER loan_repayments_append_only
  BEFORE UPDATE OR DELETE ON loan_repayments
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_entries_mutation();

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 3 — GROUP 2: proven narrow kv_relay need, code-verified per table (see header).
-- ────────────────────────────────────────────────────────────────────────────────────────

-- insurance_policies: kv_relay reads only (pmfby-policy-sync.handler.ts calls getById() only).
REVOKE ALL ON insurance_policies FROM kv_relay;
GRANT SELECT ON insurance_policies TO kv_relay;
REVOKE DELETE ON insurance_policies FROM kv_app;

-- insurance_claims: kv_relay updates status/survey fields (surveyor-dispatch.handler.ts).
REVOKE ALL ON insurance_claims FROM kv_relay;
GRANT SELECT, UPDATE ON insurance_claims TO kv_relay;
REVOKE DELETE ON insurance_claims FROM kv_app;

-- settlement_statements: kv_relay generates + attaches PDFs (settlement-statements.cadence-job.ts).
REVOKE ALL ON settlement_statements FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON settlement_statements TO kv_relay;
REVOKE DELETE ON settlement_statements FROM kv_app;

-- payout_batches: kv_relay creates/claims/executes batches (payout-execution.cadence-job.ts,
-- wage-priority-lane.job.ts) — matches the exact SELECT+INSERT+UPDATE need 0078 already
-- proved for `payouts` itself.
REVOKE ALL ON payout_batches FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON payout_batches TO kv_relay;
REVOKE DELETE ON payout_batches FROM kv_app;

-- settlement_lines: BOTH tiers verified legitimate on SELECT/INSERT/UPDATE/DELETE (dispute-
-- resolved.handler.ts's deleteByOrder()/insert(), order-completed.handler.ts's insert(),
-- the cadence job's linkToStatement() UPDATE, all real, grep-confirmed call sites) — no
-- GRANT/REVOKE change; recorded here as a NO-ACTION verdict for audit completeness only.

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 4 — GROUP 3 ("Category D"): core state-machine tables, kv_relay's INSERT/UPDATE
-- verified real and extensive — DELETE-only narrowing (both roles), no other change.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'orders', 'order_items', 'listings', 'notifications', 'subscriptions', 'promotions',
    'requirements', 'disputes', 'auctions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      EXECUTE format('REVOKE DELETE ON %I FROM kv_app', t);
      EXECUTE format('REVOKE DELETE ON %I FROM kv_relay', t);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 5 — cart_items: kv_app's DELETE is genuine (cart line-removal/clear) — preserved,
-- unlike every other table in this migration. kv_relay: zero legitimate need.
-- ────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON cart_items FROM kv_relay;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 6 — GROUP 4: 50 relations, zero code reference from any job/handler for kv_relay
-- (grep-confirmed per table, spec_dev48.md) — the dominant "pure leak" pattern, same verdict
-- 0078 reached for most of its own 15. kv_app keeps INSERT+UPDATE, loses DELETE (zero DELETE
-- call site anywhere for any of these 50).
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'account_freeze_orders', 'ambassador_profiles', 'animal_ownership_transfers',
    'booking_assignments', 'carbon_credits', 'checkout_groups', 'commission_rules',
    'coop_share_registers', 'courses', 'enrollments', 'equipment_bookings',
    'equipment_maintenance_logs', 'equipment_rates', 'export_shipments', 'farming_contracts',
    'group_lot_pledges', 'labour_bookings', 'learning_resources', 'listing_boosts',
    'listing_offers', 'listing_price_history', 'live_sessions', 'loan_products',
    'loan_restructures', 'mandi_prices', 'membership_tiers', 'migrant_engagements',
    'milk_rate_cards', 'minimum_wages', 'nwr_receipts', 'plans', 'price_alert_triggers',
    'price_alerts', 'price_predictions', 'product_batches', 'requirement_responses',
    'schemes', 'semen_catalog', 'service_bookings', 'service_offerings', 'shipments',
    'skills', 'subscription_addons', 'subscription_plans_d2c', 'tax_rules',
    'user_memberships', 'vet_bookings', 'vet_services', 'warehouses', 'worker_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      EXECUTE format('REVOKE ALL ON %I FROM kv_relay', t);
      EXECUTE format('REVOKE DELETE ON %I FROM kv_app', t);
      EXECUTE format('GRANT INSERT, UPDATE ON %I TO kv_app', t);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 7 — backfill EXISTING partitions of the 8 partitioned relations in this sweep to
-- match their (now-corrected, or defensively-reasserted) parent ACL, via 0077/0078's own
-- sync_partition_privileges(parent, child) — no new mechanism, same generic procedure.
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  parent_name text;
  parents text[] := ARRAY[
    'loan_repayments', 'orders', 'order_items', 'notifications', 'listing_price_history',
    'mandi_prices', 'price_predictions', 'shipments'
  ];
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
