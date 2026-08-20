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
-- 0901 · STAGING-ONLY demo tenant (never run in prod) · [P1-staging]
INSERT INTO tenants (id,slug,legal_name,display_name,tenant_type_id,country_code,region_id,status,created_at)
SELECT '88888888-0000-7000-8000-000000000001','demo-fpo','Demo FPO Pvt Ltd','Junagadh Demo FPO',
  (SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' ORDER BY created_at, id LIMIT 1),
  'IN','11111111-0000-7000-8000-000000000101','active',now()
ON CONFLICT (id) DO NOTHING;
