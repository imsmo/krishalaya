-- ==================================================================================================================
-- MIGRATION 0235 — PC-56 OPS-3p · THE COUNTER IS NOT THE PRICE — the person who records a farmer's milk gets a verb of
-- their own (`dairy.collect`: a pour and a manual cooler reading), the boards get a read-only verb (`dairy.read`), and
-- `dairy.manage` keeps every rate, bill, member, quality decision and cooler setting. tenant_admin is granted both new
-- verbs, so nobody who can act today loses anything; the TENANT-13b dairy desk template carries the new verbs instead of
-- `dairy.manage`, and the dairy desks that template ALREADY made are remapped — only those, identified row by row.
-- (Founder decision OPS-3 Q6-A, 2026-11-08, answered by the founder himself: `05_OPS.md` "OPS-3 SPLIT"; `survey_ops3.md`
-- §0 C-7 / C-8, §2 F-3, §3 OPS3-B4, §5 item 2, §6 Q6 — "the person weighing her milk should not be the person who can
-- change what it is worth". Brief `wave-reports/brief_ops3p.md` §D, §L1–L7, §E.)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0234 are applied; nothing here edits them. 0003's
-- `permissions` / `role_permissions`, 0159's grant-change shape (a DELETE/INSERT on role_permissions by role CODE), 0230's
-- permission-row + loud-assert shape, and 0192's `desks` / `desk_permissions` / `desk_change_proposals` are REUSED UNCHANGED.)
--
-- CLASS — RBAC / TRUST (Law 6 dynamic RBAC; Law 9 — the founder's review is OWED before merge, because this file decides
-- who may record the numbers that price a farmer's milk). NOT MONEY: no ledger table, no wallet account, no posting and no
-- money column is touched; no rupee moves. It moves authority in the REFUSING direction only: after this file no role and
-- no desk can do anything it could not do before, and the dairy desk can do LESS (it can no longer price, bill or enrol).
--
-- ==================================================================================================================
--
-- WHY. One permission, `dairy.manage`, gated the pour (`POST /v1/dairy/collections`), the rate card, enrolment, bill
-- generate / preview, every cooler act and the quality decision (survey F-3). Seed 0004 grants it to tenant_admin alone,
-- and the TENANT-13b dairy desk template mapped its three canon labels — `dairy.collections`, `dairy.quality`,
-- `bmc.monitor` — onto `dairy.manage` (C-7), so giving a counter operator the dairy desk gave him the rate card that sets
-- every member's pay. The role named "Dairy Farmer / MCC Operator" (`dairy_farmer`, 0004) lost `dairy.manage` in 0159 and
-- cannot record a pour at all (C-8) — and must not: that role is every dairy farmer.
--
-- WHAT EXISTS AFTER THIS FILE
--   235.1  Two permissions (module M16), inserted where missing (seed core/0004 carries the same rows, ON CONFLICT DO
--          NOTHING, so a database built from empty and an existing one agree):
--            dairy.collect  'Record milk pours and cooler readings'
--            dairy.read     'Read dairy boards'
--          Neither is on the ungrantable list (apps/api core/rbac/ungrantable.ts): an administrator may put either on a
--          desk or a staff override, and the RBAC resolver (role-cache.service.ts) compiles them like any other code.
--   235.2  THE SEEDED GRANTS (brief L2): tenant_admin holds both. NO OTHER seeded role is granted either — in particular
--          NEVER `dairy_farmer`. `dairy.read` goes to no other role because no other seeded role reads a dairy board
--          today: the boards required `dairy.manage`, and tenant_admin is the only seeded role that holds it (0004, 0159).
--          LOUD ASSERTS: tenant_admin holds both; no role but tenant_admin holds either; dairy_farmer holds neither and
--          still does not hold dairy.manage.
--   235.3  THE TEMPLATE REMAP (brief L4) — only rows the dairy template install itself copied in. A `desk_permissions`
--          row is remapped when ALL of these hold:
--            (a) its desk's `template_code` is 'dairy';
--            (b) the desk was born of a CONFIRMED `install_templates` proposal (`desks.created_by_proposal` → kind
--                'install_templates', status 'confirmed') — a desk an administrator created with kind 'create' is NEVER
--                touched, whatever template label it carries, because its codes were chosen by hand;
--            (c) that proposal's own diff lists `dairy.manage` among the dairy desk's permissions
--                (`diff->'desks' @> '[{"code":"dairy","templateCode":"dairy","permissions":["dairy.manage"]}]'`);
--            (d) the row is `dairy.manage`, live (`removed_at IS NULL`), and was ADDED BY THAT SAME install proposal
--                (`added_by_proposal = desks.created_by_proposal`) — a `dairy.manage` an administrator re-added by an
--                edit proposal carries the edit's id and is NEVER touched.
--          For each such desk: `dairy.collect` and `dairy.read` are added (unless already live), and the `dairy.manage`
--          row is soft-removed (never deleted — 0192's rule). BOTH CITE THE DESK'S OWN INSTALL PROPOSAL
--          (`added_by_proposal` / `removed_by_proposal` = `desks.created_by_proposal`): the two administrators of that
--          proposal confirmed "install the dairy desk template", and this file redefines what that template grants by the
--          founder's decision. THE CITATION IS PROVENANCE, NOT A CLAIM that those two people removed `dairy.manage` —
--          0234's "approved_at = now() is the instant the rule shipped, NOT a claim that anyone approved it then" shape. No
--          proposal row is fabricated (0192's trg_dcp_moves would need two administrators who never proposed or confirmed
--          anything). A remapped row is recognisable forever by `removed_by_proposal = added_by_proposal` on a
--          `dairy.manage` row — a shape no desk proposal can produce (a proposal never adds and removes one row).
--          The remap is wrapped in the markers `>>> 235.3 REMAP` / `<<< 235.3 REMAP` so the live spec runs the very same
--          SQL against desks it made the old way (ops3p-counter-permission.integration.spec.ts). On a database built from
--          empty there are no desks and the remap touches nothing.
--          The members of a remapped desk resolve the new codes on their next resolution (RoleCacheService, 5-minute
--          cache) — this file cannot invalidate an application cache; a token minted earlier carries its own snapshot until
--          it expires, as for every grant change on this platform.
--   235.4  `dairy.override` is UNTOUCHED (the diversion checker's verb, 0166: `POST /v1/dairy/diversions/:id/approve`).
--   235.5  No table, no column, no grant to any database role, no policy, no flag. `kv_app` keeps SELECT only on
--          `permissions` and `role_permissions` (0149:463-488) — it cannot grant itself either code. The RLS gate stays at
--          1,988 (no new table).
--
-- OWNER: the remap updates `desk_permissions` (RLS ENABLED by 0192) as the MIGRATION OWNER. 0192's trg_desk_proposal_gate
-- returns early for any role other than kv_app / kv_relay, and refuses DELETE for everyone — this file never deletes. On a
-- database where the owner neither owns the table nor bypasses RLS the remap would see no rows; the post-remap assert
-- would then still pass vacuously, so the production owner's BYPASSRLS is the same standing question as PARTNER-0's.
--
-- SHARDS: `permissions` and `role_permissions` are global reference data (shard 0, replicated); `desks` and
-- `desk_permissions` carry a tenant_id and live on that tenant's shard — run this file on every shard (the runner does).
--
-- REVERSAL (hand-run, never by the runner; revert the API's dairy controllers, dairy.policies.ts and desk-templates.ts first):
--   -- 1. restore the dairy.manage rows this file soft-removed (the signature only this file writes):
--   UPDATE desk_permissions SET removed_at = NULL, removed_by_proposal = NULL
--    WHERE permission_code = 'dairy.manage' AND removed_by_proposal = added_by_proposal;
--   -- 2. soft-remove the two codes on those same desks (rows are never deleted — 0192):
--   UPDATE desk_permissions dp SET removed_at = now(), removed_by_proposal = dp.added_by_proposal
--    WHERE dp.permission_code IN ('dairy.collect', 'dairy.read') AND dp.removed_at IS NULL
--      AND EXISTS (SELECT 1 FROM desk_permissions m WHERE m.desk_id = dp.desk_id AND m.permission_code = 'dairy.manage' AND m.removed_at IS NULL);
--   -- 3. the grants, then the rows (a permission still referenced by a desk_permissions row stays: FK history):
--   DELETE FROM role_permissions WHERE permission_code IN ('dairy.collect', 'dairy.read');
--   DELETE FROM staff_permission_overrides WHERE permission_code IN ('dairy.collect', 'dairy.read');   -- only if none must be kept
--   DELETE FROM permissions p WHERE p.code IN ('dairy.collect', 'dairy.read')
--    AND NOT EXISTS (SELECT 1 FROM desk_permissions dp WHERE dp.permission_code = p.code);
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 235.1  THE TWO PERMISSIONS
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO permissions (code, default_name, module_code) VALUES
  ('dairy.collect', 'Record milk pours and cooler readings', 'M16'),
  ('dairy.read',    'Read dairy boards',                     'M16')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 235.2  THE SEEDED GRANTS — tenant_admin only (never dairy_farmer)
-- ------------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = 'tenant_admin') THEN
    RAISE EXCEPTION '0235: role tenant_admin is missing — the counter verbs would be granted to nobody';
  END IF;
END $$;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r JOIN permissions p ON p.code IN ('dairy.collect', 'dairy.read')
 WHERE r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
DO $$
BEGIN
  IF (SELECT count(*) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.code = 'tenant_admin' AND rp.permission_code IN ('dairy.collect', 'dairy.read')) <> 2 THEN
    RAISE EXCEPTION '0235: tenant_admin does not hold both dairy.collect and dairy.read';
  END IF;
  IF EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE r.code <> 'tenant_admin' AND rp.permission_code IN ('dairy.collect', 'dairy.read')) THEN
    RAISE EXCEPTION '0235: dairy.collect / dairy.read is held by a role other than tenant_admin (brief L2: no other seeded role)';
  END IF;
  IF EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
              WHERE r.code = 'dairy_farmer' AND rp.permission_code IN ('dairy.collect', 'dairy.read', 'dairy.manage')) THEN
    RAISE EXCEPTION '0235: dairy_farmer holds a dairy operator verb — every dairy farmer must not record pours';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 235.3  THE TEMPLATE REMAP — dairy desks the template install made; never a desk or a row an administrator chose by hand
-- ------------------------------------------------------------------------------------------------------------------
-- >>> 235.3 REMAP
CREATE TEMP TABLE ops3p_remap ON COMMIT DROP AS
SELECT dp.id AS row_id, dp.tenant_id, dp.desk_id, d.created_by_proposal AS install_id
  FROM desk_permissions dp
  JOIN desks d ON d.id = dp.desk_id AND d.tenant_id = dp.tenant_id
  JOIN desk_change_proposals p ON p.id = d.created_by_proposal AND p.tenant_id = d.tenant_id
 WHERE d.template_code = 'dairy'
   AND p.kind = 'install_templates' AND p.status = 'confirmed'
   AND p.diff -> 'desks' @> '[{"code":"dairy","templateCode":"dairy","permissions":["dairy.manage"]}]'::jsonb
   AND dp.permission_code = 'dairy.manage' AND dp.removed_at IS NULL
   AND dp.added_by_proposal = d.created_by_proposal;

INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal)
SELECT x.tenant_id, x.desk_id, c.code, x.install_id
  FROM ops3p_remap x CROSS JOIN (VALUES ('dairy.collect'), ('dairy.read')) AS c(code)
 WHERE NOT EXISTS (SELECT 1 FROM desk_permissions e
                    WHERE e.desk_id = x.desk_id AND e.permission_code = c.code AND e.removed_at IS NULL);

UPDATE desk_permissions dp SET removed_at = now(), removed_by_proposal = x.install_id
  FROM ops3p_remap x
 WHERE dp.id = x.row_id AND dp.removed_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ops3p_remap x JOIN desk_permissions dp ON dp.id = x.row_id WHERE dp.removed_at IS NULL) THEN
    RAISE EXCEPTION '0235: a template-made dairy.manage row is still live on a dairy desk';
  END IF;
  IF EXISTS (SELECT 1 FROM (SELECT DISTINCT desk_id FROM ops3p_remap) x
              WHERE (SELECT count(*) FROM desk_permissions dp
                      WHERE dp.desk_id = x.desk_id AND dp.removed_at IS NULL
                        AND dp.permission_code IN ('dairy.collect', 'dairy.read')) <> 2) THEN
    RAISE EXCEPTION '0235: a remapped dairy desk does not hold both dairy.collect and dairy.read';
  END IF;
END $$;
-- <<< 235.3 REMAP
