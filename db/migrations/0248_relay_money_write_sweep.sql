-- ==================================================================================================================
-- MIGRATION 0248 — PC-56 TEST-1 · THE RELAY ROLE LOSES WRITE ACCESS IT NEVER NEEDED ON TEN MONEY-BEARING TABLES.
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. MONEY-ADJACENT (privileges on money tables): CODEOWNERS review.
-- ==================================================================================================================
--
-- WHAT WAS TRUE: 0014/0018's `ALTER DEFAULT PRIVILEGES` hand every NEW table INSERT/UPDATE/DELETE to `kv_relay` (the outbox
-- relay + cadence jobs' role, BYPASSRLS). 0079 swept the money tables that existed then; 0157 §1 found the trap had re-opened
-- on ~45 later relations and ESCALATED the sweep ("every one needs its code checked for a legitimate relay need before its
-- grants are cut"). The permanent guard for it — ledger-privilege-boundary.integration.spec.ts, "NO relation matching the
-- money-signal column regex holds kv_relay INSERT/UPDATE/DELETE unless explicitly allow-listed" — had been red since, and
-- never ran in CI. On a database built from the migrations it named 13 relations.
--
-- THE CODE CHECK (PC-56 TEST-1): every writer of each table in apps/api, apps/worker and apps/admin-api, and whether any
-- relay-run code path (core/outbox handlers, */jobs/*, the worker) reaches it:
--   • saas_invoices, saas_invoice_payments — the relay DOES write them (SaasInvoicePaymentHandler; 0146 §146.6 re-granted the
--     exact shape). Allow-listed in the spec, untouched here.
--   • settlement_runs — 0114 §4 granted it to kv_relay explicitly and on purpose. Allow-listed, untouched.
--   • returns — the relay writes ONE column: ReturnRefundedStampHandler (payments.return_refunded) runs
--     `UPDATE returns SET refund_txn_id …` inside the relay transaction. It keeps SELECT + UPDATE; INSERT and DELETE go.
--   • cod_remittance_shipments, cod_remittances (logistics CodRemittanceService / CodLedgerService), dbt_bounces
--     (schemes DbtBounceService; the scheme desk only READS it), loan_disbursement_run_items, loan_disbursement_runs
--     (fintech LoanDisbursementService; the execute step is a request-tier stub), mgnrega_musters, mgnrega_works (labour
--     MgnregaService), rider_payout_terms (logistics RiderPayoutService), settlement_cycles (payments SettlementCycleService,
--     OrgStatementService — 0144 granted kv_app only) — EVERY writer is a request-tier service on the unit of work (kv_app).
--     No handler, job or worker touches them. The relay's INSERT/UPDATE/DELETE there is pure default-privilege residue:
--     revoked. SELECT is left as it was (the guard is about writes; reads are a separate review).
--
-- Partitioned tables: none of the ten is partitioned (checked), so a parent REVOKE is complete.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  cod_remittance_shipments, cod_remittances, dbt_bounces,
  loan_disbursement_run_items, loan_disbursement_runs,
  mgnrega_musters, mgnrega_works, rider_payout_terms, settlement_cycles
  FROM kv_relay;
REVOKE INSERT, DELETE, TRUNCATE ON returns FROM kv_relay;
