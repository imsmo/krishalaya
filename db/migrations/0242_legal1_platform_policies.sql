-- ==================================================================================================================
-- MIGRATION 0242 — PC-56 LEGAL-1 · THE FOUR PLATFORM POLICY PAGES (terms · privacy · refunds · shipping)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0001–0241 are applied; nothing here edits them: `reserved_tenant_slugs` gains
-- FOUR rows by INSERT (the 0205 / 0207 / 0212 / 0219 / 0220 precedent), `cms_pages` gains three columns, two CHECKs, one index and one more
-- trigger, `translations` one trigger, and one SECURITY DEFINER read is created.)
-- NOT MONEY: no ledger table, no posting, no money column is read or written.
-- ==================================================================================================================
--
-- WHY. Launch blocker: the public storefront had NO Terms, Privacy, Refund or Shipping page. Razorpay live activation requires all four on
-- the site, and the DPDP Act 2023 requires a privacy notice. `cms_pages` (0012 + 0177) could hold them — `tenant_id NULL` = a platform page,
-- `page_kind = 'policy'`, versioned per (slug, version) — but (survey, apps/web-storefront/src/app/(platform)/blog/page.tsx) there was NO
-- anonymous published-only read and NOTHING wrote a platform page.
--
-- WHAT 0177 LEFT OPEN FOR PLATFORM ROWS (read 0177.6 closely): `cms_pages_guard` RETURNS EARLY for `tenant_id IS NULL` — after the two
-- vocabulary checks, nothing else holds for a platform row: no born-a-draft, no words-immutable-after-draft, no state machine, no markdown
-- rule and NO MAKER ≠ CHECKER. And its maker/checker columns cannot carry the admin realm's people: `published_by`, `archived_by`,
-- `last_edited_by` REFERENCE users(id), and a platform operator is NOT a users row (0118's governing decision: `platform_operators` has no
-- FK into users; 0103 / 0105 / 0107 keep admin identities as opaque uuids). So:
--
--   242.1  reserved_tenant_slugs + `terms`, `privacy`, `refunds`, `shipping` — the storefront routes `/terms` … (platform root) must not be
--          takeable by an organisation (Next's static segment would win over `/[tenantSlug]`). apps/api's signup.ts RESERVED_TENANT_SLUGS
--          mirrors it (store1b-reserved-slugs.spec.ts reads this file).
--   242.2  cms_pages: the ADMIN-REALM maker / checker columns for PLATFORM rows — `last_edited_by_admin_id`, `published_by_admin_id`,
--          `archived_by_admin_id` (opaque uuids, no FK — 0103's reasoning). The author of a platform version is `created_by` (add_std_columns,
--          no FK). Two CHECKs: the admin columns are platform-only; a PLATFORM POLICY page's publisher is neither its author nor its last
--          editor (the platform's maker≠checker constraint idiom, with the NULL escape on the publisher only — the "no named maker" case is
--          refused by the trigger, which can say why).
--   242.3  ONE open draft per platform slug (0177 built it for tenant rows only).
--   242.4  `cms_pages_platform_guard` — 0177's guard, for PLATFORM rows: born a draft with a language; slug / version / tenant / author never
--          move; the words are immutable once a version leaves draft; the state machine (draft → published | archived, published →
--          archived); a publish names its publisher (admin) and time; **a POLICY publish needs a NAMED maker** (`created_by` or
--          `last_edited_by_admin_id` — a seeded draft nobody has adopted cannot be published by one person alone) **and a publisher who is
--          neither** (23514, `[CMS_PLATFORM_MAKER_UNNAMED]` / `[CMS_PLATFORM_MAKER_IS_CHECKER]` — the admin-api maps both to typed 409s); an
--          archive names who and why; the body is markdown (0177's `cms_body_is_markdown`); a version that left draft is never DELETEd.
--   242.5  `translations` rows for a page (`entity_type = 'cms_page'`, entity_id = the VERSION id, field `title` | `body`) follow the
--          version's words: written only while that version is a draft, a body translation is markdown. "What did the policy say when I
--          ordered?" must have one answer per language too — a Hindi body added after publish would be a new text with an old version number.
--          (The hi / gu bodies therefore arrive as a NEW version's translations, through the admin screen.)
--   242.6  `public_policy_page(p_tenant, p_slug, p_language)` — THE ANONYMOUS READ (SECURITY DEFINER, `SET search_path = public`, REVOKE ALL
--          FROM PUBLIC, EXECUTE to kv_app only — 0204's pattern). Serves ONLY `page_kind = 'policy'` AND `status = 'published'` rows of the
--          four allow-listed slugs: the context tenant's own published version when it has one (F-14: the tenant row wins regardless of
--          version), else the platform's. The body/title in the requested language from `translations` when a REVIEWED, live translation of
--          the body exists (0103: a machine translation with no review never reaches a public surface; a soft-deleted one is not served),
--          else the version's own words with `fallback_language` = the language they are written in. No row = not published (the API
--          answers 404 POLICY_NOT_PUBLISHED and the storefront says so honestly — never placeholder legal text).
--
-- NO FLAG ROW — 0223's NAMED LAW 10 EXCEPTION: the information and legal pages get no switch (a privacy notice and a refund policy must not
-- have a kill-switch, exactly as a grievance address must not). The authoring plane (apps/admin-api `platform-pages`) is gated by owner
-- permissions (`platform.pages.read` / `.manage` / `.publish`), not a flag.
--
-- THE DRAFTS. The four first drafts live as markdown in docs/legal/{terms,privacy,refunds,shipping}.md and reach `cms_pages` through seed
-- core/0030_platform_legal_drafts.sql, GENERATED by db/scripts/gen-legal-drafts-seed.js (never hand-edited; a db:test fails when the seed
-- and the markdown drift). They are loaded as `draft` — NOT published: the founder publishes after legal review, via the admin screen,
-- with a second operator.
--
-- RLS DECISION. No new table. `cms_pages` keeps 0177's policies (cp_read · cp_insert_own · cp_update_own · cp_admin_realm) and kv_app's
-- column grants — the three new columns are NOT granted to kv_app (the tenant realm can never stamp an admin maker or checker). The definer
-- read adds no grant on any table. `translations` keeps 0103's grants (kv_app SELECT; kv_admin writes).
-- Partition pass: neither touched table is partitioned (0177's partition note).
--
-- REVERSAL (hand-run, never by the runner; remove the API route and the admin module first — they name the function and the columns):
--   DROP FUNCTION public_policy_page(uuid, varchar, varchar);
--   DROP TRIGGER trg_translations_cms_page_guard ON translations; DROP FUNCTION translations_cms_page_guard();
--   DROP FUNCTION cms_page_translation_check(uuid, varchar, varchar, text);
--   DROP TRIGGER trg_cms_pages_platform_guard ON cms_pages; DROP FUNCTION cms_pages_platform_guard();
--   DROP INDEX uq_cms_pages_one_draft_platform;
--   ALTER TABLE cms_pages DROP CONSTRAINT ck_cms_pages_platform_maker_ne_checker, DROP CONSTRAINT ck_cms_pages_admin_cols_platform_only,
--     DROP COLUMN last_edited_by_admin_id, DROP COLUMN published_by_admin_id, DROP COLUMN archived_by_admin_id;
--   DELETE FROM reserved_tenant_slugs WHERE slug IN ('terms', 'privacy', 'refunds', 'shipping');
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 242.1 · THE FOUR ROUTES ARE NOT ORGANISATION ADDRESSES
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO reserved_tenant_slugs (slug, reason) VALUES
  ('terms', 'storefront legal route (LEGAL-1)'), ('privacy', 'storefront legal route (LEGAL-1)'),
  ('refunds', 'storefront legal route (LEGAL-1)'), ('shipping', 'storefront legal route (LEGAL-1)')
ON CONFLICT (slug) DO NOTHING;

-- An organisation that ALREADY holds one of the four (the trigger only refuses new writes) would shadow nothing — Next's static route wins and
-- its store becomes unreachable in path mode. Said loudly at migrate time rather than discovered by a buyer.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM tenants WHERE lower(slug) IN ('terms', 'privacy', 'refunds', 'shipping') AND deleted_at IS NULL;
  IF n > 0 THEN
    RAISE WARNING 'LEGAL-1: % organisation(s) already use a slug now reserved for the legal pages (terms/privacy/refunds/shipping) — their path-mode store is shadowed; rename them in the admin realm', n;
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 242.2 · THE ADMIN REALM'S MAKER AND CHECKER ON A PLATFORM ROW
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE cms_pages
  ADD COLUMN last_edited_by_admin_id uuid,
  ADD COLUMN published_by_admin_id   uuid,
  ADD COLUMN archived_by_admin_id    uuid;

COMMENT ON COLUMN cms_pages.last_edited_by_admin_id IS
  'PC-56 LEGAL-1 (0242). PLATFORM rows only: the platform operator (admin-realm identity — no FK, 0118/0103) who last saved this DRAFT. With created_by (the author) it is the maker a policy page''s publisher may not be. A seeded draft has neither until an operator saves it.';
COMMENT ON COLUMN cms_pages.published_by_admin_id IS
  'PC-56 LEGAL-1 (0242). PLATFORM rows only: the platform operator who published this version. For page_kind = policy never the author (created_by) nor the last editor (ck_cms_pages_platform_maker_ne_checker + cms_pages_platform_guard).';
COMMENT ON COLUMN cms_pages.archived_by_admin_id IS
  'PC-56 LEGAL-1 (0242). PLATFORM rows only: the platform operator who archived this version (the publisher of its successor when the reason is superseded).';

ALTER TABLE cms_pages
  ADD CONSTRAINT ck_cms_pages_admin_cols_platform_only CHECK (
    tenant_id IS NULL OR (last_edited_by_admin_id IS NULL AND published_by_admin_id IS NULL AND archived_by_admin_id IS NULL)),
  ADD CONSTRAINT ck_cms_pages_platform_maker_ne_checker CHECK (
    tenant_id IS NOT NULL OR page_kind <> 'policy' OR published_by_admin_id IS NULL
    OR (published_by_admin_id IS DISTINCT FROM created_by AND published_by_admin_id IS DISTINCT FROM last_edited_by_admin_id));

-- ------------------------------------------------------------------------------------------------------------------
-- 242.3 · ONE OPEN DRAFT PER PLATFORM SLUG
-- ------------------------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_cms_pages_one_draft_platform ON cms_pages (slug)
  WHERE status = 'draft' AND deleted_at IS NULL AND tenant_id IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 242.4 · THE GUARD, FOR PLATFORM ROWS
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cms_pages_platform_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tenant_id IS NULL AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'platform page % v% left draft: a version is history and is never deleted', OLD.slug, OLD.version
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.tenant_id IS NOT NULL THEN RETURN NEW; END IF;   -- tenant rows: 0177's cms_pages_guard

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.published_by_admin_id IS NOT NULL OR NEW.published_by IS NOT NULL
       OR NEW.archived_at IS NOT NULL OR NEW.archived_by_admin_id IS NOT NULL THEN
      RAISE EXCEPTION 'a platform page version is born a draft (slug %, v%)', NEW.slug, NEW.version USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.language_code IS NULL THEN
      RAISE EXCEPTION 'a platform page version says which language its body is written in (slug %)', NEW.slug USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.slug <> OLD.slug OR NEW.version <> OLD.version
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'a platform page version''s tenant, slug, version and author never move (page %)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    -- The words, and who last wrote them.
    IF NEW.default_title IS DISTINCT FROM OLD.default_title OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.page_kind IS DISTINCT FROM OLD.page_kind OR NEW.language_code IS DISTINCT FROM OLD.language_code
       OR NEW.topic IS DISTINCT FROM OLD.topic OR NEW.last_edited_by_admin_id IS DISTINCT FROM OLD.last_edited_by_admin_id THEN
      IF OLD.status <> 'draft' OR NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'the words of platform page % v% are history: only a draft is edited (publishing creates a new version)', OLD.slug, OLD.version
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT ((OLD.status = 'draft' AND NEW.status IN ('published', 'archived')) OR (OLD.status = 'published' AND NEW.status = 'archived')) THEN
        RAISE EXCEPTION 'platform page % v%: % → % is not a page transition', OLD.slug, OLD.version, OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.status = 'published' THEN
        IF NEW.published_by_admin_id IS NULL OR NEW.published_at IS NULL THEN
          RAISE EXCEPTION 'platform page % v%: a publish names its publisher and its time', OLD.slug, OLD.version USING ERRCODE = 'check_violation';
        END IF;
        -- MAKER ≠ CHECKER on a platform POLICY page: the words that bind every buyer and seller on the platform are read by a second person.
        IF NEW.page_kind = 'policy' THEN
          IF NEW.created_by IS NULL AND NEW.last_edited_by_admin_id IS NULL THEN
            RAISE EXCEPTION '[CMS_PLATFORM_MAKER_UNNAMED] platform policy page % v% has no named maker: an operator saves (adopts) the draft, then a different operator publishes it', OLD.slug, OLD.version
              USING ERRCODE = 'check_violation';
          END IF;
          IF NEW.published_by_admin_id = NEW.created_by OR NEW.published_by_admin_id = NEW.last_edited_by_admin_id THEN
            RAISE EXCEPTION '[CMS_PLATFORM_MAKER_IS_CHECKER] maker is checker: platform policy page % v% must be published by an operator who neither wrote nor last edited it', OLD.slug, OLD.version
              USING ERRCODE = 'check_violation';
          END IF;
        END IF;
      END IF;
      IF NEW.status = 'archived' AND (NEW.archived_reason IS NULL OR NEW.archived_at IS NULL OR NEW.archived_by_admin_id IS NULL) THEN
        RAISE EXCEPTION 'platform page % v%: an archive says who, why and when', OLD.slug, OLD.version USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.published_by_admin_id IS DISTINCT FROM OLD.published_by_admin_id OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.archived_reason IS DISTINCT FROM OLD.archived_reason OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by_admin_id IS DISTINCT FROM OLD.archived_by_admin_id OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
      RAISE EXCEPTION 'platform page % v%: the publish and archive facts change only with the state', OLD.slug, OLD.version
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT cms_body_is_markdown(NEW.body) THEN
    RAISE EXCEPTION 'platform page % v%: the body is markdown — raw HTML and script / data link targets are not stored', NEW.slug, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION cms_pages_platform_guard() IS
  'PC-56 LEGAL-1 (0242): 0177''s cms_pages_guard for PLATFORM rows (tenant_id NULL), which 0177 let through unchecked — born a draft, words immutable after draft, the state machine, a named maker and a different publisher on a policy page ([CMS_PLATFORM_MAKER_UNNAMED] / [CMS_PLATFORM_MAKER_IS_CHECKER], 23514), markdown only, no DELETE of history.';
CREATE TRIGGER trg_cms_pages_platform_guard
  BEFORE INSERT OR UPDATE OR DELETE ON cms_pages
  FOR EACH ROW EXECUTE FUNCTION cms_pages_platform_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 242.5 · A PAGE'S TRANSLATIONS FOLLOW ITS WORDS
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cms_page_translation_check(p_page uuid, p_field varchar, p_language varchar, p_text text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE st varchar;
BEGIN
  SELECT p.status INTO st FROM cms_pages p WHERE p.id = p_page;
  IF st IS NULL THEN
    RAISE EXCEPTION '[CMS_PAGE_TRANSLATION_ORPHAN] translation of cms_page % names no page version', p_page USING ERRCODE = 'check_violation';
  END IF;
  IF st <> 'draft' THEN
    RAISE EXCEPTION '[CMS_PAGE_TRANSLATION_FROZEN] page version % left draft: its translations are history (a new version carries new words)', p_page
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_field NOT IN ('title', 'body') THEN
    RAISE EXCEPTION 'a page translation is of its title or its body, not %', p_field USING ERRCODE = 'check_violation';
  END IF;
  IF p_field = 'body' AND NOT cms_body_is_markdown(p_text) THEN
    RAISE EXCEPTION 'page translation (%, %): the body is markdown — raw HTML and script / data link targets are not stored', p_page, p_language
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION translations_cms_page_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Both sides of an UPDATE are checked: a row may not be moved OFF a frozen page either.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.entity_type = 'cms_page' THEN
    PERFORM cms_page_translation_check(OLD.entity_id, OLD.field, OLD.language_code, OLD.text);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.entity_type = 'cms_page' THEN
    PERFORM cms_page_translation_check(NEW.entity_id, NEW.field, NEW.language_code, NEW.text);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION translations_cms_page_guard() IS
  'PC-56 LEGAL-1 (0242): translations of a page version (entity_type cms_page, entity_id = cms_pages.id, field title | body) are written only while the version is a draft; a body translation is markdown. Every other entity_type is untouched.';
CREATE TRIGGER trg_translations_cms_page_guard
  BEFORE INSERT OR UPDATE OR DELETE ON translations
  FOR EACH ROW EXECUTE FUNCTION translations_cms_page_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 242.6 · THE ANONYMOUS READ
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public_policy_page(p_tenant uuid, p_slug varchar, p_language varchar)
RETURNS TABLE (source text, slug varchar, title text, body text, language_code varchar, requested_language varchar,
               fallback_language varchar, version integer, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS (
    SELECT p.id, p.tenant_id, p.slug, p.default_title, p.body, p.language_code, p.version, p.published_at
      FROM cms_pages p
     WHERE p_slug IN ('terms', 'privacy', 'refunds', 'shipping')
       AND p.slug = p_slug
       AND p.page_kind = 'policy' AND p.status = 'published' AND p.deleted_at IS NULL
       AND (p.tenant_id IS NULL OR (p_tenant IS NOT NULL AND p.tenant_id = p_tenant))
     ORDER BY (p.tenant_id IS NULL), p.version DESC       -- the tenant's own published version wins over the platform's, whatever the version
     LIMIT 1
  ), tr AS (
    SELECT max(t.text) FILTER (WHERE t.field = 'body')  AS body_tr,
           max(t.text) FILTER (WHERE t.field = 'title') AS title_tr
      FROM page
      JOIN translations t ON t.entity_type = 'cms_page' AND t.entity_id = page.id
     WHERE p_language IS NOT NULL AND t.language_code = p_language AND p_language IS DISTINCT FROM page.language_code
       AND t.deleted_at IS NULL AND (t.is_machine = false OR t.reviewed_at IS NOT NULL)
  )
  SELECT CASE WHEN page.tenant_id IS NULL THEN 'platform' ELSE 'tenant' END,
         page.slug,
         (CASE WHEN tr.body_tr IS NOT NULL THEN COALESCE(tr.title_tr, page.default_title) ELSE page.default_title END)::text,
         COALESCE(tr.body_tr, page.body),
         (CASE WHEN tr.body_tr IS NOT NULL THEN p_language ELSE page.language_code END)::varchar,
         p_language,
         (CASE WHEN tr.body_tr IS NULL AND p_language IS NOT NULL AND p_language IS DISTINCT FROM page.language_code
               THEN page.language_code END)::varchar,
         page.version, page.published_at
    FROM page LEFT JOIN tr ON true
$$;
COMMENT ON FUNCTION public_policy_page(uuid, varchar, varchar) IS
  'PC-56 LEGAL-1 (0242): the anonymous storefront''s policy read (GET /v1/storefront/policies/:slug). Only page_kind = policy AND status = published, only the four slugs terms | privacy | refunds | shipping; the context tenant''s own published version wins over the platform''s; the body / title in p_language from a reviewed, live translation, else the version''s own words with fallback_language = their language. No row = not published. No author, publisher or any person in the projection. No flag (0223''s named Law 10 exception).';
REVOKE ALL ON FUNCTION public_policy_page(uuid, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_policy_page(uuid, varchar, varchar) TO kv_app;
