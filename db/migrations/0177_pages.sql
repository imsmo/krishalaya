-- ==================================================================================================================
-- 0177 · PC-56 TENANT-8c · THE PAGES — W175 (pages), W176 (page editor), W177 (FAQ) + the faq-form (W2605–W2608),
--        faq-mutate (W2609–W2611), page-form (W2696–W2699), page-mutate (W2700–W2702), pages-form (W2703–W2706) and
--        pages-mutate (W2707–W2709) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration.
-- ==================================================================================================================
--
-- W175: *"Static pages, policies and help articles (cms_pages) — markdown body, versioned (a new publish = a new
--        version, history kept)"* · *"Policy pages (payment, refund, conduct) version with history because members rely
--        on them — 'what did the policy say when I ordered?' always has an answer (UNIQUE tenant + slug + version)"* ·
--        *"Platform defaults cover the essentials; your own pages replace them as you publish."*
-- W176: *"publishing creates v3, v2 stays in history"* · Archive page — *"Reason \*"* · *"Editor restricted —
--        help_article needs content scope; policy needs tenant_admin + checker."*
-- W177: *"cms_pages with page_kind: faq — grouped by topic"*.
--
-- WHAT THE WAVE IS DECLARED AS (TENANT-8's survey, §3 F-3's note / F-7 / F-14 / F-19 / F-20):
--
--   F-3's note · `cms_pages` carried ONE policy for ALL commands, `tenant_id IS NULL OR tenant_id = current_tenant_id()`,
--         with no WITH CHECK — so `kv_app`, under ANY tenant context, could INSERT a platform page (tenant_id NULL) and
--         UPDATE the platform's own pages. 0175 split exactly this shape on `notification_templates`; this file copies it.
--   F-7 · create and update wrote NO audit row (only publish / archive did), archive took NO reason, and every CMS
--         audit row stored the REQUEST ID in its `ip` column (the controller passed `ctx.requestId` as `ip`). Fixed in
--         the module; this file gives archive its reason column and its vocabulary.
--   F-14 · `publishedBySlug` ranked tenant and platform rows by version alone, so a platform `about` v5 SHADOWED the
--         tenant's own `about` v1 — W175's *"your own pages replace them as you publish"*, inverted. Fixed in the
--         repository (the tenant row wins regardless of version); the single-live invariant becomes an index here.
--   F-19 · `cms.manage` (tenant_admin only) was the only CMS verb: author, publisher and banner manager were one key and
--         there was no checker for a policy page. Two verbs now (seed 0004): `cms.pages.manage` (author — tenant_admin,
--         support_agent) and `cms.pages.publish` (checker — tenant_admin). `cms.manage` stays for banners until 8d.
--   F-20 · `UNIQUE (tenant_id, slug, version)` is NULLS DISTINCT: two platform `about` v1 rows were representable. And
--         `maxVersion` read without a lock, so two concurrent creates of one tenant slug raced to the same version and
--         the loser was a raw 23505 → 500. A partial UNIQUE for platform rows here; the module takes a transaction-scoped
--         advisory lock on (tenant, slug) before it allocates, re-checks what the review promised, and answers a
--         typed 409.
--
-- WHAT THIS FILE BUILDS.
--   177.1  The wall: the ALL policy split (SELECT admits the platform row; INSERT/UPDATE only `tenant_id =
--          current_tenant_id()`, USING + WITH CHECK; the admin realm named). kv_app: REVOKE, then column-limited
--          INSERT/UPDATE (no `tenant_id`, `slug`, `version` change; no `deleted_at`; no DELETE). kv_relay (BYPASSRLS)
--          loses INSERT/UPDATE/DELETE — it never wrote a page (grep in the 8c report).
--   177.2  Columns: `language_code` (the language the body is WRITTEN in — W176 *"Gujarati is the source language"*;
--          FK languages), `topic` + `sort_order` (W177's FAQ grouping; topic from a vocabulary), `published_by`,
--          `archived_at` / `archived_by` / `archived_reason` (a vocabulary), `last_edited_by` (the second maker of a
--          draft, for the checker rule). Backfilled BEFORE the CHECKs (archived → `unrecorded`, faq → `general`).
--   177.3  Two vocabularies in `lookup_values` (Law 6), in the migration because the backfill and the triggers depend
--          on them (0112's / 0176's reasoning): `cms_page_archive_reason`, `cms_faq_topic`.
--   177.4  CHECKs: page_kind and status vocabularies (they were free varchar), topic only on FAQ and required there,
--          a published row has its time, an archived row says why and when.
--   177.5  Indexes: platform (slug, version) partial UNIQUE (F-20); ONE published version per (tenant, slug) and per
--          platform slug — the single-live invariant the service maintained by hand is now the database's; ONE open draft
--          per (tenant, slug) — a second draft beside an undecided one is two answers to "what will this page say".
--   177.6  `cms_pages_guard` (trigger), for TENANT rows: born a draft; the words (title, body, kind, language, topic) are
--          immutable once a version leaves draft — "what did the policy say when I ordered?" is answered by the row
--          itself, not by whoever edited it last; slug / version / tenant never move; the state machine (draft →
--          published | archived, published → archived, archived final); a publish names its publisher, who is the
--          session's own user when there is one; **MAKER ≠ CHECKER for page_kind = 'policy'** (Law 12 — a trust
--          surface: terms, privacy, refund): the publisher is neither the version's author nor its last editor (23514);
--          the archive reason is in the vocabulary; NO RAW HTML and no `javascript:` / `data:` / `vbscript:` link
--          target in the body — the canon says *"markdown body"*, so markdown is what is stored (the review refuses it
--          first, by name; this is the second layer).
--
-- RLS DECISION.
--   • `cms_pages`: ENABLE + FORCE (restated). The ALL-command policy `tenant_isolation_cms_pages` is DROPPED and replaced
--     by `cp_read` (SELECT: `tenant_id IS NULL OR tenant_id = current_tenant_id()` — every tenant reads the platform
--     defaults its own pages replace), `cp_insert_own` / `cp_update_own` (`tenant_id = current_tenant_id()` in USING and
--     WITH CHECK — NULL never matches, so the platform row cannot be written from the tenant realm), and `cp_admin_realm`
--     (FOR ALL TO kv_admin — platform pages are the admin realm's, Law 11; named, because live `rolbypassrls` for
--     kv_admin is `f`, 0175's reasoning). No DELETE policy and no DELETE grant in the tenant realm: a version is history.
--   • `lookup_values`: untouched here. It carries the same `tenant_id IS NULL OR …` ALL shape and is one of the 35 tables
--     0175 NAMED for a sweep of their own; the two vocabularies below are platform rows written by this migration.
--
-- PARTITION NOTE. `cms_pages` is not partitioned and should not be: one row per VERSION of a page a cooperative writes —
-- tens of slugs, a handful of versions each, per tenant per year (W175's canon shows 14 pages). Every read is by
-- (tenant_id, slug[, version]) on the UNIQUE index or one of the partial indexes below.
--
-- ON CONFLICT on a nullable key: the tenant path is a plain INSERT under the real UNIQUE (tenant_id NOT NULL there); the
-- platform path now has `uq_cms_pages_platform` to conflict on (F-20's lesson, 0162's for templates).
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 177.1 · THE WALL ON cms_pages
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE cms_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_pages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_cms_pages ON cms_pages;

CREATE POLICY cp_read ON cms_pages
  FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY cp_insert_own ON cms_pages
  FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cp_update_own ON cms_pages
  FOR UPDATE
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
-- Platform pages are the admin realm's (Law 11). Named, so the wall does not depend on a role attribute.
CREATE POLICY cp_admin_realm ON cms_pages
  FOR ALL TO kv_admin
  USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 177.2 · THE COLUMNS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE cms_pages
  ADD COLUMN language_code   varchar(8) REFERENCES languages(code),
  ADD COLUMN topic           varchar(40),
  ADD COLUMN sort_order      integer NOT NULL DEFAULT 0,
  ADD COLUMN published_by    uuid REFERENCES users(id),
  ADD COLUMN archived_at     timestamptz,
  ADD COLUMN archived_by     uuid REFERENCES users(id),
  ADD COLUMN archived_reason varchar(40),
  ADD COLUMN last_edited_by  uuid REFERENCES users(id);

COMMENT ON COLUMN cms_pages.language_code IS
  'PC-56 TENANT-8c. The language this version''s body is WRITTEN in (W176: "Gujarati is the source language"). Translations are NOT here: the translations table has no tenant_id and kv_app holds SELECT only on it (named in the 8c report). NULL only on rows written before 0177 (never guessed).';
COMMENT ON COLUMN cms_pages.topic IS
  'PC-56 TENANT-8c (W177, Law 6). A code from the cms_faq_topic vocabulary (lookup_values). Required on an FAQ entry (page_kind = faq), absent on every other kind.';
COMMENT ON COLUMN cms_pages.sort_order IS
  'PC-56 TENANT-8c (W177). An FAQ entry''s place inside its topic. Carried on every version of the slug (the order belongs to the entry, not to one version) and written only by the reorder act (keyed, audited) or copied forward when a version is minted.';
COMMENT ON COLUMN cms_pages.published_by IS
  'PC-56 TENANT-8c. Who published this version. For page_kind = policy it is never the version''s author (created_by) nor its last editor (last_edited_by) — cms_pages_guard, 23514.';
COMMENT ON COLUMN cms_pages.archived_reason IS
  'PC-56 TENANT-8c (F-7, Law 6). A code from cms_page_archive_reason (lookup_values). `superseded` = a newer version of the slug was published (written by the publish act); `unrecorded` = archived before 0177 kept a reason.';
COMMENT ON COLUMN cms_pages.last_edited_by IS
  'PC-56 TENANT-8c. The last member who changed a DRAFT''s words (set by cms_pages_guard from the session''s user). With created_by it is the maker the policy checker may not be.';

-- ------------------------------------------------------------------------------------------------------------------
-- 177.3 · THE VOCABULARIES (Law 6)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('cms_page_archive_reason', 'Why a page version was archived', false),
  ('cms_faq_topic', 'The topic an FAQ entry is grouped under', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.name, v.meta::jsonb, v.ord
  FROM (VALUES
    ('cms_page_archive_reason', 'outdated',          'The content is out of date',                         '{"chosen":true}', 1),
    ('cms_page_archive_reason', 'replaced',          'Replaced by another page',                           '{"chosen":true}', 2),
    ('cms_page_archive_reason', 'withdrawn',         'The cooperative withdrew this page',                 '{"chosen":true}', 3),
    ('cms_page_archive_reason', 'legal_review',      'Taken down for legal review',                        '{"chosen":true}', 4),
    ('cms_page_archive_reason', 'duplicate',         'A duplicate of another page',                        '{"chosen":true}', 5),
    ('cms_page_archive_reason', 'draft_abandoned',   'The draft will not be published',                    '{"chosen":true}', 6),
    ('cms_page_archive_reason', 'superseded',        'A newer version of this page was published',         '{"chosen":false,"system":true}', 90),
    ('cms_page_archive_reason', 'unrecorded',        'Archived before the page log kept reasons (0177)',  '{"chosen":false,"legacy":true}', 99),
    ('cms_faq_topic',           'payments',          'Payments and payouts',                               '{}', 1),
    ('cms_faq_topic',           'orders',            'Orders',                                             '{}', 2),
    ('cms_faq_topic',           'listing',           'Listing your produce',                               '{}', 3),
    ('cms_faq_topic',           'dairy',             'Dairy and milk',                                     '{}', 4),
    ('cms_faq_topic',           'delivery',          'Pickup and delivery',                                '{}', 5),
    ('cms_faq_topic',           'membership',        'Membership and shares',                              '{}', 6),
    ('cms_faq_topic',           'schemes',           'Government schemes',                                 '{}', 7),
    ('cms_faq_topic',           'account',           'Your account and app',                               '{}', 8),
    ('cms_faq_topic',           'general',           'General',                                            '{}', 99)
  ) AS v(type_code, code, name, meta, ord)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values l
                    WHERE l.type_code = v.type_code AND l.tenant_id IS NULL AND l.code = v.code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_cms_archive_platform
  ON lookup_values (code) WHERE type_code = 'cms_page_archive_reason' AND tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_cms_topic_platform
  ON lookup_values (code) WHERE type_code = 'cms_faq_topic' AND tenant_id IS NULL;

-- Backfill BEFORE the checks. A row archived before this file has no reason and is told so, never given a guessed one;
-- an FAQ row written before topics existed is `general`; the last editor of an old draft is its author.
UPDATE cms_pages SET archived_reason = 'unrecorded', archived_at = COALESCE(archived_at, updated_at)
 WHERE status = 'archived' AND archived_reason IS NULL;
UPDATE cms_pages SET topic = 'general' WHERE page_kind = 'faq' AND topic IS NULL;
UPDATE cms_pages SET last_edited_by = created_by WHERE last_edited_by IS NULL AND created_by IS NOT NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 177.4 · THE CHECKS
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE cms_pages
  ADD CONSTRAINT ck_cms_pages_kind CHECK (page_kind IN ('static', 'policy', 'faq', 'help_article')),
  ADD CONSTRAINT ck_cms_pages_status CHECK (status IN ('draft', 'published', 'archived')),
  ADD CONSTRAINT ck_cms_pages_version CHECK (version >= 1),
  ADD CONSTRAINT ck_cms_pages_topic_is_faq CHECK (topic IS NULL OR page_kind = 'faq'),
  ADD CONSTRAINT ck_cms_pages_faq_has_topic CHECK (page_kind <> 'faq' OR topic IS NOT NULL),
  ADD CONSTRAINT ck_cms_pages_sort_order CHECK (sort_order >= 0),
  ADD CONSTRAINT ck_cms_pages_published_time CHECK (status <> 'published' OR published_at IS NOT NULL),
  ADD CONSTRAINT ck_cms_pages_archived_says_why CHECK (status <> 'archived' OR (archived_reason IS NOT NULL AND archived_at IS NOT NULL)),
  ADD CONSTRAINT ck_cms_pages_archive_only_archived CHECK (archived_reason IS NULL OR status = 'archived');

-- ------------------------------------------------------------------------------------------------------------------
-- 177.5 · THE INDEXES
-- ------------------------------------------------------------------------------------------------------------------
-- F-20: the platform side of UNIQUE (tenant_id, slug, version), which NULLS DISTINCT never enforced.
CREATE UNIQUE INDEX uq_cms_pages_platform ON cms_pages (slug, version) WHERE tenant_id IS NULL;
-- One live version per slug, for each owner — the invariant `publish` kept by hand (archive the prior, then publish).
CREATE UNIQUE INDEX uq_cms_pages_one_live ON cms_pages (tenant_id, slug)
  WHERE status = 'published' AND deleted_at IS NULL AND tenant_id IS NOT NULL;
CREATE UNIQUE INDEX uq_cms_pages_one_live_platform ON cms_pages (slug)
  WHERE status = 'published' AND deleted_at IS NULL AND tenant_id IS NULL;
-- One open draft per tenant slug.
CREATE UNIQUE INDEX uq_cms_pages_one_draft ON cms_pages (tenant_id, slug)
  WHERE status = 'draft' AND deleted_at IS NULL AND tenant_id IS NOT NULL;
-- W177's read: a tenant's FAQ entries by topic and place.
CREATE INDEX idx_cms_pages_faq ON cms_pages (tenant_id, topic, sort_order, slug)
  WHERE page_kind = 'faq' AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------------------------------------------
-- 177.6 · THE GUARD
-- ------------------------------------------------------------------------------------------------------------------
-- The markdown rule, as one function both the trigger and a probe can call. A tag is `<name …>` / `</name>` / `<!--`,
-- the name directly after `<` as a browser reads it (`a < b > c` is prose); an autolink (`<https://…>`) is not a tag (the
-- scheme's colon ends the name). A link target that runs script or
-- inlines a payload is refused whatever the text around it says.
CREATE OR REPLACE FUNCTION cms_body_is_markdown(p_body text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_body !~* '</?[a-z][a-z0-9-]*(\s[^<>]*)?/?\s*>'
     AND p_body !~ '<!--'
     AND p_body !~* '\]\(\s*<?\s*(javascript|vbscript|data)\s*:'
$$;

CREATE OR REPLACE FUNCTION cms_vocab_known(p_type varchar, p_code varchar) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM lookup_values
                  WHERE type_code = p_type AND tenant_id IS NULL AND code = p_code AND is_active AND deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION cms_pages_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := current_user_id();
BEGIN
  -- The vocabularies hold for every row, the platform's included (Law 6).
  IF NEW.topic IS NOT NULL AND NOT cms_vocab_known('cms_faq_topic', NEW.topic) THEN
    RAISE EXCEPTION 'cms_pages.topic % is not in the cms_faq_topic vocabulary', NEW.topic USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.archived_reason IS NOT NULL AND NOT cms_vocab_known('cms_page_archive_reason', NEW.archived_reason) THEN
    RAISE EXCEPTION 'cms_pages.archived_reason % is not in the cms_page_archive_reason vocabulary', NEW.archived_reason
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;   -- platform pages: the admin realm's (cp_admin_realm)

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.published_at IS NOT NULL OR NEW.published_by IS NOT NULL OR NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'a tenant page version is born a draft (slug %, v%)', NEW.slug, NEW.version USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'a tenant page version names its author (slug %, v%)', NEW.slug, NEW.version USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.created_by <> me THEN
      RAISE EXCEPTION 'a page version''s author is the member writing it (slug %)', NEW.slug USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.language_code IS NULL THEN
      RAISE EXCEPTION 'a tenant page version says which language its body is written in (slug %)', NEW.slug USING ERRCODE = 'check_violation';
    END IF;
    NEW.last_edited_by := COALESCE(NEW.last_edited_by, NEW.created_by);
  ELSE
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.slug <> OLD.slug OR NEW.version <> OLD.version
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'a page version''s tenant, slug, version and author never move (page %)', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    -- The words.
    IF NEW.default_title IS DISTINCT FROM OLD.default_title OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.page_kind IS DISTINCT FROM OLD.page_kind OR NEW.language_code IS DISTINCT FROM OLD.language_code
       OR NEW.topic IS DISTINCT FROM OLD.topic THEN
      IF OLD.status <> 'draft' OR NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'the words of page % v% are history: only a draft is edited (publishing creates a new version)', OLD.slug, OLD.version
          USING ERRCODE = 'check_violation';
      END IF;
      IF me IS NOT NULL THEN NEW.last_edited_by := me; END IF;
    END IF;
    -- The state machine (domain/page-acts.ts is the same table).
    IF NEW.status <> OLD.status THEN
      IF NOT ((OLD.status = 'draft' AND NEW.status IN ('published', 'archived')) OR (OLD.status = 'published' AND NEW.status = 'archived')) THEN
        RAISE EXCEPTION 'page % v%: % → % is not a page transition', OLD.slug, OLD.version, OLD.status, NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.status = 'published' THEN
        IF NEW.published_by IS NULL THEN
          RAISE EXCEPTION 'page % v%: a publish names its publisher', OLD.slug, OLD.version USING ERRCODE = 'check_violation';
        END IF;
        IF me IS NOT NULL AND NEW.published_by <> me THEN
          RAISE EXCEPTION 'page % v%: the publisher is the member publishing it', OLD.slug, OLD.version USING ERRCODE = 'check_violation';
        END IF;
        -- MAKER ≠ CHECKER on a policy page (Law 12): what binds the cooperative to its members is read by a second person.
        IF NEW.page_kind = 'policy' AND (NEW.published_by = NEW.created_by OR NEW.published_by = NEW.last_edited_by) THEN
          RAISE EXCEPTION 'maker is checker: policy page % v% must be published by a member who neither wrote nor last edited it', OLD.slug, OLD.version
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.status = 'archived' AND (NEW.archived_reason IS NULL OR NEW.archived_at IS NULL) THEN
        RAISE EXCEPTION 'page % v%: an archive says why and when', OLD.slug, OLD.version USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.archived_reason IS DISTINCT FROM OLD.archived_reason OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
       OR NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
      RAISE EXCEPTION 'page % v%: the publish and archive facts change only with the state', OLD.slug, OLD.version
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT cms_body_is_markdown(NEW.body) THEN
    RAISE EXCEPTION 'page % v%: the body is markdown — raw HTML and script / data link targets are not stored', NEW.slug, NEW.version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cms_pages_guard
  BEFORE INSERT OR UPDATE ON cms_pages
  FOR EACH ROW EXECUTE FUNCTION cms_pages_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 177.1 (cont.) · THE GRANTS — REVOKE before the narrow GRANT (a table-level REVOKE also revokes every column grant)
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON cms_pages FROM kv_app;
REVOKE INSERT, UPDATE, DELETE ON cms_pages FROM kv_relay;
GRANT SELECT ON cms_pages TO kv_app;
GRANT INSERT (id, tenant_id, slug, page_kind, default_title, body, version, status, language_code, topic, sort_order,
              created_by, updated_by, last_edited_by)
  ON cms_pages TO kv_app;
GRANT UPDATE (page_kind, default_title, body, language_code, topic, sort_order, status, published_at, published_by,
              archived_at, archived_by, archived_reason, last_edited_by, updated_at, updated_by)
  ON cms_pages TO kv_app;
