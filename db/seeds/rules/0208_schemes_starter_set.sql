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
-- 0208 · scheme starter set (engine proof; full 200+ via admin) · [P2]
INSERT INTO scheme_authorities (id,default_name,level,region_id) VALUES
 ('33333333-0000-7000-8000-000000000001','Ministry of Agriculture','central',NULL),
 ('33333333-0000-7000-8000-000000000002','Gujarat Agriculture Dept','state','11111111-0000-7000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schemes (code,default_name,authority_id,category_id,benefit_summary,eligibility_rules,required_doc_type_ids,application_window,applicable_region_ids,processing_fee_minor,source_url,version,is_active) VALUES
 ('pm_kisan','PM-KISAN','33333333-0000-7000-8000-000000000001',(SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' ORDER BY created_at, id LIMIT 1),'{"type":"dbt_annual","amount_minor":600000,"instalments":3}','{"landholding":true,"roles":["farmer"],"exclude_income_tax_payer":true}','[]','{}','[]',0,'https://pmkisan.gov.in',1,true),
 ('pmfby','PMFBY (Crop Insurance)','33333333-0000-7000-8000-000000000001',(SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' ORDER BY created_at, id LIMIT 1),'{"type":"insurance","farmer_share_bps":{"kharif":200,"rabi":150}}','{"roles":["farmer"],"crop_season":true}','[]','{"opens":"06-01","closes":"07-31","season":"kharif"}','[]',0,'https://pmfby.gov.in',1,true)
ON CONFLICT (code) DO NOTHING;
