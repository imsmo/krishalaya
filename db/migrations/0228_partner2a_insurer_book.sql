-- ==================================================================================================================
-- MIGRATION 0228 — PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK — an insurer partner reads its OWN insurance products and the policy
-- FACTS written on them, on the kv_partner axis, and never a policyholder's identity; 0090's table-wide insurance_policies grant to
-- kv_partner is narrowed to the same column wall; the four partner roles are described without a lending word.
-- (brief_p2a.md founder decisions Q6 + Q7 + Q9, 2026-10-18; survey_partner2.md §1A–§1F, F-4, F-7, F-19, P2-B1, P2-B2, P2-B13, §5 item 1.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0227 are applied; nothing here edits them. 0090's role, axis GUC, oracle
-- `partner_owns_insurance_policy` and policy `partner_own_book_insurance_policies` are REUSED unchanged; only 0090's TABLE-WIDE grant on
-- insurance_policies is replaced by a COLUMN grant — the narrowing the founder chose under Q6.)
-- LAW 9 / LAW 11 CLASS — PII + TRUST: a cross-tenant read of farmers' insurance records by an insurer organisation (policy facts only), and
-- the narrowing of a dark machine-realm grant. A founder review is owed before `partner_console` is switched on (the PARTNER-0 review) and
-- the S2 review before `partner_api` is switched on. NOT MONEY: no ledger table, no posting, no money column is written here — every money
-- column touched is READ (sum insured, the farmer's premium share as stored), as bigint.
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   228.1  Permission `partner.insurance.read` (M19) granted to EVERY role of scope 'partner' (bound by scope with a loud assert — the 0227.5
--          pattern and the tenant4d5-chain-repair rule: never by role code). Seed core/0004 carries the same permission row (inserted where
--          missing), so a database built from empty and an existing one agree.
--   228.2  FOUR READS ON THE AXIS (SECURITY DEFINER, `SET search_path = public, pg_temp`, NULL-guarded on current_partner_id(), REVOKE FROM
--          PUBLIC, EXECUTE to kv_partner ONLY — kv_app reaches them only inside `SET LOCAL ROLE kv_partner`, 0090's non-inheriting grant):
--            partner_insurance_products()   THIS insurer's own products: id, name, kind (lookup id + code when resolvable — the
--                                           `insurance_kind` type is not registered yet, survey F-13), premium_calc (its OWN pricing terms —
--                                           0090's pricing-IP rule: never another insurer's), sum_insured_rules, govt_subsidy_bps,
--                                           our_commission_bps, is_parametric, is_active, created_at, updated_at;
--            partner_insurance_book(status, cursor_created, cursor_id, limit)
--                                           policies on THIS insurer's products, newest first, keyset on (created_at, id), limit 1–100;
--            partner_insurance_policy(id)   ONE such policy (nothing for another insurer's or an absent id);
--            partner_insurance_counts()     the dashboard's figures on this shard: policies in force (`active`) + Σ their sum insured,
--                                           `proposed` (awaiting the farmer's payment), all policies, the distinct FPOs with a policy on these
--                                           products, and the per-product count by status (jsonb).
--          THE POLICY COLUMNS (book + detail): id, tenant_id (for the FPO's PUBLIC name only — the console never prints or returns it),
--          product_id, policy_no, subject_type, status, sum_insured_minor, premium_minor (the farmer's share as stored), valid_from,
--          valid_until, created_at. NEVER holder_user_id, subject_id, premium_payment_id, parametric_triggers, created_by / updated_by (the
--          proposer is the holder). `activated_at` does NOT exist on insurance_policies (0011:166-182) — named, left out; the console prints
--          what exists.
--   228.3  0090:126 NARROWED (founder Q6): `REVOKE SELECT ON insurance_policies FROM kv_partner` then a COLUMN grant of
--            id, tenant_id, product_id, policy_no, subject_type, status, sum_insured_minor, premium_minor, valid_from, valid_until,
--            created_at, deleted_at
--          (deleted_at because the machine book filters on it). 0090's RLS policy `partner_own_book_insurance_policies` is untouched, so the
--          machine book `GET /v1/partner-api/insurance/policies` (partner-api.repository.ts) still reads on the narrowed columns — it stops
--          selecting holder_user_id and subject_id in the same wave. `partner_api` is OFF: there is no consumer to break.
--   228.4  The four partner roles' default_name is kind-neutral (founder Q9; survey C-19 / F-19): an insurer's people no longer hold roles
--          worded for loan applications. The role CODES stay. Seed core/0004 mirrors the words.
--
-- SHARDS: insurance_policies carry a tenant_id and live on that tenant's shard — the book and the counts SCATTER (the 1a dashboard shape);
-- insurance_products are global reference data (shard 0, replicated) — the products read is shard 0. No new table, no new policy, no flag
-- (`partner_console` gates the console; the platform's `insurance` flag gates the insurer routes in the API). RLS count unchanged.
--
-- REVERSAL (hand-run, never by the runner; revert the API's partner-console insurance routes and the machine book's projection first):
--   REVOKE SELECT ON insurance_policies FROM kv_partner;  GRANT SELECT ON insurance_policies TO kv_partner;    -- (0090's table-wide grant back)
--   DROP FUNCTION IF EXISTS partner_insurance_products(), partner_insurance_book(text, timestamptz, uuid, integer),
--     partner_insurance_policy(uuid), partner_insurance_counts();
--   DELETE FROM role_permissions WHERE permission_code = 'partner.insurance.read';
--   DELETE FROM permissions WHERE code = 'partner.insurance.read';
--   UPDATE roles SET default_name = 'Partner checker (decides applications)' WHERE code = 'partner_checker';    -- (0225's words)
--   UPDATE roles SET default_name = 'Partner maker (starts reviews)' WHERE code = 'partner_maker';
--   UPDATE roles SET default_name = 'Partner viewer (reads applications)' WHERE code = 'partner_viewer';
--   UPDATE roles SET default_name = 'Partner administrator' WHERE code = 'partner_admin';
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 228.1  THE PERMISSION — every partner role reads its organisation's own insurance book (policy facts only)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('partner.insurance.read', 'Partner console: read this insurer''s own products and the policies written on them — policy facts only, never a policyholder''s identity', 'M19')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM roles WHERE scope = 'partner') < 4 THEN
    RAISE EXCEPTION '0228: the four partner roles of 0225 are missing — the insurance read would grant nothing';
  END IF;
END $$;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = 'partner.insurance.read'
 WHERE r.scope = 'partner'
ON CONFLICT DO NOTHING;
DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.scope = 'partner' AND rp.permission_code = 'partner.insurance.read') < 4 THEN
    RAISE EXCEPTION '0228: partner.insurance.read is not held by every partner role';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 228.2  THE READS — this insurer's own products, and the policy FACTS on them; never a holder, a subject or a payment
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_insurance_products() RETURNS TABLE (
  id uuid, name text, kind_id uuid, kind_code text, premium_calc jsonb, sum_insured_rules jsonb, govt_subsidy_bps integer,
  our_commission_bps integer, is_parametric boolean, is_active boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT pr.id, pr.default_name::text, pr.product_kind_id,
         (SELECT lv.code::text FROM lookup_values lv WHERE lv.id = pr.product_kind_id AND lv.type_code = 'insurance_kind'),
         pr.premium_calc, pr.sum_insured_rules, pr.govt_subsidy_bps, pr.our_commission_bps, pr.is_parametric, pr.is_active,
         pr.created_at, pr.updated_at
    FROM insurance_products pr
   WHERE current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND pr.deleted_at IS NULL
   ORDER BY pr.created_at DESC, pr.id DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION partner_insurance_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_products() TO kv_partner;
COMMENT ON FUNCTION partner_insurance_products() IS
  'PC-56 PARTNER-2a (0228): this insurer''s OWN products on the kv_partner axis (its own premium_calc — never another insurer''s, 0090''s '
  'pricing-IP rule). NULL-guarded: no partner in scope → no rows.';

CREATE OR REPLACE FUNCTION partner_insurance_book(p_status text, p_cursor_created timestamptz, p_cursor_id uuid, p_limit integer) RETURNS TABLE (
  id uuid, tenant_id uuid, product_id uuid, policy_no text, subject_type text, status text, sum_insured_minor bigint, premium_minor bigint,
  valid_from date, valid_until date, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, po.tenant_id, po.product_id, po.policy_no::text, po.subject_type::text, po.status::text, po.sum_insured_minor, po.premium_minor,
         po.valid_from, po.valid_until, po.created_at
    FROM insurance_policies po
    JOIN insurance_products pr ON pr.id = po.product_id
   WHERE current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND po.deleted_at IS NULL
     AND (p_status IS NULL OR po.status::text = p_status)
     AND (p_cursor_created IS NULL OR (po.created_at, po.id) < (p_cursor_created, p_cursor_id))
   ORDER BY po.created_at DESC, po.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;
REVOKE ALL ON FUNCTION partner_insurance_book(text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_book(text, timestamptz, uuid, integer) TO kv_partner;
COMMENT ON FUNCTION partner_insurance_book(text, timestamptz, uuid, integer) IS
  'PC-56 PARTNER-2a (0228, founder Q6): the policies on THIS insurer''s products, newest first, keyset (created_at, id), 1–100 rows — policy '
  'FACTS only: never holder_user_id, subject_id, premium_payment_id, parametric_triggers or created_by. NULL-guarded.';

CREATE OR REPLACE FUNCTION partner_insurance_policy(p_id uuid) RETURNS TABLE (
  id uuid, tenant_id uuid, product_id uuid, policy_no text, subject_type text, status text, sum_insured_minor bigint, premium_minor bigint,
  valid_from date, valid_until date, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.id, po.tenant_id, po.product_id, po.policy_no::text, po.subject_type::text, po.status::text, po.sum_insured_minor, po.premium_minor,
         po.valid_from, po.valid_until, po.created_at
    FROM insurance_policies po
    JOIN insurance_products pr ON pr.id = po.product_id
   WHERE po.id = p_id
     AND current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND po.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION partner_insurance_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_policy(uuid) TO kv_partner;
COMMENT ON FUNCTION partner_insurance_policy(uuid) IS
  'PC-56 PARTNER-2a (0228, founder Q6): ONE policy on THIS insurer''s products (nothing for another insurer''s or an absent id) — the same '
  'policy facts as partner_insurance_book, never an identity. NULL-guarded.';

CREATE OR REPLACE FUNCTION partner_insurance_counts() RETURNS TABLE (
  policies bigint, in_force bigint, in_force_sum_insured_minor text, proposed bigint, fpos bigint, per_product jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH own AS (
    SELECT po.id, po.tenant_id, po.product_id, po.status::text AS status, po.sum_insured_minor
      FROM insurance_policies po
      JOIN insurance_products pr ON pr.id = po.product_id
     WHERE current_partner_id() IS NOT NULL
       AND pr.partner_id = current_partner_id()
       AND po.deleted_at IS NULL
  ), by_status AS (
    SELECT product_id, status, count(*) AS n FROM own GROUP BY product_id, status
  ), by_product AS (
    SELECT product_id, jsonb_object_agg(status, n) AS statuses FROM by_status GROUP BY product_id
  )
  SELECT (SELECT count(*) FROM own),
         (SELECT count(*) FROM own WHERE status = 'active'),
         (SELECT COALESCE(sum(sum_insured_minor), 0)::text FROM own WHERE status = 'active'),
         (SELECT count(*) FROM own WHERE status = 'proposed'),
         (SELECT count(DISTINCT tenant_id) FROM own),
         COALESCE((SELECT jsonb_object_agg(product_id::text, statuses) FROM by_product), '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION partner_insurance_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_counts() TO kv_partner;
COMMENT ON FUNCTION partner_insurance_counts() IS
  'PC-56 PARTNER-2a (0228): the insurer dashboard''s figures on THIS shard — policies in force (active) and Σ their sum insured (bigint as '
  'text), proposed, all, distinct FPOs, per-product counts by status. Shards add (a tenant lives on one shard). NULL-guarded: all zero.';

-- ------------------------------------------------------------------------------------------------------------------
-- 228.3  0090:126 NARROWED — kv_partner reads the policy FACTS columns only (founder Q6); the machine book changes with it
-- ------------------------------------------------------------------------------------------------------------------
REVOKE SELECT ON insurance_policies FROM kv_partner;
GRANT SELECT (id, tenant_id, product_id, policy_no, subject_type, status, sum_insured_minor, premium_minor, valid_from, valid_until,
              created_at, deleted_at)
  ON insurance_policies TO kv_partner;
DO $$
BEGIN
  IF has_column_privilege('kv_partner', 'insurance_policies', 'holder_user_id', 'SELECT')
     OR has_column_privilege('kv_partner', 'insurance_policies', 'subject_id', 'SELECT')
     OR has_column_privilege('kv_partner', 'insurance_policies', 'premium_payment_id', 'SELECT') THEN
    RAISE EXCEPTION '0228: kv_partner can still read a policyholder''s identity on insurance_policies';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 228.4  THE FOUR PARTNER ROLES, DESCRIBED FOR EVERY PARTNER KIND (founder Q9) — the codes stay
-- ------------------------------------------------------------------------------------------------------------------
UPDATE roles SET default_name = 'Partner administrator (the organisation''s people, keys and settings)' WHERE code = 'partner_admin' AND scope = 'partner';
UPDATE roles SET default_name = 'Partner checker (decides what is under review)' WHERE code = 'partner_checker' AND scope = 'partner';
UPDATE roles SET default_name = 'Partner maker (starts a review)' WHERE code = 'partner_maker' AND scope = 'partner';
UPDATE roles SET default_name = 'Partner viewer (reads the organisation''s own book)' WHERE code = 'partner_viewer' AND scope = 'partner';
