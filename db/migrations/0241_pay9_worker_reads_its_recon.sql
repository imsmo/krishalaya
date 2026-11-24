-- ==================================================================================================================
-- MIGRATION 0241 — PC-56 PAY-9 · THE WORKER CAN READ WHAT ITS OWN MONEY CHECKS READ.
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0240 are applied; nothing here edits them.)
--
-- CLASS — MONEY-ADJACENT, READ-ONLY — CODEOWNERS (Law 9). Two SELECT grants to the worker's role. No money moves; no
-- write privilege is added; no RLS policy changes; kv_app, kv_admin, kv_partner, kv_gov are untouched.
-- ==================================================================================================================
--
-- WHAT WAS BROKEN (found while scheduling the payout reconciliation, PAY-9; proven on a database built from empty):
--   apps/worker connects as kv_relay — WorkerConfig refuses to start in production otherwise. 0077 step 2 ran
--   `REVOKE ALL ON wallet_accounts, ledger_transactions, reconciliation_runs FROM kv_relay` and gave back only
--   `INSERT ON reconciliation_runs`. Two worker jobs written later (PC-56 ADMIN-6) READ those tables:
--     • recon-internal-balance.job.ts reads its watermark FROM reconciliation_runs and compares
--       wallet_accounts.cached_balance_minor with the ledger → "permission denied for table reconciliation_runs" on its
--       first statement, EVERY tick: the only check that a balance a farmer is SHOWN agrees with the ledger has never
--       been able to run under the production role.
--     • recon-zero-sum.job.ts inserts its run, sets kv_recon_mismatches, then reads max(finished_at) FROM
--       reconciliation_runs for kv_recon_age_seconds → denied, so that gauge is never exported and the WalletReconStale
--       page ("reconciliation hasn't run in >2h") can never fire.
--   Their specs use fake clients, and the live suites run as the owner — so neither ever met kv_relay's grants.
--
-- WHY SELECT IS SAFE TO GIVE: kv_relay already has SELECT on ledger_entries (0077 step 1, for recon-zero-sum), from
-- which every account balance is derivable, and it is BYPASSRLS by design (the outbox relay). Reading the cached
-- balance and the record of its own reconciliation runs adds no class of data it cannot already see. It still cannot
-- write wallet_accounts or ledger_transactions, or change or delete a recorded run (INSERT stays its only write).
-- ==================================================================================================================

GRANT SELECT ON reconciliation_runs TO kv_relay;   -- recon-zero-sum (age gauge), recon-internal-balance (watermark), payout-gateway-recon (date guard + gauges)
GRANT SELECT ON wallet_accounts     TO kv_relay;   -- recon-internal-balance (cached balance vs ledger)

-- Proof inside the migration: the grants are exactly read + insert, nothing wider.
DO $$
BEGIN
  IF NOT has_table_privilege('kv_relay', 'reconciliation_runs', 'SELECT')
     OR NOT has_table_privilege('kv_relay', 'wallet_accounts', 'SELECT') THEN
    RAISE EXCEPTION '0241: kv_relay still cannot read its reconciliation inputs';
  END IF;
  IF has_table_privilege('kv_relay', 'reconciliation_runs', 'UPDATE')
     OR has_table_privilege('kv_relay', 'reconciliation_runs', 'DELETE')
     OR has_table_privilege('kv_relay', 'wallet_accounts', 'INSERT')
     OR has_table_privilege('kv_relay', 'wallet_accounts', 'UPDATE')
     OR has_table_privilege('kv_relay', 'wallet_accounts', 'DELETE')
     OR has_table_privilege('kv_relay', 'ledger_transactions', 'SELECT') THEN
    RAISE EXCEPTION '0241: kv_relay holds a money privilege wider than read';
  END IF;
END $$;
