-- ============================================================================
-- db/local/local-demo-listings.sql · LOCAL DEV ONLY — give the demo-fpo storefront some products.
--
-- The demo seed (db/seeds/demo/0902) is a STAGING-ONLY placeholder, so a fresh local DB has zero listings and the
-- storefront grid at http://localhost:3001/demo-fpo is empty. This script creates: one seller user + their tenant
-- membership, one tenant product, and four PUBLISHED + PUBLIC listings owned by the demo tenant — exactly what the
-- storefront browse read-model selects (status='published', visibility IN ('public','cross_tenant'), deleted_at IS NULL).
--
-- All reference data (category 'crops', unit 'kg', currency 'INR', role 'farmer', region Junagadh) is resolved by
-- code/known-id so this is robust to UUID changes. Fixed UUIDs + ON CONFLICT DO NOTHING make it safe to re-run.
--
-- RUN IT as the DB OWNER (superuser bypasses tenant RLS so the explicit tenant_id inserts go through):
--   psql "postgres://sanjayodedra:Postgres%404958@localhost:5432/krishalaya" -f db/local/local-demo-listings.sql
--
-- NEVER run in staging/production. After running, reload http://localhost:3001/demo-fpo.
-- ============================================================================

-- 1) Seller user (global identity; phone is the unique natural key).
INSERT INTO users (id, phone, full_name, language_code, country_code, status, is_test)
VALUES ('99999999-0000-7000-8000-000000000001', '+919900000001', 'Demo Seller (FPO)', 'en', 'IN', 'active', true)
ON CONFLICT (id) DO NOTHING;

-- 2) Seller ↔ demo tenant membership as 'farmer' (so the seller belongs to demo-fpo).
INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
SELECT '99999999-0000-7000-8000-0000000000a1',
       '99999999-0000-7000-8000-000000000001',
       '88888888-0000-7000-8000-000000000001',
       r.id, 'verified', true
FROM roles r WHERE r.code = 'farmer'
ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING;

-- 3) A tenant product to hang listings off (category 'crops', sold by the kg).
INSERT INTO products (id, category_id, code, default_name, default_unit, is_perishable, tenant_id, is_active)
SELECT 'aaaaaaaa-0000-7000-8000-000000000001',
       (SELECT id FROM categories WHERE code = 'crops' LIMIT 1),
       'DEMO-PRODUCE-001', 'Fresh Farm Produce', 'kg', true,
       '88888888-0000-7000-8000-000000000001', true
ON CONFLICT (id) DO NOTHING;

-- 4) Four PUBLISHED + PUBLIC listings for demo-fpo (what the storefront grid shows).
INSERT INTO listings (
  id, tenant_id, seller_user_id, product_id, category_id, title, description,
  quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code,
  sale_type, status, organic_claim, region_id, visibility, published_at
)
SELECT v.id, '88888888-0000-7000-8000-000000000001',
       '99999999-0000-7000-8000-000000000001',
       'aaaaaaaa-0000-7000-8000-000000000001'::uuid,  -- product
       (SELECT id FROM categories WHERE code = 'crops' LIMIT 1),
       v.title, v.descr,
       v.qty, v.qty, 1, 'kg', v.price, 'INR',
       'direct', 'published', v.organic,
       '11111111-0000-7000-8000-000000000101',       -- Junagadh
       'public', now()
FROM (VALUES
  ('bbbbbbbb-0000-7000-8000-000000000001'::uuid, 'Organic Tomatoes — Grade A',   'Vine-ripened, hand-picked this morning. Junagadh farms.', 500::numeric, 2500::bigint, 'certified'),
  ('bbbbbbbb-0000-7000-8000-000000000002'::uuid, 'Fresh Onions (Red)',           'Bulk red onions, well-cured, long shelf life.',           2000::numeric, 1800::bigint, 'none'),
  ('bbbbbbbb-0000-7000-8000-000000000003'::uuid, 'Groundnut (Bold)',             'Premium bold groundnut, sun-dried, low moisture.',        1000::numeric, 6500::bigint, 'natural'),
  ('bbbbbbbb-0000-7000-8000-000000000004'::uuid, 'Wheat — Lokwan',               'Clean, sortexed Lokwan wheat. Direct from FPO members.',  5000::numeric, 2900::bigint, 'none')
) AS v(id, title, descr, qty, price, organic)
WHERE EXISTS (SELECT 1 FROM products WHERE id = 'aaaaaaaa-0000-7000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Sanity print.
SELECT status, visibility, count(*) AS n
FROM listings WHERE tenant_id = '88888888-0000-7000-8000-000000000001'
GROUP BY 1,2 ORDER BY 1,2;
