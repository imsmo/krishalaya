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
-- 0208 · sample lending partner + loan product (GLOBAL reference data, no tenant_id) · [P3]
-- Authored on the platform/partner surface (Law 11). Seeds one NBFC + a crop-loan product so the lending
-- flow is usable out of the box. product_kind_id → 'loan_kind' lookup; partner_id → financial_partners.
INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, is_active) VALUES
 ('22222222-0000-7000-8000-000000000001','samunnati','Samunnati Financial','nbfc','RBI-NBFC-0001',true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO loan_products (id, partner_id, product_kind_id, default_name, currency_code, min_amount_minor, max_amount_minor, interest_apr_bps, tenure_months_min, tenure_months_max, collateral_kind, repayment_style, is_active)
SELECT '22222222-0000-7000-8000-000000000101', '22222222-0000-7000-8000-000000000001',
       (SELECT id FROM lookup_values WHERE type_code='loan_kind' AND code='crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1),
       'Kharif Crop Loan', 'INR', 1000000, 50000000, 1100, 3, 12, 'none', 'harvest_aligned', true
ON CONFLICT (id) DO NOTHING;
