-- ============================================================================
-- MIGRATION 0075 — TENANT LOGO_URL (Q20, DEV-26)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one.
--
-- RULING (Design_Program/12_G0-2_DECISION_REGISTER.md line 44, ENGINEERING-ROUTED — "tenants.logo_url column"):
-- the design canon has named this exact column as a real, backend-pending shape for a long time —
-- `templates/system/TS-000-white-label-variable-registry.html` §a's `{{tenant_logo}}` row cites it verbatim:
-- "Maps to (real schema): backend-pending tenants.logo_url", and `brand/BRAND-034-cobrand-fallback.html`
-- (LOGO-4) both cites the same backend-pending note AND ratifies the fallback system this column feeds
-- (name-block primary / initial-tile micro-slot — see the storefront rendering side of this batch, NOT the
-- platform's own KV mark: LOGO-4 §3 is explicit that a fallback must never dress an unbranded tenant in the
-- PLATFORM's own brand color/mark, "backwards from what a fallback is for").
--
-- WHY A REAL COLUMN, NOT JUST THE EXISTING `tenant_settings` KEY (grep-verified before writing this migration):
-- `db/seeds/core/0008_setting_definitions.sql` already seeds a generic `branding.logo_url` key in the dynamic
-- `tenant_settings` EAV-style table (tenant-editable today via `apps/web-tenant`'s settings page), but that is a
-- SETTING (arbitrary jsonb value, joined per-key at read time) — the canon's own registry names a dedicated
-- COLUMN specifically because logo_url is core tenant identity/branding, read on every public storefront render
-- (Golden Law 11 — scale honesty: a dedicated indexed column avoids an extra `tenant_settings` join on every
-- anonymous storefront page view at 15,000-tenant scale). This migration is ADDITIVE, not a replacement: the
-- `tenant_settings` row is backfilled INTO the new column below (one-time copy) and is left in place untouched
-- (nothing in this migration deletes or alters `tenant_settings`) — the settings-page UI can keep working exactly
-- as it does today; a follow-up batch may point that UI's write-path at the new column directly (out of scope
-- here, disclosed rather than silently assumed done).
--
-- RLS DECISION (verified, not assumed): `tenants` carries NO `tenant_id` column (it IS the tenant — see
-- `apps/api/src/core/tenancy-context/tenant-slug-resolver.ts`'s own header: "tenants is a GLOBAL registry table
-- — it has no tenant_id column, so the blanket RLS pass... skips it and it carries NO row-level policy"), grep
-- -confirmed against every `db/migrations/*.sql` (`grep -n "CREATE POLICY.*tenants\b" db/migrations/*.sql` → 0
-- matches beyond index-name substring false-positives). Adding a nullable column to an already-RLS-exempt global
-- table changes nothing about that posture — no new policy is created or possible here, and none is needed.
--
-- HTTPS-ONLY (matches the existing `tenant_settings` seed's own description: "Storefront logo URL (https only;
-- validated in UI)") — this migration ADDS a real DB-level CHECK for the same rule (defense in depth: the UI
-- validation was the only enforcement before this), permissive enough for real CDN/asset-host URLs.
-- ============================================================================

ALTER TABLE tenants ADD COLUMN logo_url text
  CHECK (logo_url IS NULL OR logo_url ~ '^https://[^\s]+$');

COMMENT ON COLUMN tenants.logo_url IS
  'Tenant white-label logo URL (https only). Q20 (Design_Program/12_G0-2_DECISION_REGISTER.md line 44); fallback when unset is LOGO-4''s two-tier system (name-block / initial-tile), never the platform mark — see brand/BRAND-034-cobrand-fallback.html §3.';

-- One-time backfill from the pre-existing generic `tenant_settings` key, for any tenant that already configured
-- one via the web-tenant settings UI. Only copies values that already pass the same https-only rule (a value
-- that wouldn't pass is left NULL here, not silently coerced — the settings-page UI already validates this on
-- write, so a non-https value stored there would itself be a pre-existing data anomaly, out of this migration's
-- scope to fix).
UPDATE tenants t
SET logo_url = v.raw
FROM (
  SELECT ts.tenant_id, (ts.value #>> '{}') AS raw
  FROM tenant_settings ts
  WHERE ts.key = 'branding.logo_url'
) v
WHERE v.tenant_id = t.id
  AND v.raw IS NOT NULL
  AND v.raw <> ''
  AND v.raw ~ '^https://[^\s]+$';

-- RLS — no tenant_id column on `tenants` (see RLS DECISION above), so the idempotent tenant-isolation pass
-- naturally SKIPS it, same as every other global registry table since 0014 — kept here only for the standing
-- convention every migration follows, in case a future migration in this same file ever adds a tenant-scoped
-- table that needs it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    JOIN information_schema.columns c
      ON c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='tenant_id'
    WHERE t.schemaname='public'
      AND t.tablename NOT IN ('wallet_accounts','ledger_entries','ledger_transactions','reconciliation_runs')
      AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', r.tablename);
    EXECUTE format($f$CREATE POLICY tenant_isolation_%s ON %I
                     USING (tenant_id IS NULL OR tenant_id = current_tenant_id());$f$,
                   r.tablename, r.tablename);
  END LOOP;
END $$;
