-- ==================================================================================================================
-- MIGRATION 0204 — PC-56 STORE-1b · THE PLATFORM HOME AND THE TENANT HOME (canon W273 · W274 + their nine Retry chain pages)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0194 and 0200 are applied; nothing here edits them: their readers
-- `resolve_tenant_slug`, `resolve_live_tenant`, `public_tenant_card`, `resolve_tenant_host` are left exactly as they are.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (2026-10-13), built as decided:
--   D1  Phase-1 platform home = a verified-organisation directory + a READ-ONLY discovery feed of `visibility = 'cross_tenant'` listings
--       across live tenants; every card links INTO its tenant's store, where cart / checkout / sign-in stay per tenant. No cross-tenant cart.
--   D3  Public figures = COUNTS ONLY, PRECOMPUTED (live public listings · verified organisations · districts) — a platform read model
--       refreshed by a registered job, never computed per request, never an O(tenants) loop. GMV and the AGMARKNET mandi pulse are refused
--       by name on the page (nothing here computes them).
--   D4  Public tenant profile via a SECURITY DEFINER read; NO farmer PII; TRIAL HIDDEN from anonymous callers.
--
-- WHAT "VERIFIED" MEANS HERE (D4 asked for the exact columns): `tenants.approved_at IS NOT NULL` on a tenant whose `tenants.status` is
-- `active` or `grace`. `approved_at` (0002) is stamped by the admin realm's approve transition only (apps/admin-api tenant-ops
-- `Tenant.approve()` — pending|trial → active, "Stamps approved_at"); nothing in apps/api can write it (0200: kv_app holds no UPDATE on
-- approved_at, and `trg_tenants_app_insert` refuses a kv_app INSERT carrying one). It is the platform's own verification decision — not the
-- tenant's KYC upload, not a self-declared badge. (0109 is the breach-notification evidence migration and carries no tenant verification
-- column; 0200 adds the onboarding columns, none of which is a verification.)
--
-- WHAT "LIVE" MEANS HERE: status IN ('active', 'grace') AND deleted_at IS NULL. A `trial` organisation is NOT live to an anonymous caller
-- (D4, "nothing goes live to buyers until your organisation is verified"); its own members and admins (a JWT tenant) keep working.
--
-- SECTIONS
--   204.1  public_tenant_live(uuid) — the anonymous-visibility test the tenant-context middleware consults (ONE place, apps/api) ·
--          flag `storefront_trial_visible` seeded OFF. **THE TRUST RULE IS LIVE BY DEFAULT BECAUSE THE FOUNDER DECIDED IT** (D4): OFF =
--          trial organisations are invisible to anonymous callers; ON = canon-contrary demo mode (a trial store answers anonymously again).
--   204.2  public_tenant_profile(uuid) — display name, legal name, verified, "since" year, district, member-farmer count, logo, currency.
--   204.3  reserved_tenant_slugs (platform list) + trg_tenants_slug_reserved on tenants INSERT / UPDATE OF slug → [TENANT_SLUG_RESERVED].
--   204.4  platform_public_stats (platform singleton) · refresh_platform_public_stats() · public_platform_stats().
--   204.5  public_discovery_feed(…) · public_organisations(…) · public_tenant_listing_count(uuid, int) ·
--          public_tenant_members_only_count(uuid).
--   204.6  indexes.
--
-- RLS / GRANTS DECISION
--   • `reserved_tenant_slugs` — a PLATFORM list, not tenant data: no tenant_id, no row belongs to a tenant, every caller may know a route
--     name is taken. RLS is ENABLE + FORCE with ONE open policy (so the table is not "RLS-less" to a future reviewer; the privileges are the gate): kv_app / kv_relay / kv_readonly get SELECT only (the default privileges' a/r/w/d are
--     revoked first); kv_admin (the admin realm, Law 11) may add or remove a name.
--   • `platform_public_stats` — a PLATFORM SINGLETON (`id = 1` CHECK): one row of three platform-wide counts, no tenant_id, nothing a
--     tenant owns. RLS is pointless on a one-row table every reader may see in full, so none is added; instead NO role but the owner holds
--     ANY privilege on it (REVOKE ALL from kv_app / kv_relay / kv_readonly): the only write is the SECURITY DEFINER refresh, the only read
--     the SECURITY DEFINER `public_platform_stats()`. Neither table has a tenant_id, so `v_tables_without_rls` does not list them.
--   • Every function is SECURITY DEFINER with `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO kv_app` only.
--     Each returns the smallest projection its caller needs: no user id, no seller id, no owner name / phone / GSTIN / PAN, no member
--     number, no farmer name — a public card names the ORGANISATION (D4).
--   • Partition pass: none of the touched tables is partitioned (listings, tenants, user_tenant_roles are plain tables).
--
-- SCALE (Law 11)
--   • The stats are three statements, run by a job every 15 minutes, never on a request.
--   • The feed and the directory are keyset pages (≤ 48 rows, (created_at µs, id) DESC) over partial indexes added in 204.6.
--   • The per-tenant listing count is CAPPED (`p_cap`, default 1000): it stops counting at cap + 1 and the page prints "1,000+".
--   • The member count is ONE index-backed COUNT (idx_utr_tenant_role: (tenant_id, role_id) WHERE is_active AND deleted_at IS NULL).
--
-- REVERSAL (documented, not automatic): DROP the six functions, the trigger + its function, the two tables, the three indexes, and the flag
-- row. Nothing existing is altered, so nothing needs restoring.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 204.1  public_tenant_live — "may an ANONYMOUS caller see this organisation?" · flag storefront_trial_visible (OFF)
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public_tenant_live(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND t.status IN ('active', 'grace') AND t.deleted_at IS NULL)
$$;
COMMENT ON FUNCTION public_tenant_live(uuid) IS
  'PC-56 STORE-1b (0204, D4): may an ANONYMOUS caller see this organisation? true only for status active | grace (not trial — "nothing goes '
  'live to buyers until your organisation is verified"). Consulted by apps/api TenantContextMiddleware for a request with no principal whose '
  'tenant came from a slug / host / X-Tenant-Id; flag storefront_trial_visible ON skips the test (demo mode). 0200/0194 readers are untouched.';
REVOKE ALL ON FUNCTION public_tenant_live(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_live(uuid) TO kv_app;

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'storefront_trial_visible',
       'PC-56 STORE-1b (0204, founder D4). OFF (the default, and the founder''s rule) = a TRIAL organisation is invisible to ANONYMOUS callers: '
       'its storefront pages 404 and an anonymous API request resolved to it answers 404 TENANT_NOT_FOUND; its own signed-in members and '
       'admins are unaffected. ON = canon-contrary demo mode: trial stores answer anonymously again. A kill-switch, not a rollout.',
       false, 100, '{}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = 'storefront_trial_visible');

-- ------------------------------------------------------------------------------------------------------------------
-- 204.2  public_tenant_profile — the D4 fields of a LIVE tenant, else no row
-- ------------------------------------------------------------------------------------------------------------------
-- Columns, each from a real column (D4 "where a column exists"):
--   display_name   tenants.display_name (kept in step with the published brand by 0194's trg_tenants_brand_sync)
--   legal_name     tenants.legal_name   (there is NO vernacular-name column on tenants — the page says so rather than inventing one)
--   verified       tenants.approved_at IS NOT NULL (the admin realm's approval — see the header)
--   since_year     the calendar year of tenants.created_at on the tenant country's own clock (countries.timezone)
--   district_name  admin_regions.default_name of tenants.region_id (0002: "home district"); NULL when the organisation never set one
--   member_count   ONE COUNT(DISTINCT user_id) over user_tenant_roles with a live FARMING role — farmer · dairy_farmer · pashupalak
--                  (the seeded role vocabulary, 0004; staff, buyers, workers and traders are not "member farmers")
--   logo_url       tenants.logo_url (0075); brand_version = the published tenant_branding version (0194) — the API builds the
--                  version-pinned logo path from it
--   currency_code  countries.currency_code of the tenant's country — so the storefront parses a typed price with THIS currency's
--                  exponent instead of a hard-coded 2 (survey F-15). Not PII; named in the wave report as an addition to D4's list.
CREATE OR REPLACE FUNCTION public_tenant_profile(p_tenant uuid)
RETURNS TABLE (display_name varchar, legal_name varchar, verified boolean, since_year integer, district_name varchar,
               member_count bigint, logo_url text, brand_version integer, currency_code char(3))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.display_name, t.legal_name, (t.approved_at IS NOT NULL),
         EXTRACT(YEAR FROM (t.created_at AT TIME ZONE c.timezone))::integer,
         r.default_name,
         (SELECT count(DISTINCT utr.user_id)
            FROM user_tenant_roles utr
           WHERE utr.tenant_id = t.id AND utr.is_active AND utr.deleted_at IS NULL
             AND utr.role_id IN (SELECT ro.id FROM roles ro WHERE ro.code IN ('farmer', 'dairy_farmer', 'pashupalak') AND ro.deleted_at IS NULL)),
         t.logo_url::text,
         (SELECT b.version FROM tenant_branding b WHERE b.tenant_id = t.id AND b.version > 0),
         c.currency_code
    FROM tenants t
    JOIN countries c ON c.code = t.country_code
    LEFT JOIN admin_regions r ON r.id = t.region_id
   WHERE t.id = p_tenant AND t.status IN ('active', 'grace') AND t.deleted_at IS NULL
$$;
COMMENT ON FUNCTION public_tenant_profile(uuid) IS
  'PC-56 STORE-1b (0204, D4): the public profile of a LIVE (active | grace) organisation — display name, legal name, verified (approved_at '
  'set by the admin realm), since-year, district, member-farmer count, logo, currency. No row for a trial / pending / suspended / archived / '
  'terminated / deleted tenant. No owner name, phone, email, GSTIN, PAN, registration number — and no person at all.';
REVOKE ALL ON FUNCTION public_tenant_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_profile(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 204.3  reserved_tenant_slugs + the wall on tenants
-- ------------------------------------------------------------------------------------------------------------------
-- A tenant slugged `login`, `cart`, `help`, `pricing` … is unreachable in path mode (Next's static routes win over `/[tenantSlug]`), and a
-- storefront that cannot be reached is a broken promise to the organisation that signed up (survey F-4). The list is every storefront
-- top-level static segment today plus the STORE-2..6 canon routes and the platform names a phishing store would want. apps/api's
-- `modules/tenancy/domain/signup.ts` RESERVED_TENANT_SLUGS mirrors it (a unit spec compares the two); this trigger is the wall.
CREATE TABLE IF NOT EXISTS reserved_tenant_slugs (
  slug        varchar(50) PRIMARY KEY CHECK (slug = lower(slug)),
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE reserved_tenant_slugs IS
  'PC-56 STORE-1b (0204, GAP-B20): names no organisation may take as its storefront slug — the storefront''s own routes and platform names. '
  'Platform list (no tenant rows). kv_app reads it (signup); the admin realm (kv_admin) maintains it; trg_tenants_slug_reserved enforces it.';

INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('about', 'storefront route'), ('account', 'storefront route'), ('api', 'storefront route'), ('auctions', 'storefront route'),
  ('blog', 'storefront route'), ('cart', 'storefront route'), ('checkout', 'storefront route'), ('help', 'storefront route'),
  ('login', 'storefront route'), ('messages', 'storefront route'), ('notifications', 'storefront route'), ('offers', 'storefront route'),
  ('offline', 'storefront route'), ('orders', 'storefront route'), ('organisations', 'storefront route'), ('press', 'storefront route'),
  ('pricing', 'storefront route'), ('tenants-signup', 'storefront route'), ('trace', 'storefront route'),
  ('manifest.webmanifest', 'storefront metadata route'), ('robots.txt', 'storefront metadata route'), ('sitemap.xml', 'storefront metadata route'),
  ('discover', 'storefront route'), ('search', 'storefront canon route (STORE-2)'), ('browse', 'storefront canon route (STORE-2)'),
  ('seller', 'storefront canon route (STORE-2)'), ('inputs', 'storefront canon route (STORE-2)'), ('group-lots', 'storefront canon route (STORE-2)'),
  ('addresses', 'storefront canon route (STORE-3)'), ('preferences', 'storefront canon route (STORE-4)'), ('contact', 'storefront canon route (STORE-5)'),
  ('quality-promise', 'storefront canon route (STORE-5)'), ('trust-data', 'storefront canon route (STORE-5)'), ('language', 'storefront canon route (STORE-6)'),
  ('accessibility', 'storefront canon route (STORE-6)'), ('sync', 'storefront canon route (STORE-6)'), ('queued', 'storefront canon route (STORE-6)'),
  ('pwa-install', 'storefront canon route (STORE-6)'),
  ('admin', 'platform name'), ('api-docs', 'platform name'), ('status', 'platform name'), ('www', 'platform name'), ('mail', 'platform name'),
  ('app', 'platform name'), ('store', 'platform name'), ('bazaar', 'platform name (the platform store is "Krishalaya Bazaar")')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE reserved_tenant_slugs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reserved_tenant_slugs FORCE ROW LEVEL SECURITY;
-- ONE open policy: a platform list has no row a role may not see, so the PRIVILEGES below are the gate (kv_app / kv_relay / kv_readonly
-- read; kv_admin maintains; the owner seeds). FORCE keeps the owner inside the same policy (it is open), so a later migration's
-- idempotent INSERT … ON CONFLICT still works for a non-superuser owner.
DROP POLICY IF EXISTS reserved_tenant_slugs_platform_list ON reserved_tenant_slugs;
CREATE POLICY reserved_tenant_slugs_platform_list ON reserved_tenant_slugs FOR ALL USING (true) WITH CHECK (true);
REVOKE ALL ON reserved_tenant_slugs FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON reserved_tenant_slugs TO kv_app, kv_relay, kv_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON reserved_tenant_slugs TO kv_admin;

-- SECURITY DEFINER so the wall holds for every writer (kv_app signup, kv_admin provisioning, a seed) whatever that role may read.
CREATE OR REPLACE FUNCTION assert_tenant_slug_not_reserved() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reserved_tenant_slugs r WHERE r.slug = lower(NEW.slug)) THEN
    RAISE EXCEPTION '[TENANT_SLUG_RESERVED] "%" is a storefront route or platform name and cannot be an organisation''s address — PC-56 STORE-1b', NEW.slug
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION assert_tenant_slug_not_reserved() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_tenants_slug_reserved ON tenants;
CREATE TRIGGER trg_tenants_slug_reserved BEFORE INSERT OR UPDATE OF slug ON tenants
  FOR EACH ROW EXECUTE FUNCTION assert_tenant_slug_not_reserved();

-- an EXISTING organisation already holding a reserved name is reported, never renamed (a slug is in printed QR codes and links)
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM tenants t JOIN reserved_tenant_slugs r ON r.slug = lower(t.slug);
  IF n > 0 THEN RAISE NOTICE '0204: % existing tenant(s) hold a reserved slug — left as they are; the admin realm decides', n; END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 204.4  platform_public_stats — the precomputed public figures (D3)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_public_stats (
  id                smallint PRIMARY KEY CHECK (id = 1),
  live_listings     bigint NOT NULL DEFAULT 0 CHECK (live_listings >= 0),
  verified_tenants  bigint NOT NULL DEFAULT 0 CHECK (verified_tenants >= 0),
  districts         bigint NOT NULL DEFAULT 0 CHECK (districts >= 0),
  -- NULL = never computed: the home page says "not counted yet" rather than printing three zeros as if they were measured
  computed_at       timestamptz
);
COMMENT ON TABLE platform_public_stats IS
  'PC-56 STORE-1b (0204, D3): PLATFORM SINGLETON (id = 1) — the three public counts on the platform home, written ONLY by '
  'refresh_platform_public_stats() (job storefront-public-stats, every 15 min), read ONLY through public_platform_stats(). No tenant_id, '
  'no tenant rows: no RLS; no role but the owner holds any privilege on it.';
INSERT INTO platform_public_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON platform_public_stats FROM kv_app, kv_relay, kv_readonly;

-- Three cross-tenant counts, ONE statement each, each over an index (204.6 / idx_tenants_status), then one UPDATE. Never a tenant loop.
--   live_listings     published listings with visibility public | cross_tenant, of LIVE (active | grace) tenants, seller not suspended
--   verified_tenants  live tenants with approved_at set
--   districts         distinct home districts (tenants.region_id) of those verified live tenants
CREATE OR REPLACE FUNCTION refresh_platform_public_stats() RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_listings bigint; v_tenants bigint; v_districts bigint; v_at timestamptz;
BEGIN
  SELECT count(*) INTO v_listings
    FROM listings l
    JOIN tenants t ON t.id = l.tenant_id AND t.status IN ('active', 'grace') AND t.deleted_at IS NULL
   WHERE l.status = 'published' AND l.visibility IN ('public', 'cross_tenant') AND l.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions kvs
                      WHERE kvs.tenant_id = l.tenant_id AND kvs.user_id = l.seller_user_id
                        AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL);
  SELECT count(*) INTO v_tenants
    FROM tenants t WHERE t.status IN ('active', 'grace') AND t.deleted_at IS NULL AND t.approved_at IS NOT NULL;
  SELECT count(DISTINCT t.region_id) INTO v_districts
    FROM tenants t WHERE t.status IN ('active', 'grace') AND t.deleted_at IS NULL AND t.approved_at IS NOT NULL AND t.region_id IS NOT NULL;
  UPDATE platform_public_stats
     SET live_listings = v_listings, verified_tenants = v_tenants, districts = v_districts, computed_at = clock_timestamp()
   WHERE id = 1
  RETURNING computed_at INTO v_at;
  RETURN v_at;
END $$;
COMMENT ON FUNCTION refresh_platform_public_stats() IS
  'PC-56 STORE-1b (0204, D3): recomputes the three public counts (three statements, never a tenant loop) and stamps computed_at. Called by '
  'the apps/api scheduled job storefront-public-stats every 15 minutes on the kv_app pool. Never on a request.';
REVOKE ALL ON FUNCTION refresh_platform_public_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_platform_public_stats() TO kv_app;

CREATE OR REPLACE FUNCTION public_platform_stats()
RETURNS TABLE (live_listings bigint, verified_tenants bigint, districts bigint, computed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.live_listings, s.verified_tenants, s.districts, s.computed_at FROM platform_public_stats s WHERE s.id = 1
$$;
COMMENT ON FUNCTION public_platform_stats() IS
  'PC-56 STORE-1b (0204, D3): the precomputed public counts and WHEN they were computed (computed_at NULL = never). A read of one row.';
REVOKE ALL ON FUNCTION public_platform_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_platform_stats() TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 204.5  the discovery feed, the directory, and the two per-tenant counts
-- ------------------------------------------------------------------------------------------------------------------
-- The FEED (D1): `cross_tenant` published listings of LIVE tenants, newest first, keyset (created_at µs, id) DESC, ≤ 48 rows. The
-- projection names the ORGANISATION — no seller id, no user id, no farmer name, no member number. Optional filters: a category (and its
-- descendants, categories.path) and a title PREFIX (case-insensitive; ≥ 2 characters or ignored). `created_us` is the cursor instant as
-- the database prints it (shared/pagination/us-keyset.ts — never a JS millisecond).
-- Card columns that do not exist are not invented: there is no vernacular-title column on listings, and the storefront card renders no
-- photo today (components/ListingCard.tsx), so no media is projected.
CREATE OR REPLACE FUNCTION public_discovery_feed(p_after_created timestamptz, p_after_id uuid, p_limit integer,
                                                 p_category uuid DEFAULT NULL, p_q text DEFAULT NULL)
RETURNS TABLE (listing_id uuid, tenant_slug varchar, tenant_display_name varchar, title varchar, price_minor bigint, currency_code char(3),
               unit_code varchar, organic boolean, grade_name varchar, district_name varchar, created_us text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, t.slug, t.display_name, l.title, l.price_minor, l.currency_code, l.unit_code,
         (l.organic_claim IS NOT NULL AND l.organic_claim <> 'none'), g.default_name, r.default_name,
         to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM listings l
    JOIN tenants t ON t.id = l.tenant_id AND t.status IN ('active', 'grace') AND t.deleted_at IS NULL
    LEFT JOIN attribute_options g ON g.id = l.grade_option_id
    LEFT JOIN admin_regions r ON r.id = l.region_id
   WHERE l.status = 'published' AND l.visibility = 'cross_tenant' AND l.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions kvs
                      WHERE kvs.tenant_id = l.tenant_id AND kvs.user_id = l.seller_user_id
                        AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL)
     AND (p_after_created IS NULL OR p_after_id IS NULL OR (l.created_at, l.id) < (p_after_created, p_after_id))
     AND (p_category IS NULL OR l.category_id IN (
            SELECT c.id FROM categories c WHERE c.path <@ (SELECT cc.path FROM categories cc WHERE cc.id = p_category)))
     AND (p_q IS NULL OR length(btrim(p_q)) < 2
          OR lower(l.title) LIKE replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
$$;
COMMENT ON FUNCTION public_discovery_feed(timestamptz, uuid, integer, uuid, text) IS
  'PC-56 STORE-1b (0204, D1): the platform discovery feed — cross_tenant published listings of LIVE (active | grace) tenants, seller not '
  'suspended, keyset (created_at µs, id) DESC, at most 48 rows. Names the organisation (slug + display name); never a seller, user or farmer.';
REVOKE ALL ON FUNCTION public_discovery_feed(timestamptz, uuid, integer, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_discovery_feed(timestamptz, uuid, integer, uuid, text) TO kv_app;

-- The DIRECTORY ("Browse all organisations"): VERIFIED live tenants, newest first, keyset (created_at µs, id) DESC, ≤ 48 rows. The member
-- count is one index-backed COUNT per row of a bounded page (never a loop over every tenant).
CREATE OR REPLACE FUNCTION public_organisations(p_after_created timestamptz, p_after_id uuid, p_limit integer)
RETURNS TABLE (tenant_id uuid, slug varchar, display_name varchar, district_name varchar, logo_url text, brand_version integer,
               member_count bigint, created_us text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.display_name, r.default_name, t.logo_url::text,
         (SELECT b.version FROM tenant_branding b WHERE b.tenant_id = t.id AND b.version > 0),
         (SELECT count(DISTINCT utr.user_id)
            FROM user_tenant_roles utr
           WHERE utr.tenant_id = t.id AND utr.is_active AND utr.deleted_at IS NULL
             AND utr.role_id IN (SELECT ro.id FROM roles ro WHERE ro.code IN ('farmer', 'dairy_farmer', 'pashupalak') AND ro.deleted_at IS NULL)),
         to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    FROM tenants t
    LEFT JOIN admin_regions r ON r.id = t.region_id
   WHERE t.status IN ('active', 'grace') AND t.deleted_at IS NULL AND t.approved_at IS NOT NULL
     AND (p_after_created IS NULL OR p_after_id IS NULL OR (t.created_at, t.id) < (p_after_created, p_after_id))
   ORDER BY t.created_at DESC, t.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
$$;
COMMENT ON FUNCTION public_organisations(timestamptz, uuid, integer) IS
  'PC-56 STORE-1b (0204, D1): the public directory of VERIFIED live organisations — slug, display name, district, logo, member-farmer '
  'count — keyset (created_at µs, id) DESC, at most 48 rows. No owner, phone, tax or registration field.';
REVOKE ALL ON FUNCTION public_organisations(timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_organisations(timestamptz, uuid, integer) TO kv_app;

-- "Live listings from our members (N published)": public | cross_tenant published listings of the tenant (seller not suspended),
-- CAPPED — counting stops at p_cap + 1, so the answer is exact up to p_cap and p_cap + 1 means "more than p_cap" ("1,000+").
CREATE OR REPLACE FUNCTION public_tenant_listing_count(p_tenant uuid, p_cap integer DEFAULT 1000) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM (
    SELECT 1 FROM listings l
     WHERE l.tenant_id = p_tenant AND l.status = 'published' AND l.visibility IN ('public', 'cross_tenant') AND l.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM tenant_member_suspensions kvs
                        WHERE kvs.tenant_id = l.tenant_id AND kvs.user_id = l.seller_user_id
                          AND kvs.lifted_at IS NULL AND kvs.deleted_at IS NULL)
     LIMIT LEAST(GREATEST(COALESCE(p_cap, 1000), 1), 100000) + 1) x
$$;
COMMENT ON FUNCTION public_tenant_listing_count(uuid, integer) IS
  'PC-56 STORE-1b (0204, GAP-B15): the tenant''s public listing count, CAPPED at p_cap (default 1000): the answer p_cap + 1 means "more '
  'than p_cap". Never an unbounded count on a request path.';
REVOKE ALL ON FUNCTION public_tenant_listing_count(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_listing_count(uuid, integer) TO kv_app;

-- "Some lots are members-only": published listings with visibility 'tenant' (left off the public storefront). The page renders the sentence
-- ONLY when this is > 0 — so the claim is never made about a store that has none. Capped like the listing count.
CREATE OR REPLACE FUNCTION public_tenant_members_only_count(p_tenant uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::integer FROM (
    SELECT 1 FROM listings l
     WHERE l.tenant_id = p_tenant AND l.status = 'published' AND l.visibility = 'tenant' AND l.deleted_at IS NULL
     LIMIT 1001) x
$$;
COMMENT ON FUNCTION public_tenant_members_only_count(uuid) IS
  'PC-56 STORE-1b (0204): how many of the tenant''s published listings are members-only (visibility tenant), capped at 1001. A count, never '
  'the listings themselves.';
REVOKE ALL ON FUNCTION public_tenant_members_only_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_members_only_count(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 204.6  indexes
-- ------------------------------------------------------------------------------------------------------------------
-- the feed's keyset walk (newest first) over cross_tenant published listings only
CREATE INDEX IF NOT EXISTS idx_listings_cross_tenant_feed ON listings (created_at DESC, id DESC)
  WHERE status = 'published' AND visibility = 'cross_tenant' AND deleted_at IS NULL;
-- the per-tenant public / members-only counts and the stats' listing count
CREATE INDEX IF NOT EXISTS idx_listings_published_visibility ON listings (tenant_id, visibility)
  WHERE status = 'published' AND deleted_at IS NULL;
-- the directory's keyset walk over verified organisations
CREATE INDEX IF NOT EXISTS idx_tenants_public_directory ON tenants (created_at DESC, id DESC)
  WHERE approved_at IS NOT NULL AND deleted_at IS NULL;
