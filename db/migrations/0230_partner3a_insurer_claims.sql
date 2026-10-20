-- ==================================================================================================================
-- MIGRATION 0230 — PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS — FACTS, NEVER A CLAIMANT — an insurer partner reads the CLAIM FACTS
-- on its OWN products, on the kv_partner axis, through three SECURITY DEFINER reads; kv_partner gets no privilege on insurance_claims at all.
-- (brief_p3a.md founder decisions Q3 + Q4 + Q8, 2026-10-18; survey_partner3.md "WHAT CLAIMS ARE ON THE PLATFORM TODAY", §1A, §1B, §1I, F-5,
-- F-12, P3-B1, §5 item 1, E1, E5.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0229 are applied; nothing here edits them. 0090's role and axis GUC
-- (`current_partner_id()`), 0228's policy → product → partner ownership join and 0228's bind-by-scope permission pattern are REUSED.)
-- LAW 9 / LAW 11 CLASS — PII + TRUST: a cross-tenant read of farmers' loss events by an insurer organisation (claim facts only). The PARTNER-0
-- founder review stands before `partner_console` is switched on. NOT MONEY: no ledger table, no posting, no money column is written — the two
-- money columns here (the policy's sum insured, the claim's approved amount AS RECORDED) are READ, as bigint. The money act that existed — the
-- tenant desk's claim settlement — is REFUSED BY NAME in the API in the same wave (INSURANCE_SETTLEMENT_NOT_ON_PLATFORM, founder Q1).
-- ==================================================================================================================
--
-- WHAT EXISTS AFTER THIS FILE
--   230.1  Permission `partner.claims.read` (M19) granted to EVERY role of scope 'partner' (bound by scope with loud asserts — the 0227.5 /
--          0228.1 pattern and the tenant4d5-chain-repair rule: never by role code). Seed core/0004 carries the same permission row (inserted
--          where missing — the `LIKE 'partner.%'` trap: the row is named explicitly there), so a database built from empty and an existing
--          one agree. A distinct permission (survey E1): claims can be narrowed later without touching the book.
--   230.2  THREE READS ON THE AXIS (STABLE SECURITY DEFINER, `SET search_path = public, pg_temp`, NULL-guarded on current_partner_id(), REVOKE
--          FROM PUBLIC, EXECUTE to kv_partner ONLY — kv_app reaches them only inside `SET LOCAL ROLE kv_partner`, 0090's non-inheriting grant).
--          THE OWNERSHIP JOIN (all three): insurance_claims c JOIN insurance_policies po ON po.id = c.policy_id JOIN insurance_products pr ON
--          pr.id = po.product_id WHERE pr.partner_id = current_partner_id() AND c.deleted_at IS NULL.
--            partner_insurance_claims(status, cursor_created, cursor_id, limit)
--                the claims on THIS insurer's products, OLDEST FIRST (the queue is "how long a claim has waited"), keyset on (created_at, id),
--                limit 1–100; an optional status filter (a `claim_status` value; anything else matches nothing);
--            partner_insurance_claim(id)   ONE such claim (nothing for another insurer's or an absent id);
--            partner_insurance_claim_counts(from, to)
--                rows (product_id, status, event_type_code, n) over the claims FILED (created_at) in [from, to) — the two dates are IST
--                calendar days (Asia/Kolkata: `p_from::timestamp AT TIME ZONE 'Asia/Kolkata'`), the FY window the API asks for.
--          THE CLAIM COLUMNS (list + detail): id, tenant_id (for the FPO's PUBLIC name only — the console never prints or returns it),
--          policy_id, product_id, policy_no, subject_type, sum_insured_minor (the POLICY's), event_type_code (a PLATFORM `claim_event` value's
--          code — LEFT JOIN lookup_values on type_code = 'claim_event' AND tenant_id IS NULL; NULL otherwise → "not recorded"), event_date,
--          status, intimated_within_72h, approved_minor (AS RECORDED), damage_percent, created_at, updated_at, closed_at.
--          damage_percent = the survey's `damagePercent` ONLY (founder Q4's sub-question): when survey_report->'damagePercent' is a JSON number
--          in [0, 100], rounded to the nearest whole percent (the desk's DTO admits a decimal); NULL otherwise. Nothing else of the report.
--          NEVER claimant_user_id, description, surveyor_user_id, survey_report (beyond that one number — never `notes`), payout_id,
--          created_by, updated_by, deleted_at; no media (not even a count — 3b decides counts), no vet certificate, no village or parcel.
--          No timeline definer (survey E5): per-hop times live only in audit_log, a FORCE-RLS table whose production owner's BYPASSRLS is
--          unconfirmed (owed since PARTNER-0) — the console prints filed / last changed / closed only.
--   230.3  The wall, asserted: kv_partner holds NO table privilege and NO column privilege on insurance_claims (0090's three-relation rule
--          stands — the definers are the only way in). No grant, no new RLS policy, no table, no flag (`partner_console` gates the console; the
--          platform's `insurance` flag gates the insurer routes in the API). The RLS gate stays at 1,988.
--
-- OWNER: like 0228's definers (which read insurance_policies, a FORCE-RLS table), these read insurance_claims / insurance_policies /
-- lookup_values (FORCE RLS) as the MIGRATION OWNER — they return rows only where that owner bypasses RLS (a superuser or BYPASSRLS owner, as on
-- every database these migrations have run on). The production owner's BYPASSRLS is the same standing question as PARTNER-0's.
--
-- SHARDS: insurance_claims carry a tenant_id and live on that tenant's shard — the list and the counts SCATTER and merge in the API (the 2a book
-- shape); the detail is searched shard by shard. Products are global reference data (shard 0, replicated).
--
-- REVERSAL (hand-run, never by the runner; revert the API's `partner/insurance/claims` routes and the console's `/insurer/claims` pages first):
--   DROP FUNCTION IF EXISTS partner_insurance_claims(text, timestamptz, uuid, integer), partner_insurance_claim(uuid),
--     partner_insurance_claim_counts(date, date);
--   DELETE FROM role_permissions WHERE permission_code = 'partner.claims.read';
--   DELETE FROM permissions WHERE code = 'partner.claims.read';
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 230.1  THE PERMISSION — every partner role reads the claim facts on its insurer organisation's own products
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('partner.claims.read', 'Partner console: read the claims on this insurer''s own products — claim facts only, never a claimant', 'M19')
ON CONFLICT (code) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM roles WHERE scope = 'partner') < 4 THEN
    RAISE EXCEPTION '0230: the four partner roles of 0225 are missing — the claims read would grant nothing';
  END IF;
END $$;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code = 'partner.claims.read'
 WHERE r.scope = 'partner'
ON CONFLICT DO NOTHING;
DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.scope = 'partner' AND rp.permission_code = 'partner.claims.read') < 4 THEN
    RAISE EXCEPTION '0230: partner.claims.read is not held by every partner role';
  END IF;
  IF EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE r.scope <> 'partner' AND rp.permission_code = 'partner.claims.read') THEN
    RAISE EXCEPTION '0230: partner.claims.read is held by a role outside the partner realm';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 230.2  THE READS — the claim FACTS on this insurer's own products; never a claimant, a note, a surveyor or a payment
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION partner_insurance_claims(p_status text, p_cursor_created timestamptz, p_cursor_id uuid, p_limit integer) RETURNS TABLE (
  id uuid, tenant_id uuid, policy_id uuid, product_id uuid, policy_no text, subject_type text, sum_insured_minor bigint, event_type_code text,
  event_date date, status text, intimated_within_72h boolean, approved_minor bigint, damage_percent integer, created_at timestamptz,
  updated_at timestamptz, closed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.policy_id, po.product_id, po.policy_no::text, po.subject_type::text, po.sum_insured_minor, ev.code::text,
         c.event_date, c.status::text, c.intimated_within_72h, c.approved_minor,
         CASE WHEN jsonb_typeof(c.survey_report -> 'damagePercent') = 'number'
                   AND (c.survey_report ->> 'damagePercent')::numeric BETWEEN 0 AND 100
              THEN round((c.survey_report ->> 'damagePercent')::numeric)::integer END,
         c.created_at, c.updated_at, c.closed_at
    FROM insurance_claims c
    JOIN insurance_policies po ON po.id = c.policy_id
    JOIN insurance_products pr ON pr.id = po.product_id
    LEFT JOIN lookup_values ev ON ev.id = c.event_type_id AND ev.type_code = 'claim_event' AND ev.tenant_id IS NULL
   WHERE current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND c.deleted_at IS NULL
     AND (p_status IS NULL OR c.status::text = p_status)
     AND (p_cursor_created IS NULL OR (c.created_at, c.id) > (p_cursor_created, p_cursor_id))
   ORDER BY c.created_at ASC, c.id ASC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;
REVOKE ALL ON FUNCTION partner_insurance_claims(text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_claims(text, timestamptz, uuid, integer) TO kv_partner;
COMMENT ON FUNCTION partner_insurance_claims(text, timestamptz, uuid, integer) IS
  'PC-56 PARTNER-3a (0230, founder Q4): the claims on THIS insurer''s products, OLDEST first, keyset (created_at, id), 1–100 rows — claim FACTS '
  'only: never claimant_user_id, description, surveyor_user_id, survey_report (beyond damagePercent), payout_id, created_by, updated_by. NULL-guarded.';

CREATE OR REPLACE FUNCTION partner_insurance_claim(p_id uuid) RETURNS TABLE (
  id uuid, tenant_id uuid, policy_id uuid, product_id uuid, policy_no text, subject_type text, sum_insured_minor bigint, event_type_code text,
  event_date date, status text, intimated_within_72h boolean, approved_minor bigint, damage_percent integer, created_at timestamptz,
  updated_at timestamptz, closed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, c.tenant_id, c.policy_id, po.product_id, po.policy_no::text, po.subject_type::text, po.sum_insured_minor, ev.code::text,
         c.event_date, c.status::text, c.intimated_within_72h, c.approved_minor,
         CASE WHEN jsonb_typeof(c.survey_report -> 'damagePercent') = 'number'
                   AND (c.survey_report ->> 'damagePercent')::numeric BETWEEN 0 AND 100
              THEN round((c.survey_report ->> 'damagePercent')::numeric)::integer END,
         c.created_at, c.updated_at, c.closed_at
    FROM insurance_claims c
    JOIN insurance_policies po ON po.id = c.policy_id
    JOIN insurance_products pr ON pr.id = po.product_id
    LEFT JOIN lookup_values ev ON ev.id = c.event_type_id AND ev.type_code = 'claim_event' AND ev.tenant_id IS NULL
   WHERE c.id = p_id
     AND current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND c.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION partner_insurance_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_claim(uuid) TO kv_partner;
COMMENT ON FUNCTION partner_insurance_claim(uuid) IS
  'PC-56 PARTNER-3a (0230, founder Q4): ONE claim on THIS insurer''s products (nothing for another insurer''s or an absent id) — the same claim '
  'facts as partner_insurance_claims, never a claimant. NULL-guarded.';

CREATE OR REPLACE FUNCTION partner_insurance_claim_counts(p_from date, p_to date) RETURNS TABLE (
  product_id uuid, status text, event_type_code text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT po.product_id, c.status::text, ev.code::text, count(*)
    FROM insurance_claims c
    JOIN insurance_policies po ON po.id = c.policy_id
    JOIN insurance_products pr ON pr.id = po.product_id
    LEFT JOIN lookup_values ev ON ev.id = c.event_type_id AND ev.type_code = 'claim_event' AND ev.tenant_id IS NULL
   WHERE current_partner_id() IS NOT NULL
     AND pr.partner_id = current_partner_id()
     AND c.deleted_at IS NULL
     AND p_from IS NOT NULL AND p_to IS NOT NULL
     AND c.created_at >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
     AND c.created_at <  (p_to::timestamp AT TIME ZONE 'Asia/Kolkata')
   GROUP BY po.product_id, c.status, ev.code;
$$;
REVOKE ALL ON FUNCTION partner_insurance_claim_counts(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partner_insurance_claim_counts(date, date) TO kv_partner;
COMMENT ON FUNCTION partner_insurance_claim_counts(date, date) IS
  'PC-56 PARTNER-3a (0230): COUNTS of the claims on THIS insurer''s products filed in [p_from, p_to) (IST calendar days), by product × status × '
  'platform claim_event code (NULL = not recorded). Counts only — no amount, no ratio. Shards add (a claim lives on one shard). NULL-guarded.';

-- ------------------------------------------------------------------------------------------------------------------
-- 230.3  THE WALL — kv_partner holds nothing on insurance_claims; the definers are the only way in
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE col text;
BEGIN
  IF has_table_privilege('kv_partner', 'insurance_claims', 'SELECT') OR has_table_privilege('kv_partner', 'insurance_claims', 'INSERT')
     OR has_table_privilege('kv_partner', 'insurance_claims', 'UPDATE') OR has_table_privilege('kv_partner', 'insurance_claims', 'DELETE') THEN
    RAISE EXCEPTION '0230: kv_partner holds a table privilege on insurance_claims — the claim wall is the definer, never a grant';
  END IF;
  FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'insurance_claims' LOOP
    IF has_column_privilege('kv_partner', 'insurance_claims', col, 'SELECT') THEN
      RAISE EXCEPTION '0230: kv_partner can read insurance_claims.% — the claim wall is the definer, never a column grant', col;
    END IF;
  END LOOP;
  IF has_function_privilege('kv_app', 'partner_insurance_claims(text, timestamptz, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_insurance_claim(uuid)', 'EXECUTE')
     OR has_function_privilege('kv_app', 'partner_insurance_claim_counts(date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0230: kv_app can call a claims definer without wearing the axis role';
  END IF;
END $$;
