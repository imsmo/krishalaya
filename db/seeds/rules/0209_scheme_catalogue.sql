-- [PC-56 TENANT-6c-4] `ORDER BY created_at, id LIMIT 1` rather than a bare subquery (or a bare `LIMIT 1`).
-- `lookup_values` has UNIQUE (type_code, tenant_id, code) and a PLATFORM row has tenant_id IS NULL; Postgres
-- treats NULLs as DISTINCT in a unique index unless declared NULLS NOT DISTINCT, which 0001's is not. So every
-- `ON CONFLICT (type_code,tenant_id,code) DO NOTHING` for a platform value is decoration and these codes are
-- duplicated (139 of 311 in a freshly built database). A BARE subquery then fails outright with "more than one
-- row returned by a subquery used as an expression" — which is what kept this file's product out of every
-- database once it was finally listed — and a bare `LIMIT 1` silently picks an ARBITRARY duplicate, which is
-- how the seeds already in the runner's list have been surviving. Ordering makes it the ORIGINAL row.
-- The duplicates themselves are escalated (see migration 0160's header): de-duplicating them means repointing
-- foreign keys on the ledger.
-- 0209 · sample scheme authority + schemes (GLOBAL reference data, no tenant_id) · [P3]
-- Authored on the platform/admin surface (Law 11). Seeds one authority + two schemes so the application
-- flow is usable: PM-KISAN (income support, no processing fee) + a state mechanisation subsidy (with a
-- small processing fee to exercise the wallet path). category_id → 'scheme_category'; authority_id → scheme_authorities.
INSERT INTO scheme_authorities (id, default_name, level, region_id) VALUES
 ('33333333-0000-7000-8000-000000000001','Ministry of Agriculture & Farmers Welfare','central',NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO schemes (id, code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, required_doc_type_ids, application_window, applicable_region_ids, processing_fee_minor, version, is_active)
SELECT '33333333-0000-7000-8000-000000000101','pm_kisan','PM-KISAN Income Support','33333333-0000-7000-8000-000000000001',
       (SELECT id FROM lookup_values WHERE type_code='scheme_category' AND code='income_support' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1),
       '{"type":"dbt_annual","amount_minor":600000,"instalments":3}', '{"roles":["farmer","pashupalak"],"landholding_max_acres":5}', '[]', NULL, '[]', 0, 1, true
ON CONFLICT (id) DO NOTHING;

INSERT INTO schemes (id, code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, required_doc_type_ids, application_window, applicable_region_ids, processing_fee_minor, version, is_active)
SELECT '33333333-0000-7000-8000-000000000102','smam','SMAM Farm Mechanisation Subsidy','33333333-0000-7000-8000-000000000001',
       (SELECT id FROM lookup_values WHERE type_code='scheme_category' AND code='mechanisation' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1),
       '{"type":"subsidy_pct","pct":50}', '{"roles":["farmer"]}', '[]', NULL, '[]', 5000, 1, true
ON CONFLICT (id) DO NOTHING;
