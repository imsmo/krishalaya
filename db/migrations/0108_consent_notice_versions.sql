-- ============================================================================
-- MIGRATION 0108 — THE WORDS A FARMER CONSENTED TO (PC-56 ADMIN-5b)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT, AND IT IS THE SAME SHAPE AS ADMIN-4's. A VERSION LABEL POINTING AT NOTHING.
-- ---------------------------------------------------------------------------
-- `consents` is a good table. It is append-only (0014 revokes UPDATE and DELETE from kv_app), it records
-- `granted boolean` per decision rather than a mutable flag, it carries the channel and the assisting ambassador, and
-- it stamps `version varchar(20)` — the version of the purpose the person agreed to. All correct.
--
-- Except `consents.version` is a STRING that points at `consent_purposes.current_version`, which is a MUTABLE COLUMN.
-- Publishing v3 of a purpose overwrites it, and **the words of v2 then exist nowhere in the database**. A consent record
-- says a farmer agreed to "v2" of `ai_training`, and nothing on this platform can produce what v2 said.
--
-- That is the identical defect ADMIN-4 found on `scheme_applications.scheme_version`, in a different domain, and it is
-- worth naming as a PATTERN rather than a coincidence: **a version label with no version row.** It looks like a
-- snapshot, every screen and every reviewer trusts it, and it is a number beside a fact nobody kept.
--
-- Consent is the worst place for it. A scheme's rules are the platform's own policy; a consent notice is the WORDS A
-- PERSON READ AND AGREED TO. It is the entire legal basis for processing their data. "They consented to v2" with no v2
-- is not a weaker record than we thought — under DPDP it is not a record of consent at all.
--
-- AND W047's NOTICE TEXT HAD NOWHERE TO LIVE. The screen shows a notice per purpose in twelve languages, with a
-- coverage column reading "12/12 ✓" and "9/12 partial". `consent_purposes` holds `code`, `default_name`,
-- `is_mandatory`, `current_version` — and NO NOTICE TEXT COLUMN AT ALL, in any language. The coverage column had
-- nothing behind it.
--
-- ---------------------------------------------------------------------------
-- WHY NOT `translations`, WHEN DELTA-008 AND DELTA-018 BOTH REUSED AN EXISTING TABLE
-- ---------------------------------------------------------------------------
-- The reflex from the last three waves is to look for the table that already models this, and `translations` (with the
-- review workflow ADMIN-3b built) is the obvious candidate: entity_type, entity_id, field, language_code, text.
--
-- IT IS THE WRONG HOME, AND THE REASON IS THE POINT OF THIS MIGRATION. `translations` is built to be CORRECTED — rows
-- are updatable, soft-deletable, and a bad Gujarati category name should be fixable in place. A consent notice is the
-- opposite: once one person has consented under it, its words can never change, because the record of their consent
-- refers to those words. Putting a legal text a farmer agreed to in a table designed for editable display strings would
-- make the most important immutability guarantee on the platform depend on nobody using an UPDATE that exists.
--
-- So: notices live in their own append-only table, PINNED TO A VERSION, immutable once that version is published. The
-- discipline that made `external_entity_refs` the right answer twice is the same discipline that makes it the wrong
-- answer here — reuse when the shape AND the lifecycle match, not when only the shape does.
-- ============================================================================

CREATE TYPE consent_version_status AS ENUM ('draft', 'published', 'superseded');

-- ---------------------------------------------------------------------------
-- 1. THE VERSION — a published-never-edited object, the platform's FOURTH
-- ---------------------------------------------------------------------------
-- After the dunning ladder, the support policy object and 0105's scheme versions. Deliberately the same shape as
-- `scheme_versions`, including the maker≠checker CHECK, so that an operator who has published one recognises the other.
CREATE TABLE consent_purpose_versions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  purpose_code      varchar(60) NOT NULL REFERENCES consent_purposes(code),
  -- The label a consent record stamps. Kept as the canon's 'v1'/'v2' text rather than an integer because it is already
  -- that shape in `consents.version` and in every screen, and renumbering a live column to be tidier is not a trade.
  version           varchar(20) NOT NULL,
  status            consent_version_status NOT NULL DEFAULT 'draft',
  -- Snapshotted, not joined: whether a purpose was MANDATORY when somebody agreed is part of what they agreed to. If
  -- `service_core` later becomes optional, a consent given when it was compulsory must not be re-described as freely
  -- given.
  is_mandatory      boolean NOT NULL,
  -- Why this version exists. W047's ladder starts with a drafted notice, and the reason is what a DPO reads later.
  change_reason     text NOT NULL,
  drafted_by        uuid,
  drafted_at        timestamptz NOT NULL DEFAULT now(),
  published_by      uuid,
  published_at      timestamptz,
  checker_note      text,
  -- True for the rows this migration backfills from `consent_purposes.current_version`: nobody drafted or published
  -- them through the maker-checker path, and the console must be unable to print a signature that was never there.
  is_backfilled     boolean NOT NULL DEFAULT false,

  CONSTRAINT ck_cpv_reason        CHECK (length(trim(change_reason)) > 0),
  CONSTRAINT ck_cpv_version_shape CHECK (version ~ '^v[0-9]{1,4}$'),
  CONSTRAINT ck_cpv_draft_clean   CHECK (status <> 'draft' OR (published_at IS NULL AND published_by IS NULL)),
  CONSTRAINT ck_cpv_published     CHECK (status = 'draft' OR is_backfilled OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  CONSTRAINT ck_cpv_backfill      CHECK (NOT is_backfilled OR published_by IS NULL),
  CONSTRAINT ck_cpv_maker         CHECK (is_backfilled OR drafted_by IS NOT NULL),
  -- MAKER ≠ CHECKER at the database. W047: "version bumps are maker-checker". The platform's fourth such constraint,
  -- and the first written after the assertion was extracted to core/approval/two-person-rule.ts — the two NULL escapes
  -- are the load-bearing part and are exactly what that helper documents.
  CONSTRAINT ck_cpv_maker_ne_checker CHECK (published_by IS NULL OR drafted_by IS NULL OR published_by <> drafted_by)
);
CALL add_std_columns('consent_purpose_versions');

CREATE UNIQUE INDEX uq_cpv_purpose_version ON consent_purpose_versions (purpose_code, version) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_cpv_one_draft   ON consent_purpose_versions (purpose_code) WHERE status = 'draft' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_cpv_one_current ON consent_purpose_versions (purpose_code) WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX idx_cpv_history ON consent_purpose_versions (purpose_code, drafted_at DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE consent_purpose_versions IS
  'Published-never-edited consent purpose versions. consents.consent_purpose_version_id points at the version a person actually agreed to, so the WORDS of that version (consent_purpose_notices) can always be produced. Before 0108 consents.version was a label pointing at a mutable column.';

-- ---------------------------------------------------------------------------
-- 2. THE NOTICE — the words themselves, one row per language per version
-- ---------------------------------------------------------------------------
CREATE TABLE consent_purpose_notices (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  version_id    uuid NOT NULL REFERENCES consent_purpose_versions(id),
  language_code varchar(8) NOT NULL REFERENCES languages(code),
  -- The text a person read. `text` and not varchar: a plain-language notice that actually explains a purpose is
  -- paragraphs, and truncating one at 500 characters is how notices become unreadable legalese.
  notice_text   text NOT NULL,
  -- A short label for the consent toggle itself ("Offers & scheme alerts"), separate from the full notice, because the
  -- toggle and the notice are read at different moments and squeezing both into one field forces one of them to be
  -- wrong.
  toggle_label  varchar(150) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,

  CONSTRAINT ck_cpn_text   CHECK (length(trim(notice_text)) > 0),
  CONSTRAINT ck_cpn_label  CHECK (length(trim(toggle_label)) > 0),
  -- No HTML. A consent notice is rendered into an app, an IVR script and an SMS; markup that survives into a voice
  -- prompt is read aloud.
  CONSTRAINT ck_cpn_plain  CHECK (notice_text !~ '<[a-zA-Z/]' AND toggle_label !~ '<[a-zA-Z/]')
);

CREATE UNIQUE INDEX uq_cpn_version_language ON consent_purpose_notices (version_id, language_code);
CREATE INDEX idx_cpn_version ON consent_purpose_notices (version_id);

-- IMMUTABLE ONCE PUBLISHED, ENFORCED. A draft's notices are freely editable; the moment the version publishes, its
-- words are what somebody agreed to. A trigger and not a convention, for the same reason `scheme_versions` has one:
-- a service-level guard is bypassed by the next caller written against the table.
CREATE OR REPLACE FUNCTION trg_consent_notice_immutable() RETURNS trigger AS $$
DECLARE v_status consent_version_status;
BEGIN
  SELECT status INTO v_status FROM consent_purpose_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'consent notices for a % version are immutable — the words are what a person agreed to; publish a new version instead', v_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cpn_immutable BEFORE INSERT OR UPDATE OR DELETE ON consent_purpose_notices
  FOR EACH ROW EXECUTE FUNCTION trg_consent_notice_immutable();

-- ---------------------------------------------------------------------------
-- 3. THE POINTER THAT MAKES A CONSENT RECORD MEAN SOMETHING
-- ---------------------------------------------------------------------------
ALTER TABLE consents
  ADD COLUMN consent_purpose_version_id uuid REFERENCES consent_purpose_versions(id);

COMMENT ON COLUMN consents.consent_purpose_version_id IS
  'The version whose WORDS this person agreed to. NULL means unresolvable: recorded before 0108, when the version was a label pointing at a mutable column. Never read NULL as "the current version" — that is the mistake this column exists to prevent.';

CREATE INDEX idx_consents_version ON consents (consent_purpose_version_id) WHERE consent_purpose_version_id IS NOT NULL;

-- The admin registry (W046) reads newest-first across every user — the first cross-tenant reader of this table, and
-- every existing index is keyed on (user_id, purpose_code, created_at). Without this it sorts the whole table per page,
-- and the canon's own header says 8,42,196 consent events.
CREATE INDEX idx_consents_registry ON consents (created_at DESC, id DESC);
-- The withdrawn-only filter W046 offers. Partial, because withdrawals are the minority and they are what somebody
-- actually comes to this screen to look at.
CREATE INDEX idx_consents_withdrawn ON consents (created_at DESC, id DESC) WHERE granted = false;

-- ---------------------------------------------------------------------------
-- 4. THE CHANNEL WAS A FREE VARCHAR
-- ---------------------------------------------------------------------------
-- W046 names four channels and 0003's comment lists them, but `consents.channel varchar(30)` has no CHECK — so the
-- values were a comment. The only writer today is a zod enum in the grant DTO, which is why the data is almost certainly
-- clean; the constraint is defence against the NEXT writer, and against a backfill script.
--
-- ADDED **NOT VALID** ON PURPOSE, and this is a deliberate trade rather than laziness: a validating constraint would
-- scan the table and abort the whole migration if a single legacy or fixture row disagreed, and this migration runs on a
-- founder's staging box with no way to inspect first. NOT VALID enforces on every future write immediately and leaves
-- existing rows alone. `VALIDATE CONSTRAINT` is a one-line follow-up once somebody has looked at the distinct values —
-- named here so it is a known step and not a forgotten one.
ALTER TABLE consents ADD CONSTRAINT ck_consents_channel CHECK (
  channel IN ('app', 'web', 'ambassador_assisted', 'ivr')
) NOT VALID;

-- An assisted consent must name its assistant. W046's whole assurance about the 38% assisted share is "ambassador
-- identity logged" — an assisted consent with no ambassador is the one row that assurance cannot cover. NOT VALID for
-- the same reason as above.
ALTER TABLE consents ADD CONSTRAINT ck_consents_assisted_has_assistant CHECK (
  channel <> 'ambassador_assisted' OR assisted_by IS NOT NULL
) NOT VALID;

-- ---------------------------------------------------------------------------
-- 5. BACKFILL — the current version of every purpose, unsigned, with NO NOTICE
-- ---------------------------------------------------------------------------
-- One version row per existing purpose, at its current label, marked `is_backfilled`. Earlier versions are gone and this
-- does not invent them.
INSERT INTO consent_purpose_versions (purpose_code, version, status, is_mandatory, change_reason, drafted_by, drafted_at, published_at, is_backfilled)
SELECT p.code, p.current_version, 'published', p.is_mandatory,
       'Backfilled by migration 0108 from consent_purposes.current_version. Nobody drafted or published this version '
       || 'through the maker-checker path, and NO NOTICE TEXT EXISTS FOR IT — the platform never had a column to store '
       || 'one, so the words these consents were given against were never recorded anywhere.',
       -- **PC-56 TENANT-4d-5 CHAIN REPAIR: THIS READ TWO COLUMNS THAT DO NOT EXIST.** It was written
       -- `NULL, p.created_at, p.created_at, true … WHERE p.deleted_at IS NULL`, and `consent_purposes`
       -- (0003) is one of the few tables in this schema with NO `CALL add_std_columns(...)` — it has
       -- exactly `code`, `default_name`, `is_mandatory`, `current_version` and nothing else. So this
       -- file failed on every fresh database with `column p.created_at does not exist`, and because
       -- `db/scripts/migrate.js` wraps each file in ONE transaction and `return`s on failure, **THE
       -- CHAIN STOPPED HERE.** TypeScript never sees a column list — the same class as 0140's
       -- varchar(10), 0139's NULL CHECK and 0142's `r.tenant_id`, and the fourth time this programme
       -- has met it.
       --
       -- **AND THE REPAIR IS MORE HONEST THAN THE ORIGINAL INTENT, NOT LESS.** Using a purpose's
       -- creation date as its version's PUBLICATION date would assert that these words were published
       -- to users on the day the purpose row was made, which nobody knows and which this file's own
       -- header goes out of its way to refuse ("NO NOTICE TEXT EXISTS FOR IT"). So:
       --   • `drafted_at` = now(), which is a fact: this row is being drafted by this migration, and
       --     the column is NOT NULL so it must say something true rather than something convenient;
       --   • `published_at` = NULL — unknown, and `ck_cpv_published` explicitly permits a NULL on a
       --     backfilled row for exactly this reason.
       -- A DPO reading these rows now sees a version with no publication date and `is_backfilled` set,
       -- which is the truth, instead of a date that would survive into an audit as evidence.
       NULL, now(), NULL, true
  FROM consent_purposes p
ON CONFLICT DO NOTHING;

-- **NO NOTICE ROWS ARE FABRICATED.** This is the most important omission in the file. It would be easy to insert
-- `default_name` as a notice and make W047's coverage column read 1/12 instead of 0/12 — and it would be a lie about a
-- legal text. "Offers & scheme alerts" is a toggle label, not a notice explaining what happens to somebody's data. The
-- console therefore shows these versions as having NO recorded notice, which is the truth, and it is the strongest
-- possible argument for authoring real ones.

-- Resolve the pointer where the label matches the backfilled version — every consent given under the current label.
-- Consents stamped with any EARLIER label stay NULL and are honestly unresolvable: their words never existed.
UPDATE consents c
   SET consent_purpose_version_id = v.id
  FROM consent_purpose_versions v
 WHERE v.purpose_code = c.purpose_code
   AND v.version = c.version
   AND c.consent_purpose_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- 6. GRANTS
-- ---------------------------------------------------------------------------
-- kv_app READS both tables and writes neither. Reading is the point: apps/api must render the notice a farmer is
-- consenting to, and must resolve the version at grant time. Authoring a version is a platform act, checker-gated, in
-- the admin realm. Explicit REVOKE first because 0014/0018 set ALTER DEFAULT PRIVILEGES for kv_app on this schema and a
-- new table silently inherits INSERT/UPDATE.
REVOKE ALL ON consent_purpose_versions, consent_purpose_notices FROM kv_app, kv_relay;
GRANT SELECT ON consent_purpose_versions, consent_purpose_notices TO kv_app;
GRANT SELECT, INSERT, UPDATE ON consent_purpose_versions TO kv_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON consent_purpose_notices TO kv_admin;
GRANT SELECT ON consent_purpose_versions, consent_purpose_notices TO kv_readonly;

-- No tenant_id on either table and therefore no RLS: a consent purpose is platform-wide (the same notice governs every
-- tenant's farmers), exactly as `consents` and `consent_purposes` already are.

-- ---------------------------------------------------------------------------
-- 7. WHAT IS STILL MISSING, RECORDED WHERE THE NEXT PERSON WILL LOOK
-- ---------------------------------------------------------------------------
--   • NO RE-CONSENT PROMPT. W047's ladder ends "re-consent prompts roll out" and there is no mechanism: nothing
--     compares a user's held version against the current one at the point of use. The version pointer added here is the
--     prerequisite for building it, and the console reports how many principals hold a superseded version.
--   • NO VOICE-LOG REFERENCE. W046 shows "(voice log ref)" against an IVR consent and `consents` has no column for it —
--     an IVR consent's evidence is the recording, and there is nowhere to put its id. Not added speculatively: it needs
--     the voice provider that does not exist, and an empty column would imply one.
--   • THE CHANNEL CONSTRAINTS ARE `NOT VALID`. One `VALIDATE CONSTRAINT` each once the distinct values have been read.
--   • `consent_purposes.current_version` IS NOW A PROJECTION of the published version row and nothing else should write
--     it. The service reprojects it on publish, in the same transaction, exactly as 0105 does for `schemes`.
