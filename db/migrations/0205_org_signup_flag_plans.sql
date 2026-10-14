-- ==================================================================================================================
-- MIGRATION 0205 — PC-56 STORE-1c · FOR ORGANISATIONS (canon W307 "Open your organisation's storefront" + its 14 chain pages)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0204 is applied; nothing here edits it: its reserved-slug seed, its trigger
-- and its readers are left exactly as they are — this file only ADDS one reserved name and one flag row.)
-- ==================================================================================================================
--
-- WHAT WAS TRUE (survey F-12 / GAP-B19): the one public route that creates an organisation (`POST /v1/tenant-signup`, TENANT-1d-3a) ran
-- behind NO flag. CLAUDE.md Law 10 ("every feature behind a flag, default OFF, kill-switch") and the contract's Law 8 were both unmet, and
-- canon W307's "Flagged off — Open Your Storefront disabled" state had no flag it could read.
--
-- WHAT IS TRUE NOW:
--   205.1  flag `org_self_signup`, seeded **ON**. FOUNDER DECISION D1 (2026-10-14): a KILL-SWITCH, read in ONE place —
--          apps/api `TenantSignupService.signUp`, BEFORE the one-time code is consumed — OFF answers 403 SIGNUP_DISABLED (a flag-store
--          failure counts as OFF). The storefront reads it through `GET /v1/storefront/flags` (allow-listed).
--          **THE LAW 10 EXCEPTION, NAMED:** the flag is seeded ON, not OFF, because web-tenant's W113 signup has been LIVE on this unflagged
--          route since TENANT-1d-3a; seeding it OFF would dark a working door the moment this migration applied. The founder chose ON
--          knowingly (D1); turning it OFF is the operator's switch, not a code change.
--   205.2  reserved slug `for-organisations` — the storefront route canon W307 lives at (`(platform)/for-organisations`, STORE-1c C1).
--          `tenants-signup` stays reserved (0204): its route now answers with a permanent redirect to `/for-organisations`, and a slug
--          whose address is a redirect is just as unreachable as one shadowed by a page. apps/api `domain/signup.ts`
--          RESERVED_TENANT_SLUGS mirrors 0204 + this row (a unit spec reads both files and compares).
--
-- NOTHING ELSE (A3). The public plans read (`GET /v1/storefront/plans`, founder D2) needs NO grant and NO definer function:
--   • `plans` (0002, + `status` from 0037) is a PLATFORM catalogue — no tenant_id, no RLS (0037's header: "PLATFORM/god-mode tables: no
--     tenant_id ⇒ the idempotent RLS pass skips them") — and kv_app has held SELECT on it since 0002's default privileges (verified on
--     krishalaya_dev before writing this file: has_table_privilege('kv_app','plans','SELECT') = true; the W115 compare read and the
--     signup service's trial-plan read already SELECT it as kv_app). `currencies` (for the exponent) and `setting_definitions` /
--     `platform_setting_values` (for the trial length the review step prints) are likewise platform tables kv_app already reads.
--   • So no SELECT grant is added: granting what is held would be noise a reviewer has to reason about.
--
-- RLS / GRANTS DECISION: no table is created or altered. `feature_flags` and `reserved_tenant_slugs` keep their existing policies and grants
-- (reserved_tenant_slugs: ENABLE + FORCE with 0204's one open policy; the owner's INSERT below runs inside it). Partition pass: neither
-- table is partitioned.
--
-- REVERSAL (documented, not automatic): `DELETE FROM feature_flags WHERE key = 'org_self_signup'` (the gate then reads an unknown flag =
-- OFF — so re-seed it ON first if W113 must stay open) and `DELETE FROM reserved_tenant_slugs WHERE slug = 'for-organisations'`.
-- Nothing existing is altered, so nothing needs restoring.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 205.1  org_self_signup — the platform's switch for self-serve organisation signup (ON; a kill-switch — founder D1)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'org_self_signup',
       'PC-56 STORE-1c (0205, founder D1). The PLATFORM switch for self-serve organisation signup (POST /v1/tenant-signup — web-tenant W113 '
       'and the storefront''s /for-organisations, canon W307). ON (seeded ON: W113 was already live on the unflagged route — the named Law 10 '
       'exception) = an organisation may sign itself up into a trial. OFF = every signup answers 403 SIGNUP_DISABLED BEFORE the one-time code '
       'is consumed, and both doors say signup is switched off. Evaluated platform-wide (no tenant exists yet). A kill-switch, not a rollout.',
       true, 100, '{}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = 'org_self_signup');

-- ------------------------------------------------------------------------------------------------------------------
-- 205.2  for-organisations — canon W307's storefront route is no organisation's address
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('for-organisations', 'storefront route (canon W307, STORE-1c)')
ON CONFLICT (slug) DO NOTHING;

-- an EXISTING organisation already holding the name is reported, never renamed (a slug is in printed QR codes and links) — 0204's rule
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM tenants t WHERE lower(t.slug) = 'for-organisations';
  IF n > 0 THEN RAISE NOTICE '0205: % existing tenant(s) hold the slug for-organisations — left as they are; the admin realm decides', n; END IF;
END $$;
