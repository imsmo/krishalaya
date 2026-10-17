-- ==================================================================================================================
-- MIGRATION 0220 — PC-56 HOTFIX-8 · NOTHING PERSONAL IN THE CACHE, NOTHING SENT AS SOMEONE ELSE — the reserved slug `sw.js`
-- (survey_store6.md §2 F-1 / §3 B3: the service worker is now SERVED BY A ROUTE, `apps/web-storefront/src/app/sw.js/route.ts`, versioned by
--  the build with `Cache-Control: no-cache`, instead of the static `public/sw.js` with a constant VERSION that never refreshed.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0219 are applied; nothing here edits them: 0204's `reserved_tenant_slugs`
-- gains ONE row by INSERT, the 0205 / 0207 / 0212 / 0219 precedent.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written.
-- ==================================================================================================================
--
-- WHY A RESERVED SLUG: the storefront's tenancy guard (apps/api/src/modules/tenancy/domain/signup.ts `RESERVED_TENANT_SLUGS`, the STORE-1b
-- rule "every top-level static route of the storefront is a reserved slug") is proven against THIS table on every fresh database. A worker
-- must be served from the origin's root (`/sw.js`) to control every path — a store's path (`/<slug>`) included — so the segment is a top-level
-- static route of the storefront and must be reserved. A slug can never contain a dot (the signup rule), so no organisation loses a name.
--
-- REVERSAL (hand-run, never by the runner):
--   DELETE FROM reserved_tenant_slugs WHERE slug = 'sw.js';
-- ==================================================================================================================

INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('sw.js', 'storefront service-worker route (HOTFIX-8)')
ON CONFLICT (slug) DO NOTHING;
