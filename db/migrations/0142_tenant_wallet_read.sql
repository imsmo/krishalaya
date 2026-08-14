-- =============================================================================================
-- 0142_tenant_wallet_read.sql · PC-56 TENANT-4a — THE TENANT'S OWN WALLET GETS A READER
-- =============================================================================================
-- W143 (Wallet) and W144 (Wallet Transactions) are the FPO's own money: "Three tenant accounts
-- (main - commission - hold), all INR, backed by the append-only hash-chained ledger."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE WAVE'S HEADLINE): THE TENANT'S THREE ACCOUNTS ARE WRITTEN BY FIVE CODE PATHS
--                                 AND READ BY NOTHING, ANYWHERE, ON ANY SCREEN.
-- ---------------------------------------------------------------------------------------------
-- `wallet_accounts` has held tenant-owned rows since 0006. They are written today:
--   commission  <- credited by OrderCompletedHandler, reversed by DisputeResolvedHandler and
--                  ReturnRefundedHandler (the tenant's earned commission)
--   main        <- debited by dairy milk-bill payouts, scheme disbursals and fintech loan
--                  disbursals (four modules, each of which declares its OWN local `tenantMain`
--                  helper because core/wallet/account-codes.ts exports only `tenantCommission`)
--   hold        <- NOTHING. NO CODE PATH ANYWHERE WRITES A TENANT HOLD ENTRY. (See defect 3.)
-- And the read side: `grep -rn "owner_kind='tenant'"` over apps/ returns the ledger repository's
-- own get-or-create and NOTHING ELSE. No read-model, no controller, no SDK method, no screen.
--
-- What the tenant console shows instead is worse than an empty screen. `apps/web-tenant/.../wallet`
-- calls `wallet.balance` / `wallet.ledger`, and BOTH resolve their subject from `ctx.userId` — the
-- signed-in STAFF MEMBER's PERSONAL wallet. An FPO with money in its main account opens the Money
-- section of its own console and sees a staff member's personal balance, which for most staff is
-- zero. The figure is real, correctly computed, tenant-safe, and about the wrong party.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: `wallet.view` IS SEEDED, GRANTED TO TWO ROLES, AND CHECKED BY NO CODE
-- ---------------------------------------------------------------------------------------------
-- db/seeds/core/0004_roles_permissions.sql:46 seeds ('wallet.view','View wallet','M05') and grants
-- it to `farmer` and `vyapari`. No `@Permissions('wallet.view')`, no policy, no guard reads it:
-- viewing your own wallet is a core read and is (correctly) not gated. Meanwhile `tenant_admin` is
-- granted `wallet.adjust` — MANUAL WALLET ADJUSTMENT — and holds no view permission at all. The
-- org wallet therefore has no key of its own, which is what this migration adds.
--
-- NOT DONE, DELIBERATELY: `wallet.view` is NOT retro-enforced on the personal endpoints. Every role
-- that is not farmer/vyapari (staff, worker, transporter, ...) would lose sight of their own money
-- the moment a guard started reading a grant nobody has audited. Recorded as a finding; a grant
-- review is its own wave.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: THE HOLD CARD HAS NO WRITER — AND THIS MIGRATION ADDS NO COLUMN TO PRETEND IT DOES
-- ---------------------------------------------------------------------------------------------
-- W143's third card reads "hold - frozen / Rs 12,820 / 1 dispute freeze (DSP-0712-01) - only
-- disputed amounts, never the wallet". TENANT-3b established that the partial freeze is not built:
-- escrow holds the buyer's gross for the whole order until a dispute closes, and there is no
-- per-line release. `TenantAccount.Hold` is a constant with no caller. The card is therefore
-- rendered from the ledger like the other two — it reads zero — and the screen states WHY it is
-- zero (no code path freezes tenant money) instead of showing a number nobody wrote.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 4: THE LEDGER'S TAMPER-EVIDENCE IS VERIFIABLE ONLY IN GOD MODE
-- ---------------------------------------------------------------------------------------------
-- ADMIN-6 built the first hash-chain verifier on this platform, in apps/admin-api (W064/W065).
-- Law 11 keeps that plane separate, and correctly so. But W143 prints "Hash chain intact - last
-- entry ...a41f" to a TENANT, about the tenant's OWN entries, and a tenant cannot ask that question
-- of its own money today. TENANT-4a gives the tenant realm a verifier over ITS OWN three accounts
-- only, and it computes the hash with THE WRITER'S OWN FUNCTION (core/wallet/hash-chain.ts, now
-- imported by the in-process client) rather than a second copy of the formula: a verifier that
-- disagrees with the writer is worse than no verifier, because it pages somebody at 3am about
-- arithmetic instead of tampering.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 5: "ZERO-SUM VERIFIED CONTINUOUSLY - NIGHTLY RECONCILIATION - 0 BREAKS" IS A PLATFORM
--           FACT PRINTED AS A TENANT FACT
-- ---------------------------------------------------------------------------------------------
-- `reconciliation_runs` is platform-wide and unscoped by design (the ledger is one book). ADMIN-6
-- wired the two worker jobs that write it. A tenant console that restates "0 breaks" is claiming
-- knowledge about every other FPO's money on the same book. So the tenant's ledger-health panel
-- reports only what IS the tenant's own truth — its cached balances against the sum of its own
-- entries, and its own chain — and says plainly that platform-wide reconciliation is the
-- platform's assurance, run by the platform, not a figure restated here.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO: RLS ON THE LEDGER
-- ---------------------------------------------------------------------------------------------
-- `wallet_accounts`, `ledger_transactions` and `ledger_entries` carry NO row-level policies, on
-- purpose (0014's "history is physics, not policy" doctrine — the ledger is the wallet service's
-- book, and kv_app holds SELECT and nothing more; 0077 revoked every write). Isolation on the read
-- side is therefore a QUERY property, not a database property, and 3c-2's lesson applies in
-- reverse: proving isolation here means proving the funnel. TENANT-4a's read-model resolves the
-- caller's own account ids from `ctx.tenantId` FIRST and never accepts an account id, an owner id
-- or an account code from the caller; the spec pins that no query in the file filters on anything
-- else. What this migration adds is the index that funnel needs.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 142.1  THE ORG WALLET'S OWN KEY
-- ---------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('wallet.org_view', 'View the organisation wallet, its ledger and its health', 'M05')
ON CONFLICT (code) DO NOTHING;

-- WHO HOLDS IT: tenant_admin. `owner` reaches it through '*'. It is deliberately NOT granted to
-- support_agent or finance-adjacent staff roles by default — an FPO that wants a finance clerk to
-- see the organisation's balances grants it per person through `staff_permission_overrides` (0003),
-- which is also the record of who asked for it. Note the shape this fixes: tenant_admin has held
-- `wallet.adjust` (manual adjustment) since 0004 with no view key at all.
-- CAUGHT BY THE LIVE APPLY, NOT BY REVIEW: this grant was first written `WHERE r.code = 'tenant_admin'
-- AND r.tenant_id IS NULL`, on the assumption that roles are tenant-scoped like most tables here. They are
-- not — `roles` is a PLATFORM table (0003) whose scope lives in a `scope` column, and it has no tenant_id at
-- all, so the statement failed with "column r.tenant_id does not exist" against a real database after a
-- fully green unit suite. Same class as 0140's varchar(10) and 0139's NULL CHECK: TypeScript never sees a
-- column list. The predicate now matches 0139's, which is the pattern that has actually run.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'wallet.org_view' FROM roles r
 WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 142.2  THE INDEX THE TENANT FUNNEL NEEDS
-- ---------------------------------------------------------------------------------------------
-- The escrow card ("platform-held, not yours yet") is the net of the PLATFORM escrow account's
-- entries that carry this tenant's `tenant_id` — captures credit it, completions and refunds debit
-- it, so the remainder is what is still held for this tenant's in-flight orders. That is exact
-- arithmetic off the ledger rather than an estimate, but it reads ONE account shared by every
-- tenant on the platform: without this index it is a scan of the hottest account in the book.
-- ledger_entries is partitioned by created_at, so this creates a partitioned index whose parts are
-- local to each month.
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_account
  ON ledger_entries (tenant_id, account_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 142.3  A NOTE STORED WHERE THE NEXT PERSON WILL LOOK
-- ---------------------------------------------------------------------------------------------
COMMENT ON INDEX idx_ledger_tenant_account IS
  'PC-56 TENANT-4a: supports the tenant-scoped reads of the shared escrow account (net escrow per tenant) and of a tenant''s own accounts. The ledger has no RLS by doctrine (0014); tenant isolation on the read side is enforced by the read-model funnel, which resolves account ids from the request tenant and accepts none from the caller.';

COMMENT ON COLUMN wallet_accounts.owner_tenant_id IS
  'The organisation that owns this account (account_code main|commission|hold). Written since 0006, read by no application code until PC-56 TENANT-4a. hold has never been written by any code path: no tenant-side freeze exists (see TENANT-3b - escrow holds the buyer''s gross for the whole order).';
