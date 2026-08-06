-- ============================================================================
-- MIGRATION 0105 — SCHEME RULES BECOME REAL VERSIONS (PC-56 ADMIN-4)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it
-- in schema_migrations. NEVER edit an applied migration — add a new numbered one.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT. `scheme_applications.scheme_version` IS AN INTEGER POINTING AT NOTHING.
-- ---------------------------------------------------------------------------
-- PRD risk R18, the canon W069 lead line ("rules change = NEW version; applications snapshot the version they applied
-- under") and W070's publish note ("it never rewrites v6 applications") all describe the same guarantee: an
-- application is judged by the rules that were in force when it was filed. The schema cannot honour it.
--
-- `schemes` (0011) holds `benefit_summary` and `eligibility_rules` as jsonb ON THE LIVE ROW, plus an integer
-- `version` counter. admin-api's rules editor (schemes-registry-ops) bumps that counter and OVERWRITES the jsonb in
-- place. `scheme_applications.scheme_version` copies the integer — not an FK, not the rules. So the moment v6 is
-- edited into v7:
--   • the 4,206 applications stamped `scheme_version = 6` reference rules that NO LONGER EXIST ANYWHERE READABLE;
--   • the only surviving copy of v6 is `scheme_registry_changes.old_value` (0042) — a table with no tenant_id,
--     operated by kv_admin alone, in a different application. apps/api, which is where an application is actually
--     verified and approved, cannot read it at all. It is an audit trail, not a rule source: nothing can ask it
--     "what did v6 require?" and get an answer, because a rules edit that touched only `benefit_summary` writes an
--     old_value containing only `benefit_summary`.
--   • WORSE, AND THIS ONE IS MONEY. apps/api's submit path re-reads the LIVE scheme row and charges
--     `schemes.processing_fee_minor` (scheme-application.service.ts). A farmer who opened a draft when the fee was
--     ₹0 and submitted after an operator raised it to ₹50 is charged ₹50, under an application whose own
--     `scheme_version` says it was filed under the old rules. The paperwork and the money disagree, and the
--     paperwork is the thing a grievance officer reads.
--
-- A version number whose rules cannot be retrieved is not a snapshot. It is the APPEARANCE of one, which is worse:
-- every screen and every reviewer trusts it.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY IT IS SHAPED THIS WAY
-- ---------------------------------------------------------------------------
--   • `scheme_versions` HOLDS THE RULES, ONE ROW PER VERSION, PUBLISHED-NEVER-EDITED. Same doctrine as the dunning
--     policies and the support policy object: a published rule set is a historical fact somebody acted on, so it is
--     immutable and a change means a NEW row. Enforced by trigger, not convention — a service-level guard is
--     bypassed by the next caller written against this table.
--   • THE LIVE `schemes` ROW BECOMES A PROJECTION OF ITS PUBLISHED VERSION (Law 5, reflect-never-grant). Publishing
--     copies the version's rule columns onto `schemes` in the same transaction. Nothing else may write them. The
--     live row is kept — not migrated away — because apps/api's hot read path (catalogue browse, eligibility
--     pre-check) selects it on every call and a join per scheme for the common case would be a scale tax paid
--     forever to avoid one copy.
--   • MAKER ≠ CHECKER IS A DATABASE FACT. W069's locked state says edits need "schemes.write + checker" and W070's
--     version history literally prints "checker: Amit R.". `ck_scheme_version_maker_ne_checker` refuses a row whose
--     publisher is its drafter, exactly as `ck_billing_adj_maker_ne_checker` (0093) does for manual money moves.
--     This is the second maker-checker control on the platform and it is deliberately the same shape.
--   • ONE OPEN DRAFT PER SCHEME (`uq_scheme_versions_one_draft`). Two concurrent drafts of the same scheme would
--     each be a plausible v7 and whichever published second would silently discard the other operator's work.
--   • THE WINDOW IS VERSIONED TOO. W073's own locked state states it: "Window dates come from scheme versions — edit
--     via the scheme (checker-gated)". The built `POST schemes/:id/window` route edited the live row directly with
--     no version and no checker, so a closing date — the single field that decides whether a farmer's application is
--     accepted at all — was the least-controlled field on the screen. It moves into the draft.
--   • `drafted_by` / `published_by` CARRY NO FK TO `users`. `scheme_registry_changes.actor_user_id` (0042) already
--     made this choice in this domain and it is the right one: a platform operator is an admin-realm identity and
--     ADMIN-2d established that they have no tenant `users` row to point at. 0093's FK to users(id) is a latent
--     trap, not a precedent to copy.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL IS HONEST ABOUT WHAT IT CANNOT RECOVER
-- ---------------------------------------------------------------------------
-- Every existing scheme gets ONE version row: its current rules, at its current version number, marked
-- `is_backfilled`. Versions BELOW that number are gone and this migration does not pretend otherwise — it does not
-- reconstruct them from `scheme_registry_changes` (a partial-field audit trail cannot yield a complete rule set, and
-- a plausible-looking reconstruction of the rules a farmer was judged by is the worst artefact this table could
-- contain). `is_backfilled` rows carry `published_by IS NULL`, and the constraints below make that combination legal
-- ONLY for a backfilled row: the table can therefore never claim a human signed off on a version nobody signed.
-- The console reads this and says "versions before v6 were not recorded" — never "no earlier versions".
-- ============================================================================

CREATE TYPE scheme_version_status AS ENUM ('draft', 'published', 'superseded');

CREATE TABLE scheme_versions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  scheme_id             uuid NOT NULL REFERENCES schemes(id),
  version               integer NOT NULL,
  status                scheme_version_status NOT NULL DEFAULT 'draft',

  -- the rule set, verbatim. Same shape as the schemes columns it projects onto.
  benefit_summary       jsonb NOT NULL,
  eligibility_rules     jsonb NOT NULL,
  required_doc_type_ids jsonb NOT NULL DEFAULT '[]',
  application_window    jsonb,
  applicable_region_ids jsonb NOT NULL DEFAULT '[]',
  processing_fee_minor  bigint NOT NULL DEFAULT 0,        -- minor units, Law 2 (never a float, never a rupee)

  -- who, why, and when. `change_reason` is the maker's; `checker_note` is the publisher's.
  change_reason         text NOT NULL,
  drafted_by            uuid,
  drafted_at            timestamptz NOT NULL DEFAULT now(),
  published_by          uuid,
  published_at          timestamptz,
  checker_note          text,
  is_backfilled         boolean NOT NULL DEFAULT false,

  CONSTRAINT ck_scheme_version_reason      CHECK (length(trim(change_reason)) > 0),
  CONSTRAINT ck_scheme_version_fee         CHECK (processing_fee_minor >= 0),
  -- a draft has not been published; anything else has, unless it was backfilled (nobody published those)
  CONSTRAINT ck_scheme_version_draft_clean CHECK (status <> 'draft' OR (published_at IS NULL AND published_by IS NULL)),
  CONSTRAINT ck_scheme_version_published   CHECK (status = 'draft' OR is_backfilled OR (published_at IS NOT NULL AND published_by IS NOT NULL)),
  -- a backfilled row must NEVER name a publisher: no human signed it, and saying one did is the lie this guards
  CONSTRAINT ck_scheme_version_backfill    CHECK (NOT is_backfilled OR published_by IS NULL),
  -- a real (non-backfilled) row must name its maker
  CONSTRAINT ck_scheme_version_maker       CHECK (is_backfilled OR drafted_by IS NOT NULL),
  -- MAKER ≠ CHECKER, at the database, as for billing adjustments (0093)
  CONSTRAINT ck_scheme_version_maker_ne_checker CHECK (published_by IS NULL OR drafted_by IS NULL OR published_by <> drafted_by)
);
CALL add_std_columns('scheme_versions');

-- one row per version number per scheme; the version number is the thing an application stamps
CREATE UNIQUE INDEX uq_scheme_versions_number ON scheme_versions (scheme_id, version) WHERE deleted_at IS NULL;
-- at most one open draft per scheme: two rival v7s is how one operator's work vanishes
CREATE UNIQUE INDEX uq_scheme_versions_one_draft ON scheme_versions (scheme_id) WHERE status = 'draft' AND deleted_at IS NULL;
-- at most one PUBLISHED (current) version per scheme: the live schemes row projects exactly one
CREATE UNIQUE INDEX uq_scheme_versions_one_current ON scheme_versions (scheme_id) WHERE status = 'published' AND deleted_at IS NULL;
-- the version-history read: newest first, keyset-friendly
CREATE INDEX idx_scheme_versions_history ON scheme_versions (scheme_id, version DESC) WHERE deleted_at IS NULL;

COMMENT ON TABLE scheme_versions IS
  'Published-never-edited rule sets per scheme version. The live schemes row is a projection of the row with status=published. scheme_applications.scheme_version_id points at the row an application was judged under.';

-- ---------------------------------------------------------------------------
-- PUBLISHED MEANS IMMUTABLE, ENFORCED. A draft is freely editable; the moment a version is published somebody has
-- acted on it, and the rule columns are frozen for good. The trigger permits exactly the transitions the workflow
-- needs (draft→published stamps the checker; published→superseded on the next publish) and refuses everything else,
-- including a same-status rewrite of the rules by a future caller holding kv_admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_scheme_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW;                                        -- a draft is work in progress
  END IF;
  IF OLD.benefit_summary::text       IS DISTINCT FROM NEW.benefit_summary::text
     OR OLD.eligibility_rules::text     IS DISTINCT FROM NEW.eligibility_rules::text
     OR OLD.required_doc_type_ids::text IS DISTINCT FROM NEW.required_doc_type_ids::text
     OR OLD.application_window::text    IS DISTINCT FROM NEW.application_window::text
     OR OLD.applicable_region_ids::text IS DISTINCT FROM NEW.applicable_region_ids::text
     OR OLD.processing_fee_minor        IS DISTINCT FROM NEW.processing_fee_minor
     OR OLD.version                     IS DISTINCT FROM NEW.version
     OR OLD.scheme_id                   IS DISTINCT FROM NEW.scheme_id
     OR OLD.change_reason               IS DISTINCT FROM NEW.change_reason
     OR OLD.drafted_by                  IS DISTINCT FROM NEW.drafted_by
     OR OLD.published_by                IS DISTINCT FROM NEW.published_by
     OR OLD.published_at                IS DISTINCT FROM NEW.published_at THEN
    RAISE EXCEPTION 'scheme_versions row % is % and its rules are immutable (publish a new version instead)', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> NEW.status AND NOT (OLD.status = 'published' AND NEW.status = 'superseded') THEN
    RAISE EXCEPTION 'scheme_versions status % -> % is not a permitted transition', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_scheme_versions_immutable BEFORE UPDATE ON scheme_versions
  FOR EACH ROW EXECUTE FUNCTION trg_scheme_version_immutable();

-- ---------------------------------------------------------------------------
-- GRANTS. kv_app gets SELECT AND NOTHING ELSE — and the SELECT is the point of the whole migration: apps/api must be
-- able to read what v6 said in order to judge a v6 application and charge a v6 fee. It must never author a version:
-- authoring is a platform act, checker-gated, in the admin realm. Explicit REVOKE first because 0014/0018 set
-- ALTER DEFAULT PRIVILEGES for kv_app on this schema and a new table inherits INSERT/UPDATE silently.
-- ---------------------------------------------------------------------------
REVOKE ALL ON scheme_versions FROM kv_app, kv_relay;
GRANT SELECT ON scheme_versions TO kv_app;
GRANT SELECT, INSERT, UPDATE ON scheme_versions TO kv_admin;
GRANT SELECT ON scheme_versions TO kv_readonly;

-- no tenant_id and therefore no RLS, exactly as `schemes` and `scheme_authorities`: a government scheme is global
-- platform data. The generic RLS sweep only fires on tables carrying tenant_id, so nothing to opt out of here.

-- ---------------------------------------------------------------------------
-- THE POINTER THAT MAKES A SNAPSHOT REAL
-- ---------------------------------------------------------------------------
ALTER TABLE scheme_applications
  ADD COLUMN scheme_version_id uuid REFERENCES scheme_versions(id);

COMMENT ON COLUMN scheme_applications.scheme_version_id IS
  'The rule set this application was filed under. NULL means unresolvable: filed before 0105 under a version whose rules were overwritten in place and are not recoverable. Never treat NULL as "the current version".';

CREATE INDEX idx_scheme_apps_version ON scheme_applications (scheme_version_id) WHERE scheme_version_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BACKFILL — the current rules, as the current version, unsigned.
-- ---------------------------------------------------------------------------
INSERT INTO scheme_versions (
  scheme_id, version, status, benefit_summary, eligibility_rules, required_doc_type_ids,
  application_window, applicable_region_ids, processing_fee_minor, change_reason,
  drafted_by, drafted_at, published_at, is_backfilled
)
SELECT s.id, s.version, 'published', s.benefit_summary, s.eligibility_rules, s.required_doc_type_ids,
       s.application_window, s.applicable_region_ids, s.processing_fee_minor,
       'Backfilled by migration 0105 from the live schemes row. Nobody drafted or published this version through the '
       || 'maker-checker path — it is a record of what the row said when versioning was introduced. Versions below v'
       || s.version::text || ' were overwritten in place and are not recoverable.',
       NULL, s.updated_at, s.updated_at, true
  FROM schemes s
 WHERE s.deleted_at IS NULL;

-- Applications filed under the CURRENT version can be resolved; older ones cannot, and are deliberately left NULL.
-- Reading NULL as "current" is the exact mistake this column exists to prevent, which is why it is documented above
-- rather than defaulted to something convenient.
UPDATE scheme_applications a
   SET scheme_version_id = v.id
  FROM scheme_versions v
 WHERE v.scheme_id = a.scheme_id
   AND v.version   = a.scheme_version
   AND a.scheme_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- DELTA-018 — PER-AUTHORITY PORTAL MAPPING, WITH NO NEW TABLE
-- ---------------------------------------------------------------------------
-- W072 shows a "Portal sync" column reading connected/manual and its own footnote calls the backing
-- "per-authority sync config BACKEND PENDING (DELTA-018)". The answer is the same one DELTA-008 got in 0104:
-- `external_entity_refs` (0015) already models internal-entity → provider → external-id with UNIQUE both ways, and
-- its entity_type is a free varchar precisely so new kinds need no migration. An authority's portal is exactly that
-- shape. What it needs is provider rows to point at, since provider_code is an FK.
--
-- AND A WORD WE REFUSE TO PRINT. The canon's value is "connected". A mapping row means somebody recorded WHICH
-- portal an authority files through — it does not mean a request has ever succeeded, and no code in this monorepo
-- calls any of these portals. So the console says "portal mapped", never "connected": an operator who reads
-- "connected" will stop chasing a filing that is not happening. Credentials stay in Secrets Manager (W072's own
-- rule) and never appear in this table — `external_entity_refs.payload` holds the endpoint label only.
INSERT INTO integration_providers (code, default_name, category, is_active) VALUES
  ('pfms',    'PFMS (Public Financial Management System)', 'government', true),
  ('ikhedut', 'iKhedut (Gujarat Agriculture Department portal)', 'government', true),
  ('pmkisan', 'PM-KISAN portal (Ministry of Agriculture & Farmers Welfare)', 'government', true)
ON CONFLICT (code) DO NOTHING;

CREATE INDEX idx_extrefs_scheme_authority ON external_entity_refs (entity_id)
  WHERE entity_type = 'scheme_authority' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE AUDIT LEDGER LEARNS THE NEW VERBS
-- ---------------------------------------------------------------------------
-- `scheme_registry_changes.action` (0042) allows created/updated/activated/deactivated/versioned. A draft opened, a
-- draft discarded, a version published and a portal mapping are four new facts, and without them the version plane
-- would have to log a publish as "updated" — a checker-gated rule change recorded with the same verb as a typo fix
-- in a scheme's name. `entity_type` gains 'scheme_version' for the same reason it gained kinds in 0102: an audit row
-- that cannot name its own object kind is not an audit row.
ALTER TABLE scheme_registry_changes DROP CONSTRAINT IF EXISTS scheme_registry_changes_action_check;
ALTER TABLE scheme_registry_changes ADD CONSTRAINT scheme_registry_changes_action_check CHECK (action IN (
  'created', 'updated', 'activated', 'deactivated', 'versioned',
  'draft_opened', 'draft_updated', 'draft_discarded', 'published', 'bound', 'unbound'
));
ALTER TABLE scheme_registry_changes DROP CONSTRAINT IF EXISTS scheme_registry_changes_entity_type_check;
ALTER TABLE scheme_registry_changes ADD CONSTRAINT scheme_registry_changes_entity_type_check CHECK (entity_type IN (
  'authority', 'scheme', 'scheme_version', 'authority_portal'
));
