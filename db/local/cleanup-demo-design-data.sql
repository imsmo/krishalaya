-- ============================================================================
-- db/local/cleanup-demo-design-data.sql · LOCAL DEV ONLY — deletes the rows that
-- db/local/demo-design-data.sql hand-inserted (the OLD, pre-API "design-preview" seed).
--
-- WHY: db/local/demo-design-data.sql predates money entirely (no order_items money columns'
-- siblings some screens now expect) and uses FIXED, hand-picked ids (the `d0000...` / `44444444-...`
-- literals) that are NOT real uuidv7 — orders is uuidv7-partitioned and PRUNE-checked, so a
-- detail lookup by id on one of these rows misses its partition and the app shows
-- "This order is unavailable". The same rows have no order_items/ledger money columns
-- populated the way the real API does, so prices/amounts/earnings render "—". And because
-- scripts/demo-seed/run.mjs (the NEW api-driven seeder) creates its OWN "Onion — Medium Grade"
-- and "Red Chilli — Teja (Organic)" listings under slightly different titles than this old file's
-- "Onion — Medium grade" / "Red Chilli — Teja Premium", the seeder's title-based idempotency check
-- (GET /v1/listings?mine=true&q=<title>) never matches the old file's rows — so BOTH sets of rows
-- persist side by side → Onion ×2, Red Chilli ×2 in the buyer browse / farmer listings feed.
--
-- THIS SCRIPT removes ONLY the exact rows demo-design-data.sql inserted (matched by their fixed,
-- hand-picked ids — every id below is copy-pasted from that file, not guessed) plus the two rows
-- (`mandi_prices` where source='demo_design') it manages by DELETE+re-INSERT. It never touches:
--   • rows created by the real API / scripts/demo-seed/run.mjs (those get real uuidv7 ids —
--     structurally impossible to collide with the fixed ids listed here)
--   • anything the founder created by hand through the app
--   • the demo tenant itself (88888888-0000-7000-8000-000000000001) or shared reference data
--     (roles/units/categories/products/mandis/schemes) — other real rows may still reference them
--
-- ORDER (FK-safe, children before parents):
--   reviews → order_items → orders → bids → auctions → scheme_applications → worker_profiles →
--   notifications → learning_resources → mandi_prices(source=demo_design) → mandis(demo ids) →
--   listings → products(demo ids) → user_tenant_roles(demo memberships) → users(demo cast)
--
-- IDEMPOTENT: every DELETE is scoped to an explicit id list (or an id LIKE 'd0000%' pattern that
-- only ever matched this file's rows) — running this twice, or against a DB where these rows were
-- already removed, is a no-op (0 rows deleted second time), never an error.
--
-- NEVER run in staging/production (there is no legitimate reason these ids would exist there).
--
-- RUN IT as the DB owner (same role that ran demo-design-data.sql):
--   psql "postgres://<owner>:<pw>@localhost:5432/krishalaya" -f db/local/cleanup-demo-design-data.sql
-- ============================================================================
BEGIN;

DO $$
DECLARE
  n_reviews          int; n_order_items int; n_orders  int;
  n_bids             int; n_auctions    int; n_schemeapps int;
  n_workerprofiles   int; n_notifications int; n_learning int;
  n_mandiprices      int; n_mandis      int; n_listings int;
  n_products         int; n_memberships int; n_users    int;
BEGIN

  -- 6) REVIEWS — reference the demo orders / demo user ids, must go before orders/users.
  DELETE FROM reviews WHERE id IN (
    'd0000006-0000-7000-8000-000000000001',
    'd0000006-0000-7000-8000-000000000002'
  );
  GET DIAGNOSTICS n_reviews = ROW_COUNT;

  -- 5) ORDER_ITEMS — before orders (FK order_id -> orders).
  DELETE FROM order_items WHERE id IN (
    'd0000003-0000-7000-8000-0000000000c1',
    'd0000003-0000-7000-8000-0000000000c2',
    'd0000003-0000-7000-8000-0000000000c3'
  );
  GET DIAGNOSTICS n_order_items = ROW_COUNT;

  -- 5) ORDERS — the fake, non-uuidv7 KV-2026-0142/0138/0121 rows.
  DELETE FROM orders WHERE id IN (
    'd0000003-0000-7000-8000-000000000001',
    'd0000003-0000-7000-8000-000000000002',
    'd0000003-0000-7000-8000-000000000003'
  );
  GET DIAGNOSTICS n_orders = ROW_COUNT;

  -- 4) BIDS — before auctions (FK auction_id -> auctions).
  DELETE FROM bids WHERE id IN (
    'd0000004-0000-7000-8000-0000000000b1',
    'd0000004-0000-7000-8000-0000000000b2',
    'd0000004-0000-7000-8000-0000000000b3'
  );
  GET DIAGNOSTICS n_bids = ROW_COUNT;

  -- 4) AUCTIONS — the Red Chilli live-auction row (before listings, FK listing_id -> listings).
  DELETE FROM auctions WHERE id = 'd0000004-0000-7000-8000-000000000001';
  GET DIAGNOSTICS n_auctions = ROW_COUNT;

  -- 9) SCHEME APPLICATIONS — Ramesh's demo applications.
  DELETE FROM scheme_applications WHERE id IN (
    'd0000009-0000-7000-8000-000000000001',
    'd0000009-0000-7000-8000-000000000002'
  );
  GET DIAGNOSTICS n_schemeapps = ROW_COUNT;

  -- 10) WORKER PROFILES — before users (FK user_id -> users).
  DELETE FROM worker_profiles WHERE id IN (
    'd000000a-0000-7000-8000-000000000001',
    'd000000a-0000-7000-8000-000000000002',
    'd000000a-0000-7000-8000-000000000003'
  );
  GET DIAGNOSTICS n_workerprofiles = ROW_COUNT;

  -- 11) NOTIFICATIONS — the 5 inbox rows for Ramesh.
  DELETE FROM notifications WHERE id IN (
    'd000000b-0000-7000-8000-000000000001',
    'd000000b-0000-7000-8000-000000000002',
    'd000000b-0000-7000-8000-000000000003',
    'd000000b-0000-7000-8000-000000000004',
    'd000000b-0000-7000-8000-000000000005'
  );
  GET DIAGNOSTICS n_notifications = ROW_COUNT;

  -- 8) LEARNING RESOURCES — the 5 tips/articles owned by the demo ambassador.
  DELETE FROM learning_resources WHERE id IN (
    'd0000008-0000-7000-8000-000000000001',
    'd0000008-0000-7000-8000-000000000002',
    'd0000008-0000-7000-8000-000000000003',
    'd0000008-0000-7000-8000-000000000004',
    'd0000008-0000-7000-8000-000000000005'
  );
  GET DIAGNOSTICS n_learning = ROW_COUNT;

  -- 7) MANDI PRICES — demo-design-data.sql itself manages these by `source = 'demo_design'`
  -- (it DELETEs + re-INSERTs them every run) — mirror that exact scoping here so we only ever
  -- remove rows this file owns, never a mandi price a real feed/import created.
  DELETE FROM mandi_prices WHERE source = 'demo_design';
  GET DIAGNOSTICS n_mandiprices = ROW_COUNT;

  -- 7) MANDIS — the 4 demo APMC rows (only if nothing else still references them; mandi_prices
  -- above is already clear, and no other demo table FKs to mandis).
  DELETE FROM mandis WHERE id IN (
    'd00000a1-0000-7000-8000-000000000001',
    'd00000a1-0000-7000-8000-000000000002',
    'd00000a1-0000-7000-8000-000000000003',
    'd00000a1-0000-7000-8000-000000000004'
  );
  GET DIAGNOSTICS n_mandis = ROW_COUNT;

  -- 3) LISTINGS — Ramesh's 4 hand-inserted listings. THIS is the fix for the Onion ×2 / Red
  -- Chilli ×2 duplicate: these ids collide (by crop/title, not by id) with the real seeder's
  -- "Onion — Medium Grade" and "Red Chilli — Teja (Organic)" listings created via POST /v1/listings.
  -- Removing the OLD hand-inserted rows leaves exactly ONE listing per crop (the seeder's real one).
  DELETE FROM listings WHERE id IN (
    'd0000002-0000-7000-8000-000000000001',  -- 'Premium Wheat — Lokwan' (fake price_minor path)
    'd0000002-0000-7000-8000-000000000002',  -- 'Red Chilli — Teja Premium'  <- duplicate of seeder's Red Chilli
    'd0000002-0000-7000-8000-000000000003',  -- 'Onion — Medium grade'      <- duplicate of seeder's Onion
    'd0000002-0000-7000-8000-000000000004'   -- 'Organic Cucumber'
  );
  GET DIAGNOSTICS n_listings = ROW_COUNT;

  -- 2) PRODUCTS — only the 5 crop-master rows this file added (maize/chilli/castor/potato/cucumber
  -- codes it introduced beyond the core catalogue seed). Safe: no other seed/API path uses these ids.
  -- REFERENCE-SAFE: a demo product is kept if a REAL listing you created (via the app/seeder)
  -- still points at it — deleting it would orphan your real listing. Those 5 rows are just
  -- catalogue crop entries; leaving a referenced one is harmless. Unreferenced ones are removed.
  DELETE FROM products WHERE id IN (
    'd0000077-0000-7000-8000-000000000001',
    'd0000077-0000-7000-8000-000000000002',
    'd0000077-0000-7000-8000-000000000003',
    'd0000077-0000-7000-8000-000000000004',
    'd0000077-0000-7000-8000-000000000005'
  ) AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.product_id = products.id);
  GET DIAGNOSTICS n_products = ROW_COUNT;

  -- 1) USER_TENANT_ROLES — the 8 demo memberships, before users.
  DELETE FROM user_tenant_roles WHERE id IN (
    'd0000001-0000-7000-8000-0000000000a1',
    'd0000001-0000-7000-8000-0000000000a2',
    'd0000001-0000-7000-8000-0000000000a3',
    'd0000001-0000-7000-8000-0000000000a4',
    'd0000001-0000-7000-8000-0000000000a5',
    'd0000001-0000-7000-8000-0000000000a6',
    'd0000001-0000-7000-8000-0000000000a7',
    'd0000001-0000-7000-8000-0000000000a8'
  );
  GET DIAGNOSTICS n_memberships = ROW_COUNT;

  -- 1) USERS — the 8-person recurring cast (Ramesh Patel, Krishna FPO Seller, Sharma Stores,
  -- Sharma Masala Mart, Sunita Kumari, Ramesh Mahato, Lakshmi Devi, Vikas Joshi). NOTE: if the
  -- founder has since logged in / created REAL data AS one of these phone numbers through the
  -- actual OTP flow, the real row would have a different (uuidv7) id and is untouched by this
  -- DELETE — only the exact fake ids below are removed.
  DELETE FROM users WHERE id IN (
    'd0000001-0000-7000-8000-000000000001',
    'd0000001-0000-7000-8000-000000000002',
    'd0000001-0000-7000-8000-000000000003',
    'd0000001-0000-7000-8000-000000000004',
    'd0000001-0000-7000-8000-000000000005',
    'd0000001-0000-7000-8000-000000000006',
    'd0000001-0000-7000-8000-000000000007',
    'd0000001-0000-7000-8000-000000000008'
  )
    AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.seller_user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.buyer_user_id = users.id OR o.seller_user_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM user_tenant_roles r WHERE r.user_id = users.id);
  GET DIAGNOSTICS n_users = ROW_COUNT;

  RAISE NOTICE '--------------------------------------------------------------------';
  RAISE NOTICE 'cleanup-demo-design-data: removed old design-preview rows (idempotent)';
  RAISE NOTICE '  reviews:              %', n_reviews;
  RAISE NOTICE '  order_items:          %', n_order_items;
  RAISE NOTICE '  orders:               %  (KV-2026-0142 / 0138 / 0121 — the fake non-uuidv7 rows)', n_orders;
  RAISE NOTICE '  bids:                 %', n_bids;
  RAISE NOTICE '  auctions:             %', n_auctions;
  RAISE NOTICE '  scheme_applications:  %', n_schemeapps;
  RAISE NOTICE '  worker_profiles:      %', n_workerprofiles;
  RAISE NOTICE '  notifications:        %', n_notifications;
  RAISE NOTICE '  learning_resources:   %', n_learning;
  RAISE NOTICE '  mandi_prices (demo_design source): %', n_mandiprices;
  RAISE NOTICE '  mandis:               %', n_mandis;
  RAISE NOTICE '  listings:             %  (includes the Onion / Red Chilli duplicates)', n_listings;
  RAISE NOTICE '  products:             %', n_products;
  RAISE NOTICE '  user_tenant_roles:    %', n_memberships;
  RAISE NOTICE '  users:                %', n_users;
  RAISE NOTICE '--------------------------------------------------------------------';
  RAISE NOTICE 'Real data (created via the APIs / scripts/demo-seed/run.mjs, or by the founder';
  RAISE NOTICE 'through the app) is untouched — it never shares these fixed ids.';
  RAISE NOTICE '--------------------------------------------------------------------';
END $$;

COMMIT;

-- ============================================================================
-- AFTER running this: re-run the real seeder if you want the design-preview surfaces (mandi
-- pulse/prices) repopulated with realistic numbers WITHOUT the money-invariant-breaking rows:
--   node scripts/demo-seed/run.mjs
-- (safe to run repeatedly — it is idempotent by title/phone, see scripts/demo-seed/README.md)
-- ============================================================================
