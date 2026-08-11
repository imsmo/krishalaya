-- ============================================================================
-- MIGRATION 0128 — SEVEN GUARDED ROUTES THAT NOBODY COULD EVER CALL (PC-56 TENANT-1b-3)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT REACHES BACK THROUGH SEVERAL WAVES INCLUDING MY OWN LAST ONE
-- ---------------------------------------------------------------------------
-- `PermissionsGuard` allows a request only if the caller's resolved permission set contains every required code, and that
-- set is built by `RoleCacheService` from `role_permissions` — which is FK'd to `permissions(code)`. The tenant realm
-- never resolves a wildcard (that is deliberate, Law 11: god-mode lives only in apps/admin-api).
--
-- **SO A PERMISSION CODE THAT IS NOT A ROW IN `permissions` CANNOT BE GRANTED TO ANY ROLE, WHICH MEANS EVERY ROUTE BEHIND
-- IT REFUSES EVERYBODY, FOREVER.** Not a hard failure. A 403, quietly, for every caller including a tenant super-admin.
--
-- Comparing every code declared in an `apps/api` `*Permissions` policy object against the `INSERT INTO permissions` block
-- in db/seeds/core/0004 found SEVEN such codes:
--
--   • `member.pii.reveal`     — PC-56 TENANT-1b. **MINE, LAST WAVE.** I built the per-field, recorded, reasoned PII
--                               reveal, tested it, planted seven mutations, and recorded the wave as closed. Nobody could
--                               call it. The control was real; the door was welded shut.
--   • `listing.boost`         — PC-21b. Paid listing visibility, **revenue stream #4**. `listing_boosts` (0005) is a real
--                               table with a real wallet-capture path, and no seller could reach it.
--   • `group_lot.manage`      — group-lot creation/settlement. A CORE FPO feature: pooling smallholder produce into a
--   • `group_lot.coordinate`   truck-load is most of why a farmer joins an FPO at all.
--   • `certificate.submit`    — listing trust documents (an organic certificate on a listing).
--   • `certificate.verify`
--   • `listing.view_any`      — the moderation read across a tenant's listings.
--
-- **AND NO MIGRATION HAS EVER INSERTED A PERMISSION.** Every code lives only in the seed file, which runs on a fresh
-- database — so adding a row there would fix a demo and leave every existing tenant exactly as broken. Hence this file.
--
-- A test now enumerates the policy codes against both the seed and the migrations, so the next code declared without a
-- row fails CI rather than shipping as a silent 403 (`src/core/auth/__tests__/tenant1b3-permission-reachability.spec.ts`).
--
-- ---------------------------------------------------------------------------
-- 128.1  THE MISSING ROWS
-- ---------------------------------------------------------------------------
-- `module_code` is free text (varchar(10), no FK), matching the seed's own usage ('M03', 'M-AMB', NULL).
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('member.pii.reveal',   'Reveal a member''s contact detail (per field, recorded, reasoned)', 'M01'),
  -- PC-56 TENANT-1b-3, W155. **THE NARROWEST GRANT IN THE TENANT CONSOLE**, and the screen says so: "Needs
  -- member.view360 — the deepest per-person view in your console, so the narrowest grant." One page that assembles
  -- everything an organisation knows about one person deserves its own key.
  ('member.view360',      'Open a member''s 360 view (the deepest per-person read)', 'M01'),
  ('listing.boost',       'Pay to boost a listing''s visibility', 'M03'),
  ('listing.view_any',    'Read any listing in the tenant (moderation)', 'M03'),
  ('group_lot.manage',    'Create and settle group lots', 'M12'),
  ('group_lot.coordinate','Coordinate a group lot (collect pledges, arrange transport)', 'M12'),
  ('certificate.submit',  'Attach a trust document to a listing', 'M03'),
  ('certificate.verify',  'Verify a listing''s trust document', 'M03')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 128.2  WHO HOLDS THEM, AND WHY EACH LINE IS THAT NARROW
-- ---------------------------------------------------------------------------
-- Grants are DATA and a tenant may refine them per staff member through `staff_permission_overrides` (0003). What this
-- migration sets is the DEFAULT, and a default that is too generous is the harder mistake to notice: nobody complains
-- about being able to do too much.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
WHERE
  -- **PII REVEAL AND 360 GO TO tenant_admin ONLY — NOT tenant_staff, NOT support_agent.** Both are deliberately narrower
  -- than `report.view`, which every desk holds: seeing that a member EXISTS and seeing their unmasked phone number (or
  -- their whole life with this organisation) are different acts. A tenant that wants a particular field officer to have
  -- either one grants it to that person through an override, which is a decision somebody makes and a row somebody can
  -- read — rather than a capability 40 staff acquire by accident.
     (r.code = 'tenant_admin' AND p.code IN ('member.pii.reveal', 'member.view360'))

  -- BOOST is bought by SELLERS. It moves money from a seller's wallet, so the roles that can hold stock are the roles
  -- that can pay to promote it.
  OR (r.code IN ('farmer', 'dairy_farmer', 'pashupalak', 'vyapari', 'organic_store', 'pharma_store')
      AND p.code = 'listing.boost')

  -- GROUP LOTS: `manage` is the organisation deciding a lot exists and settling the money afterwards; `coordinate` is the
  -- legwork of collecting pledges and arranging a truck, which an ambassador does in the village. Split because they are
  -- genuinely different jobs done by different people, and collapsing them would either give an ambassador the settlement
  -- or deny them the coordination.
  OR (r.code IN ('tenant_admin', 'fpo_coordinator') AND p.code IN ('group_lot.manage', 'group_lot.coordinate'))
  OR (r.code = 'ambassador' AND p.code = 'group_lot.coordinate')

  -- CERTIFICATES: a seller ATTACHES their own organic certificate; the organisation VERIFIES it. **Never the same role**
  -- — a seller who could verify their own certificate is the whole trust claim undone, and this platform sells that claim
  -- to buyers.
  OR (r.code IN ('farmer', 'dairy_farmer', 'organic_store', 'pharma_store', 'vyapari') AND p.code = 'certificate.submit')
  OR (r.code IN ('tenant_admin', 'fpo_coordinator') AND p.code = 'certificate.verify')

  -- LISTING.VIEW_ANY is a moderation read, so it follows the roles that already moderate or audit. `auditor` gets it
  -- because an auditor who can read the ledger but not the listings behind it cannot reconcile anything.
  OR (r.code IN ('tenant_admin', 'support_agent', 'auditor') AND p.code = 'listing.view_any')
ON CONFLICT (role_id, permission_code) DO NOTHING;

COMMENT ON TABLE permissions IS
  'Atomic actions (PRD §10 matrix as data). **A CODE MISSING FROM HERE CANNOT BE GRANTED, SO EVERY ROUTE GUARDED BY IT REFUSES EVERYBODY** — silently, with a 403, including a tenant super-admin (the tenant realm never resolves a wildcard). 0128 added seven codes that had shipped without rows. A test enumerates the policy objects against this table; add the row in a MIGRATION, not only in db/seeds, or existing tenants stay broken.';

-- ---------------------------------------------------------------------------
-- 128.3  WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
-- IT DOES NOT INVALIDATE THE RBAC CACHE. `RoleCacheService` holds effective permissions for 300 seconds and this is a
-- migration, not a service — so a staff member's new capability appears within five minutes, or immediately on their next
-- sign-in. Naming it because "the grant is in the database and the console still says no" is a five-minute mystery
-- somebody would otherwise debug from scratch.
--
-- IT DOES NOT BACKFILL THE SEED FILE. db/seeds/core/0004 keeps its own list for fresh databases, and the two must now
-- agree; the reachability test reads BOTH, so a code present in only one of them still passes while a code present in
-- neither fails. Consolidating the seed into migrations is a bigger change than this wave should make (TENANT-1b-3-Q1).
--
-- IT GRANTS NOTHING TO `super_admin`. That role is a PLATFORM role and the tenant API deliberately resolves no wildcard
-- for it (Law 11); god-mode acts belong to apps/admin-api's own realm and its own FIDO2 front door.
