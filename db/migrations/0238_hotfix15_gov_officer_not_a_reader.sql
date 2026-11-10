-- ==================================================================================================================
-- MIGRATION 0238 — PC-56 HOTFIX-15 · A GOVERNMENT OFFICER IS NOT THE ORGANISATION'S READER — the tenant role
-- `gov_officer` loses `report.view` (the organisation's member roster, member files, user records, role assignments,
-- console home and finance scope), and the tenant `gov_officer` is FROZEN: the database refuses any write that would make
-- a `gov_officer` row in `user_tenant_roles` active — a new active assignment, an approval, a re-activation, or a row
-- moved onto the role. One DELETE, one guard function, one trigger, one comment; no table, no column, no grant, no
-- policy, no flag, no backfill.
-- (GOV-1 Q2-A and Q3-A, applied by the lead on 2026-11-10 under the founder's instruction of that day: "please choose
-- recommended option and start at your end next step … think as you are product owner" — `survey_gov1.md` §2 F-1/F-2,
-- §3 GOV1-B1/B2, §5 item 1, §6 Q2 ("a government authority is its own organisation … the FPO's 'government officer' role
-- is frozen now (HOTFIX-15)") and Q3 (F-1: the member-roster removal "is HOTFIX-15 regardless"). Brief
-- `wave-reports/brief_hotfix15.md` §D/§E. The founder may reopen Q2 and Q3.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0237 are applied; nothing here edits them. 0003's
-- `user_tenant_roles`, seed core/0004's `gov_officer` role (:28) and its grant list (:212 — edited IN THE SAME COMMIT,
-- 0128's lesson: a grant removed only here would come back on the next seed run), 0225's `trg_utr_no_partner_role`
-- (:119 — the shape copied: a BEFORE trigger on user_tenant_roles raising `[CODE] …` as check_violation) and
-- 0233/0234/0236/0237's admin-realm rule — `kv_admin` or `pg_roles.rolsuper` (the 0203 rule) — are REUSED UNCHANGED.)
--
-- CORRECTION OF 0181:41-44, stated here and never by editing 0181 (survey C-10): 0181's header says
--   "gov_officer and support_agent lose the issue (they keep every read `report.view` gives)"
-- as if that were harmless. What `report.view` gives is the organisation's member roster and every member's file
-- (payouts, orders, dairy collections, per-role KYC), any member's user record, the role assignments, the console home,
-- the organisation's finance scope (invoices, GSTR-1 export, full GSTIN — `payments.policies.ts` canReadFinance), the
-- governance register, the suspension reads and the insights datasets and exports. None of it is a scheme's. After this
-- file `gov_officer` keeps NONE of those reads; `support_agent` is unchanged (not this file's decision).
--
-- CLASS — PII/TRUST — CODEOWNERS, the founder's Law 9 review. This file moves no rupee and touches no ledger, wallet or
-- money column. It decides WHO READS the organisation's people and finance (PII) and WHO MAY BE MADE a government
-- officer inside an organisation (TRUST). The founder's Law 9 review of every line stands before merge, in the REFUSING
-- direction only.
--
-- ==================================================================================================================
--
-- WHY. Until this file a "government officer" was a member of ONE organisation holding the tenant role `gov_officer`,
-- which carried `scheme.process` AND `report.view` (seed 0004:212). With the seed flags `schemes` is OFF, so the only
-- thing the role could actually do was read the organisation's members and its finance (survey F-1, reachable today).
-- And ONE administrator could make anyone — themselves included — a government officer, permanently: assign and approve
-- are both `user.approve`, with no second person and no expiry (survey F-2). Under Q2-A a government authority becomes
-- its own organisation (GOV-0, its own people, sign-in and grants); the tenant role is frozen until then.
--
-- WHAT EXISTS AFTER THIS FILE
--   238.1  role_permissions holds no (`gov_officer`, `report.view`) row. The role carries exactly `scheme.process`
--          (whatever else an operator granted by hand stays as it is — this file removes one grant, named).
--   238.2  user_tenant_roles_no_gov_role() + trigger trg_utr_no_gov_role (BEFORE INSERT OR UPDATE OF role_id,
--          is_active, approved_at ON user_tenant_roles, FOR EACH ROW), outside the admin realm:
--          a row whose role is `gov_officer` (roles.code) may not BECOME active —
--            INSERT  NEW.is_active                                         → refused
--            UPDATE  NEW.is_active AND (NOT OLD.is_active                  → refused (an approval; a re-activation)
--                                       OR NEW.role_id <> OLD.role_id      → refused (a row moved onto the role)
--                                       OR NEW.approved_at <> OLD.approved_at) → refused (a re-approval)
--          raising `[GOV_ROLE_LIVES_IN_AN_AUTHORITY] …` (check_violation), which the API names
--          (`modules/identity/domain/swc.errors.ts`). An INACTIVE row may still be written (the service refuses a new
--          assignment before any write — HOTFIX-15's first commit — but a pending row is no grant); an ALREADY-ACTIVE
--          row may be updated in ways that leave it as it is (its KYC status, its role data) and may be revoked.
--          The ADMIN REALM (kv_admin, or a superuser as pg_roles knows one — the 0203 rule) is exempt, exactly as 0225's
--          sibling guards and 0236/0237 are: an operator repairing data by hand, a migration, the test harness fixtures.
--   238.3  A COMMENT on the trigger naming the decision.
--
-- EXISTING ACTIVE `gov_officer` ROWS (brief §D): there is no production database, and no seed file holds a
-- `gov_officer` assignment (seed 0004 creates the ROLE only). On a database that already holds active rows this file
-- LEAVES THEM AS THEY ARE — the role now carries only `scheme.process`, so those people lose the organisation's members and
-- finance at their next token (access tokens live 15 minutes); a NOTICE names the count. Deleting or deactivating a
-- person's row is not this file's decision; the organisation's administrator can remove it (`DELETE /v1/rbac/assignments/
-- :id`, with a reason, recorded).
--
-- NO GRANT / NO POLICY / NO NEW TABLE: the RLS gate count is UNCHANGED (asserted in QA: 1,989).
-- NO FLAG (Law 10 reasoning, the HOTFIX precedents): a refusal on a trust path is not a feature; a kill-switch on it would
-- be a switch that re-opens the door. The scheme surface still sits behind `schemes` OFF (seed 0009_feature_flags:44).
-- NOTHING ON THE PARTNER AXIS (kv_partner, current_partner_id(), the partner definers) is touched; 0225's
-- `trg_utr_no_partner_role` stays exactly as it is, beside this one.
--
-- OWNER: plain DDL; the guard is SECURITY INVOKER and reads only the row, the role catalogue (`roles` — platform
-- reference data kv_app may SELECT) and the session's role name.
--
-- SHARDS: `role_permissions` and `roles` are platform reference data present on every shard; `user_tenant_roles` carries
-- tenant_id and lives on the tenant's shard. The DELETE and the trigger are per-shard facts, so every shard runs this file
-- unchanged and no cross-shard read exists.
--
-- REVERSAL (hand-run, never by the runner; revert the API's HOTFIX-15 code in modules/identity FIRST — the service and the
-- controller refuse `gov_officer` by name before the database is asked):
--   DROP TRIGGER IF EXISTS trg_utr_no_gov_role ON user_tenant_roles;
--   DROP FUNCTION IF EXISTS user_tenant_roles_no_gov_role();
--   INSERT INTO role_permissions (role_id, permission_code) SELECT r.id, p.code FROM roles r JOIN permissions p
--     ON p.code = 'report.view' WHERE r.code = 'gov_officer' ON CONFLICT DO NOTHING;
--   -- …and restore `report.view` to seed core/0004's gov_officer list (else the next seed run does not re-add it).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 238.1  THE ORGANISATION'S MEMBERS AND FINANCE ARE NOT A GOVERNMENT OFFICER'S (GOV-1 Q3 / F-1)
-- ------------------------------------------------------------------------------------------------------------------
DELETE FROM role_permissions rp
 USING roles r
 WHERE rp.role_id = r.id
   AND r.code = 'gov_officer'
   AND rp.permission_code = 'report.view';

-- ------------------------------------------------------------------------------------------------------------------
-- 238.2  THE TENANT gov_officer IS FROZEN (GOV-1 Q2-A / F-2) — the 0225 :119 shape
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION user_tenant_roles_no_gov_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  realm boolean := current_user = 'kv_admin' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper);
BEGIN
  IF realm THEN RETURN NEW; END IF;
  IF NOT NEW.is_active THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.code = 'gov_officer') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT'
     OR NOT OLD.is_active
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     -- [lead QA, HOTFIX-15] an un-delete: the resolver counts `is_active AND deleted_at IS NULL`, so clearing `deleted_at` on a
     -- soft-deleted, still-active legacy row would revive the officer without touching the three columns above.
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL) THEN
    RAISE EXCEPTION '[GOV_ROLE_LIVES_IN_AN_AUTHORITY] the government officer role is not given or approved inside an organisation — PC-56 HOTFIX-15 (0238)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_utr_no_gov_role ON user_tenant_roles;
CREATE TRIGGER trg_utr_no_gov_role BEFORE INSERT OR UPDATE OF role_id, is_active, approved_at, deleted_at ON user_tenant_roles
  FOR EACH ROW EXECUTE FUNCTION user_tenant_roles_no_gov_role();

-- ------------------------------------------------------------------------------------------------------------------
-- 238.3  THE DECISION, ON THE TRIGGER; EXISTING ROWS NAMED, NEVER TOUCHED
-- ------------------------------------------------------------------------------------------------------------------
COMMENT ON TRIGGER trg_utr_no_gov_role ON user_tenant_roles IS
  'PC-56 HOTFIX-15 (GOV-1 Q2-A, lead-applied 2026-11-10; the founder may reopen): the tenant role gov_officer is frozen — no row '
  'with it may become active outside the admin realm (insert, approval, re-activation, re-approval, a row moved onto it). '
  'A government authority is its own organisation (GOV-0). Existing active rows are left as they were.';

DO $$
DECLARE active_rows int;
BEGIN
  SELECT count(*) INTO active_rows FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
   WHERE r.code = 'gov_officer' AND utr.is_active AND utr.deleted_at IS NULL;
  IF active_rows > 0 THEN
    RAISE NOTICE 'MIGRATION 0238: % active gov_officer assignment(s) exist and are LEFT AS THEY ARE (none can exist in production). The role now carries only scheme.process; an administrator may remove a row with a reason.', active_rows;
  END IF;
END $$;
