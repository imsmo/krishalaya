-- ============================================================================
-- ⚠️  DEPRECATED for app-flow testing (Krishalaya hardening slice D) — DESIGN-PREVIEW ONLY.
--
-- This file hand-inserts rows with fixed, non-uuidv7 ids (the `d0000...`/`44444444-...` literals
-- below) and predates money entirely: no `price_minor` sibling columns some screens now expect, no
-- `order_items`, no wallet ledger. Worse, it CANNOT safely be extended to cover those — the tables
-- it would need to touch are invariant-protected:
--   • `orders` is uuidv7-partitioned and PRUNE-checked; a hand-picked id breaks partition routing.
--   • the wallet ledger is hash-chained + zero-sum (a nightly reconciliation job verifies this) —
--     a hand-inserted credit with no matching debit, or a broken hash chain, fails reconciliation.
--   • bids are immutable; escrow release is a server-computed side effect of a real event, not a
--     column this file could set.
--
-- For anything that needs to look real when driven through the ACTUAL app (listings with working
-- prices, orders in real lifecycle states, a real wallet balance + payout) use the real seeder
-- instead, which drives the genuine HTTP APIs end-to-end (same pattern scripts/pilot-e2e/flow.mjs
-- proved for the pilot slice):
--
--     node scripts/demo-seed/run.mjs        (see scripts/demo-seed/README.md)
--
-- This file remains useful ONLY for populating the Phase-1 design-preview surfaces (mandi prices,
-- tips, schemes, reviews, notifications feed dressing) where the exact mockup copy/ids matter and no
-- money invariant is at stake — keep using it for that. Do NOT use it to make listings/orders/wallet
-- screens work; they will still show fake/missing data because this file was never able to populate
-- the columns those screens actually read.
-- ============================================================================

-- ============================================================================
-- db/local/demo-design-data.sql · LOCAL DEV ONLY — load the exact data shown in the Phase-1 196-screen
-- designs into the real database so every surface (mobile, storefront, tenant console, API) renders the
-- SAME data DYNAMICALLY from Postgres — not from static files.
--
-- Source of truth for the values: docs/design-data/demo-dataset.json (extracted from the design mockups).
-- Region: Anand & Junagadh, Gujarat. Demo tenant: demo-fpo. Money is paise (Law 2).
--
-- DESIGN / SAFETY:
--   • Idempotent — fixed UUIDs + `ON CONFLICT DO NOTHING`; mandi prices are refreshed to CURRENT_DATE each run.
--   • UUID-robust — all reference data (roles, units, currency, category, products, region) resolves BY CODE.
--   • Requires migrations to have run first (so partitioned tables orders/order_items/notifications/mandi_prices
--     have their DEFAULT partition — created by ensure_partitions()).
--
-- RUN IT as the DB OWNER / superuser (bypasses tenant RLS so explicit tenant_id inserts go through):
--   psql "postgres://<owner>:<pw>@localhost:5432/krishiverse" -f db/local/demo-design-data.sql
-- e.g.
--   psql "postgres://sanjayodedra:Postgres%404958@localhost:5432/krishiverse" -f db/local/demo-design-data.sql
--
-- NEVER run in staging/production. Re-runnable any time.
-- ============================================================================
BEGIN;

-- Shared anchors (resolved by known id / code) -------------------------------
-- demo tenant (seeded by db/seeds/demo/0901): 88888888-0000-7000-8000-000000000001
-- Junagadh region (seeded by db/seeds/core/0002): 11111111-0000-7000-8000-000000000101

-- ============================================================================
-- 1) PEOPLE — the recurring cast shown across the screens (screens 09, 29, 86, …)
-- ============================================================================
INSERT INTO users (id, phone, full_name, language_code, country_code, status, is_test) VALUES
 ('d0000001-0000-7000-8000-000000000001','+919900000101','Ramesh Patel','hi','IN','active',true),       -- farmer (logged-in farmer on most screens)
 ('d0000001-0000-7000-8000-000000000002','+919900000102','Krishna FPO Seller','gu','IN','active',true), -- seller org contact
 ('d0000001-0000-7000-8000-000000000003','+919900000103','Sharma Stores','hi','IN','active',true),      -- buyer
 ('d0000001-0000-7000-8000-000000000004','+919900000104','Sharma Masala Mart','hi','IN','active',true), -- buyer (auction leader)
 ('d0000001-0000-7000-8000-000000000005','+919900000105','Sunita Kumari','hi','IN','active',true),      -- worker
 ('d0000001-0000-7000-8000-000000000006','+919900000106','Ramesh Mahato','hi','IN','active',true),      -- worker (tractor+loading)
 ('d0000001-0000-7000-8000-000000000007','+919900000107','Lakshmi Devi','hi','IN','active',true),       -- worker (weeding)
 ('d0000001-0000-7000-8000-000000000008','+919900000108','Vikas Joshi','gu','IN','active',true)         -- ambassador
ON CONFLICT DO NOTHING;

-- Memberships: each person × demo tenant × role (role resolved by code) ------
INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
SELECT m.id::uuid, m.user_id::uuid, '88888888-0000-7000-8000-000000000001'::uuid, r.id, 'verified', true
FROM (VALUES
  ('d0000001-0000-7000-8000-0000000000a1','d0000001-0000-7000-8000-000000000001','farmer'),
  ('d0000001-0000-7000-8000-0000000000a2','d0000001-0000-7000-8000-000000000002','farmer'),
  ('d0000001-0000-7000-8000-0000000000a3','d0000001-0000-7000-8000-000000000003','customer'),
  ('d0000001-0000-7000-8000-0000000000a4','d0000001-0000-7000-8000-000000000004','customer'),
  ('d0000001-0000-7000-8000-0000000000a5','d0000001-0000-7000-8000-000000000005','worker'),
  ('d0000001-0000-7000-8000-0000000000a6','d0000001-0000-7000-8000-000000000006','worker'),
  ('d0000001-0000-7000-8000-0000000000a7','d0000001-0000-7000-8000-000000000007','worker'),
  ('d0000001-0000-7000-8000-0000000000a8','d0000001-0000-7000-8000-000000000008','ambassador')
) AS m(id, user_id, role_code)
JOIN roles r ON r.code = m.role_code
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2) CROPS — ensure a product master exists for every crop the designs show
--    (existing seed db/seeds/catalogue/0103 already has wheat, groundnut, cumin, onion).
--    Category + unit resolve by code so this is UUID-robust.
-- ============================================================================
INSERT INTO products (id, category_id, code, default_name, default_unit, is_perishable, shelf_life_days, tenant_id, is_active)
SELECT p.id::uuid, (SELECT id FROM categories WHERE code='crops' LIMIT 1), p.code, p.name, p.unit, p.perish, p.shelf, NULL, true
FROM (VALUES
  ('d0000077-0000-7000-8000-000000000001','maize','Maize','quintal',false,180),
  ('d0000077-0000-7000-8000-000000000002','chilli','Red Chilli','quintal',false,365),
  ('d0000077-0000-7000-8000-000000000003','castor','Castor Seed','quintal',false,365),
  ('d0000077-0000-7000-8000-000000000004','potato','Potato','kg',true,30),
  ('d0000077-0000-7000-8000-000000000005','cucumber','Cucumber','kg',true,5)
) AS p(id, code, name, unit, perish, shelf)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3) LISTINGS — Ramesh's catalogue (screens 09 pulse, 12 my-listings, 13 buyer-home, 14 detail)
--    status=published + visibility=public is what the storefront/browse read-model selects.
-- ============================================================================
INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, description,
                      quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code,
                      sale_type, status, organic_claim, region_id, visibility, published_at)
SELECT l.id::uuid, '88888888-0000-7000-8000-000000000001'::uuid, l.seller::uuid,
       (SELECT id FROM products WHERE code=l.crop LIMIT 1),
       (SELECT id FROM categories WHERE code='crops' LIMIT 1),
       l.title, l.descr, l.qty, l.qty, 0, l.unit, l.price, 'INR',
       l.sale::sale_type, l.status::listing_status, l.organic,
       '11111111-0000-7000-8000-000000000101'::uuid, 'public', now()
FROM (VALUES
  ('d0000002-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','wheat',
     'Premium Wheat — Lokwan','Grade A Lokwan wheat, Anand. Premium quality, freshly harvested.',
     5,'quintal',288000::bigint,'direct','published','none'),
  ('d0000002-0000-7000-8000-000000000002','d0000001-0000-7000-8000-000000000001','chilli',
     'Red Chilli — Teja Premium','Organic Teja red chilli, 2 quintal. Sun-dried, premium grade.',
     2,'quintal',1450000::bigint,'auction','published','certified'),
  ('d0000002-0000-7000-8000-000000000003','d0000001-0000-7000-8000-000000000001','onion',
     'Onion — Medium grade','Red onion, medium size, Grade B. 10 quintal available.',
     10,'quintal',280000::bigint,'direct','published','none'),
  ('d0000002-0000-7000-8000-000000000004','d0000001-0000-7000-8000-000000000002','cucumber',
     'Organic Cucumber','Local-grade organic cucumber, 200 kg.',
     200,'kg',3800::bigint,'direct','sold_out','natural')
) AS l(id, seller, crop, title, descr, qty, unit, price, sale, status, organic)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4) AUCTION — Red Chilli live auction (screens 16/17/65). EMD ₹500. + bid history.
-- ============================================================================
INSERT INTO auctions (id, tenant_id, listing_id, kind, start_price_minor, reserve_price_minor,
                      min_increment_minor, emd_minor, starts_at, ends_at, status)
VALUES ('d0000004-0000-7000-8000-000000000001','88888888-0000-7000-8000-000000000001',
        'd0000002-0000-7000-8000-000000000002','english_open',
        1400000, 1300000, 10000, 50000,
        now() - interval '2 hours', now() + interval '2 hours 14 minutes', 'live')
ON CONFLICT DO NOTHING;

INSERT INTO bids (id, tenant_id, auction_id, bidder_user_id, amount_minor, created_at) VALUES
 ('d0000004-0000-7000-8000-0000000000b1','88888888-0000-7000-8000-000000000001','d0000004-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000004',1450000, now() - interval '2 minutes'),
 ('d0000004-0000-7000-8000-0000000000b2','88888888-0000-7000-8000-000000000001','d0000004-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000003',1420000, now() - interval '5 minutes'),
 ('d0000004-0000-7000-8000-0000000000b3','88888888-0000-7000-8000-000000000001','d0000004-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000004',1400000, now() - interval '8 minutes')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5) ORDERS — KV-2026 series (screens 22 my-orders, 23 detail, 56/57 farmer orders)
--    Partitioned by created_at → routes to the DEFAULT partition.
-- ============================================================================
INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code,
                    subtotal_minor, total_minor, status, created_at) VALUES
 ('d0000003-0000-7000-8000-000000000001','88888888-0000-7000-8000-000000000001','KV-2026-0142',
    'd0000001-0000-7000-8000-000000000003','d0000001-0000-7000-8000-000000000001','direct','INR',
    576000, 576000, 'in_transit', TIMESTAMPTZ '2026-08-15 09:00:00+05:30'),
 ('d0000003-0000-7000-8000-000000000002','88888888-0000-7000-8000-000000000001','KV-2026-0138',
    'd0000001-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000002','direct','INR',
    1450000, 1450000, 'payment_pending', TIMESTAMPTZ '2026-08-14 17:00:00+05:30'),
 ('d0000003-0000-7000-8000-000000000003','88888888-0000-7000-8000-000000000001','KV-2026-0121',
    'd0000001-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000002','direct','INR',
    760000, 760000, 'delivered', TIMESTAMPTZ '2026-08-12 11:00:00+05:30')
ON CONFLICT DO NOTHING;

INSERT INTO order_items (id, order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot,
                        quantity, unit_code, unit_price_minor, line_total_minor, created_at) VALUES
 ('d0000003-0000-7000-8000-0000000000c1','d0000003-0000-7000-8000-000000000001',TIMESTAMPTZ '2026-08-15 09:00:00+05:30','88888888-0000-7000-8000-000000000001','d0000002-0000-7000-8000-000000000001',(SELECT id FROM products WHERE code='wheat' LIMIT 1),'Premium Wheat — Lokwan',2,'quintal',288000,576000, TIMESTAMPTZ '2026-08-15 09:00:00+05:30'),
 ('d0000003-0000-7000-8000-0000000000c2','d0000003-0000-7000-8000-000000000002',TIMESTAMPTZ '2026-08-14 17:00:00+05:30','88888888-0000-7000-8000-000000000001','d0000002-0000-7000-8000-000000000002',(SELECT id FROM products WHERE code='chilli' LIMIT 1),'Red Chilli — Teja Variety',1,'quintal',1450000,1450000, TIMESTAMPTZ '2026-08-14 17:00:00+05:30'),
 ('d0000003-0000-7000-8000-0000000000c3','d0000003-0000-7000-8000-000000000003',TIMESTAMPTZ '2026-08-12 11:00:00+05:30','88888888-0000-7000-8000-000000000001','d0000002-0000-7000-8000-000000000004',(SELECT id FROM products WHERE code='cucumber' LIMIT 1),'Organic Cucumber',200,'kg',3800,760000, TIMESTAMPTZ '2026-08-12 11:00:00+05:30')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6) REVIEWS — seller rating shown on listing/seller-profile (screens 14, 100, 40)
-- ============================================================================
INSERT INTO reviews (id, tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, body, is_verified_purchase, status) VALUES
 ('d0000006-0000-7000-8000-000000000001','88888888-0000-7000-8000-000000000001','d0000003-0000-7000-8000-000000000003','d0000001-0000-7000-8000-000000000001','seller','d0000001-0000-7000-8000-000000000002',5,'Fresh produce, fair price, on-time delivery. Will buy again.',true,'published'),
 ('d0000006-0000-7000-8000-000000000002','88888888-0000-7000-8000-000000000001',NULL,'d0000001-0000-7000-8000-000000000003','seller','d0000001-0000-7000-8000-000000000001',5,'Lokwan wheat exactly as described. Highly recommended seller.',true,'published')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 7) MANDI PRICES — Today's Mandi Pulse / Prices (screens 09, 52, 53). Refreshed to CURRENT_DATE.
--    product_id + price for each crop the design lists; mandi name is free text.
-- ============================================================================
DELETE FROM mandi_prices WHERE source = 'demo_design';

INSERT INTO mandis (id, default_name, mandi_code, is_active) VALUES
 ('d00000a1-0000-7000-8000-000000000001','Anand APMC','GJ-AND-01',true),
 ('d00000a1-0000-7000-8000-000000000002','Unjha APMC','GJ-UNJ-01',true),
 ('d00000a1-0000-7000-8000-000000000003','Junagadh APMC','GJ-JUN-01',true),
 ('d00000a1-0000-7000-8000-000000000004','Mehsana APMC','GJ-MEH-01',true)
ON CONFLICT DO NOTHING;

INSERT INTO mandi_prices (mandi_id, product_id, price_date, modal_minor, unit_code, source, currency_code)
SELECT (SELECT id FROM mandis WHERE mandi_code = mp.mandi_code),
       (SELECT id FROM products WHERE code = mp.crop LIMIT 1),
       CURRENT_DATE, mp.modal, mp.unit, 'demo_design', 'INR'
FROM (VALUES
  ('wheat','GJ-AND-01',288000::bigint,'quintal'),   -- Wheat Lokwan ₹2,880
  ('maize','GJ-AND-01',191000::bigint,'quintal'),   -- Maize Yellow ₹1,910
  ('chilli','GJ-AND-01',1450000::bigint,'quintal'), -- Red Chilli Teja ₹14,500
  ('cucumber','GJ-AND-01',3800::bigint,'kg'),       -- Cucumber ₹38
  ('potato','GJ-AND-01',2200::bigint,'kg'),         -- Potato ₹22
  ('onion','GJ-AND-01',2800::bigint,'kg'),          -- Onion Red ₹28
  ('cumin','GJ-UNJ-01',6240000::bigint,'quintal'),  -- Cumin Jeera ₹62,400
  ('groundnut','GJ-JUN-01',625000::bigint,'quintal'),-- Groundnut Bold ₹6,250
  ('castor','GJ-MEH-01',583000::bigint,'quintal')   -- Castor ₹5,830
) AS mp(crop, mandi_code, modal, unit)
WHERE EXISTS (SELECT 1 FROM products WHERE code = mp.crop);

-- ============================================================================
-- 8) TIPS / KNOWLEDGE — Tips library (screens 55, 101, 104). status=approved so they surface.
-- ============================================================================
INSERT INTO learning_resources (id, tenant_id, owner_user_id, kind, title, language_code, status) VALUES
 ('d0000008-0000-7000-8000-000000000001','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000008','article','When to harvest wheat for maximum yield and price','hi','approved'),
 ('d0000008-0000-7000-8000-000000000002','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000008','article','Identifying aphid infestation in wheat — early signs & organic remedies','hi','approved'),
 ('d0000008-0000-7000-8000-000000000003','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000008','video','Drip irrigation setup — 60% water savings in cotton fields','en','approved'),
 ('d0000008-0000-7000-8000-000000000004','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000008','article','Why are chilli prices rising? Demand forecast for Aug-Oct 2026','en','approved'),
 ('d0000008-0000-7000-8000-000000000005','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000008','article','How to read your Soil Health Card — N, P, K, micronutrients explained','en','approved')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 9) SCHEME APPLICATIONS — farmer schemes (screens 60, 107, 109). Only inserts if the
--    scheme code exists in the seeded scheme catalogue (db/seeds/rules/0208-0209).
-- ============================================================================
INSERT INTO scheme_applications (id, tenant_id, scheme_id, scheme_version, applicant_user_id, status, submitted_at)
SELECT a.id::uuid, '88888888-0000-7000-8000-000000000001'::uuid, s.id, s.version, 'd0000001-0000-7000-8000-000000000001'::uuid, a.status::application_status, a.submitted
FROM (VALUES
  ('d0000009-0000-7000-8000-000000000001','pm_kisan','approved', TIMESTAMPTZ '2026-08-01 10:00:00+05:30'),
  ('d0000009-0000-7000-8000-000000000002','pmfby','submitted',  TIMESTAMPTZ '2026-08-10 10:00:00+05:30')
) AS a(id, scheme_code, status, submitted)
JOIN schemes s ON s.code = a.scheme_code
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 10) WORKER PROFILES — Find Workers / browse (screens 29, 42, 25). Profiles for the 3 workers.
-- ============================================================================
INSERT INTO worker_profiles (id, user_id, tenant_id, age_verified_18, travel_km, min_wage_expectation_minor, rating_avg, bookings_completed) VALUES
 ('d000000a-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000005','88888888-0000-7000-8000-000000000001',true,10,40000,4.6,187),
 ('d000000a-0000-7000-8000-000000000002','d0000001-0000-7000-8000-000000000006','88888888-0000-7000-8000-000000000001',true,15,46000,4.7,92),
 ('d000000a-0000-7000-8000-000000000003','d0000001-0000-7000-8000-000000000007','88888888-0000-7000-8000-000000000001',true,8,38000,4.4,54)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 11) NOTIFICATIONS — inbox (screens 28, 172, 191). Partitioned → DEFAULT partition.
-- ============================================================================
INSERT INTO notifications (id, tenant_id, user_id, event_code, channel, payload, status, read_at, created_at) VALUES
 ('d000000b-0000-7000-8000-000000000001','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','order.out_for_delivery','in_app','{"title":"Your order is on the way! 🚛","body":"Premium Wheat (2 qtl) is out for delivery. Expected by 4:00 PM.","ref":"KV-2026-0142"}'::jsonb,'delivered',NULL, now() - interval '12 minutes'),
 ('d000000b-0000-7000-8000-000000000002','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','auction.outbid','in_app','{"title":"You''ve been outbid on Red Chilli","body":"Highest bid now ₹15,200. Auction ends in 2h 14m."}'::jsonb,'delivered',NULL, now() - interval '28 minutes'),
 ('d000000b-0000-7000-8000-000000000003','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','booking.accepted','in_app','{"title":"Sunita Kumari accepted your booking","body":"She''ll arrive at your farm at 7 AM on Mon, 18 Aug for wheat harvesting."}'::jsonb,'delivered',NULL, now() - interval '1 hour'),
 ('d000000b-0000-7000-8000-000000000004','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','payment.received','in_app','{"title":"Payment received ₹9,550","body":"From Anand Stores for your Maize listing. Credited to wallet.","amount_minor":955000}'::jsonb,'read', now() - interval '20 hours', now() - interval '20 hours'),
 ('d000000b-0000-7000-8000-000000000005','88888888-0000-7000-8000-000000000001','d0000001-0000-7000-8000-000000000001','kyc.verified','in_app','{"title":"Aadhaar KYC verified","body":"Your account is now fully verified. You can withdraw up to ₹50,000/day."}'::jsonb,'read', now() - interval '26 hours', now() - interval '26 hours')
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================================
-- NOT INCLUDED here (need a separate DB or many lookup FKs — ask to add next):
--   • Wallet balance + ledger lines (screens 19/21/71): live in the wallet-service DB (kv_wallet), not krishiverse.
--   • Labour bookings (screens 50/51): need demand-type lookup + skills + farm address rows.
--   • Ambassador earnings/referrals (screens 86/92): need the ambassador tables seeded.
-- ============================================================================
