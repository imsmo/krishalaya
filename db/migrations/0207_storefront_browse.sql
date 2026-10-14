-- ==================================================================================================================
-- MIGRATION 0207 — PC-56 STORE-2a · WHAT AN ANONYMOUS BUYER SEES IS TRUE AND PRIVATE (canon W275 browse · W276 search · W277 listing ·
-- W280 seller → the organisation's seller page · W282 farm inputs + their 12 Retry / Apply chain pages)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0204, 0205 and 0206 are applied; nothing here edits them: 0204's readers,
-- reserved-slug seed and trigger are left exactly as they are — this file only ADDS one flag row and one reserved name.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey F-11 / B23, founder Q13): `GET /v1/listings` and `GET /v1/listings/:id` were unflagged `@Public` routes. Canon
-- W275–W282 each carry a "Flagged off — … disabled" state that had no flag it could read, and no operator could dark the public catalogue
-- without a deploy.
--
-- WHAT IS TRUE NOW:
--   207.1  flag `storefront_browse`, seeded **ON**. FOUNDER DECISION D4 (2026-10-14): ONE kill-switch for the public catalogue, read in ONE
--          place — apps/api `StorefrontBrowseGate` (modules/listings/storefront-browse.guard.ts), on every public listing read: the feed
--          (`GET /v1/listings`, not the owner's `mine=true` view), the public detail (`GET /v1/listings/:id` for a non-owner), the tombstone,
--          the lot attributes, the regulated marker and the organisation seller page. OFF answers 503 STOREFRONT_BROWSE_OFF (named). The
--          storefront reads it through `GET /v1/storefront/flags` (allow-listed, PLATFORM-scoped like `org_self_signup`) and renders a
--          "temporarily unavailable" state on browse, search, listing, seller and inputs — never "for this tenant/plan".
--          A flag-store FAILURE reads as ON (fail OPEN): the switch is read-only and for humans — a dead flag store must not black out every
--          store on the platform; an operator who wants the catalogue dark flips the row, which the gate reads within the flag cache's TTL.
--          **THE LAW 10 EXCEPTION, NAMED (the 0205 pattern):** seeded ON, not OFF, because browse IS the storefront — the public catalogue has
--          been live and unflagged since Phase 1; seeding it OFF would dark every organisation's store the moment this file applied. The
--          founder chose ON knowingly (D4); turning it OFF is the operator's switch, not a code change.
--   207.2  reserved slug `sellers` — the storefront route the organisation's seller page lives at (`/[tenantSlug]/sellers`, STORE-2a C4).
--          `search` and `inputs` were reserved by 0204 already. The canon's `/c/[...path]` category route is NOT built (the category path is
--          a `?category=` parameter on the store's own page — a recorded DELTA), so `c` is not reserved. apps/api `domain/signup.ts`
--          RESERVED_TENANT_SLUGS mirrors 0204 + 0205 + this row (a unit spec reads every migration and compares).
--
--   207.3  public_organisation_search(prefix, limit) + one index — the ONE addition beyond A1/A2, named as a deviation in the wave report:
--          brief C2 asks the platform search's "Organisations" tab to be "public_organisations filtered by name prefix", and 0204's
--          `public_organisations(after, id, limit)` has NO name parameter. `tenants` is walled from a context-free kv_app (0200), so the
--          filter cannot be written in apps/api without a definer read; filtering one 47-row directory page in TypeScript would search only
--          the newest 47 organisations and call it a search (a silent narrowing). So: the SAME projection and the SAME "verified live"
--          predicate as `public_organisations`, matched on a case-insensitive PREFIX (≥ 2 characters, LIKE metacharacters escaped) of the
--          DISPLAY name, at most 24 rows, ordered by display name — a byte-range probe of the new partial expression index
--          `idx_tenants_public_name_prefix (lower(display_name) text_pattern_ops)`, so a search never scans the tenants table (Law 11). The
--          legal name is not matched: an OR arm on it would defeat the index (named in the wave report).
--
-- NOTHING ELSE (A2 / A3). The new public reads need NO definer function and NO grant — each was verified on krishalaya_dev before writing
-- this file (pg_class.relrowsecurity / relforcerowsecurity, has_table_privilege('kv_app', …, 'SELECT')):
--   • `listing_attribute_values` (0005) — no tenant_id, NO RLS, kv_app holds SELECT. The lot-attributes read JOINS it to `listings`, which IS
--     RLS-forced per tenant, inside the tenant's own context (replica.forTenant): a row is reachable only through a published listing of the
--     context tenant. `attribute_definitions`, `attribute_options` and `units` (0004 / seeds) are platform master data — no RLS, kv_app SELECT.
--   • `regulated_product_rules` (0004) — GLOBAL master (written by the admin realm, Law 11), no tenant_id, NO RLS, kv_app SELECT; `categories`
--     and `admin_regions` likewise. The regulated marker reads them directly (as catalogue's RegulatedRuleRepository already does).
--   • `reviews` (0005) — RLS-forced per tenant; the organisation's verified-purchase aggregate runs inside that tenant's context.
--   • the organisation page reuses 0204's `public_tenant_profile` and `public_tenant_listing_count` (EXECUTE already granted to kv_app).
-- No index is added: the feed's capped count + facets read at most cap + 1 = 1,001 rows of ONE tenant through the existing
-- `idx_listings_tenant_status (tenant_id, status, published_at DESC)` (the cost is stated in listing-search.read-model.ts); a price-sort
-- index is a measured-traffic decision, named in the wave report rather than guessed here.
--
-- RLS / GRANTS DECISION: no table is created or altered (207.3 adds one INDEX on tenants and one function: SECURITY DEFINER, `SET search_path
-- = public`, REVOKE ALL FROM PUBLIC, EXECUTE to kv_app only — 0204's rule — returning the directory's own projection: no owner, phone, tax
-- or registration field, no person). `feature_flags` and `reserved_tenant_slugs` keep their existing policies and grants
-- (reserved_tenant_slugs: ENABLE + FORCE with 0204's one open policy; the owner's INSERT below runs inside it). Partition pass: neither
-- table is partitioned.
--
-- REVERSAL (documented, not automatic): `DELETE FROM feature_flags WHERE key = 'storefront_browse'` (the gate then reads an unknown flag =
-- OFF, which DARKS the catalogue — so set it ON instead if the catalogue must stay open),
-- `DELETE FROM reserved_tenant_slugs WHERE slug = 'sellers'`, `DROP FUNCTION public_organisation_search(text, integer)` and
-- `DROP INDEX idx_tenants_public_name_prefix`. Nothing existing is altered, so nothing needs restoring.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 207.1  storefront_browse — the platform's kill-switch for the public catalogue (ON; founder D4)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'storefront_browse',
       'PC-56 STORE-2a (0207, founder D4). The PLATFORM kill-switch for the public catalogue: the listing feed, the public listing detail, '
       'the tombstone, the lot attributes, the regulated marker and the organisation seller page. ON (seeded ON: browse IS the storefront — '
       'the named Law 10 exception) = buyers browse. OFF = each of those reads answers 503 STOREFRONT_BROWSE_OFF and the storefront says '
       'browsing is temporarily unavailable. Evaluated platform-wide; a flag-store failure reads ON. A kill-switch, not a rollout.',
       true, 100, '{}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = 'storefront_browse');

-- ------------------------------------------------------------------------------------------------------------------
-- 207.2  sellers — the organisation's seller page (canon W280, collapsed to the organisation: HOTFIX-4 founder D3)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('sellers', 'storefront route (canon W280 → the organisation seller page, STORE-2a)')
ON CONFLICT (slug) DO NOTHING;

-- an EXISTING organisation already holding the name is reported, never renamed (a slug is in printed QR codes and links) — 0204's rule
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM tenants t WHERE lower(t.slug) = 'sellers';
  IF n > 0 THEN RAISE NOTICE '0207: % existing tenant(s) hold the slug sellers — left as they are; the admin realm decides', n; END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 207.3  public_organisation_search — the platform search's "Organisations" tab (canon W276 "Sellers & FPOs"), by name prefix
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tenants_public_name_prefix ON tenants (lower(display_name) text_pattern_ops)
  WHERE approved_at IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public_organisation_search(p_prefix text, p_limit integer)
RETURNS TABLE (tenant_id uuid, slug varchar, display_name varchar, district_name varchar, logo_url text, brand_version integer, member_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT replace(replace(replace(lower(btrim(p_prefix)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat)
  SELECT t.id, t.slug, t.display_name, r.default_name, t.logo_url::text,
         (SELECT b.version FROM tenant_branding b WHERE b.tenant_id = t.id AND b.version > 0),
         (SELECT count(DISTINCT utr.user_id)
            FROM user_tenant_roles utr
           WHERE utr.tenant_id = t.id AND utr.is_active AND utr.deleted_at IS NULL
             AND utr.role_id IN (SELECT ro.id FROM roles ro WHERE ro.code IN ('farmer', 'dairy_farmer', 'pashupalak') AND ro.deleted_at IS NULL))
    FROM tenants t
    CROSS JOIN q
    LEFT JOIN admin_regions r ON r.id = t.region_id
   WHERE p_prefix IS NOT NULL AND length(btrim(p_prefix)) >= 2
     AND t.status IN ('active', 'grace') AND t.deleted_at IS NULL AND t.approved_at IS NOT NULL
     -- the RANGE is what the index answers (a runtime pattern cannot drive a LIKE index scan); the LIKE keeps the match exact
     AND lower(t.display_name) ~>=~ lower(btrim(p_prefix)) AND lower(t.display_name) ~<~ (lower(btrim(p_prefix)) || chr(1114111))
     AND lower(t.display_name) LIKE q.pat
   ORDER BY t.display_name, t.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 24)
$$;
COMMENT ON FUNCTION public_organisation_search(text, integer) IS
  'PC-56 STORE-2a (0207, brief C2): VERIFIED live organisations whose display name starts with p_prefix (case-insensitive, at least 2 '
  'characters, LIKE metacharacters escaped), at most 24 rows by display name — the same projection and the same verified-live rule as '
  'public_organisations. No owner, phone, tax or registration field; no person.';
REVOKE ALL ON FUNCTION public_organisation_search(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_organisation_search(text, integer) TO kv_app;
