-- ==================================================================================================================
-- 0178 · PC-56 TENANT-8d · THE BANNERS — W173 (banners), W174 (banner editor) + the banner-form (W2503–W2506),
--        banner-mutate (W2507–W2509), banners-form (W2510–W2513) and banners-mutate (W2514–W2516) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- ==================================================================================================================
--
-- W173: *"What members see in their app: per placement × language × audience. A banner without a Gujarati variant simply
--        doesn't show to Gujarati-first members — no English fallback surprises."* · *"Text lives in the banner record,
--        never baked into the image (i18n law)."* · *"live/scheduled/ended are derived from the window + is_active — no
--        status column exists"*.
-- W174: *"Language variants (language_code per row)"* · *"Headline (lives in record, not image)"* · *"Audience
--        (audience_rules jsonb)"* · *"Window & link"* · *"Publishing is recorded"* · Pause.
--
-- WHAT THE WAVE IS DECLARED AS (TENANT-8's survey, §4 row 8d; §3 F-7 / F-8 / F-14 / F-16 / F-21):
--   "banners has no text column so the canon's i18n law is unsatisfiable, cannot be edited after create, pauses without
--    an audit row, no variant grouping, no audience evaluator, no impressions, no reader."
--   F-7  · `setActive` wrote no audit row and took no reason (the module fixes the act; this file gives pause its reason).
--   F-8  · `media_id REFERENCES media_assets(id)` — an FK check is not subject to RLS, and the service never read the
--          media row: a banner could point at ANOTHER TENANT'S image, or at an image the scanner never cleared.
--   F-16 · `placement` was a free varchar(40) whose vocabulary was a SQL comment (0012:210: 'home_hero','category_top',
--          'wallet'); `audience_rules` a free jsonb nothing validated or read.
--   F-21 · `runBannerExpiry` (cms/jobs/banner-schedule.job.ts) was registered nowhere. DECIDED in the module: the job is
--          DELETED and the window stays a read-time fact (see "THE WINDOW" below) — nothing in this file depends on it.
--
-- WHAT THIS FILE BUILDS.
--   178.1  The wall on `banners`: the ALL policy `tenant_id IS NULL OR …` (the 0175 shape — dead here, `tenant_id` is
--          NOT NULL, but a policy with no WITH CHECK is still the wrong policy) is replaced by `bn_tenant` (USING + WITH
--          CHECK `tenant_id = current_tenant_id()`) and `bn_admin_realm` (TO kv_admin, named). kv_app: REVOKE, then
--          column-limited INSERT / UPDATE (never `tenant_id`, `created_by`, `deleted_at`, the legacy `language_code` /
--          `audience_rules`); no DELETE — a banner is archived, never erased. kv_relay loses INSERT/UPDATE/DELETE: the
--          dead expiry job was its only writer (grep in the 8d report).
--   178.2  The record: `state` (draft · active · paused · archived — Law 5; the canon's *"no status column exists"* is
--          true of the canon's schema, and is why a pause could not say why), `banner_group_key` (variants), `slot_order`
--          (the order inside a placement), `audience` (a DECLARED rule, validated), the activation, pause and archive
--          facts (who · when · why), `last_edited_by`. `is_active` is re-made a GENERATED column `(state = 'active')`
--          so nothing that reads it can disagree with the state.
--   178.3  `banner_texts` — ONE ROW PER LANGUAGE (headline · body · CTA label). Law 3/7: the words live in the record,
--          never in the image. en · hi · gu are REQUIRED before a banner is activated (`banner_required_languages()`),
--          by the review first and by `banner_activation_refusals()` — the same function the activate act calls and
--          the trigger re-takes — and an ACTIVE banner can never lose one of them (a deferred constraint trigger).
--   178.4  `placement` from a vocabulary (`cms_banner_placement`, Law 6). Widened to the vocabulary's own width FIRST
--          (varchar(40) → varchar(80) = lookup_values.code); every value already written that the platform vocabulary
--          does not hold is carried into the vocabulary as the TENANT's own legacy row (`chosen: false` — printed, never
--          offered), so no row is orphaned and no free word is re-admitted.
--   178.5  F-8: `banner_media_issue()` — a banner's image must be the SAME tenant's, an image, and `scan_status =
--          'clean'`. Checked on insert, on a media change, and again on every activation (an image the scanner later
--          marks infected cannot be resumed onto a member's screen).
--   178.6  `banners_guard` (trigger): born a draft by the member writing it; tenant / author never move; the state
--          machine; an activation re-takes the activation refusals; a pause and an archive say why; archived is final;
--          the placement in the vocabulary; the audience valid against the `roles` and `admin_regions` registries; the
--          target link https only.
--
-- THE VARIANT GROUP IS A GROUPING FACT. `banner_group_key` says "these banners are one campaign in one slot — e.g. the gu
-- image and the en image of the Kharif seeds banner". NOTHING ALLOCATES BETWEEN THEM: there is no A/B split, no
-- exposure count, no winner (DELTA-029's class — the same refusal 8a made for W182). The console prints the group; the
-- reader that does not exist would serve each banner by its own audience and window.
--
-- THE AUDIENCE IS A DECLARED RULE, NOT A QUERY. `{"roles": [role codes], "regions": [admin_regions ids]}` — empty lists
-- mean "every member". Roles must be TENANT-scope, active rows of `roles`; regions active rows of `admin_regions` in the
-- tenant's country (any level: state · district · taluka · village). A member matches when they hold one of the roles
-- (or the list is empty) AND one of their addresses lies in or under one of the regions (or the list is empty). The
-- evaluator is a pure function in the module (`domain/banner-audience.ts`) with its tests; the DB validates the
-- declaration, never evaluates it. NOT declarable, refused by name in the console: `min_orders` (the legacy jsonb's key —
-- no order count is a member fact this module may read), KYC state, "clusters" (no cluster registry exists).
--
-- IMPRESSIONS ARE NOT BUILT. There is no reader (no storefront or mobile code fetches `cms/banners` — grep in the 8d
-- report), so there is nothing to count an impression of, and no counter table is created here. `click_count` stays as
-- it was (atomic `+1`, the route now counts only a banner that is live).
--
-- THE WINDOW. `[starts_at, ends_at)` is stored as instants; the console types wall-clock date + time and the module
-- resolves them `AT TIME ZONE` the tenant's zone (`tenants.country_code → countries.timezone`, 6c-1 / 7c). Whether a
-- banner is scheduled · live · ended is computed at READ time from `state = 'active'` and the window — exact to the
-- instant, with no job lag and no second copy of the truth (F-21's decision).
--
-- RLS DECISION.
--   • `banners`: ENABLE + FORCE (restated); `tenant_isolation_banners` DROPPED; `bn_tenant` FOR ALL (USING + WITH CHECK
--     `tenant_id = current_tenant_id()`); `bn_admin_realm` FOR ALL TO kv_admin (named; live `rolbypassrls` for kv_admin is
--     `f`, 0175's reasoning). No DELETE grant in the tenant realm.
--   • `banner_texts`: tenant-scoped (`tenant_id NOT NULL`, the parent's — a trigger says so), ENABLE + FORCE, `bt_tenant`
--     FOR ALL (USING + WITH CHECK), `bt_admin_realm` TO kv_admin. kv_app: REVOKE ALL, then SELECT · column INSERT (never
--     born deleted, never back-dated) · column UPDATE (the words) · DELETE (a draft's language removed — the words are not history; the audit row of the act records the
--     words before and after). kv_relay: REVOKE ALL.
--   • `lookup_values`: untouched (one of the 35 tables 0175 named for a sweep of their own). The placement vocabulary is
--     written by this migration as the owner.
--
-- PARTITION NOTE. Neither table is partitioned, nor should be: a cooperative runs tens of banners a season (W173's canon
-- shows 11), each with ≤ a dozen language rows. Every read is by (tenant_id[, placement]) on the indexes below or by
-- (banner_id[, language_code]) on the UNIQUE.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 178.1 · THE WALL ON banners
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE banners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_banners ON banners;
CREATE POLICY bn_tenant ON banners
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY bn_admin_realm ON banners
  FOR ALL TO kv_admin
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 178.4 · THE PLACEMENT VOCABULARY (Law 6) — widen before the check; carry every written value into the vocabulary
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE banners ALTER COLUMN placement TYPE varchar(80);

INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('cms_banner_placement', 'Where in the member app a banner is placed', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('cms_banner_placement', 'home_hero',    'Home screen — the top banner',          '{"chosen":true}', 1),
    ('cms_banner_placement', 'category_top', 'Top of a category list',                '{"chosen":true}', 2),
    ('cms_banner_placement', 'wallet',       'Wallet screen',                          '{"chosen":true}', 3)
  ) AS v(type_code, code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values l
                    WHERE l.type_code = v.type_code AND l.tenant_id IS NULL AND l.code = v.code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_cms_placement_platform
  ON lookup_values (code) WHERE type_code = 'cms_banner_placement' AND tenant_id IS NULL;

-- A value a cooperative already wrote that the platform does not hold becomes THAT cooperative's legacy row: printed
-- with its own words, never offered for a new banner (`chosen: false`), never a platform value.
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT DISTINCT 'cms_banner_placement', b.tenant_id, b.placement, b.placement, '{"chosen":false,"legacy":true,"since":"0178"}'::jsonb, 90
  FROM banners b
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values l WHERE l.type_code = 'cms_banner_placement' AND l.tenant_id IS NULL AND l.code = b.placement)
   AND NOT EXISTS (SELECT 1 FROM lookup_values l WHERE l.type_code = 'cms_banner_placement' AND l.tenant_id = b.tenant_id AND l.code = b.placement);

-- ------------------------------------------------------------------------------------------------------------------
-- 178.2 · THE RECORD
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE banners
  ADD COLUMN state             varchar(12) NOT NULL DEFAULT 'draft',
  ADD COLUMN audience          jsonb NOT NULL DEFAULT '{"roles":[],"regions":[]}'::jsonb,
  ADD COLUMN banner_group_key  varchar(60),
  ADD COLUMN slot_order        integer NOT NULL DEFAULT 0,
  ADD COLUMN activated_at      timestamptz,
  ADD COLUMN activated_by      uuid REFERENCES users(id),
  ADD COLUMN paused_at         timestamptz,
  ADD COLUMN paused_by         uuid REFERENCES users(id),
  ADD COLUMN paused_reason     varchar(300),
  ADD COLUMN archived_at       timestamptz,
  ADD COLUMN archived_by       uuid REFERENCES users(id),
  ADD COLUMN archived_reason   varchar(300),
  ADD COLUMN last_edited_by    uuid REFERENCES users(id);

COMMENT ON COLUMN banners.state IS
  'PC-56 TENANT-8d (Law 5). draft → active | archived; active → paused | archived; paused → active | archived; archived is final. Whether an ACTIVE banner is scheduled, live or ended is the window at read time (no job writes it — F-21 decided).';
COMMENT ON COLUMN banners.audience IS
  'PC-56 TENANT-8d. A DECLARED rule: {"roles":[tenant-scope role codes],"regions":[admin_regions ids]} — empty = every member. Validated against the registries by banners_guard; evaluated by domain/banner-audience.ts (pure). min_orders / KYC / clusters are not declarable (no member fact, no registry).';
COMMENT ON COLUMN banners.audience_rules IS
  'LEGACY (0012). The free jsonb written before 0178; kept as written, read by nothing, writable by nobody in the tenant realm. The declared rule is banners.audience.';
COMMENT ON COLUMN banners.language_code IS
  'LEGACY (0012). One language per banner, before the words had a home. Superseded by banner_texts (one row per language); NULL on every banner written after 0178; writable by nobody in the tenant realm.';
COMMENT ON COLUMN banners.banner_group_key IS
  'PC-56 TENANT-8d. Variants of one campaign in one slot (e.g. the gu image and the en image). A GROUPING FACT: nothing allocates exposure between them — no A/B engine exists (DELTA-029''s class).';
COMMENT ON COLUMN banners.slot_order IS
  'PC-56 TENANT-8d. The banner''s place inside its placement (1 = first). Written by the reorder act (keyed, audited, the placement locked) or last-in-slot on create / placement change.';
COMMENT ON COLUMN banners.paused_reason IS
  'PC-56 TENANT-8d (F-7). Why the banner was last paused — the sentence the member typed (kept after a resume as the last pause''s fact; the audit trail holds every pause).';

-- Backfill BEFORE the checks. No banner written before this file can satisfy the activation law (banner_texts did not
-- exist — every one of them has no words in any language), so none stays active: each is PAUSED and told why, never
-- given guessed words. Their legacy audience keeps only what the registries can vouch for.
UPDATE banners SET state = 'paused', paused_at = COALESCE(updated_at, now()),
       paused_reason = CASE WHEN is_active THEN 'Paused by migration 0178: written before banners kept their words (no headline in any language)'
                            ELSE 'Deactivated before migration 0178 kept a reason' END
 WHERE state = 'draft';
UPDATE banners b SET audience = jsonb_build_object(
         'roles', COALESCE((SELECT jsonb_agg(DISTINCT r.code) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.audience_rules->'roles') = 'array' THEN b.audience_rules->'roles' ELSE '[]'::jsonb END) x(code)
                             JOIN roles r ON r.code = x.code AND r.scope = 'tenant' AND r.is_active AND r.deleted_at IS NULL), '[]'::jsonb),
         'regions', '[]'::jsonb);
UPDATE banners b SET slot_order = s.n
  FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id, placement ORDER BY created_at, id) AS n FROM banners) s
 WHERE s.id = b.id;
UPDATE banners SET last_edited_by = created_by WHERE last_edited_by IS NULL;

-- `is_active` IS the state now (the index that read it goes with it and comes back on the state).
DROP INDEX IF EXISTS idx_banners_active;
ALTER TABLE banners DROP COLUMN is_active;
ALTER TABLE banners ADD COLUMN is_active boolean GENERATED ALWAYS AS (state = 'active') STORED;
COMMENT ON COLUMN banners.is_active IS 'PC-56 TENANT-8d. GENERATED (state = ''active'') — kept so nothing that reads it can disagree with the state.';

ALTER TABLE banners
  ADD CONSTRAINT ck_banners_state CHECK (state IN ('draft', 'active', 'paused', 'archived')),
  ADD CONSTRAINT ck_banners_window CHECK (ends_at > starts_at),
  ADD CONSTRAINT ck_banners_active_was_activated CHECK (state <> 'active' OR activated_at IS NOT NULL),
  ADD CONSTRAINT ck_banners_paused_says_why CHECK (state <> 'paused' OR (paused_reason IS NOT NULL AND paused_at IS NOT NULL)),
  ADD CONSTRAINT ck_banners_archived_says_why CHECK (state <> 'archived' OR (archived_reason IS NOT NULL AND archived_at IS NOT NULL)),
  ADD CONSTRAINT ck_banners_archive_only_archived CHECK (archived_at IS NULL OR state = 'archived'),
  ADD CONSTRAINT ck_banners_group_key CHECK (banner_group_key IS NULL OR banner_group_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT ck_banners_slot_order CHECK (slot_order >= 0),
  ADD CONSTRAINT ck_banners_click_count CHECK (click_count >= 0),
  ADD CONSTRAINT ck_banners_audience_object CHECK (jsonb_typeof(audience) = 'object');

CREATE INDEX idx_banners_slot ON banners (tenant_id, placement, slot_order, id) WHERE deleted_at IS NULL AND state <> 'archived';
CREATE INDEX idx_banners_live ON banners (tenant_id, placement, starts_at, ends_at) WHERE deleted_at IS NULL AND state = 'active';
CREATE INDEX idx_banners_group ON banners (tenant_id, banner_group_key) WHERE banner_group_key IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_banners_list ON banners (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 178.3 · THE WORDS — banner_texts
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE banner_texts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  banner_id     uuid NOT NULL REFERENCES banners(id),
  language_code varchar(8) NOT NULL REFERENCES languages(code),
  headline      varchar(120) NOT NULL,
  body          varchar(300),
  cta_label     varchar(40),
  UNIQUE (banner_id, language_code),
  CONSTRAINT ck_banner_texts_headline CHECK (length(btrim(headline)) > 0),
  CONSTRAINT ck_banner_texts_plain CHECK (headline !~ '[<>]' AND COALESCE(body, '') !~ '[<>]' AND COALESCE(cta_label, '') !~ '[<>]'),
  CONSTRAINT ck_banner_texts_body CHECK (body IS NULL OR length(btrim(body)) > 0),
  CONSTRAINT ck_banner_texts_cta CHECK (cta_label IS NULL OR length(btrim(cta_label)) > 0)
);
CALL add_std_columns('banner_texts');
CREATE INDEX idx_banner_texts_tenant ON banner_texts (tenant_id, banner_id);
COMMENT ON TABLE banner_texts IS
  'PC-56 TENANT-8d (Law 7). A banner''s words, one row per language — the headline, an optional line of body and the CTA label. The image carries no words. en · hi · gu are required before activation (banner_required_languages()).';

ALTER TABLE banner_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE banner_texts FORCE ROW LEVEL SECURITY;
CREATE POLICY bt_tenant ON banner_texts
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY bt_admin_realm ON banner_texts
  FOR ALL TO kv_admin
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 178.5 · THE CHECK FUNCTIONS (one source: the review asks them, the acts call them, the triggers re-take them)
-- ------------------------------------------------------------------------------------------------------------------
-- The languages a banner must speak before it reaches a member. The module's REQUIRED_LANGUAGES is the same list (a
-- console spec reads this line).
CREATE OR REPLACE FUNCTION banner_required_languages() RETURNS varchar[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['en', 'hi', 'gu']::varchar[] $$;

-- F-8. NULL = the image may be used. Runs with the CALLER's rights, so from the tenant realm another tenant's image is
-- simply not there (RLS) — `MEDIA_NOT_YOURS` either way, never an oracle for another tenant's ids; run as the owner it
-- still refuses on the explicit tenant comparison. A platform image (tenant_id NULL) is not the tenant's either.
CREATE OR REPLACE FUNCTION banner_media_issue(p_tenant uuid, p_media uuid) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE m record;
BEGIN
  SELECT tenant_id, kind, scan_status INTO m FROM media_assets WHERE id = p_media AND deleted_at IS NULL;
  IF NOT FOUND OR m.tenant_id IS NULL OR m.tenant_id <> p_tenant THEN RETURN 'MEDIA_NOT_YOURS'; END IF;
  IF m.kind <> 'image' THEN RETURN 'MEDIA_NOT_IMAGE'; END IF;
  IF m.scan_status <> 'clean' THEN RETURN 'MEDIA_NOT_CLEAN'; END IF;
  RETURN NULL;
END $$;

-- The declared audience against the registries. Empty array = valid.
CREATE OR REPLACE FUNCTION banner_audience_issues(p_tenant uuid, p_audience jsonb) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE out text[] := '{}'; k text; roles jsonb; regions jsonb; x text; country char(2);
BEGIN
  IF jsonb_typeof(p_audience) <> 'object' THEN RETURN ARRAY['AUDIENCE_SHAPE']; END IF;
  FOR k IN SELECT jsonb_object_keys(p_audience) LOOP
    IF k NOT IN ('roles', 'regions') THEN out := out || ('AUDIENCE_KEY:' || k); END IF;
  END LOOP;
  roles := COALESCE(p_audience->'roles', '[]'::jsonb);
  regions := COALESCE(p_audience->'regions', '[]'::jsonb);
  IF jsonb_typeof(roles) <> 'array' OR jsonb_typeof(regions) <> 'array' THEN RETURN out || ARRAY['AUDIENCE_SHAPE']; END IF;
  IF jsonb_array_length(roles) > 20 OR jsonb_array_length(regions) > 20 THEN out := out || ARRAY['AUDIENCE_TOO_MANY']; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(roles) e WHERE jsonb_typeof(e) <> 'string')
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(regions) e WHERE jsonb_typeof(e) <> 'string') THEN
    RETURN out || ARRAY['AUDIENCE_SHAPE'];
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements_text(roles)) <> (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(roles) v)
     OR (SELECT count(*) FROM jsonb_array_elements_text(regions)) <> (SELECT count(DISTINCT v) FROM jsonb_array_elements_text(regions) v) THEN
    out := out || ARRAY['AUDIENCE_DUPLICATE'];
  END IF;
  FOR x IN SELECT jsonb_array_elements_text(roles) LOOP
    IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = x AND r.scope = 'tenant' AND r.is_active AND r.deleted_at IS NULL) THEN
      out := out || ('ROLE_UNKNOWN:' || x);
    END IF;
  END LOOP;
  SELECT t.country_code INTO country FROM tenants t WHERE t.id = p_tenant;
  FOR x IN SELECT jsonb_array_elements_text(regions) LOOP
    IF x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (SELECT 1 FROM admin_regions g WHERE g.id = x::uuid AND g.is_active AND g.deleted_at IS NULL AND g.country_code = country) THEN
      out := out || ('REGION_UNKNOWN:' || x);
    END IF;
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION banner_placement_known(p_tenant uuid, p_code varchar) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM lookup_values
                  WHERE type_code = 'cms_banner_placement' AND (tenant_id IS NULL OR tenant_id = p_tenant)
                    AND code = p_code AND is_active AND deleted_at IS NULL)
$$;

-- What stands between this banner and a member's screen. Empty array = it may be activated (or resumed). The activate
-- and resume acts call this inside their transaction; banners_guard re-takes it on every move to `active`.
CREATE OR REPLACE FUNCTION banner_activation_refusals(p_banner uuid) RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE b record; out text[] := '{}'; l varchar; mi text;
BEGIN
  SELECT id, tenant_id, media_id, ends_at, audience INTO b FROM banners WHERE id = p_banner AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN ARRAY['BANNER_NOT_FOUND']; END IF;
  FOREACH l IN ARRAY banner_required_languages() LOOP
    IF NOT EXISTS (SELECT 1 FROM banner_texts t WHERE t.banner_id = p_banner AND t.language_code = l AND t.deleted_at IS NULL) THEN
      out := out || ('TEXT_MISSING:' || l);
    END IF;
  END LOOP;
  mi := banner_media_issue(b.tenant_id, b.media_id);
  IF mi IS NOT NULL THEN out := out || mi; END IF;
  IF b.ends_at <= now() THEN out := out || ARRAY['WINDOW_ENDED']; END IF;
  IF cardinality(banner_audience_issues(b.tenant_id, b.audience)) > 0 THEN out := out || ARRAY['AUDIENCE_INVALID']; END IF;
  RETURN out;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 178.6 · THE GUARDS
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION banners_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := current_user_id(); issues text[]; mi text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'draft' OR NEW.activated_at IS NOT NULL OR NEW.paused_at IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'a banner is born a draft' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'a banner names its author' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.created_by <> me THEN
      RAISE EXCEPTION 'a banner''s author is the member writing it' USING ERRCODE = 'check_violation';
    END IF;
    NEW.last_edited_by := COALESCE(NEW.last_edited_by, NEW.created_by);
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'a banner''s tenant and author never move (banner %)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.state = 'archived' THEN
      RAISE EXCEPTION 'banner % is archived: an archived banner is final', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    -- The state machine (domain/banner.state.ts is the same table).
    IF NEW.state <> OLD.state THEN
      IF NOT ((OLD.state = 'draft' AND NEW.state IN ('active', 'archived'))
           OR (OLD.state = 'active' AND NEW.state IN ('paused', 'archived'))
           OR (OLD.state = 'paused' AND NEW.state IN ('active', 'archived'))) THEN
        RAISE EXCEPTION 'banner %: % → % is not a banner transition', OLD.id, OLD.state, NEW.state USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.state = 'active' THEN
        IF NEW.activated_at IS NULL OR NEW.activated_by IS NULL THEN
          RAISE EXCEPTION 'banner %: an activation names who and when', OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF me IS NOT NULL AND NEW.activated_by <> me THEN
          RAISE EXCEPTION 'banner %: the activator is the member activating it', OLD.id USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.state = 'paused' THEN
        IF NEW.paused_reason IS NULL OR length(btrim(NEW.paused_reason)) < 3 OR NEW.paused_at IS NULL OR NEW.paused_by IS NULL THEN
          RAISE EXCEPTION 'banner %: a pause says who, when and why', OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF me IS NOT NULL AND NEW.paused_by <> me THEN
          RAISE EXCEPTION 'banner %: the member pausing it is the one named', OLD.id USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.state = 'archived' AND (NEW.archived_reason IS NULL OR length(btrim(NEW.archived_reason)) < 3 OR NEW.archived_at IS NULL OR NEW.archived_by IS NULL) THEN
        RAISE EXCEPTION 'banner %: an archive says who, when and why', OLD.id USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.activated_at IS DISTINCT FROM OLD.activated_at OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
       OR NEW.paused_at IS DISTINCT FROM OLD.paused_at OR NEW.paused_by IS DISTINCT FROM OLD.paused_by OR NEW.paused_reason IS DISTINCT FROM OLD.paused_reason
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by OR NEW.archived_reason IS DISTINCT FROM OLD.archived_reason THEN
      RAISE EXCEPTION 'banner %: the activation, pause and archive facts change only with the state', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    -- A change of what the banner IS names its editor.
    IF me IS NOT NULL AND (NEW.placement IS DISTINCT FROM OLD.placement OR NEW.media_id IS DISTINCT FROM OLD.media_id OR NEW.target_url IS DISTINCT FROM OLD.target_url
       OR NEW.audience IS DISTINCT FROM OLD.audience OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
       OR NEW.banner_group_key IS DISTINCT FROM OLD.banner_group_key) THEN
      NEW.last_edited_by := me;
    END IF;
  END IF;

  -- Law 6: the placement, on every write that sets it.
  IF (TG_OP = 'INSERT' OR NEW.placement IS DISTINCT FROM OLD.placement) AND NOT banner_placement_known(NEW.tenant_id, NEW.placement) THEN
    RAISE EXCEPTION 'banners.placement % is not in the cms_banner_placement vocabulary', NEW.placement USING ERRCODE = 'check_violation';
  END IF;
  -- The declared audience, against the registries.
  IF TG_OP = 'INSERT' OR NEW.audience IS DISTINCT FROM OLD.audience THEN
    issues := banner_audience_issues(NEW.tenant_id, NEW.audience);
    IF cardinality(issues) > 0 THEN
      RAISE EXCEPTION 'banner audience refused: %', array_to_string(issues, ', ') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- F-8: the image is the tenant's own, an image, and clean — on insert, on a change, and on every activation.
  IF TG_OP = 'INSERT' OR NEW.media_id IS DISTINCT FROM OLD.media_id OR (NEW.state = 'active' AND OLD.state IS DISTINCT FROM 'active') THEN
    mi := banner_media_issue(NEW.tenant_id, NEW.media_id);
    IF mi IS NOT NULL THEN
      RAISE EXCEPTION 'banner media refused: %', mi USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.target_url IS DISTINCT FROM OLD.target_url) AND NEW.target_url IS NOT NULL
     AND (NEW.target_url !~ '^https://[^\s/?#]+[^\s]*$' OR length(NEW.target_url) > 400) THEN
    RAISE EXCEPTION 'banners.target_url is an https link' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_banners_guard
  BEFORE INSERT OR UPDATE ON banners
  FOR EACH ROW EXECUTE FUNCTION banners_guard();

-- The activation law, AFTER the row is written (so the words the same transaction wrote are counted) and DEFERRED to the
-- commit (so an edit that rewrites the words of an ACTIVE banner can delete-then-insert a language inside one act).
CREATE OR REPLACE FUNCTION banners_activation_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r text[];
BEGIN
  IF NEW.state = 'active' AND NEW.deleted_at IS NULL THEN
    r := banner_activation_refusals(NEW.id);
    -- WINDOW_ENDED stops an activation, not an edit of a banner that has simply run its course.
    IF TG_OP = 'UPDATE' AND OLD.state = 'active' THEN r := array_remove(r, 'WINDOW_ENDED'); END IF;
    IF cardinality(r) > 0 THEN
      RAISE EXCEPTION 'banner % cannot be active: %', NEW.id, array_to_string(r, ', ') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_banners_activation_check
  AFTER INSERT OR UPDATE ON banners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION banners_activation_check();

CREATE OR REPLACE FUNCTION banner_texts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent record;
BEGIN
  SELECT tenant_id, state INTO parent FROM banners WHERE id = COALESCE(NEW.banner_id, OLD.banner_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'banner_texts: no such banner' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent.state = 'archived' THEN
    RAISE EXCEPTION 'banner_texts: the banner is archived — its words are final' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.tenant_id IS DISTINCT FROM parent.tenant_id THEN
    RAISE EXCEPTION 'banner_texts.tenant_id is its banner''s' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.banner_id <> OLD.banner_id OR NEW.language_code <> OLD.language_code) THEN
    RAISE EXCEPTION 'banner_texts: a row''s banner and language never move' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_banner_texts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON banner_texts
  FOR EACH ROW EXECUTE FUNCTION banner_texts_guard();

-- An ACTIVE banner never loses a required language, whatever writes the words.
CREATE OR REPLACE FUNCTION banner_texts_complete_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE b record; l varchar;
BEGIN
  SELECT id, state INTO b FROM banners WHERE id = COALESCE(NEW.banner_id, OLD.banner_id) AND deleted_at IS NULL;
  IF FOUND AND b.state = 'active' THEN
    FOREACH l IN ARRAY banner_required_languages() LOOP
      IF NOT EXISTS (SELECT 1 FROM banner_texts t WHERE t.banner_id = b.id AND t.language_code = l AND t.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'banner % is active and would lose its % words', b.id, l USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_banner_texts_complete
  AFTER INSERT OR UPDATE OR DELETE ON banner_texts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION banner_texts_complete_check();

-- ------------------------------------------------------------------------------------------------------------------
-- 178.1 (cont.) · THE GRANTS — REVOKE before the narrow GRANT (a table-level REVOKE also revokes every column grant)
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON banners FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON banners FROM kv_relay;
GRANT SELECT ON banners TO kv_app;
GRANT INSERT (id, tenant_id, placement, media_id, target_url, audience, starts_at, ends_at, banner_group_key, slot_order, state,
              created_by, updated_by, last_edited_by)
  ON banners TO kv_app;
GRANT UPDATE (placement, media_id, target_url, audience, starts_at, ends_at, banner_group_key, slot_order, state,
              activated_at, activated_by, paused_at, paused_by, paused_reason, archived_at, archived_by, archived_reason,
              click_count, last_edited_by, updated_at, updated_by)
  ON banners TO kv_app;

REVOKE ALL ON banner_texts FROM kv_app;
REVOKE ALL ON banner_texts FROM kv_relay;
GRANT SELECT, DELETE ON banner_texts TO kv_app;
GRANT INSERT (id, tenant_id, banner_id, language_code, headline, body, cta_label, created_by, updated_by) ON banner_texts TO kv_app;
GRANT UPDATE (headline, body, cta_label, updated_at, updated_by) ON banner_texts TO kv_app;
GRANT SELECT ON banner_texts TO kv_readonly;
