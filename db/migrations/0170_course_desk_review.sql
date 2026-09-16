-- ==================================================================================================================
-- 0170 · PC-56 TENANT-7a · THE COURSE RECORD & THE DESK — W178 (courses), W179 (course detail), W416 (review &
--        publish) + the course-form (W2546–W2549) and course-mutate (W2550–W2552) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- ==================================================================================================================
--
-- W416: *"This screen submits to the tenant content desk — publish is the desk's act, not yours (maker-checker)."*
--       *"Returned with notes — the tenant content desk sent this back kindly: 'Lesson 6's ration numbers need a
--        source citation — otherwise ready.' Fix and resubmit."*
-- W179: *"Archive course — Reason * … This action is recorded."*
--
-- WHAT THE TABLE COULD NOT HOLD. `courses` (0012) is a status column and nothing about how it got there. The state
-- machine (`course.state.ts`) has admitted `review → draft` since PC-26 and NO route, service or column performed it,
-- so W416's "Returned with notes" state described an act this platform could not do and a note it had nowhere to
-- keep. Nothing recorded WHO submitted a course, WHO published it, or WHEN — so maker-checker on publish was a sentence
-- in a canon file and not a rule anything could enforce, and `CourseService.publish` let the course's own instructor
-- publish their own course whenever they also held `course.publish`.
--
-- This migration adds the desk's memory to the course row: who submitted and when, who reviewed and when, the desk's
-- note when a course is returned, and the instants a course was published and archived. The REASON for every act goes
-- to `audit_log` (the chain's promise: actor · time · reason · before/after), not here — the row keeps the desk's
-- last word because the instructor reads it on W416, and the audit trail keeps every word because the auditor does.
--
-- MAKER ≠ CHECKER, AS A CONSTRAINT AND NOT ONLY A VERDICT (6c-3's rule, applied to content). A trigger refuses a
-- `review → published` transition whose `reviewed_by` is the user behind the course's own instructor row. The
-- service refuses it first with a named reason; the trigger is the wall behind the door, so a job, a script or a
-- future caller cannot walk past the rule the way 6d-4 found a DTO-only rule could be walked past.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION. No new table. `courses` stays under `tenant_isolation_courses` (0014/0020: `tenant_id IS NULL OR
-- tenant_id = current_tenant_id()`, ENABLED + FORCED — verified by the gate at this wave's baseline). The new columns
-- inherit `kv_app`'s existing table-level INSERT/UPDATE/SELECT on `courses`; no wider grant is made and none is
-- needed, so there is no REVOKE/GRANT block here — the narrowing pattern applies to NEW tables, and this file creates
-- none. The trigger function is SECURITY INVOKER (default) and reads `instructors` under the caller's own RLS, which is
-- the right scope: a tenant's course can only ever have a tenant's or a platform instructor, and both are visible to
-- the policy that already applies.
--
-- PARTITION NOTE. `courses` is not partitioned and should not be: a cooperative authors tens of courses over its life,
-- a district union hundreds; the hot tables of this module are `enrollments` and `lesson_progress`, untouched here.
-- The one new index is partial on `status='review'` — the desk's queue — and is tiny by construction.
-- ------------------------------------------------------------------------------------------------------------------

-- 0170.1 · the desk's memory on the course row
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS submitted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by  uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by   uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS review_note   text,
  ADD COLUMN IF NOT EXISTS published_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at   timestamptz;

COMMENT ON COLUMN courses.submitted_at IS 'PC-56 TENANT-7a · when the instructor last submitted for review (draft → review). NULL until the first submission.';
COMMENT ON COLUMN courses.submitted_by IS 'PC-56 TENANT-7a · the MAKER — who submitted. The checker on publish must differ (trg_courses_checker_is_not_maker).';
COMMENT ON COLUMN courses.reviewed_at  IS 'PC-56 TENANT-7a · when the desk last acted (published or returned).';
COMMENT ON COLUMN courses.reviewed_by  IS 'PC-56 TENANT-7a · the CHECKER — who published or returned the course.';
COMMENT ON COLUMN courses.review_note  IS 'PC-56 TENANT-7a · the desk''s note when a course was RETURNED (review → draft), W416 "Returned with notes". Cleared on the next submission.';
COMMENT ON COLUMN courses.published_at IS 'PC-56 TENANT-7a · first instant the course reached published. Never cleared by pause.';
COMMENT ON COLUMN courses.archived_at  IS 'PC-56 TENANT-7a · the terminal instant. The reason is in audit_log (education.course.archive).';

-- 0170.2 · rows that predate this file. A course already `published` has no published_at to show; the row's
-- updated_at is the closest fact this platform holds and is written AS the instant with no claim to be exact — the
-- alternative was refusing the CHECK above on every pre-existing published course. Same for archived. A course in
-- `review` predating this file has no submitter on record: it is moved back to `draft`, because the desk cannot
-- check a submission nobody is recorded as having made, and the instructor resubmits (one click, audited).
UPDATE courses SET published_at = COALESCE(published_at, updated_at, created_at) WHERE status IN ('published','paused') AND published_at IS NULL;
UPDATE courses SET archived_at  = COALESCE(archived_at,  updated_at, created_at) WHERE status = 'archived' AND archived_at IS NULL;
UPDATE courses SET status = 'draft' WHERE status = 'review' AND submitted_at IS NULL;

-- 0170.3 · the constraints
-- A note is the desk's word, so it always names who wrote it.
ALTER TABLE courses ADD CONSTRAINT ck_courses_note_is_signed
  CHECK (review_note IS NULL OR reviewed_by IS NOT NULL);
-- A submission is an act with an actor and an instant, both or neither.
ALTER TABLE courses ADD CONSTRAINT ck_courses_submission_whole
  CHECK ((submitted_at IS NULL) = (submitted_by IS NULL));
ALTER TABLE courses ADD CONSTRAINT ck_courses_review_whole
  CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL));
-- The status the row is in and the instants that got it there agree.
ALTER TABLE courses ADD CONSTRAINT ck_courses_status_instants
  CHECK (
    (status <> 'review'    OR submitted_at IS NOT NULL) AND
    (status <> 'published' OR published_at IS NOT NULL) AND
    (status <> 'archived'  OR archived_at  IS NOT NULL)
  );

-- 0170.4 · the desk's queue
CREATE INDEX IF NOT EXISTS idx_courses_review_desk ON courses(tenant_id, submitted_at) WHERE status='review';

-- 0170.5 · maker ≠ checker, as a wall behind the service's door
CREATE OR REPLACE FUNCTION courses_checker_is_not_maker() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE maker uuid;
BEGIN
  IF NEW.status = 'published' AND OLD.status = 'review' THEN
    IF NEW.reviewed_by IS NULL THEN
      RAISE EXCEPTION 'courses: publishing needs a checker (reviewed_by) — PC-56 TENANT-7a maker-checker'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.submitted_by IS NOT NULL AND NEW.reviewed_by = NEW.submitted_by THEN
      RAISE EXCEPTION 'courses: the user who submitted % cannot also publish it — PC-56 TENANT-7a maker-checker', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT i.user_id INTO maker FROM instructors i WHERE i.id = NEW.instructor_id;
    IF maker IS NOT NULL AND maker = NEW.reviewed_by THEN
      RAISE EXCEPTION 'courses: the instructor of % cannot publish their own course — PC-56 TENANT-7a maker-checker', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_courses_checker_is_not_maker ON courses;
CREATE TRIGGER trg_courses_checker_is_not_maker
  BEFORE UPDATE OF status ON courses
  FOR EACH ROW EXECUTE FUNCTION courses_checker_is_not_maker();

