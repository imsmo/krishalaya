-- ==================================================================================================================
-- 0171 · PC-56 TENANT-7b · THE LESSON & THE QUIZ — W411 (course builder / the outline), W412 (lesson video), W413
--        (quiz builder) + the lesson-form (W2664–W2667), lesson-mutate (W2668–W2670) and quiz-form (W2727–W2730) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- ==================================================================================================================
--
-- W411: *"Every video lesson MUST have an audio-only sibling — the 2G fallback (W-D20 canon). The outline below pairs
--        them; the rule is the default, not a preference."*  *"Reorder lesson 1 (keyboard: move up/down controls)"*
-- W412: *"Chapters … 00:00 — Why colostrum, in the first hour"* · *"Thumbnail — frame at 02:31 — always a real frame of
--        THIS lesson, never a stock photo"* · *"Subtitle tracks — ગુજરાતી (gu) human-reviewed · English (en) AI draft
--        — review before publish"* · *"Mark ready"*
-- W413: *"Options — each needs an explanation (mandatory)"* · *"Passing threshold (certificate only) — below this, the
--        learner keeps the course and can retry — content never locks."*
-- W416 (7a): six of seven gate checks printed `not_measured` because every one of them is a column on the LESSON record
--        that `course_lessons` (0012) did not have. This file adds those columns; the gate in code stops saying
--        "not measured" the moment they exist (TENANT-6d-2's rule: a refusal left standing after the thing was built is
--        the same defect as a claim that stopped being true).
--
-- WHAT THE ROW COULD NOT HOLD. `course_lessons` is title · kind · media · body · duration · quiz. No link from a video
-- to its audio twin, no chapter marks, no thumbnail frame, no subtitle track in any language, no passing threshold, no
-- per-option explanation (the quiz JSON is `{questions:[{q,options,answer,hint?}]}`), and no state of its own — so
-- *"Mark ready"* was a button over nothing and *"reorder"* was a delete+insert nothing performed (the row's only
-- position is its UNIQUE (course, module, lesson) key).
--
-- FOUND ON THE WAY IN: `course_lessons` HAD NO ROW-LEVEL SECURITY. It carries no `tenant_id`, so 0014's idempotent RLS
-- pass skipped it and `v_tables_without_rls` (which keys on that column) never listed it. Every read in the module
-- joins `courses` and filters the tenant there — correct, and the reason no leak has been observed — but a table that
-- `kv_app` can read and write with no policy is a wall that exists only as long as every future query remembers to
-- write the join. This file gives the row a `tenant_id` (copied from its course by a trigger, so a writer cannot get it
-- wrong), backfills it, and puts the same policy on it that `courses` has. The new subtitle table is born with both.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   • `course_lessons`: NEW `tenant_id` (nullable — a platform-library course has none, exactly as on `courses`),
--     ENABLE + FORCE, policy `tenant_id IS NULL OR tenant_id = current_tenant_id()` — the 0014 shape, so the platform
--     library's lessons are readable by every tenant (the application filters the library to PUBLISHED courses through
--     the course join, 7a's `libraryVisible()`, as it does for the course row itself). `kv_app`'s existing table-level
--     SELECT/INSERT/UPDATE (0014 default privileges) stands; nothing wider is granted. The tenant_id is written by a
--     BEFORE trigger from the course row, so the column can never disagree with the course it hangs off.
--   • `course_lesson_subtitles`: NEW table, same policy, ENABLE + FORCE. REVOKE ALL from kv_app and kv_relay first
--     (0014/0018 default privileges would otherwise hand both a blanket grant), then GRANT SELECT, INSERT, UPDATE to
--     kv_app only. Nobody deletes a track: a track is replaced by its next version, and `deleted_at` is there if a
--     later wave needs a soft retirement. kv_relay has no business on it (no job reads subtitles).
--
-- PARTITION NOTE. Neither table is partitioned and neither should be. A course has tens of lessons and a lesson has one
-- track per language the tenant teaches in (three at launch); a district union with a thousand courses holds
-- ~10⁴ lessons and ~3·10⁴ tracks. The hot tables of this module remain `enrollments` and `lesson_progress` (untouched).
-- The index on `(tenant_id, course_id, module_no, lesson_no)` is the outline's read; the partial unique index on
-- `sibling_lesson_id` is the pairing rule (one audio twin serves one video) and is over NOT NULL values only, so
-- `ON CONFLICT` is never asked to fire on a nullable key (6c-4's finding).
-- ------------------------------------------------------------------------------------------------------------------

-- 0171.1 · the lesson's own state, its pairing, its frame, its chapters, its threshold
ALTER TABLE course_lessons
  ADD COLUMN IF NOT EXISTS tenant_id             uuid REFERENCES tenants(id),
  ADD COLUMN IF NOT EXISTS status                varchar(10) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS ready_at              timestamptz,
  ADD COLUMN IF NOT EXISTS ready_by              uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS sibling_lesson_id     uuid REFERENCES course_lessons(id),
  ADD COLUMN IF NOT EXISTS thumbnail_frame_secs  integer,
  ADD COLUMN IF NOT EXISTS chapters              jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quiz_passing_pct      smallint;

COMMENT ON COLUMN course_lessons.tenant_id            IS 'PC-56 TENANT-7b · the course''s tenant, copied by trg_course_lessons_tenant (NULL = platform library). Exists so RLS can hold the row, not only the join.';
COMMENT ON COLUMN course_lessons.status               IS 'PC-56 TENANT-7b · draft | ready. W412 "Mark ready" (draft → ready) and "reopen" (ready → draft); a ready lesson is not edited until reopened. Transitions live in domain/lesson.state.ts.';
COMMENT ON COLUMN course_lessons.ready_at             IS 'PC-56 TENANT-7b · when the lesson was last marked ready. NULL while draft.';
COMMENT ON COLUMN course_lessons.ready_by             IS 'PC-56 TENANT-7b · who marked it ready. The reason is in audit_log (education.lesson.ready).';
COMMENT ON COLUMN course_lessons.sibling_lesson_id    IS 'PC-56 TENANT-7b · on a VIDEO lesson: its audio-only twin in the same course (W411 "every video lesson MUST have an audio-only sibling"). One twin serves one video (uq_course_lessons_sibling).';
COMMENT ON COLUMN course_lessons.thumbnail_frame_secs IS 'PC-56 TENANT-7b · on a VIDEO lesson: the second of THIS lesson''s own video that is its thumbnail (W412 "frame at 02:31 — never a stock photo"). Stored as a time into the lesson; nothing on this platform extracts the frame (core/media has no codec), so it is a declaration the gate can measure, not a rendered image.';
COMMENT ON COLUMN course_lessons.chapters             IS 'PC-56 TENANT-7b · [{at: seconds, title}] in increasing order of `at`, within the lesson''s duration (W412 "Chapters"). Empty array = no chapters.';
COMMENT ON COLUMN course_lessons.quiz_passing_pct     IS 'PC-56 TENANT-7b · on a QUIZ lesson: 0–100, the certificate threshold (W413 "gates the certificate only — never the next lesson"). NULL = not declared; the gate refuses a quiz without one.';

-- 0171.2 · backfill the tenant from the course, before the trigger and the policy exist
UPDATE course_lessons l SET tenant_id = c.tenant_id FROM courses c WHERE c.id = l.course_id AND l.tenant_id IS DISTINCT FROM c.tenant_id;

-- 0171.3 · the constraints (widen before CHECK: the columns above are new or defaulted, so every existing row passes)
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_status CHECK (status IN ('draft','ready'));
-- ready is an act with an actor and an instant, both or neither — and the status agrees with them.
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_ready_whole CHECK ((ready_at IS NULL) = (ready_by IS NULL));
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_ready_status CHECK (status <> 'ready' OR ready_at IS NOT NULL);
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_not_own_sibling CHECK (sibling_lesson_id IS NULL OR sibling_lesson_id <> id);
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_thumbnail_nonneg CHECK (thumbnail_frame_secs IS NULL OR thumbnail_frame_secs >= 0);
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_passing_pct CHECK (quiz_passing_pct IS NULL OR (quiz_passing_pct BETWEEN 0 AND 100));
ALTER TABLE course_lessons ADD CONSTRAINT ck_course_lessons_chapters_array CHECK (jsonb_typeof(chapters) = 'array');
-- a lesson number is a position, and positions start at 1 (the reorder act renumbers through negatives inside its
-- own transaction, which is why this is NOT a CHECK on lesson_no > 0: the swap would violate it mid-statement)

-- one audio twin serves one video; partial, over NOT NULL values only
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_lessons_sibling ON course_lessons (sibling_lesson_id) WHERE sibling_lesson_id IS NOT NULL;
-- the outline's read
CREATE INDEX IF NOT EXISTS idx_course_lessons_outline ON course_lessons (tenant_id, course_id, module_no, lesson_no);

-- 0171.4 · the tenant is the course's, always — written by the database, not trusted from the writer
CREATE OR REPLACE FUNCTION course_lessons_tenant_from_course() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t uuid; found boolean;
BEGIN
  SELECT c.tenant_id, true INTO t, found FROM courses c WHERE c.id = NEW.course_id;
  IF found IS NOT TRUE THEN
    RAISE EXCEPTION 'course_lessons: course % is not visible to this session — PC-56 TENANT-7b', NEW.course_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_course_lessons_tenant ON course_lessons;
CREATE TRIGGER trg_course_lessons_tenant BEFORE INSERT OR UPDATE OF course_id, tenant_id ON course_lessons
  FOR EACH ROW EXECUTE FUNCTION course_lessons_tenant_from_course();

-- 0171.5 · the policy the row never had
ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_course_lessons ON course_lessons;
CREATE POLICY tenant_isolation_course_lessons ON course_lessons
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- 0171.6 · subtitle tracks — one per (lesson, language)
CREATE TABLE IF NOT EXISTS course_lesson_subtitles (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid REFERENCES tenants(id),                  -- the lesson's course's tenant; NULL = platform library
  lesson_id     uuid NOT NULL REFERENCES course_lessons(id),
  language_code varchar(8) NOT NULL REFERENCES languages(code),
  status        varchar(20) NOT NULL DEFAULT 'draft',         -- draft | reviewed
  body          text NOT NULL,                                -- WebVTT or plain timed text, as the instructor gave it
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES users(id),
  UNIQUE (lesson_id, language_code)
);
CALL add_std_columns('course_lesson_subtitles');
ALTER TABLE course_lesson_subtitles ADD CONSTRAINT ck_cls_status CHECK (status IN ('draft','reviewed'));
ALTER TABLE course_lesson_subtitles ADD CONSTRAINT ck_cls_review_whole CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL));
ALTER TABLE course_lesson_subtitles ADD CONSTRAINT ck_cls_reviewed_signed CHECK (status <> 'reviewed' OR reviewed_by IS NOT NULL);
ALTER TABLE course_lesson_subtitles ADD CONSTRAINT ck_cls_body_present CHECK (length(body) > 0);
CREATE INDEX IF NOT EXISTS idx_cls_lesson ON course_lesson_subtitles (tenant_id, lesson_id);

COMMENT ON TABLE course_lesson_subtitles IS 'PC-56 TENANT-7b · W412 "Subtitle tracks". One track per lesson and language, as text. `status` is draft (typed or pasted, unreviewed) or reviewed (a human marked it reviewed — the canon''s "human-reviewed"). This platform has no speech-to-text provider, so there is no "AI draft" state: a track exists because a person supplied it.';

CREATE OR REPLACE FUNCTION course_lesson_subtitles_tenant_from_lesson() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t uuid; found boolean;
BEGIN
  SELECT l.tenant_id, true INTO t, found FROM course_lessons l WHERE l.id = NEW.lesson_id;
  IF found IS NOT TRUE THEN
    RAISE EXCEPTION 'course_lesson_subtitles: lesson % is not visible to this session — PC-56 TENANT-7b', NEW.lesson_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cls_tenant ON course_lesson_subtitles;
CREATE TRIGGER trg_cls_tenant BEFORE INSERT OR UPDATE OF lesson_id, tenant_id ON course_lesson_subtitles
  FOR EACH ROW EXECUTE FUNCTION course_lesson_subtitles_tenant_from_lesson();

ALTER TABLE course_lesson_subtitles ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lesson_subtitles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_course_lesson_subtitles ON course_lesson_subtitles;
CREATE POLICY tenant_isolation_course_lesson_subtitles ON course_lesson_subtitles
  USING (tenant_id IS NULL OR tenant_id = current_tenant_id());

-- LEAST PRIVILEGE: revoke the blanket default grants first, then the narrow one.
REVOKE ALL ON course_lesson_subtitles FROM kv_app;
REVOKE ALL ON course_lesson_subtitles FROM kv_relay;
GRANT SELECT, INSERT, UPDATE ON course_lesson_subtitles TO kv_app;
