-- ==================================================================================================================
-- MIGRATION 0194 — PC-56 TENANT-13d · BRANDING & DOMAINS (WHITE-LABEL)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0002, 0014, 0075, 0175, 0192, 0193 are applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (brief_t13d.md, 2026-10-03): BRAND FOR ALL, DOMAIN BY PLAN; CNAME + TXT PROOF, PLATFORM EDGE, HOST ROUTING, ACME LATER.
--
-- WHAT WAS WRONG (survey_t13.md):
--   F-13 branding was write-only and split across two stores: the console wrote `branding.*` settings that nothing read, while the
--        storefront read `tenants.display_name` / `tenants.logo_url` — and `tenants.logo_url` had NO writer. Colours were any string
--        ≤ 4000 (a CSS-injection vector the day a consumer interpolated one); no draft, no publish, no history, no checker, no contrast
--        law; the storefront's manifest and metadata hard-coded "Krishalaya Store".
--   F-7  custom domains: no verification token, no verifier, no TLS, no Host routing, first-come squatting that was never released,
--        no included subdomain at signup, no successor rule.
--   F-6  domain remove was `DELETE FROM tenant_domains`, and kv_app has no DELETE: it always failed.
--   F-12 GET /tenants/me/domains was open to every member.
--   F-25 tls_status vocabulary pending/provisioning/active/failed (code) vs canon pending → issued; no CHECK.
--
-- WHAT THIS FILE DOES
--   194.1  platform settings the domain screens and the verifier read — `platform.edge_hostname`, `platform.included_suffix`,
--          `platform.wildcard_tls_ready` (default false), `platform.public_api_origin`, `platform.dns_resolvers` — and the four dead
--          `branding.*` tenant keys DEPRECATED (their values backfilled into the draft brand, 194.7). Helper `kv_platform_setting(key)`.
--   194.2  plan feature `white_label_unbranded` (removing the "Powered by Krishalaya" mark; plan_features row in seed 0201).
--   194.3  tenant_branding — ONE store of record per tenant: the working draft (name, short name, logo → media_assets, four colours,
--          the Powered-by choice) plus the publication pointer (version, published_at, published_by, checker_user_id). The pointer moves
--          ONLY inside the transaction that confirms a proposal (trg_tenant_branding_gate).
--   194.4  tenant_branding_history — append-only: every published version, frozen, with maker, checker, reason, contrast verdict.
--   194.5  tenant_branding_proposals — publish / rollback proposals; the contrast verdict and the logo are on the row (CHECK ≥ 4.5:1,
--          logo clean); trg_tbp_moves refuses checker = maker (13b shape).
--   194.6  tenants — ONE writer of display_name / logo_url once a brand is published: the publish transaction (trg_tenants_brand_sync).
--   194.7  backfill: a draft for every tenant that had typed something into the dead `branding.*` settings.
--   194.8  tenant_domains — kind included|custom, verification token / status / last check / error in words / 7-day claim expiry,
--          tls_status constrained to pending|issued|failed (provisioning→pending, active→issued), soft delete; ONE VERIFIED claim per
--          domain platform-wide (pending claims by different tenants coexist — first VERIFIED wins); one primary; the included row is
--          permanent; trg_tenant_domains_gate; RLS re-cut to the 0175 split shape; kv_app UPDATE column-scoped, no DELETE ever.
--   194.9  tenant_domain_proposals — make-primary / remove (successor named for a primary); checker ≠ maker by trigger.
--   194.10 reserved_domain_suffixes + `domain_reserved_problem(domain)` — the ONE implementation of the reserved rule (the service asks
--          it; the gate trigger enforces it).
--   194.11 SECURITY DEFINER lookups for the two questions RLS forbids a tenant to ask itself: `resolve_tenant_host(host)` (Host routing:
--          verified rows only, tenant status trial|active|grace) and `tenant_domain_verified_elsewhere(domain, tenant)`.
--   194.12 the included subdomain `<slug>.<included_suffix>` — created by an AFTER INSERT trigger on tenants (every creation path: api
--          signup, admin-api approval, seeds) and backfilled for every existing tenant; TLS `issued` only when the platform wildcard
--          certificate is configured.
--   194.13 flags `tenant_branding`, `tenant_domains`, `tenant_host_routing` (default OFF; also seed 0009).
--   194.14 notification catalogue `tenant.brand_published` (in-app; copy in seed 0007).
--   194.15 indexes.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 194.1  platform settings + the dead branding keys
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description) VALUES
  ('platform.edge_hostname', 'string', 'platform', 'security', '"edge.krishalaya.app"',
   'PC-56 TENANT-13d (0194): the platform edge hostname a tenant''s custom domain must CNAME to. Printed in the domain instructions and checked by the verifier.'),
  ('platform.included_suffix', 'string', 'platform', 'security', '"krishalaya.app"',
   'PC-56 TENANT-13d (0194): every tenant''s included subdomain is <slug>.<this suffix>; no custom domain may sit at or under it.'),
  ('platform.wildcard_tls_ready', 'bool', 'platform', 'security', 'false',
   'PC-56 TENANT-13d (0194): true only once the platform wildcard certificate for *.<included_suffix> is installed at the edge. Until then every included subdomain prints TLS "pending — platform wildcard certificate not yet configured".'),
  ('platform.public_api_origin', 'string', 'platform', 'ordinary', '"https://api.krishalaya.app"',
   'PC-56 TENANT-13d (0194): the public https origin of the API — the published logo URL synced into tenants.logo_url is <origin>/v1/storefront/branding/logo/<tenant>/<version>.'),
  ('platform.dns_resolvers', 'json', 'platform', 'security', '["1.1.1.1", "8.8.8.8"]',
   'PC-56 TENANT-13d (0194): the resolvers the domain verifier pins its CNAME / TXT lookups to (never the pod''s own resolver).')
ON CONFLICT (key) DO NOTHING;

-- The four keys seed core/0008 defines. Seeds run AFTER migrations, so on an empty database these rows do not exist yet when this file
-- runs: they are UPSERTED here with the seed's own type/default/description (the seed's ON CONFLICT DO NOTHING then keeps this file's
-- deprecation — the 0192 precedent), and on an existing database the INSERT is a no-op and only the deprecation below moves.
INSERT INTO setting_definitions (key, value_type, default_value, scope, description) VALUES
  ('branding.display_name', 'string', '""', 'tenant', 'Storefront display name (falls back to tenant name)'),
  ('branding.logo_url', 'string', '""', 'tenant', 'Storefront logo URL (https only; validated in UI)'),
  ('branding.primary_color', 'string', '""', 'tenant', 'Brand primary colour (#RRGGBB)'),
  ('branding.support_email', 'string', '""', 'tenant', 'Public support email shown on the storefront')
ON CONFLICT (key) DO NOTHING;
UPDATE setting_definitions
   SET deprecated_at = COALESCE(deprecated_at, now()),
       deprecated_note = CASE key
         WHEN 'branding.support_email' THEN
           'PC-56 TENANT-13d (0194, F-13): read by nothing, and not part of the canon brand (W191). Its value stays readable here; it is no longer writable.'
         WHEN 'branding.logo_url' THEN
           'PC-56 TENANT-13d (0194, F-13): the logo is now an UPLOAD in the media store (tenant_branding.logo_media_id), sanitised and scanned; a URL cannot be backfilled into an upload, so a value here stays readable and is not carried over. Not writable.'
         ELSE
           'PC-56 TENANT-13d (0194, F-13): written by the console and read by nothing; its value was backfilled into the draft brand (tenant_branding), the one store of record. Not writable.'
       END
 WHERE key IN ('branding.display_name', 'branding.logo_url', 'branding.primary_color', 'branding.support_email');

CREATE OR REPLACE FUNCTION kv_platform_setting(p_key varchar) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT v.value FROM platform_setting_values v WHERE v.key = p_key AND v.deleted_at IS NULL ORDER BY v.updated_at DESC LIMIT 1),
    (SELECT d.default_value FROM setting_definitions d WHERE d.key = p_key AND d.scope = 'platform'))
$$;
COMMENT ON FUNCTION kv_platform_setting(varchar) IS
  'PC-56 TENANT-13d (0194): a platform setting''s effective value (the platform_setting_values row, else the registry default), or NULL.';

-- ------------------------------------------------------------------------------------------------------------------
-- 194.2  plan feature — removing the Powered-by mark (Rule Zero: branding itself is on EVERY plan; only this and the custom domain gate)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO features (code, default_name, module_code, description) VALUES
  ('white_label_unbranded', 'Remove "Powered by Krishalaya"', 'M01',
   'PC-56 TENANT-13d (0194): lets a tenant hide the small "Powered by Krishalaya" mark on brandable surfaces. Trust surfaces (escrow, KYC, disputes, ledger receipts, billing documents) keep it regardless.')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.3  tenant_branding — the one store of record
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_branding (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL UNIQUE REFERENCES tenants(id),
  display_name      varchar(80) NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 80 AND display_name = btrim(display_name)),
  app_short_name    varchar(12) NOT NULL CHECK (length(btrim(app_short_name)) BETWEEN 1 AND 12 AND app_short_name = btrim(app_short_name)),
  logo_media_id     uuid REFERENCES media_assets(id),
  primary_color     varchar(7) NOT NULL CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color      varchar(7) NOT NULL CHECK (accent_color  ~ '^#[0-9a-f]{6}$'),
  ink_color         varchar(7) NOT NULL CHECK (ink_color     ~ '^#[0-9a-f]{6}$'),
  surface_color     varchar(7) NOT NULL CHECK (surface_color ~ '^#[0-9a-f]{6}$'),
  powered_by_hidden boolean NOT NULL DEFAULT false,
  -- 'published' = the working copy IS the published version; 'draft' = never published, or edited since.
  status            varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  -- the version members see (tenant_branding_history.version); 0 = never published — members see the platform brand with the tenant's name
  version           integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  draft_revision    integer NOT NULL DEFAULT 1 CHECK (draft_revision >= 1),
  published_at      timestamptz,
  published_by      uuid REFERENCES users(id),
  checker_user_id   uuid REFERENCES users(id),
  updated_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tb_publication_whole CHECK (
    (version = 0 AND published_at IS NULL AND published_by IS NULL AND checker_user_id IS NULL AND status = 'draft')
 OR (version > 0 AND published_at IS NOT NULL AND published_by IS NOT NULL AND checker_user_id IS NOT NULL AND published_by <> checker_user_id))
);
COMMENT ON TABLE tenant_branding IS
  'PC-56 TENANT-13d (0194, F-13; founder decision: brand for ALL tenants, publish needs a checker, contrast law). The ONE store of record for a tenant''s white-label brand: the working DRAFT (edited directly by a tenant_admin, audited before/after) and the PUBLICATION POINTER (version → tenant_branding_history). The pointer moves only inside the transaction that confirms a tenant_branding_proposals row (trg_tenant_branding_gate), which also syncs tenants.display_name / tenants.logo_url.';

CREATE OR REPLACE FUNCTION kv_brand_proposal_confirmed_now(p_tenant uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE pid text := current_setting('app.brand_proposal_id', true); ok uuid;
BEGIN
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT p.id INTO ok FROM tenant_branding_proposals p
   WHERE p.id = pid::uuid AND p.tenant_id = p_tenant AND p.status = 'confirmed' AND p.confirmed_at = now()
     AND p.confirmed_by IS NOT NULL AND p.confirmed_by <> p.proposed_by;
  RETURN ok;
END $$;
COMMENT ON FUNCTION kv_brand_proposal_confirmed_now(uuid) IS
  'PC-56 TENANT-13d (0194): the brand proposal this transaction cites (app.brand_proposal_id) IF it was confirmed in THIS transaction (confirmed_at = now()) by someone other than its proposer; else NULL. An old confirmation never unlocks a later write.';

-- (the function above references tenant_branding_proposals, created in 194.5 — plpgsql resolves names at call time)

CREATE OR REPLACE FUNCTION assert_tenant_branding_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid uuid; p record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '[BRAND_NEVER_DELETED] a tenant brand is never deleted — PC-56 TENANT-13d' USING ERRCODE = '42501';
  END IF;
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 0 OR NEW.status <> 'draft' OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION '[BRAND_BORN_DRAFT] a brand is born an unpublished draft — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[BRAND_REKEY] a brand keeps its tenant — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.checker_user_id IS DISTINCT FROM OLD.checker_user_id
     OR (NEW.status = 'published' AND OLD.status <> 'published') THEN
    pid := kv_brand_proposal_confirmed_now(NEW.tenant_id);
    IF pid IS NULL THEN
      RAISE EXCEPTION '[BRAND_PUBLISH_NEEDS_CHECKER] a brand is published only in the transaction that confirms a proposal by a second administrator — PC-56 TENANT-13d maker-checker'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO p FROM tenant_branding_proposals WHERE id = pid;
    IF NEW.version <> OLD.version + 1 OR NEW.version <> p.publishes_version OR NEW.published_by <> p.proposed_by
       OR NEW.checker_user_id <> p.confirmed_by OR NEW.published_at <> now() THEN
      RAISE EXCEPTION '[BRAND_PUBLISH_MISMATCH] the publication must be exactly the confirmed proposal % (version %) — PC-56 TENANT-13d', pid, p.publishes_version
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.4  tenant_branding_history — every published version, frozen
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_branding_history (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  version           integer NOT NULL CHECK (version >= 1),
  kind              varchar(10) NOT NULL CHECK (kind IN ('publish', 'rollback')),
  rolled_back_to    integer CHECK (rolled_back_to IS NULL OR rolled_back_to >= 1),
  display_name      varchar(80) NOT NULL,
  app_short_name    varchar(12) NOT NULL,
  logo_media_id     uuid NOT NULL REFERENCES media_assets(id),
  logo_mime         varchar(20) NOT NULL CHECK (logo_mime IN ('image/png', 'image/svg+xml')),
  primary_color     varchar(7) NOT NULL CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color      varchar(7) NOT NULL CHECK (accent_color  ~ '^#[0-9a-f]{6}$'),
  ink_color         varchar(7) NOT NULL CHECK (ink_color     ~ '^#[0-9a-f]{6}$'),
  surface_color     varchar(7) NOT NULL CHECK (surface_color ~ '^#[0-9a-f]{6}$'),
  powered_by_hidden boolean NOT NULL,
  contrast          jsonb NOT NULL,
  contrast_min      numeric(6,3) NOT NULL CHECK (contrast_min >= 4.5),
  proposal_id       uuid NOT NULL,
  proposed_by       uuid NOT NULL REFERENCES users(id),
  confirmed_by      uuid NOT NULL REFERENCES users(id),
  reason            text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  published_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tbh_version UNIQUE (tenant_id, version),
  CONSTRAINT ck_tbh_two_people CHECK (proposed_by <> confirmed_by),
  CONSTRAINT ck_tbh_rollback_whole CHECK ((kind = 'rollback') = (rolled_back_to IS NOT NULL))
);
COMMENT ON TABLE tenant_branding_history IS
  'PC-56 TENANT-13d (0194, F-16; canon W191 "reversible with history"): every published brand version, frozen, with maker, checker, reason and the contrast verdict it passed. Append-only. A rollback is a NEW version copied from an older one through the same checker path.';

CREATE OR REPLACE FUNCTION assert_tenant_branding_history_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid uuid; p record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'tenant_branding_history is append-only — a published version is never edited or removed (PC-56 TENANT-13d, 0194)' USING ERRCODE = '42501';
  END IF;
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN NEW; END IF;
  pid := kv_brand_proposal_confirmed_now(NEW.tenant_id);
  IF pid IS NULL OR pid <> NEW.proposal_id THEN
    RAISE EXCEPTION '[BRAND_PUBLISH_NEEDS_CHECKER] a history version is written only by the transaction that confirms its proposal — PC-56 TENANT-13d'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM tenant_branding_proposals WHERE id = pid;
  IF NEW.version <> p.publishes_version OR NEW.proposed_by <> p.proposed_by OR NEW.confirmed_by <> p.confirmed_by
     OR NEW.display_name <> p.display_name OR NEW.app_short_name <> p.app_short_name OR NEW.logo_media_id <> p.logo_media_id
     OR NEW.primary_color <> p.primary_color OR NEW.accent_color <> p.accent_color OR NEW.ink_color <> p.ink_color
     OR NEW.surface_color <> p.surface_color OR NEW.powered_by_hidden <> p.powered_by_hidden OR NEW.contrast_min <> p.contrast_min THEN
    RAISE EXCEPTION '[BRAND_PUBLISH_MISMATCH] history version % must be exactly what proposal % froze — PC-56 TENANT-13d', NEW.version, pid
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.5  tenant_branding_proposals — publish / rollback, checker ≠ maker
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_branding_proposals (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  kind               varchar(10) NOT NULL CHECK (kind IN ('publish', 'rollback')),
  publishes_version  integer NOT NULL CHECK (publishes_version >= 1),
  rollback_to        integer CHECK (rollback_to IS NULL OR rollback_to >= 1),
  -- the frozen snapshot the checker approves (never "whatever the draft says at confirm time")
  display_name       varchar(80) NOT NULL,
  app_short_name     varchar(12) NOT NULL,
  logo_media_id      uuid NOT NULL REFERENCES media_assets(id),
  logo_mime          varchar(20) NOT NULL CHECK (logo_mime IN ('image/png', 'image/svg+xml')),
  primary_color      varchar(7) NOT NULL CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color       varchar(7) NOT NULL CHECK (accent_color  ~ '^#[0-9a-f]{6}$'),
  ink_color          varchar(7) NOT NULL CHECK (ink_color     ~ '^#[0-9a-f]{6}$'),
  surface_color      varchar(7) NOT NULL CHECK (surface_color ~ '^#[0-9a-f]{6}$'),
  powered_by_hidden  boolean NOT NULL,
  -- the contrast law's verdict (packages/tokens contrast.ts), every pair with its ratio; the floor is ALSO a CHECK here
  contrast           jsonb NOT NULL,
  contrast_min       numeric(6,3) NOT NULL CONSTRAINT ck_tbp_contrast_floor CHECK (contrast_min >= 4.5),
  draft_revision     integer NOT NULL,
  reason             text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by        uuid NOT NULL REFERENCES users(id),
  proposed_at        timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  status             varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by       uuid REFERENCES users(id),
  confirmed_at       timestamptz,
  refused_by         uuid REFERENCES users(id),
  refused_at         timestamptz,
  refuse_reason      text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 5 AND 500),
  expired_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tbp_rollback_whole  CHECK ((kind = 'rollback') = (rollback_to IS NOT NULL)),
  CONSTRAINT ck_tbp_confirm_whole   CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL) AND ((status = 'confirmed') = (confirmed_by IS NOT NULL))),
  CONSTRAINT ck_tbp_refused_whole   CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_tbp_expired_whole   CHECK ((status = 'expired') = (expired_at IS NOT NULL))
  -- maker ≠ checker is ONE wall, the trigger below (trg_tbp_moves) — not a second CHECK that would hide the trigger's removal.
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbp_live ON tenant_branding_proposals (tenant_id) WHERE status = 'proposed';
COMMENT ON TABLE tenant_branding_proposals IS
  'PC-56 TENANT-13d (0194, founder decision: publish needs a checker — "brand touches every member"). A tenant_admin PROPOSES a frozen snapshot (publish the draft, or roll back to a history version) that already passed the contrast law (every pair >= 4.5:1, ck_tbp_contrast_floor) with a clean logo; a DIFFERENT active tenant_admin CONFIRMS it (trg_tbp_moves), and that same transaction publishes it (history row, tenant_branding pointer, tenants.display_name/logo_url, outbox). One live proposal per tenant; 7-day expiry; append-only once closed.';

CREATE OR REPLACE FUNCTION assert_tenant_branding_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); cur integer; m record; h record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tenant_branding_proposals is append-only: a proposal is never deleted — PC-56 TENANT-13d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.expired_at IS NOT NULL THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_BORN_PROPOSED] a brand proposal is born proposed — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[BRAND_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose a brand — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    SELECT version INTO cur FROM tenant_branding WHERE tenant_id = NEW.tenant_id;
    IF NEW.publishes_version <> COALESCE(cur, 0) + 1 THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_STALE] the next version is % — PC-56 TENANT-13d', COALESCE(cur, 0) + 1 USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, mime_type, scan_status, kind, deleted_at INTO m FROM media_assets WHERE id = NEW.logo_media_id;
    IF NOT FOUND OR m.tenant_id IS DISTINCT FROM NEW.tenant_id OR m.kind <> 'image' OR m.mime_type <> NEW.logo_mime
       OR m.scan_status <> 'clean' OR m.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION '[BRAND_LOGO_NOT_READY] the logo must be this tenant''s own clean (antivirus-scanned) PNG or SVG upload — PC-56 TENANT-13d'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'rollback' THEN
      SELECT * INTO h FROM tenant_branding_history WHERE tenant_id = NEW.tenant_id AND version = NEW.rollback_to;
      IF NOT FOUND OR h.display_name <> NEW.display_name OR h.app_short_name <> NEW.app_short_name OR h.logo_media_id <> NEW.logo_media_id
         OR h.primary_color <> NEW.primary_color OR h.accent_color <> NEW.accent_color OR h.ink_color <> NEW.ink_color
         OR h.surface_color <> NEW.surface_color OR h.powered_by_hidden <> NEW.powered_by_hidden THEN
        RAISE EXCEPTION '[BRAND_ROLLBACK_MISMATCH] a rollback re-publishes history version % exactly — PC-56 TENANT-13d', NEW.rollback_to USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: what was proposed is final.
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.publishes_version <> OLD.publishes_version
     OR NEW.rollback_to IS DISTINCT FROM OLD.rollback_to OR NEW.display_name <> OLD.display_name OR NEW.app_short_name <> OLD.app_short_name
     OR NEW.logo_media_id <> OLD.logo_media_id OR NEW.logo_mime <> OLD.logo_mime OR NEW.primary_color <> OLD.primary_color
     OR NEW.accent_color <> OLD.accent_color OR NEW.ink_color <> OLD.ink_color OR NEW.surface_color <> OLD.surface_color
     OR NEW.powered_by_hidden <> OLD.powered_by_hidden OR NEW.contrast <> OLD.contrast OR NEW.contrast_min <> OLD.contrast_min
     OR NEW.draft_revision <> OLD.draft_revision OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by
     OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[BRAND_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-13d', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[BRAND_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-13d', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[BRAND_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second administrator — PC-56 TENANT-13d maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[BRAND_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm a brand — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at <> now() OR NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-13d', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    SELECT version INTO cur FROM tenant_branding WHERE tenant_id = OLD.tenant_id;
    IF OLD.publishes_version <> COALESCE(cur, 0) + 1 THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_STALE] version % was published meanwhile; propose again — PC-56 TENANT-13d', COALESCE(cur, 0) USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'refused' THEN
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[BRAND_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse a brand — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF NEW.expired_at < OLD.expires_at THEN
      RAISE EXCEPTION '[BRAND_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-13d', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[BRAND_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13d', NEW.status USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_tbp_moves ON tenant_branding_proposals;
CREATE TRIGGER trg_tbp_moves BEFORE INSERT OR UPDATE OR DELETE ON tenant_branding_proposals FOR EACH ROW EXECUTE FUNCTION assert_tenant_branding_proposal_moves();
DROP TRIGGER IF EXISTS trg_tbp_no_truncate ON tenant_branding_proposals;
CREATE TRIGGER trg_tbp_no_truncate BEFORE TRUNCATE ON tenant_branding_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_branding_proposal_moves();
DROP TRIGGER IF EXISTS trg_tenant_branding_gate ON tenant_branding;
CREATE TRIGGER trg_tenant_branding_gate BEFORE INSERT OR UPDATE OR DELETE ON tenant_branding FOR EACH ROW EXECUTE FUNCTION assert_tenant_branding_write();
DROP TRIGGER IF EXISTS trg_tenant_branding_no_truncate ON tenant_branding;
CREATE TRIGGER trg_tenant_branding_no_truncate BEFORE TRUNCATE ON tenant_branding FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_branding_write();
DROP TRIGGER IF EXISTS trg_tbh_append_only ON tenant_branding_history;
CREATE TRIGGER trg_tbh_append_only BEFORE INSERT OR UPDATE OR DELETE ON tenant_branding_history FOR EACH ROW EXECUTE FUNCTION assert_tenant_branding_history_write();
DROP TRIGGER IF EXISTS trg_tbh_no_truncate ON tenant_branding_history;
CREATE TRIGGER trg_tbh_no_truncate BEFORE TRUNCATE ON tenant_branding_history FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_branding_history_write();

-- RLS — the 0175 split shape on all three
DO $$
DECLARE t text; pfx text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_branding', 'tenant_branding_history', 'tenant_branding_proposals'] LOOP
    pfx := CASE t WHEN 'tenant_branding' THEN 'tb' WHEN 'tenant_branding_history' THEN 'tbh' ELSE 'tbp' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', pfx || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', pfx || '_insert_own', t);
    IF t <> 'tenant_branding_history' THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', pfx || '_update_own', t);
    END IF;
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', pfx || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
  END LOOP;
END $$;
GRANT UPDATE (display_name, app_short_name, logo_media_id, primary_color, accent_color, ink_color, surface_color, powered_by_hidden,
              status, version, draft_revision, published_at, published_by, checker_user_id, updated_by, updated_at) ON tenant_branding TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON tenant_branding_proposals TO kv_app;
-- the proposal clock (job runner pool, kv_relay) only reads WHICH tenants have a proposal past its window; every act is kv_app's
GRANT SELECT ON tenant_branding_proposals TO kv_relay;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.6  tenants — one writer of display_name / logo_url once a brand is published
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_tenants_brand_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE branded boolean;
BEGIN
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN NEW; END IF;
  IF NEW.logo_url IS DISTINCT FROM OLD.logo_url AND kv_brand_proposal_confirmed_now(NEW.id) IS NULL THEN
    RAISE EXCEPTION '[TENANT_LOGO_IS_BRAND] tenants.logo_url is written only by publishing a brand — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    SELECT EXISTS (SELECT 1 FROM tenant_branding b WHERE b.tenant_id = NEW.id AND b.version > 0) INTO branded;
    IF branded AND kv_brand_proposal_confirmed_now(NEW.id) IS NULL THEN
      RAISE EXCEPTION '[TENANT_NAME_IS_BRAND] the name members see is set by publishing the brand (Branding) — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenants_brand_sync ON tenants;
CREATE TRIGGER trg_tenants_brand_sync BEFORE UPDATE OF display_name, logo_url ON tenants FOR EACH ROW EXECUTE FUNCTION assert_tenants_brand_sync();
COMMENT ON TRIGGER trg_tenants_brand_sync ON tenants IS
  'PC-56 TENANT-13d (0194, F-13): tenants.display_name and tenants.logo_url are what the storefront (and the document headers) read. Once a brand has been published, the app roles write them ONLY inside the transaction that confirms a brand proposal — one writer, in sync. Before any publish, the profile edit keeps writing display_name as it always did.';

-- ------------------------------------------------------------------------------------------------------------------
-- 194.7  backfill — the work typed into the dead branding.* settings is never lost
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE n integer; lost integer;
BEGIN
  INSERT INTO tenant_branding (tenant_id, display_name, app_short_name, primary_color, accent_color, ink_color, surface_color)
  SELECT t.id,
         left(btrim(CASE WHEN length(btrim(COALESCE(s_name.value #>> '{}', ''))) >= 2 THEN s_name.value #>> '{}' ELSE t.display_name END), 80),
         left(btrim(CASE WHEN length(btrim(COALESCE(s_name.value #>> '{}', ''))) >= 2 THEN s_name.value #>> '{}' ELSE t.display_name END), 12),
         CASE WHEN lower(btrim(COALESCE(s_col.value #>> '{}', ''))) ~ '^#[0-9a-f]{6}$' THEN lower(btrim(s_col.value #>> '{}')) ELSE '#1e6f3f' END,
         '#f39c12', '#232a33', '#ffffff'
    FROM tenants t
    LEFT JOIN tenant_settings s_name ON s_name.tenant_id = t.id AND s_name.key = 'branding.display_name'
    LEFT JOIN tenant_settings s_col  ON s_col.tenant_id  = t.id AND s_col.key  = 'branding.primary_color'
   WHERE EXISTS (SELECT 1 FROM tenant_settings s WHERE s.tenant_id = t.id AND s.key LIKE 'branding.%')
     AND length(btrim(t.display_name)) >= 2
  ON CONFLICT (tenant_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO lost FROM tenant_settings WHERE key = 'branding.logo_url' AND COALESCE(value #>> '{}', '') <> '';
  RAISE NOTICE '0194: % draft brand(s) backfilled from branding.* settings; % branding.logo_url value(s) stay readable in tenant_settings and are not carried over (a URL is not an upload)', n, lost;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.8  tenant_domains — proof, expiry, TLS vocabulary, soft delete, one verified claim
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS kind                 varchar(10) NOT NULL DEFAULT 'custom';
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS verification_token   varchar(64);
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS verification_status  varchar(10) NOT NULL DEFAULT 'pending';
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS last_checked_at      timestamptz;
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS last_manual_check_at timestamptz;
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS check_error          text;
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS expires_at           timestamptz;
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS tls_note             text;
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS deleted_by           uuid REFERENCES users(id);
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS delete_reason        text;

-- F-25: map the code vocabulary onto the canon's before constraining it
UPDATE tenant_domains SET tls_status = 'pending' WHERE tls_status = 'provisioning';
UPDATE tenant_domains SET tls_status = 'issued'  WHERE tls_status = 'active';
UPDATE tenant_domains SET tls_status = 'pending' WHERE tls_status NOT IN ('pending', 'issued', 'failed');
-- existing rows: a verified_at is a verified claim; anything else is a pending claim with a fresh token and 7 days to prove it
UPDATE tenant_domains SET verification_status = 'verified' WHERE verified_at IS NOT NULL;
UPDATE tenant_domains SET tls_status = 'pending' WHERE verification_status <> 'verified' AND tls_status = 'issued';
UPDATE tenant_domains SET verification_token = encode(gen_random_bytes(16), 'hex') WHERE kind = 'custom' AND verification_token IS NULL;
UPDATE tenant_domains SET expires_at = now() + interval '7 days' WHERE kind = 'custom' AND verification_status = 'pending' AND expires_at IS NULL;
UPDATE tenant_domains SET is_primary = false WHERE is_primary AND verification_status <> 'verified';
UPDATE tenant_domains SET domain = lower(rtrim(domain, '.')) WHERE domain <> lower(rtrim(domain, '.'));

ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_kind;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_kind CHECK (kind IN ('included', 'custom'));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_tls;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_tls CHECK (tls_status IN ('pending', 'issued', 'failed'));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_verification;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_verification CHECK (verification_status IN ('pending', 'verified', 'failed', 'expired'));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_verified_whole;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_verified_whole CHECK ((verification_status = 'verified') = (verified_at IS NOT NULL));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_token;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_token CHECK (
  (kind = 'custom' AND verification_token ~ '^[0-9a-f]{32}$') OR (kind = 'included' AND verification_token IS NULL));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_claim_expiry;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_claim_expiry CHECK (kind = 'included' OR verification_status = 'verified' OR expires_at IS NOT NULL);
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_primary_verified;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_primary_verified CHECK (NOT is_primary OR (verification_status = 'verified' AND deleted_at IS NULL));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_tls_after_proof;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_tls_after_proof CHECK (tls_status <> 'issued' OR verification_status = 'verified');
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_included_permanent;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_included_permanent CHECK (kind = 'custom' OR (deleted_at IS NULL AND verification_status = 'verified'));
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_domain_normal;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_domain_normal CHECK (domain = lower(domain) AND domain !~ '\.$' AND domain ~ '\.');
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS ck_td_removed_whole;
ALTER TABLE tenant_domains ADD CONSTRAINT ck_td_removed_whole CHECK (
  deleted_at IS NULL OR verification_status = 'expired' OR (deleted_by IS NOT NULL AND delete_reason IS NOT NULL));

-- ONE VERIFIED claim per domain platform-wide; pending claims of different tenants coexist (first VERIFIED wins); no duplicate claim
-- inside one tenant; one primary per tenant; one included subdomain per tenant. The old UNIQUE(domain) let the first claimant squat
-- forever (F-7d) — it is replaced, not added to.
ALTER TABLE tenant_domains DROP CONSTRAINT IF EXISTS tenant_domains_domain_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_td_verified_domain ON tenant_domains (domain) WHERE deleted_at IS NULL AND verification_status = 'verified';
CREATE UNIQUE INDEX IF NOT EXISTS uq_td_tenant_domain   ON tenant_domains (tenant_id, domain) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_td_primary         ON tenant_domains (tenant_id) WHERE is_primary AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_td_included        ON tenant_domains (tenant_id) WHERE kind = 'included' AND deleted_at IS NULL;

COMMENT ON TABLE tenant_domains IS
  'PC-56 TENANT-13d (0194, F-7; founder decision: CNAME + TXT proof, platform edge, Host routing, ACME later). kind included = <slug>.<platform.included_suffix>, created with the tenant, verified by construction, permanent. kind custom = a CLAIM (Professional plan: custom_domain) proven by CNAME <domain> -> platform.edge_hostname AND TXT _krishalaya-verify.<domain> = verification_token, checked by the registered verifier every 5 minutes; unproven after 7 days it EXPIRES and is released (soft-deleted). One VERIFIED claim per domain platform-wide. tls_status pending|issued|failed: custom domains stay pending — certificate issuance (ACME) is not built (own infrastructure wave).';
COMMENT ON COLUMN tenant_domains.check_error IS 'PC-56 TENANT-13d (0194): why the last DNS check failed, in words (never a code alone).';

-- ------------------------------------------------------------------------------------------------------------------
-- 194.9  tenant_domain_proposals — make primary / remove (with successor)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_domain_proposals (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  kind                 varchar(15) NOT NULL CHECK (kind IN ('make_primary', 'remove')),
  domain_id            uuid NOT NULL REFERENCES tenant_domains(id),
  domain               varchar(255) NOT NULL,
  successor_domain_id  uuid REFERENCES tenant_domains(id),
  reason               text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  proposed_by          uuid NOT NULL REFERENCES users(id),
  proposed_at          timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  status               varchar(10) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'refused', 'expired')),
  confirmed_by         uuid REFERENCES users(id),
  confirmed_at         timestamptz,
  refused_by           uuid REFERENCES users(id),
  refused_at           timestamptz,
  refuse_reason        text CHECK (refuse_reason IS NULL OR length(btrim(refuse_reason)) BETWEEN 5 AND 500),
  expired_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tdp_successor_kind CHECK (successor_domain_id IS NULL OR (kind = 'remove' AND successor_domain_id <> domain_id)),
  CONSTRAINT ck_tdp_confirm_whole  CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL) AND ((status = 'confirmed') = (confirmed_by IS NOT NULL))),
  CONSTRAINT ck_tdp_refused_whole  CHECK ((status = 'refused') = (refused_by IS NOT NULL AND refused_at IS NOT NULL AND refuse_reason IS NOT NULL)),
  CONSTRAINT ck_tdp_expired_whole  CHECK ((status = 'expired') = (expired_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tdp_live ON tenant_domain_proposals (domain_id) WHERE status = 'proposed';
COMMENT ON TABLE tenant_domain_proposals IS
  'PC-56 TENANT-13d (0194; canon W192 "Domain changes are recorded · owner + checker"). Making a domain primary (the address members are sent to) and removing one are PROPOSALS: a tenant_admin proposes with a reason, a DIFFERENT active tenant_admin confirms (trg_tdp_moves) and the change happens in that transaction (trg_tenant_domains_gate admits it only then). A primary domain is removed only by naming a verified successor — members never hit a dead URL.';

CREATE OR REPLACE FUNCTION kv_domain_proposal_confirmed_now(p_tenant uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE pid text := current_setting('app.domain_proposal_id', true); ok uuid;
BEGIN
  IF pid IS NULL OR pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT p.id INTO ok FROM tenant_domain_proposals p
   WHERE p.id = pid::uuid AND p.tenant_id = p_tenant AND p.status = 'confirmed' AND p.confirmed_at = now()
     AND p.confirmed_by IS NOT NULL AND p.confirmed_by <> p.proposed_by;
  RETURN ok;
END $$;

CREATE OR REPLACE FUNCTION assert_tenant_domain_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); d record; s record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tenant_domain_proposals is append-only: a proposal is never deleted — PC-56 TENANT-13d' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.kind <> OLD.kind OR NEW.domain_id <> OLD.domain_id OR NEW.domain <> OLD.domain
       OR NEW.successor_domain_id IS DISTINCT FROM OLD.successor_domain_id OR NEW.reason <> OLD.reason OR NEW.proposed_by <> OLD.proposed_by
       OR NEW.proposed_at <> OLD.proposed_at OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_FINAL] what proposal % proposes is final — PC-56 TENANT-13d', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'proposed' THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_CLOSED] proposal % is already % — PC-56 TENANT-13d', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.confirmed_by IS NOT NULL OR NEW.refused_by IS NOT NULL OR NEW.expired_at IS NOT NULL THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_BORN_PROPOSED] a domain proposal is born proposed — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(NEW.tenant_id, NEW.proposed_by) THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSER_NOT_ADMIN] only an active tenant_admin may propose a domain change — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at <> NEW.proposed_at + interval '7 days' THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_EXPIRY] a proposal expires 7 days after it is made — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'confirmed' THEN
    IF NEW.confirmed_by = OLD.proposed_by THEN
      RAISE EXCEPTION '[DOMAIN_CHECKER_IS_MAKER] the person who proposed % cannot also confirm it — a second administrator — PC-56 TENANT-13d maker-checker', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.confirmed_by) THEN
      RAISE EXCEPTION '[DOMAIN_CHECKER_NOT_ADMIN] only an active tenant_admin may confirm a domain change — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.confirmed_at <> now() OR NEW.confirmed_at >= OLD.expires_at THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_EXPIRED] proposal % expired at % — PC-56 TENANT-13d', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'refused' THEN
    IF me IS NOT NULL AND NEW.refused_by <> me THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_NOT_YOURS] a refusal is made in the refuser''s own session — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_is_tenant_admin(OLD.tenant_id, NEW.refused_by) THEN
      RAISE EXCEPTION '[DOMAIN_CHECKER_NOT_ADMIN] only an active tenant_admin may refuse a domain change — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF NEW.status = 'expired' THEN
    IF NEW.expired_at < OLD.expires_at THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_MOVE] proposal % does not expire before % — PC-56 TENANT-13d', OLD.id, OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSE
    RAISE EXCEPTION '[DOMAIN_PROPOSAL_MOVE] proposed -> % is not a move — PC-56 TENANT-13d', NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- the state rules, judged at INSERT and again at CONFIRM (the world may have moved in between)
  SELECT * INTO d FROM tenant_domains WHERE id = NEW.domain_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR d.deleted_at IS NOT NULL OR d.domain <> NEW.domain THEN
    RAISE EXCEPTION '[DOMAIN_NOT_FOUND] domain % is not one of this tenant''s live domains — PC-56 TENANT-13d', NEW.domain USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'make_primary' THEN
    IF d.verification_status <> 'verified' THEN
      RAISE EXCEPTION '[DOMAIN_NOT_VERIFIED] only a verified domain can be made primary — % is %', d.domain, d.verification_status USING ERRCODE = 'check_violation';
    END IF;
    IF d.is_primary THEN
      RAISE EXCEPTION '[DOMAIN_ALREADY_PRIMARY] % is already the primary domain', d.domain USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF d.kind = 'included' THEN
      RAISE EXCEPTION '[DOMAIN_INCLUDED_PERMANENT] the included subdomain % is permanent — it is never removed', d.domain USING ERRCODE = 'check_violation';
    END IF;
    IF d.is_primary THEN
      IF NEW.successor_domain_id IS NULL THEN
        RAISE EXCEPTION '[DOMAIN_SUCCESSOR_REQUIRED] % is the primary domain: name the verified domain that takes over first — members never hit a dead URL', d.domain
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT * INTO s FROM tenant_domains WHERE id = NEW.successor_domain_id AND tenant_id = NEW.tenant_id;
      IF NOT FOUND OR s.deleted_at IS NOT NULL OR s.verification_status <> 'verified' THEN
        RAISE EXCEPTION '[DOMAIN_SUCCESSOR_NOT_VERIFIED] the successor must be one of this tenant''s live, verified domains' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.successor_domain_id IS NOT NULL THEN
      RAISE EXCEPTION '[DOMAIN_SUCCESSOR_NOT_NEEDED] % is not the primary domain; no successor is named', d.domain USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tdp_moves ON tenant_domain_proposals;
CREATE TRIGGER trg_tdp_moves BEFORE INSERT OR UPDATE OR DELETE ON tenant_domain_proposals FOR EACH ROW EXECUTE FUNCTION assert_tenant_domain_proposal_moves();
DROP TRIGGER IF EXISTS trg_tdp_no_truncate ON tenant_domain_proposals;
CREATE TRIGGER trg_tdp_no_truncate BEFORE TRUNCATE ON tenant_domain_proposals FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_domain_proposal_moves();

-- ------------------------------------------------------------------------------------------------------------------
-- 194.10 reserved domains — ONE implementation
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reserved_domain_suffixes (
  pattern     varchar(100) PRIMARY KEY CHECK (pattern = lower(pattern) AND pattern ~ '^[a-z0-9.-]+$'),
  match_kind  varchar(20) NOT NULL CHECK (match_kind IN ('any_label', 'first_label', 'platform_label', 'suffix')),
  note        text NOT NULL CHECK (length(note) >= 10),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE reserved_domain_suffixes IS
  'PC-56 TENANT-13d (0194, F-7d): names no tenant may claim as a custom domain. any_label: the label appears anywhere (krishalaya.com, krishalaya.co.in, mandi.krishalaya.in); first_label: the host''s first label (api.*, admin.*, edge.*); platform_label: a first label reserved only on the platform''s own apex (www, mail); suffix: the domain or anything under it. Also always reserved, without a row: the platform included suffix and everything under it (every tenant''s included subdomain), and the edge hostname. A platform lookup — kv_app SELECT only; admin-api (kv_admin) is the writer.';
INSERT INTO reserved_domain_suffixes (pattern, match_kind, note) VALUES
  ('krishalaya', 'any_label',      'The platform''s name in any domain (krishalaya.* and anything under it).'),
  ('edge',       'first_label',    'edge.* — the platform edge''s naming; a tenant host never imitates it.'),
  ('api',        'first_label',    'api.* — the platform API''s naming; a tenant host never imitates it.'),
  ('admin',      'first_label',    'admin.* — the platform operator console''s naming.'),
  ('www',        'platform_label', 'www on the platform''s own apex.'),
  ('mail',       'platform_label', 'mail on the platform''s own apex.')
ON CONFLICT (pattern) DO NOTHING;
REVOKE ALL ON reserved_domain_suffixes FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON reserved_domain_suffixes TO kv_app, kv_relay, kv_readonly;

CREATE OR REPLACE FUNCTION domain_reserved_problem(p_domain text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE d text := lower(btrim(p_domain)); suffix text := lower(kv_platform_setting('platform.included_suffix') #>> '{}');
        edge text := lower(kv_platform_setting('platform.edge_hostname') #>> '{}'); labels text[]; r record;
BEGIN
  IF d IS NULL OR d = '' THEN RETURN 'empty'; END IF;
  IF d ~ '^[0-9.]+$' OR d ~ ':' THEN RETURN 'ip_literal'; END IF;
  IF suffix IS NOT NULL AND (d = suffix OR right(d, length(suffix) + 1) = '.' || suffix) THEN RETURN 'included_suffix'; END IF;
  IF edge IS NOT NULL AND d = edge THEN RETURN 'edge_hostname'; END IF;
  labels := string_to_array(d, '.');
  FOR r IN SELECT pattern, match_kind FROM reserved_domain_suffixes LOOP
    IF r.match_kind = 'any_label' AND r.pattern = ANY (labels) THEN RETURN 'reserved:' || r.pattern; END IF;
    IF r.match_kind = 'first_label' AND labels[1] = r.pattern THEN RETURN 'reserved:' || r.pattern; END IF;
    IF r.match_kind = 'platform_label' AND suffix IS NOT NULL AND d = r.pattern || '.' || suffix THEN RETURN 'reserved:' || r.pattern; END IF;
    IF r.match_kind = 'suffix' AND (d = r.pattern OR right(d, length(r.pattern) + 1) = '.' || r.pattern) THEN RETURN 'reserved:' || r.pattern; END IF;
  END LOOP;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION domain_reserved_problem(text) IS
  'PC-56 TENANT-13d (0194): why a hostname may not be claimed as a custom domain (included_suffix | edge_hostname | ip_literal | reserved:<pattern>), or NULL. The ONE implementation: the domain service asks it for the review; trg_tenant_domains_gate enforces it on every custom insert.';

CREATE OR REPLACE FUNCTION assert_tenant_domain_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE problem text; pid uuid; p record;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '[DOMAIN_NEVER_DELETED] a domain row is never deleted — removal is a soft delete through a confirmed proposal — PC-56 TENANT-13d' USING ERRCODE = '42501';
  END IF;
  IF current_user NOT IN ('kv_app', 'kv_relay') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind = 'included' THEN
      IF COALESCE(current_setting('app.included_domain_insert', true), '') <> NEW.tenant_id::text THEN
        RAISE EXCEPTION '[DOMAIN_INCLUDED_BY_PLATFORM] the included subdomain is created by the platform with the tenant — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.verification_status <> 'pending' OR NEW.verified_at IS NOT NULL OR NEW.is_primary OR NEW.tls_status <> 'pending'
       OR NEW.deleted_at IS NOT NULL OR NEW.expires_at IS DISTINCT FROM now() + interval '7 days' THEN
      RAISE EXCEPTION '[DOMAIN_BORN_PENDING] a custom domain is born an unproven, non-primary claim that expires in 7 days — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    problem := domain_reserved_problem(NEW.domain);
    IF problem IS NOT NULL THEN
      RAISE EXCEPTION '[DOMAIN_RESERVED] % is reserved (%) — PC-56 TENANT-13d', NEW.domain, problem USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.domain <> OLD.domain OR NEW.kind <> OLD.kind
     OR NEW.verification_token IS DISTINCT FROM OLD.verification_token OR NEW.created_at <> OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION '[DOMAIN_FINAL] a domain keeps its tenant, name, kind, token and claim window — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '[DOMAIN_RELEASED] % was released; claim it again to start over — PC-56 TENANT-13d', OLD.domain USING ERRCODE = 'check_violation';
  END IF;
  -- verification: only the DNS verifier marks a claim verified, in its own act (app.domain_verifier = 'dns'), never a past instant
  IF NEW.verification_status = 'verified' AND OLD.verification_status <> 'verified' THEN
    IF OLD.kind <> 'custom' OR COALESCE(current_setting('app.domain_verifier', true), '') <> 'dns'
       OR NEW.verified_at IS DISTINCT FROM now() OR NEW.last_checked_at IS DISTINCT FROM now() OR now() >= OLD.expires_at THEN
      RAISE EXCEPTION '[DOMAIN_VERIFY_BY_DNS_ONLY] a domain is verified only by the DNS verifier''s own successful check — PC-56 TENANT-13d (no fake verified)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.verification_status = 'verified' AND NEW.verification_status <> 'verified' AND OLD.kind = 'included' THEN
    RAISE EXCEPTION '[DOMAIN_INCLUDED_PERMANENT] the included subdomain stays verified — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tls_status = 'issued' AND OLD.tls_status <> 'issued' AND OLD.kind = 'custom' THEN
    RAISE EXCEPTION '[DOMAIN_TLS_NOT_BUILT] certificate issuance for custom domains is not built (ACME, own infrastructure wave) — tls_status stays pending — PC-56 TENANT-13d'
      USING ERRCODE = 'check_violation';
  END IF;
  -- release of an expired claim (the verifier): no proposal, but only a never-verified claim past its window
  IF NEW.deleted_at IS NOT NULL AND NEW.verification_status = 'expired' THEN
    IF OLD.verification_status = 'verified' OR now() < OLD.expires_at OR NEW.is_primary THEN
      RAISE EXCEPTION '[DOMAIN_RELEASE] only an unproven claim past its 7-day window is released — PC-56 TENANT-13d' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- primary changes and removal: only inside the transaction that confirms a proposal by a second administrator
  IF NEW.is_primary IS DISTINCT FROM OLD.is_primary OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    pid := kv_domain_proposal_confirmed_now(NEW.tenant_id);
    IF pid IS NULL THEN
      RAISE EXCEPTION '[DOMAIN_CHANGE_NEEDS_CHECKER] making a domain primary or removing one happens only when a second administrator confirms the proposal — PC-56 TENANT-13d maker-checker'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO p FROM tenant_domain_proposals WHERE id = pid;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND (p.kind <> 'remove' OR p.domain_id <> NEW.id OR NEW.deleted_at <> now()) THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_MISMATCH] removal of % is not what proposal % confirmed — PC-56 TENANT-13d', NEW.domain, pid USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_primary AND NOT OLD.is_primary AND NOT ((p.kind = 'make_primary' AND p.domain_id = NEW.id) OR (p.kind = 'remove' AND p.successor_domain_id = NEW.id)) THEN
      RAISE EXCEPTION '[DOMAIN_PROPOSAL_MISMATCH] % becoming primary is not what proposal % confirmed — PC-56 TENANT-13d', NEW.domain, pid USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenant_domains_gate ON tenant_domains;
CREATE TRIGGER trg_tenant_domains_gate BEFORE INSERT OR UPDATE OR DELETE ON tenant_domains FOR EACH ROW EXECUTE FUNCTION assert_tenant_domain_write();
DROP TRIGGER IF EXISTS trg_tenant_domains_no_truncate ON tenant_domains;
CREATE TRIGGER trg_tenant_domains_no_truncate BEFORE TRUNCATE ON tenant_domains FOR EACH STATEMENT EXECUTE FUNCTION assert_tenant_domain_write();

-- RLS: the 0014 blanket policy is re-cut to the 0175 split shape (tenant_domains + its proposals); kv_app UPDATE column-scoped; no DELETE.
DROP POLICY IF EXISTS tenant_isolation_tenant_domains ON tenant_domains;
DO $$
DECLARE t text; pfx text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_domains', 'tenant_domain_proposals'] LOOP
    pfx := CASE t WHEN 'tenant_domains' THEN 'td' ELSE 'tdp' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pfx || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', pfx || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', pfx || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', pfx || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', pfx || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO kv_app', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly, kv_relay', t);
  END LOOP;
END $$;
GRANT UPDATE (is_primary, tls_status, tls_note, verified_at, verification_status, last_checked_at, last_manual_check_at, check_error,
              deleted_at, deleted_by, delete_reason, updated_at, updated_by) ON tenant_domains TO kv_app;
GRANT UPDATE (status, confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at) ON tenant_domain_proposals TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.11 the two cross-tenant questions, answered narrowly (SECURITY DEFINER; EXECUTE to kv_app only)
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_tenant_host(p_host text)
RETURNS TABLE (tenant_id uuid, slug varchar, domain_id uuid, domain_kind varchar, is_primary boolean,
               primary_domain varchar, primary_kind varchar, primary_tls varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, d.id, d.kind, d.is_primary, p.domain, p.kind, p.tls_status
    FROM tenant_domains d
    JOIN tenants t ON t.id = d.tenant_id AND t.status IN ('trial', 'active', 'grace') AND t.deleted_at IS NULL
    LEFT JOIN tenant_domains p ON p.tenant_id = d.tenant_id AND p.is_primary AND p.deleted_at IS NULL
   WHERE d.domain = lower(rtrim(btrim(p_host), '.')) AND d.deleted_at IS NULL AND d.verification_status = 'verified'
   LIMIT 1
$$;
COMMENT ON FUNCTION resolve_tenant_host(text) IS
  'PC-56 TENANT-13d (0194, F-7c / F-24): Host -> tenant for an anonymous request. ONLY a verified, live domain of a tenant whose status is trial | active | grace answers; anything else is no row (the caller answers 404 tenant-not-found — never a default tenant). Also returns the tenant''s primary domain so the caller can 301 to it.';
REVOKE ALL ON FUNCTION resolve_tenant_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_host(text) TO kv_app;

CREATE OR REPLACE FUNCTION tenant_domain_verified_elsewhere(p_domain text, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenant_domains d WHERE d.domain = lower(btrim(p_domain)) AND d.tenant_id <> p_tenant
                    AND d.deleted_at IS NULL AND d.verification_status = 'verified')
$$;
COMMENT ON FUNCTION tenant_domain_verified_elsewhere(text, uuid) IS
  'PC-56 TENANT-13d (0194): true when ANOTHER tenant holds a verified claim on the domain — the add refuses it ("already claimed and verified") and the verifier fails a pending claim on it. Says nothing about who.';
REVOKE ALL ON FUNCTION tenant_domain_verified_elsewhere(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_domain_verified_elsewhere(text, uuid) TO kv_app;

CREATE OR REPLACE FUNCTION kv_plan_feature(p_tenant uuid, p_feature varchar) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT tf.is_enabled FROM tenant_features tf
      WHERE tf.tenant_id = p_tenant AND tf.feature_code = p_feature AND tf.deleted_at IS NULL
        AND (tf.expires_at IS NULL OR tf.expires_at > now()) LIMIT 1),
    (SELECT COALESCE(pf.is_included, false)
       FROM subscriptions s LEFT JOIN plan_features pf ON pf.plan_id = s.plan_id AND pf.feature_code = p_feature
      WHERE s.tenant_id = p_tenant AND s.deleted_at IS NULL AND s.status IN ('trialing', 'active', 'past_due')
      ORDER BY s.created_at DESC LIMIT 1),
    false)
$$;
COMMENT ON FUNCTION kv_plan_feature(uuid, varchar) IS
  'PC-56 TENANT-13d (0194): a plan feature read for real — an unexpired tenant_features override wins, else the current subscription''s plan_features, else false. The same rule 13c reads for api_access; used by the public brand read (white_label_unbranded).';
REVOKE ALL ON FUNCTION kv_plan_feature(uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_plan_feature(uuid, varchar) TO kv_app;

CREATE OR REPLACE FUNCTION public_tenant_brand(p_tenant uuid)
RETURNS TABLE (version integer, display_name varchar, app_short_name varchar, logo_mime varchar, primary_color varchar, accent_color varchar,
               ink_color varchar, surface_color varchar, powered_by_hidden boolean, published_at timestamptz, plan_allows_unbranded boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.version, h.display_name, h.app_short_name, h.logo_mime, h.primary_color, h.accent_color, h.ink_color, h.surface_color,
         h.powered_by_hidden, h.published_at, kv_plan_feature(p_tenant, 'white_label_unbranded')
    FROM tenant_branding b
    JOIN tenant_branding_history h ON h.tenant_id = b.tenant_id AND h.version = b.version
    JOIN tenants t ON t.id = b.tenant_id AND t.status IN ('trial', 'active', 'grace') AND t.deleted_at IS NULL
   WHERE b.tenant_id = p_tenant AND b.version > 0
$$;
COMMENT ON FUNCTION public_tenant_brand(uuid) IS
  'PC-56 TENANT-13d (0194, A5): the PUBLISHED brand of a live tenant — exactly the history version tenant_branding points at, never the draft — plus whether its plan currently allows hiding the Powered-by mark. Public storefront data (no PII). No row = the tenant has never published: members see the platform brand with the tenant''s name.';
REVOKE ALL ON FUNCTION public_tenant_brand(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tenant_brand(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.12 the included subdomain — with every tenant, from its first instant
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kv_included_host(p_slug text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN lower(p_slug) ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
              THEN lower(p_slug) || '.' || lower(kv_platform_setting('platform.included_suffix') #>> '{}') END
$$;

CREATE OR REPLACE FUNCTION add_included_tenant_domain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE host text := kv_included_host(NEW.slug); prev_t text := current_setting('app.tenant_id', true);
        prev_i text := current_setting('app.included_domain_insert', true); ready boolean;
BEGIN
  IF host IS NULL THEN
    RAISE NOTICE '0194: tenant % has slug "%" which is not a DNS label — no included subdomain', NEW.id, NEW.slug;
    RETURN NEW;
  END IF;
  ready := COALESCE((kv_platform_setting('platform.wildcard_tls_ready') #>> '{}')::boolean, false);
  PERFORM set_config('app.tenant_id', NEW.id::text, true);
  PERFORM set_config('app.included_domain_insert', NEW.id::text, true);
  INSERT INTO tenant_domains (tenant_id, domain, kind, is_primary, verification_status, verified_at, tls_status, tls_note)
  VALUES (NEW.id, host, 'included', true, 'verified', now(), CASE WHEN ready THEN 'issued' ELSE 'pending' END,
          CASE WHEN ready THEN NULL ELSE 'platform wildcard certificate not yet configured' END)
  ON CONFLICT DO NOTHING;
  PERFORM set_config('app.included_domain_insert', COALESCE(prev_i, ''), true);
  PERFORM set_config('app.tenant_id', COALESCE(prev_t, ''), true);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tenants_included_domain ON tenants;
CREATE TRIGGER trg_tenants_included_domain AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION add_included_tenant_domain();
COMMENT ON TRIGGER trg_tenants_included_domain ON tenants IS
  'PC-56 TENANT-13d (0194, F-7e): every tenant gets its included subdomain <slug>.<platform.included_suffix> the instant it exists — api self-serve signup, admin-api approval and seeds alike — verified by construction (the platform owns the zone), primary until a verified custom domain is made primary, permanent. TLS is issued only when platform.wildcard_tls_ready is true.';

-- backfill every existing tenant (an existing verified row for the same host stays as it is)
DO $$
DECLARE n integer := 0; t record; host text; ready boolean := COALESCE((kv_platform_setting('platform.wildcard_tls_ready') #>> '{}')::boolean, false);
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE deleted_at IS NULL LOOP
    host := kv_included_host(t.slug);
    CONTINUE WHEN host IS NULL;
    CONTINUE WHEN EXISTS (SELECT 1 FROM tenant_domains d WHERE d.tenant_id = t.id AND d.kind = 'included' AND d.deleted_at IS NULL);
    CONTINUE WHEN EXISTS (SELECT 1 FROM tenant_domains d WHERE d.domain = host AND d.deleted_at IS NULL);
    INSERT INTO tenant_domains (tenant_id, domain, kind, is_primary, verification_status, verified_at, tls_status, tls_note)
    VALUES (t.id, host, 'included', NOT EXISTS (SELECT 1 FROM tenant_domains d WHERE d.tenant_id = t.id AND d.is_primary AND d.deleted_at IS NULL),
            'verified', now(), CASE WHEN ready THEN 'issued' ELSE 'pending' END,
            CASE WHEN ready THEN NULL ELSE 'platform wildcard certificate not yet configured' END);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '0194: % included subdomain row(s) backfilled', n;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.13 flags (also seed 0009) — default OFF
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT v.key, v.description, false, 100, '{}'::jsonb
  FROM (VALUES
    ('tenant_branding', 'PC-56 TENANT-13d. White-label theming console (W191): draft, contrast law, publish with a checker, history and rollback. Branding is on EVERY plan; only removing "Powered by" needs white_label_unbranded. OFF until enabled; while off the console prints Flagged off. Published brands are served regardless.'),
    ('tenant_domains', 'PC-56 TENANT-13d. Domains console (W192): included subdomain, custom domain claims (custom_domain plan feature), CNAME + TXT verification, make primary / remove with a checker. OFF until enabled.'),
    ('tenant_host_routing', 'PC-56 TENANT-13d. Host -> tenant resolution on anonymous API requests and in the storefront (verified domains only; an unknown tenant Host answers 404). OFF until the edge routes tenant hosts here; while off, Host is never consulted.')
  ) AS v(key, description)
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags f WHERE f.key = v.key);

-- ------------------------------------------------------------------------------------------------------------------
-- 194.14 notification catalogue — "same organisation, new look"
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('tenant.brand_published', 'Your organisation published a new look (confirmed by two administrators) — same organisation, new look', 'informational', '["inapp"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 194.15 indexes
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tbh_tenant      ON tenant_branding_history (tenant_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tbp_tenant      ON tenant_branding_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tbp_expiring    ON tenant_branding_proposals (expires_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_tdp_tenant      ON tenant_domain_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_tdp_expiring    ON tenant_domain_proposals (expires_at) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_td_pending      ON tenant_domains (tenant_id, last_checked_at NULLS FIRST) WHERE deleted_at IS NULL AND verification_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_td_tenant_list  ON tenant_domains (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
