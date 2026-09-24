-- ==================================================================================================================
-- 0173 · PC-56 TENANT-7d · THE INSTRUCTOR — W410 (studio home), W419 (profile & credentials) + the instructor-form
--        (W2636–W2639), instructor-mutate (W2640–W2642) and studio-form (W2775–W2778) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- ==================================================================================================================
--
-- W419: *"Profile & credentials · is_verified"* · *"Learners trust the person before the playlist."* · *"Bio · Languages
--        taught · Credentials — Add credential — BVSc & AH — GAU · verified against the certificate face"* · *"Credential
--        rejected · Reason: the certificate photo was too blurred … Re-upload a clearer scan"* · *"No credentials added
--        yet — Add at least one qualification to apply for verified-instructor status."*
-- W410: *"Dr. Kalpana Joshi · verified instructor"* · *"Studio access needed — This tenant hasn't marked you an instructor
--        yet — ask your tenant admin to verify your credentials."* · *"Start from a template — outline, quiz and publish
--        checklist already scaffolded."*
--
-- WHAT THE WAVE IS DECLARED AS (7a's survey, verbatim): *"`is_verified` is INSERTed `false` and written by nothing
-- anywhere (no admin-api surface); credentials, languages taught and a rating have no table; the instructor's display
-- name is not on the row."* A "verified instructor" badge is a TRUST surface (Law 12 of this programme: render only
-- verified truth). So before the badge can be drawn, WHO verifies and HOW it is revoked must exist: the tenant's content
-- desk (`course.publish`) verifies, with maker ≠ checker as a wall in the database (the desk user cannot be the
-- instructor being verified — 7a's rule for publish, 0170's trigger, applied to a person instead of a course), on the
-- strength of AT LEAST ONE ACCEPTED CREDENTIAL — a document the instructor uploaded through core/media (store · scan ·
-- serve) that the same desk ACCEPTED or REJECTED with a note the instructor reads on W419. *"Verified against the
-- certificate face"* is a human's act here: nothing on this platform matches a face or reads a certificate
-- (`grep -rniE "ocr|face.?match" apps/api/src` → 0), and W419's *Retry* on *"Couldn't verify the credential"* is refused
-- by name on the page — there is no automated check to retry.
--
-- FOUND ON THE WAY IN (7b's and 7c's defect class, a third time): `lesson_progress` HAS NO ROW-LEVEL SECURITY. 0012 gave
-- it a PK of (enrollment_id, lesson_id) and no tenant_id; its repository comments *"gated via the enrollment join"*, and
-- `v_tables_without_rls` never listed it because the view keys on a tenant_id column. `kv_app` holds SELECT/INSERT/UPDATE
-- on every learner's watch-seconds and quiz scores across every tenant, with no policy. W410's *"Watch-hours"* tile is
-- the first read of this table by an instructor-facing surface; it is not read until the row has a wall. The row gets
-- the enrollment's `tenant_id` by trigger, backfilled, ENABLE + FORCE.
--
-- WHAT THE TILE CANNOT SAY: `lesson_progress` has no timestamp (no add_std_columns, no `updated_at`), so *"Watch-hours
-- THIS MONTH"* has no fact to compute from. Lifetime watch-seconds are a sum; the month is not measured, and the page
-- says so. (Adding a timestamp here would date only future writes; the honest column is a follow-up, named.)
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   • `instructors`: under 0027's idempotent pass already (`tenant_id IS NULL OR tenant_id = current_tenant_id()`;
--     NULL = a platform instructor, readable by every tenant — the KVK trainer, by design). Unchanged; new columns only.
--   • `instructor_credentials`: NEW. `tenant_id` NOT NULL, copied from the instructor's row by a BEFORE trigger, which
--     REFUSES a credential on a platform instructor (tenant_id NULL — their record is admin-api's, Law 11). ENABLE +
--     FORCE, policy `tenant_id = current_tenant_id()`. REVOKE ALL from kv_app and kv_relay first, then GRANT SELECT,
--     INSERT, UPDATE to kv_app (an instructor files and re-files; the desk reviews; nothing deletes — `withdrawn` is a
--     status), nothing to kv_relay (no job reads a credential).
--   • `lesson_progress`: NEW `tenant_id` (NOT NULL after backfill — an enrollment always has a tenant), written by a
--     BEFORE trigger from the enrollment, ENABLE + FORCE, policy `tenant_id = current_tenant_id()`. kv_app keeps its 0014
--     default SELECT/INSERT/UPDATE; DELETE was never granted.
--   • `course_templates`: NEW platform registry (Law 6: *"templates come from DB"*) — `tenant_id` NULL = a platform
--     template, readable by every tenant; a tenant's own templates are readable by that tenant (policy `tenant_id IS
--     NULL OR tenant_id = current_tenant_id()`, ENABLE + FORCE). REVOKE ALL from kv_app and kv_relay, then GRANT SELECT
--     to kv_app: nothing in apps/api writes a template (a tenant authoring its own is NAMED, not built).
--
-- PARTITION NOTE. None of the four is partitioned and none should be. An instructor has a handful of credentials; a
-- tenant has tens of instructors; the platform has tens of templates. `lesson_progress` is the module's hot table
-- (one row per learner × lesson) and stays unpartitioned as 0012 made it: 10⁶ learners × 30 lessons is 3·10⁷ rows a
-- decade out, which the PK and the new (tenant_id, enrollment_id) index serve; partitioning it is a decision for the
-- day a shard fills, not this one. `ON CONFLICT` is asked of no nullable key anywhere here (6c-4): the credentials
-- table has no upsert, and the templates' uniqueness is a partial unique index the seed's `ON CONFLICT DO NOTHING`
-- resolves against (arbiter: the index over `(code) WHERE tenant_id IS NULL`).
-- ------------------------------------------------------------------------------------------------------------------

-- 0173.1 · the instructor the row could not hold
ALTER TABLE instructors
  ADD COLUMN IF NOT EXISTS display_name      varchar(120),
  ADD COLUMN IF NOT EXISTS languages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visibility        varchar(10) NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by       uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verification_note varchar(300);

COMMENT ON COLUMN instructors.display_name      IS 'PC-56 TENANT-7d · the name learners see on the course (W179, W410 "Dr. Kalpana Joshi"). NULL = the user''s full_name. 7a printed a note where the name should be.';
COMMENT ON COLUMN instructors.languages         IS 'PC-56 TENANT-7d · W419 "Languages taught": an array of codes from the `languages` registry (Law 6), validated by the review against is_active rows. Never a free string.';
COMMENT ON COLUMN instructors.visibility        IS 'PC-56 TENANT-7d · public = the profile is shown to learners on the course; private = only the instructor and the tenant desk read it. The instructor''s own choice.';
COMMENT ON COLUMN instructors.is_verified       IS 'PC-56 TENANT-7d · W419 "is_verified" / W410 "verified instructor". Since 0012 INSERTed false and written by NOTHING (no route, no admin surface). Written now only by the verify/unverify ACTS of the tenant desk (course.publish), maker ≠ checker enforced by trg_instructors_verify_checker, on the strength of at least one accepted credential (the service''s verdict, NO_ACCEPTED_CREDENTIAL).';
COMMENT ON COLUMN instructors.verified_at       IS 'PC-56 TENANT-7d · when the desk verified. NULL when not verified (is_verified false).';
COMMENT ON COLUMN instructors.verified_by       IS 'PC-56 TENANT-7d · the desk user who verified — never the instructor''s own user (trigger). The revocation''s actor is on the audit row (education.instructor.unverify).';
COMMENT ON COLUMN instructors.verification_note IS 'PC-56 TENANT-7d · the desk''s note on verification, read by the instructor on W419. The reason is also the audit row''s.';

-- widen before CHECK: every existing row has is_verified=false and NULL instants, so all three pass
ALTER TABLE instructors ADD CONSTRAINT ck_instructors_verified_whole CHECK ((is_verified = (verified_at IS NOT NULL)) AND ((verified_at IS NULL) = (verified_by IS NULL)));
ALTER TABLE instructors ADD CONSTRAINT ck_instructors_languages_array CHECK (jsonb_typeof(languages) = 'array');
ALTER TABLE instructors ADD CONSTRAINT ck_instructors_visibility CHECK (visibility IN ('public','private'));

-- MAKER ≠ CHECKER, as a wall behind the service's door (0170's shape): the person verified cannot be the verifier.
CREATE OR REPLACE FUNCTION instructors_verify_checker() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_verified AND NEW.verified_by IS NOT NULL AND NEW.verified_by = NEW.user_id THEN
    RAISE EXCEPTION 'instructors: % cannot verify their own instructor record — PC-56 TENANT-7d maker-checker', NEW.user_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_instructors_verify_checker ON instructors;
CREATE TRIGGER trg_instructors_verify_checker BEFORE INSERT OR UPDATE OF is_verified, verified_by ON instructors
  FOR EACH ROW EXECUTE FUNCTION instructors_verify_checker();

-- the desk's list: this tenant's instructors by verification state
CREATE INDEX IF NOT EXISTS idx_instructors_tenant_verified ON instructors (tenant_id, is_verified, created_at DESC) WHERE deleted_at IS NULL;

-- 0173.2 · credentials — the documents a verification stands on
CREATE TABLE IF NOT EXISTS instructor_credentials (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  instructor_id     uuid NOT NULL REFERENCES instructors(id),
  title             varchar(200) NOT NULL,             -- "BVSc & AH"
  issuer            varchar(200),                      -- "GAU (Gujarat Agricultural University)"
  year_awarded      integer,
  document_media_id uuid NOT NULL REFERENCES media_assets(id),   -- the scan, in THIS tenant's bucket (image or document)
  status            varchar(12) NOT NULL DEFAULT 'submitted',    -- submitted | accepted | rejected | withdrawn
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES users(id),
  review_note       varchar(300)                       -- W419 "Reason: the certificate photo was too blurred …"
);
CALL add_std_columns('instructor_credentials');
COMMENT ON TABLE instructor_credentials IS 'PC-56 TENANT-7d · W419 "Credentials". One row per qualification an instructor files, with the scan as a core/media document and the tenant desk''s review (accepted · rejected with a note · withdrawn by the instructor). A verification stands on at least one accepted row.';
COMMENT ON COLUMN instructor_credentials.status IS 'PC-56 TENANT-7d · submitted (filed, awaiting the desk) · accepted (the desk checked the document — W419 "verified against the certificate": a person''s act, nothing here reads a face) · rejected (with review_note; a re-upload returns it to submitted) · withdrawn (by the instructor; final).';

ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_status CHECK (status IN ('submitted','accepted','rejected','withdrawn'));
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_title_present CHECK (length(btrim(title)) > 0);
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_year CHECK (year_awarded IS NULL OR year_awarded BETWEEN 1900 AND 2100);
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_review_whole CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL));
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_reviewed_signed CHECK (status NOT IN ('accepted','rejected') OR reviewed_by IS NOT NULL);
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_rejected_has_note CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0));
ALTER TABLE instructor_credentials ADD CONSTRAINT ck_ic_submitted_unreviewed CHECK (status <> 'submitted' OR reviewed_at IS NULL);

-- the tenant from the instructor; a platform instructor's credentials are not a tenant's to file (Law 11)
CREATE OR REPLACE FUNCTION instructor_credentials_tenant_from_instructor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t uuid; found boolean;
BEGIN
  SELECT i.tenant_id, true INTO t, found FROM instructors i WHERE i.id = NEW.instructor_id AND i.deleted_at IS NULL;
  IF found IS NOT TRUE THEN
    RAISE EXCEPTION 'instructor_credentials: instructor % is not visible to this session — PC-56 TENANT-7d', NEW.instructor_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF t IS NULL THEN
    RAISE EXCEPTION 'instructor_credentials: instructor % is a platform instructor; its record is admin-api''s (Law 11) — PC-56 TENANT-7d', NEW.instructor_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ic_tenant ON instructor_credentials;
CREATE TRIGGER trg_ic_tenant BEFORE INSERT OR UPDATE OF instructor_id, tenant_id ON instructor_credentials
  FOR EACH ROW EXECUTE FUNCTION instructor_credentials_tenant_from_instructor();

-- MAKER ≠ CHECKER on the credential: the instructor cannot accept or reject their own document
CREATE OR REPLACE FUNCTION instructor_credentials_review_checker() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
  IF NEW.status IN ('accepted','rejected') AND NEW.reviewed_by IS NOT NULL THEN
    SELECT i.user_id INTO owner FROM instructors i WHERE i.id = NEW.instructor_id;
    IF owner IS NOT NULL AND owner = NEW.reviewed_by THEN
      RAISE EXCEPTION 'instructor_credentials: the instructor of % cannot review their own credential — PC-56 TENANT-7d maker-checker', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ic_review_checker ON instructor_credentials;
CREATE TRIGGER trg_ic_review_checker BEFORE INSERT OR UPDATE OF status, reviewed_by ON instructor_credentials
  FOR EACH ROW EXECUTE FUNCTION instructor_credentials_review_checker();

CREATE INDEX IF NOT EXISTS idx_ic_instructor ON instructor_credentials (tenant_id, instructor_id, submitted_at DESC) WHERE deleted_at IS NULL;
-- the desk's queue: what is waiting
CREATE INDEX IF NOT EXISTS idx_ic_pending ON instructor_credentials (tenant_id, submitted_at) WHERE status = 'submitted' AND deleted_at IS NULL;

ALTER TABLE instructor_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE instructor_credentials FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_instructor_credentials ON instructor_credentials;
CREATE POLICY tenant_isolation_instructor_credentials ON instructor_credentials
  USING (tenant_id = current_tenant_id());

-- LEAST PRIVILEGE: revoke the blanket default grants first, then the narrow ones.
REVOKE ALL ON instructor_credentials FROM kv_app;
REVOKE ALL ON instructor_credentials FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON instructor_credentials TO kv_app;

-- 0173.3 · lesson_progress gets the wall it never had
ALTER TABLE lesson_progress ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE lesson_progress lp SET tenant_id = e.tenant_id FROM enrollments e WHERE e.id = lp.enrollment_id AND lp.tenant_id IS DISTINCT FROM e.tenant_id;
-- a progress row whose enrollment is gone cannot be backfilled and cannot be trusted: none exist (FK), but say so
DELETE FROM lesson_progress WHERE tenant_id IS NULL;
ALTER TABLE lesson_progress ALTER COLUMN tenant_id SET NOT NULL;
COMMENT ON COLUMN lesson_progress.tenant_id IS 'PC-56 TENANT-7d · the enrollment''s tenant, copied by trg_lp_tenant. Exists so RLS can hold the row, not only the join (0012 had none; the repository''s comment called the join its wall).';

CREATE OR REPLACE FUNCTION lesson_progress_tenant_from_enrollment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t uuid; found boolean;
BEGIN
  SELECT e.tenant_id, true INTO t, found FROM enrollments e WHERE e.id = NEW.enrollment_id;
  IF found IS NOT TRUE THEN
    RAISE EXCEPTION 'lesson_progress: enrollment % is not visible to this session — PC-56 TENANT-7d', NEW.enrollment_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lp_tenant ON lesson_progress;
CREATE TRIGGER trg_lp_tenant BEFORE INSERT OR UPDATE OF enrollment_id, tenant_id ON lesson_progress
  FOR EACH ROW EXECUTE FUNCTION lesson_progress_tenant_from_enrollment();

CREATE INDEX IF NOT EXISTS idx_lp_tenant_enrollment ON lesson_progress (tenant_id, enrollment_id);

ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lesson_progress ON lesson_progress;
CREATE POLICY tenant_isolation_lesson_progress ON lesson_progress
  USING (tenant_id = current_tenant_id());
REVOKE DELETE ON lesson_progress FROM kv_app;

-- 0173.4 · course templates — W410 / W2775 "Start from template": a registry, so the button is honest (Law 6)
CREATE TABLE IF NOT EXISTS course_templates (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid REFERENCES tenants(id),              -- NULL = platform template
  code        varchar(60) NOT NULL,
  title       varchar(250) NOT NULL,                    -- the course title the form opens with
  topic_code  varchar(40) NOT NULL,                     -- a `course_topic` lookup code; the review refuses TOPIC_UNKNOWN if the registry lacks it
  level       varchar(15) NOT NULL DEFAULT 'basic',
  outline     jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{"title": "...", "lessons": [{"title": "...", "kind": "article|video|audio|pdf|quiz"}]}]
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  smallint NOT NULL DEFAULT 100
);
CALL add_std_columns('course_templates');
COMMENT ON TABLE course_templates IS 'PC-56 TENANT-7d · W410 "Start from a template — outline, quiz and publish checklist already scaffolded". The outline becomes a DRAFT course with draft lessons (quiz lessons with no questions yet); the publish checklist is W416''s gate, which every course already has. Platform rows (tenant_id NULL) are seeded (db/seeds/core/0018); a tenant authoring its own is named, not built.';
ALTER TABLE course_templates ADD CONSTRAINT ck_ct_level CHECK (level IN ('basic','intermediate','advanced'));
ALTER TABLE course_templates ADD CONSTRAINT ck_ct_outline_array CHECK (jsonb_typeof(outline) = 'array');
ALTER TABLE course_templates ADD CONSTRAINT ck_ct_code_present CHECK (length(btrim(code)) > 0);
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_templates_platform_code ON course_templates (code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_templates_tenant_code ON course_templates (tenant_id, code) WHERE tenant_id IS NOT NULL;

ALTER TABLE course_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_course_templates ON course_templates;
CREATE POLICY tenant_isolation_course_templates ON course_templates
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

REVOKE ALL ON course_templates FROM kv_app;
REVOKE ALL ON course_templates FROM kv_relay;
GRANT SELECT ON course_templates TO kv_app;
GRANT SELECT ON course_templates TO kv_readonly;
