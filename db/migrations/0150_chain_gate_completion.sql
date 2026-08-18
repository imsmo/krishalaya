-- =============================================================================================
-- 0150_chain_gate_completion.sql
-- PC-56 TENANT-4d-5 CHAIN REPAIR (part 2) — WHAT THE DEPLOYMENT GATE FOUND ONCE IT COULD RUN
-- =============================================================================================
-- `0056a_reference_data_the_chain_depends_on.sql` made the migration chain appliable for the first
-- time. `.github/workflows/db-migrate.yml` then runs four more steps after `migrate`, and each one is a
-- gate this repository wrote and has never been able to execute, because the chain halted at 0057 long
-- before any of them:
--
--     ensure-partitions      → PASSES (36 partitioned parents, runway ≥ 2 months)
--     verify-rls-coverage    → **FAILED**  (this file, 150.1 and 150.2)
--     archive-partitions     → **FAILED**  (this file, 150.3)
--     seed core/rules/cat.   → PASSES (28 seed files)
--
-- Nothing below is a new feature. Every statement here closes something the platform already declared it
-- required, and the only reason none of it was caught is that the gate could not start.
--
-- ---------------------------------------------------------------------------------------------
-- 150.1  FOUR TENANT TABLES WITH NO ROW-LEVEL SECURITY AT ALL
-- ---------------------------------------------------------------------------------------------
-- `verify-rls-coverage.js` reports, verbatim:
--     tenant tables WITHOUT an RLS policy:
--       correction_drafts, listing_moderation_orders, moderation_action_notices,
--       support_coaching_records
--
-- All four carry a `tenant_id` column, and **not one of the three migrations that created them contains
-- a single RLS statement** — `grep -c "ENABLE ROW LEVEL SECURITY\|CREATE POLICY"` returns 0 for
-- 0100_support_coaching.sql, 0111_manual_correction_drafts.sql and 0112_moderation_queue.sql. This is
-- not "RLS enabled with a weak policy"; it is `relrowsecurity = false`, no net of any kind.
--
-- CLAUDE.md Law 1 states the doctrine exactly: "RLS is the net, not the plan." The plan — a tenant
-- predicate in every query — may well be correct in today's repositories. The net was missing, so the
-- first read written without a predicate reads every tenant's rows, and what these four tables hold is
-- the kind of thing that makes that a disclosure rather than a bug:
--   • `support_coaching_records`     — a support agent's coaching notes about named people;
--   • `correction_drafts`            — proposed manual corrections to money;
--   • `listing_moderation_orders`    — moderation decisions taken against a seller;
--   • `moderation_action_notices`    — the notices sent about them.
--
-- Per-verb policies rather than `FOR ALL`, and every write verb carries a `WITH CHECK`. That is
-- deliberate and it is on this programme's own defect list: a `FOR ALL` policy with only a `USING`
-- clause filters reads and permits an INSERT that plants a row into ANOTHER tenant. FORCED as well, so
-- the table owner cannot bypass it either — which is the second half of what the gate checks.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['correction_drafts', 'listing_moderation_orders',
                           'moderation_action_notices', 'support_coaching_records']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 150.2  SEVEN TABLES WITH RLS ENABLED BUT NOT FORCED — THE OWNER WALKS STRAIGHT THROUGH
-- ---------------------------------------------------------------------------------------------
-- `verify-rls-coverage.js`, verbatim again:
--     RLS enabled but NOT forced (owner can bypass):
--       charge_change_proposals, credit_notes, notification_template_versions, refund_approvals,
--       settlement_cycles, subscription_plan_changes, tenant_member_suspensions
--
-- `ENABLE ROW LEVEL SECURITY` does not apply to the table's OWNER, and migrations run as the schema
-- owner. So every one of these has a policy that is silently inert for the most privileged connection in
-- the system — and the list is a roll-call of the controls the last twelve waves built: the refund gate
-- (0139), credit notes (0140), the charge-change gate (0141), the plan-change record (0126), the
-- settlement cycle close (0144), the member suspension (0127) and template versioning (0122).
--
-- Two of them matter beyond isolation. `tenant_member_suspensions` is the table
-- `shared/sql/member-suspension.sql.ts` anti-joins on SIX public read paths — TENANT-4d-5 made it a
-- seventh — so an unforced net there is the single predicate the marketplace's visibility rules and the
-- RBAC resolver both stand on. And `notification_template_versions` is the immutable evidence of what
-- wording was sent, which is only evidence if it cannot be read or written across tenants.
--
-- Every migration in this repository that adds RLS to a NEW table already writes both statements
-- together (`ENABLE` then `FORCE`); these seven were written before that became the habit or missed the
-- second line. Nothing else changes — the policies they already have start applying to the owner too.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['charge_change_proposals', 'credit_notes', 'notification_template_versions',
                           'refund_approvals', 'settlement_cycles', 'subscription_plan_changes',
                           'tenant_member_suspensions']
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 150.3  A RETENTION POLICY FOR A TABLE THAT DOES NOT EXIST
-- ---------------------------------------------------------------------------------------------
-- `archive-partitions.js` dies with
--     FATAL  relation "user_devices" does not exist
-- because 0107_dsr_erasure_evidence.sql seeded a `data_retention_policies` row for `user_devices`, and
-- **there is no such table anywhere in this schema.** The device-token table is `push_devices` (0045).
-- `data_retention_policies.table_name` is free text — it cannot carry a foreign key to a catalogue — so
-- the typo was undetectable by the database and would only ever have surfaced when the archive script
-- ran, which it could not.
--
-- The consequence is precise and it is a DPDP one: 0107's own purpose is data minimisation, this row is
-- the policy that erases device tokens (`action = 'delete'`, `active_months = 0`), and it has been
-- pointing at nothing. Device tokens have no retention policy in force at all, and the script that
-- enforces every OTHER table's policy would have aborted on this row before reaching them.
--
-- Corrected, not deleted: the policy decision 0107 recorded was right, only its subject was misspelt.
-- `archive-partitions.js` is separately hardened to SKIP and REPORT an unknown table rather than
-- aborting the run (Law 12, degrade never die), so the next typo costs a warning instead of a deploy.
UPDATE data_retention_policies
   SET table_name = 'push_devices'
 WHERE table_name = 'user_devices'
   AND NOT EXISTS (SELECT 1 FROM data_retention_policies d WHERE d.table_name = 'push_devices');

-- If a `push_devices` policy somehow already exists, the misdirected row is retired rather than left to
-- abort the archive run for ever.
DELETE FROM data_retention_policies WHERE table_name = 'user_devices';

-- **AND IT WAS NOT ONE BAD ROW, IT WAS THREE.** Asked directly — `SELECT table_name,
-- to_regclass(table_name) IS NOT NULL FROM data_retention_policies` — three of 0107's thirteen policies name a
-- relation that has never existed: `user_devices`, `notification_deliveries` and `invoices`.
--
-- `notification_deliveries` is unambiguous: the delivery log is `notifications` (0012), it is PARTITIONED BY
-- RANGE (created_at), and 6-months-then-delete is exactly what the archive script can enforce on it. So this one
-- is corrected, and correcting it has a real effect — the notification delivery log has had no retention in
-- force at all, on a table that records who was messaged, on what channel, with what wording.
UPDATE data_retention_policies
   SET table_name = 'notifications'
 WHERE table_name = 'notification_deliveries'
   AND NOT EXISTS (SELECT 1 FROM data_retention_policies d WHERE d.table_name = 'notifications');
DELETE FROM data_retention_policies WHERE table_name = 'notification_deliveries';

-- **`invoices` IS NOT GUESSED, AND THAT IS THE DECISION.** There are three invoice tables in this schema —
-- `trade_invoices` (the order tax invoice), `saas_invoices` (the bill the platform raises to a tenant) and
-- `freight_invoices` — and the row's own legal basis, "CGST Act s.36 — 72 months from the annual return due
-- date", applies to more than one of them. Picking one would be inventing a statutory retention decision about
-- somebody else's books, which is not a repair.
--
-- It is also inert either way, and saying so is part of being honest about the fix: `archive-partitions.js` acts
-- only on PARTITIONED parents (it walks `pg_inherits`), and both `trade_invoices` and `saas_invoices` are plain
-- tables. So no invoice retention has ever been enforceable by this mechanism regardless of the name.
--
-- The row is therefore DEACTIVATED with its reason recorded, not deleted and not redirected: it is the trace of
-- a real compliance intent that needs a founder decision (which invoice books, and partitioned by what) rather
-- than a silent edit by a repair migration. Deactivated means the archive script skips it cleanly instead of
-- warning about it on every run for ever.
UPDATE data_retention_policies
   SET is_active = false,
       -- `legal_basis` is varchar(200) and the full argument does not fit — it lives in this file's header
       -- and in the table COMMENT below. What the ROW must carry is enough for an operator reading it to
       -- know it is deliberate and where to look, which is all a 200-character column can honestly hold.
       legal_basis = left(legal_basis || ' [DEACTIVATED by 0150: no table named invoices exists; which invoice books this covers is a founder decision]', 200)
 WHERE table_name = 'invoices' AND is_active;

COMMENT ON TABLE data_retention_policies IS
  'Tiered retention per table, enforced by db/scripts/archive-partitions.js. `table_name` is free text and cannot be foreign-keyed, so a typo here is invisible until the archive run — 0107 seeded THREE such rows - `user_devices` (real table `push_devices`), `notification_deliveries` (real table `notifications`) and `invoices` (no such table; three real invoice tables exist and none is partitioned). 0150 corrected the first two and DEACTIVATED the third rather than guessing which books it meant. The script now skips and reports an unknown table instead of aborting the whole run.';
