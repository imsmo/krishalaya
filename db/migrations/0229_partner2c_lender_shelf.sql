-- ==================================================================================================================
-- MIGRATION 0229 — PC-56 PARTNER-2c · THE LENDER'S SHELF — a lending partner reads its OWN loan products' terms on the kv_partner axis, and
-- never another lender's. One SECURITY DEFINER read; nothing else.
-- (brief_p2c.md founder decisions Q7 + Q6's spirit + Q9, 2026-10-18; survey_partner2.md §1J, §1K, §1W, §1X, F-9, P2-B8, §5.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0228 are applied; nothing here edits them. 0225's `partner_loan_products()`
-- (id, name, kind code — the applications list's join) and its consent oracle `partner_owns_application` + RLS policy
-- `partner_own_book_loan_applications` are REUSED unchanged.)
-- LAW 9 / LAW 11 CLASS — TRUST: a partner reads platform-authored reference data that carries its own pricing (0090's pricing-IP rule — a
-- lender never sees another lender's terms). The PARTNER-0 founder review stands before `partner_console` is switched on. NOT MONEY: no ledger
-- table, no posting, no money column is written — every money column here is READ (the amount range, the origination fee), as bigint.
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   229.1  ONE READ ON THE AXIS (SECURITY DEFINER, STABLE, `SET search_path = public, pg_temp`, NULL-guarded on current_partner_id(), REVOKE FROM
--          PUBLIC, EXECUTE to kv_partner ONLY — kv_app reaches it only inside `SET LOCAL ROLE kv_partner`, 0090's non-inheriting grant):
--            partner_loan_product_terms(p_id uuid DEFAULT NULL)
--                THIS partner's own `loan_products` rows (all of them when p_id is NULL; the one row when p_id names one of them; nothing for
--                another partner's or an absent id): id, product_kind_id + the resolved kind code (the platform's `loan_kind` registry —
--                NULL when the id does not resolve to a platform `loan_kind` value: the console prints "kind not registered"), default_name,
--                currency_code, min_amount_minor, max_amount_minor, interest_apr_bps, subvention_bps, tenure_months_min, tenure_months_max,
--                ltv_bps, collateral_kind, origination_fee_minor, origination_fee_bps, eligibility_rules, required_doc_type_ids + the codes of
--                those ids that resolve to a platform `doc_type` value, repayment_style, is_active, created_at, updated_at.
--                NEVER created_by / updated_by (a person) — not selected, not in the column list.
--          ONE function with an OPTIONAL id (not two): the shelf and the detail read the same column list from the same predicate, so the
--          predicate lives once.
--   229.2  Nothing else. kv_partner gets NO grant on `loan_products` (the definer IS the wall — 0090's pricing-IP rule); the 30-day count of
--          applications is NOT here: the API computes it inside `withAxis` on 0225's consent axis (kv_partner's column grant on
--          loan_applications + the RLS policy `partner_own_book_loan_applications` = `partner_owns_application`: this partner's product AND a
--          live per-application consent), per shard, merged — the 1a dashboard's shape. No permission (the shelf is guarded by 0225's
--          `partner.applications.read`), no flag, no table, no policy, no event. RLS count unchanged.
--
-- SHARDS: loan_products are GLOBAL reference data (no tenant_id, shard 0, replicated) — the terms read is shard 0. The applications carry their
-- TENANT and live on its shard — the API scatters the count over every shard and adds.
--
-- REVERSAL (hand-run, never by the runner; revert the API's `partner/loan-products` routes and the console's `/lender/products` pages first):
--   DROP FUNCTION IF EXISTS partner_loan_product_terms(uuid);
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 229.1  THE READ — this partner's own loan products' terms; never another partner's, never the person who wrote the row
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_loan_product_terms(p_id uuid DEFAULT NULL) RETURNS TABLE (
  id uuid, product_kind_id uuid, kind_code text, default_name text, currency_code text,
  min_amount_minor bigint, max_amount_minor bigint, interest_apr_bps integer, subvention_bps integer,
  tenure_months_min smallint, tenure_months_max smallint, ltv_bps integer, collateral_kind text,
  origination_fee_minor bigint, origination_fee_bps integer, eligibility_rules jsonb, required_doc_type_ids jsonb, required_doc_codes text[],
  repayment_style text, is_active boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT lp.id, lp.product_kind_id,
         (SELECT lv.code::text FROM lookup_values lv
           WHERE lv.id = lp.product_kind_id AND lv.type_code = 'loan_kind' AND lv.tenant_id IS NULL),
         lp.default_name::text, lp.currency_code::text,
         lp.min_amount_minor, lp.max_amount_minor, lp.interest_apr_bps, lp.subvention_bps,
         lp.tenure_months_min, lp.tenure_months_max, lp.ltv_bps, lp.collateral_kind::text,
         lp.origination_fee_minor, lp.origination_fee_bps, lp.eligibility_rules, lp.required_doc_type_ids,
         ARRAY(SELECT lv.code::text
                 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(lp.required_doc_type_ids) = 'array' THEN lp.required_doc_type_ids ELSE '[]'::jsonb END) AS d(x)
                 JOIN lookup_values lv ON lv.id::text = d.x AND lv.type_code = 'doc_type' AND lv.tenant_id IS NULL
                ORDER BY lv.code),
         lp.repayment_style::text, lp.is_active, lp.created_at, lp.updated_at
    FROM loan_products lp
   WHERE current_partner_id() IS NOT NULL
     AND lp.partner_id = current_partner_id()
     AND lp.deleted_at IS NULL
     AND (p_id IS NULL OR lp.id = p_id)
   ORDER BY lp.created_at DESC, lp.id DESC
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION partner_loan_product_terms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_loan_product_terms(uuid) TO kv_partner;
COMMENT ON FUNCTION partner_loan_product_terms(uuid) IS
  'PC-56 PARTNER-2c (0229): this lending partner''s OWN loan products'' terms on the kv_partner axis (all of them, or the one named) — never '
  'another partner''s (0090''s pricing-IP rule), never created_by / updated_by. NULL-guarded: no partner in scope → no rows.';

DO $$
BEGIN
  -- the definer is the wall: kv_partner holds no table privilege on loan_products (every lender's pricing would be readable)
  IF has_table_privilege('kv_partner', 'loan_products', 'SELECT') THEN
    RAISE EXCEPTION '0229: kv_partner can read loan_products directly — every lender''s pricing would be readable';
  END IF;
END $$;
