-- ==================================================================================================================
-- MIGRATION 0184 — PC-56 TENANT-10a · AMBASSADORS + REFERRALS — THE MONEY TELLS THE TRUTH
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0013, 0014, 0078, 0080 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- WHAT THE SURVEY FOUND (survey_t10.md F-1, F-3, F-5, F-6, F-11, F-13, F-15, F-18), RE-PROVEN AT 9743e8b BEFORE THIS FILE:
--   • F-1  DEV-55 IS A DOUBLE-PAY. `markPaid` matched `created_at=$2` with a millisecond JS Date against a microsecond
--          column: zero rows stamped AFTER the wallet had credited the ambassador, so every later payout re-paid the same
--          earnings (the harness's own `ambassadors.integration.spec.ts` "re-payout finds nothing" was red at 9743e8b for
--          exactly this reason). The fix is code (repository + service); this file adds nothing for it — the column was
--          always microsecond, the read was wrong.
--   • F-3  THE PAYOUT HAD NO VERB OF ITS OWN. `ambassador.manage` ("Enroll/suspend … + run commission payouts") is held by
--          tenant_admin AND support_agent (seed 0004), so a support agent could move platform money to a village agent.
--   • F-5  COMMISSION CONDITIONS WERE DATA NOBODY READ. `max_sales_per_farmer` / `max_per_farmer` are per FARMER, and an
--          earning row did not say which farmer it was earned on (`reference_id` is an order or a referral).
--   • F-6  `commission_plans_ambassador` WAS THE 0175 CLASS: tenant_id NULLABLE ("NULL = platform default plan"), one ALL
--          policy `tenant_id IS NULL OR tenant_id = current_tenant_id()` with no WITH CHECK, kv_app holding INSERT+UPDATE —
--          so kv_app under ANY tenant could INSERT or rewrite a platform plan that every tenant's accrual then applies.
--   • F-13 / F-15  "Onboarded (30d)" needs the moment a referral was ACTIVATED; nothing recorded it.
--   • F-18 `UNIQUE (tenant_id, code, referee_user_id)` is NULL-distinct: two concurrent mints of one code both commit.
--
-- WHAT THIS FILE DOES
--   184.1  THE WALL ON commission_plans_ambassador (F-6, the 0175 split): the ALL policy is DROPPED; `cpa_read` (SELECT:
--          the platform row stays readable underneath a tenant's override), `cpa_insert_own` / `cpa_update_own`
--          (`tenant_id = current_tenant_id()` in USING and WITH CHECK — NULL never matches, so a platform plan cannot be
--          written from the tenant realm), `cpa_admin_realm` (FOR ALL TO kv_admin — the admin realm owns platform rates).
--          ENABLE + FORCE restated. Grants are not widened.
--   184.2  `ambassador_earnings.subject_user_id` — WHICH FARMER an earning was earned on (F-5). Nullable (a stream with no
--          farmer — a milestone — has none). Backfilled where the reference is unambiguous: an `order` reference → that
--          order's seller; a `referral` reference → that referral's referee. Indexed for the per-farmer cap count.
--   184.3  `referrals.activated_at` — the activation act's own timestamp (F-13/F-15 read models). Backfilled from
--          `updated_at` for rows already `activated`: activation is the LAST write any code path makes to such a row
--          (`rewarded` / `reward_txn_id` have no writer — F-11), so `updated_at` IS the activation moment. A `rewarded` row
--          (none exist; nothing writes the status) would stay NULL = "not recorded" rather than be guessed.
--   184.4  ONE OPEN CODE PER TENANT (F-18): partial unique index `(tenant_id, code) WHERE referee_user_id IS NULL`.
--   184.5  THE VERB (F-3): `ambassador.payout` — "Run ambassador commission payouts", module M-AMB, granted to tenant_admin
--          ONLY. Here AND in seed 0004 (0128's lesson: a seed-only permission repairs a demo, not a database).
--   184.6  `idx_ambassador_profiles_activity` — the roster's "inactive 60d" filter reads `last_activity_at` per tenant.
--
-- WHAT THIS FILE DOES NOT DO (named)
--   • No referral REWARD rule, no reward ledger write (F-11 — refused by name until the founder decides who funds a reward:
--     tenant wallet or platform). `referrals.reward_rule` / `reward_txn_id` are untouched.
--   • No cluster EXCLUSIVITY constraint and no 60-day reassignment record (F-15): no reassignment act exists to record, and
--     an exclusivity constraint over a jsonb array of regions needs the reassignment act's rules first. The console prints
--     "no reassignment act recorded".
--   • No grant to kv_relay. The sale-commission outbox handler used to read ambassador_profiles / commission plans and
--     INSERT ambassador_earnings inside the RELAY's transaction, where kv_relay holds none of those privileges (0078/0080 —
--     and the DEV-54 spec pins that kv_relay must never write ambassador_earnings). That is fixed in CODE: the handler now
--     runs its accrual through the request-tier unit of work (kv_app, RLS-bound), which already holds exactly those grants.
--
-- RLS DECISION: no new table. `commission_plans_ambassador` keeps ENABLE + FORCE with the 0175 policy shape (184.1).
-- `ambassador_earnings` (partitioned) and `referrals` gain a column each — both already ENABLE + FORCE with tenant_id NOT
-- NULL; a column added to the partitioned parent propagates to every partition, existing and future (ensure_partitions).
-- PARTITION NOTE: the index in 184.2 is created on the partitioned parent, which creates it on every partition.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 184.1  THE WALL ON commission_plans_ambassador (F-6)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE commission_plans_ambassador ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_plans_ambassador FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_commission_plans_ambassador ON commission_plans_ambassador;
DROP POLICY IF EXISTS cpa_read ON commission_plans_ambassador;
DROP POLICY IF EXISTS cpa_insert_own ON commission_plans_ambassador;
DROP POLICY IF EXISTS cpa_update_own ON commission_plans_ambassador;
DROP POLICY IF EXISTS cpa_admin_realm ON commission_plans_ambassador;
CREATE POLICY cpa_read       ON commission_plans_ambassador FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY cpa_insert_own ON commission_plans_ambassador FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cpa_update_own ON commission_plans_ambassador FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cpa_admin_realm ON commission_plans_ambassador FOR ALL TO kv_admin USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 184.2  WHICH FARMER AN EARNING WAS EARNED ON (F-5)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE ambassador_earnings ADD COLUMN IF NOT EXISTS subject_user_id uuid;
COMMENT ON COLUMN ambassador_earnings.subject_user_id IS
  'PC-56 TENANT-10a (0184): the farmer this earning was earned on — the per-farmer caps (max_sales_per_farmer, max_per_farmer) count by it. NULL for a stream with no farmer.';
UPDATE ambassador_earnings e SET subject_user_id = o.seller_user_id
  FROM orders o
 WHERE e.subject_user_id IS NULL AND e.reference_type = 'order' AND o.id = e.reference_id AND o.tenant_id = e.tenant_id;
UPDATE ambassador_earnings e SET subject_user_id = r.referee_user_id
  FROM referrals r
 WHERE e.subject_user_id IS NULL AND e.reference_type = 'referral' AND r.id = e.reference_id AND r.tenant_id = e.tenant_id;
CREATE INDEX IF NOT EXISTS idx_amb_earn_subject ON ambassador_earnings(ambassador_id, event_code, subject_user_id);

-- ------------------------------------------------------------------------------------------------------------------
-- 184.3  THE ACTIVATION MOMENT (F-13 / F-15)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS activated_at timestamptz;
COMMENT ON COLUMN referrals.activated_at IS
  'PC-56 TENANT-10a (0184): when the audited activation act ran. Backfilled from updated_at for rows already activated (activation is the last write any path makes to such a row).';
UPDATE referrals SET activated_at = updated_at WHERE status = 'activated' AND activated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_activated ON referrals(tenant_id, activated_at) WHERE activated_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_referrals_tenant_created ON referrals(tenant_id, created_at DESC, id DESC);

-- ------------------------------------------------------------------------------------------------------------------
-- 184.4  ONE OPEN CODE PER TENANT (F-18)
-- ------------------------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_open_code ON referrals(tenant_id, code) WHERE referee_user_id IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 184.5  THE VERB (F-3) — rows here AND in seed 0004
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('ambassador.payout', 'Run ambassador commission payouts', 'M-AMB')
ON CONFLICT (code) DO NOTHING;
-- The old verb's own name said it ran payouts; it no longer does. The name changes, the code and its holders do not.
UPDATE permissions SET default_name = 'Enroll/suspend/edit ambassadors + activate referrals (payouts are ambassador.payout)'
 WHERE code = 'ambassador.manage';
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'ambassador.payout' FROM roles r WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 184.6  THE ROSTER'S ACTIVITY FILTER
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ambassador_profiles_activity ON ambassador_profiles(tenant_id, last_activity_at);
