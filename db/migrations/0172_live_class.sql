-- ==================================================================================================================
-- 0172 · PC-56 TENANT-7c · THE LIVE CLASS — W414 (live schedule), W415 (live host view) + the live-form (W2671–W2674)
--        and live-mutate (W2675–W2677) chains
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction.
-- ==================================================================================================================
--
-- W414: *"Schedule, host, and let the recording carry the lesson forward."* · *"Mastitis: spot it early — Thu 16 Jul,
--        20:30 — 500 — scheduled — Host view"* · *"held Mon 06 Jul, 20:30 — recorded → lesson 7"* · *"Auto-record this
--        class … the recording auto-publishes as a video+audio lesson pair (DELTA-047 — live class scheduling has its own
--        table, separate from ordinary lessons)"* · *"Time clash — soft warning … Schedule anyway"* · *"Capacity above
--        500 needs tenant approval"*
-- W415: *"Attendees 342 of 500 capacity"* · *"End class"* · *"the recording became lesson 7"*
--
-- WHAT THE WAVE IS DECLARED AS (7a's survey, verbatim): **this platform has no video provider.** `STREAM_PROVIDER_URL`
-- unset binds `NoopStreamGateway`, which in prod answers `provider_not_configured`. So the honest object is a SCHEDULED
-- CLASS: a title, its course, its host, an instant in the COOPERATIVE's own timezone, a duration, a capacity, a JOIN
-- LINK the host pastes (the class is held on whatever the cooperative uses — a meet link, a call), attendance as a
-- number the host RECORDS afterwards (never a live counter over a stream nobody runs), and a RECORDING attached
-- through `core/media` (store · scan · serve) and published as a lesson by an ACT a person performs — DELTA-047's
-- "auto-publishes" has no job, and a job that fabricated a lesson out of a file nobody checked would be the wrong job.
--
-- WHAT THE ROW COULD NOT HOLD. `live_sessions` (0027) is title · channel · topic · instant · status · a provider ref ·
-- a playback URL · a recording id. No course (so *"recorded → lesson 7"* had nowhere to point), no duration (so a
-- clash could not be computed — a class is an interval, not an instant), no capacity, no join link, no attendance, no
-- record of WHEN it was cancelled, and its writer required an APPROVED LEARNING CHANNEL — PC-26b's creator-content
-- concept — while the canon's host is the course's INSTRUCTOR. The class was also unreachable by the console: no
-- review, no reason, no audit row, no Idempotency-Key on any of its four routes.
--
-- FOUND ON THE WAY IN (7b's defect class, again): `live_session_registrations` HAS NO ROW-LEVEL SECURITY. 0027 says so
-- in its own comment (*"no tenant_id; gated through the session join"*), 0014's pass skipped it, and `v_tables_without_rls`
-- never listed it. A member's registration to a class is a fact about a person; a table `kv_app` can read with no
-- policy is a wall that exists only while every query remembers the join. This file gives the row the session's
-- `tenant_id` by trigger, backfills it, ENABLE + FORCE.
--
-- ------------------------------------------------------------------------------------------------------------------
-- RLS DECISION.
--   • `live_sessions`: already under 0027's idempotent pass (`tenant_id IS NULL OR tenant_id = current_tenant_id()`;
--     tenant_id is NOT NULL on this table so the first arm is dead). Unchanged. New columns only.
--   • `live_session_registrations`: NEW `tenant_id` (NOT NULL after backfill — a session always has a tenant), written
--     by a BEFORE trigger from the session, ENABLE + FORCE, policy `tenant_id = current_tenant_id()`. `kv_app` keeps its
--     0014 default SELECT/INSERT/UPDATE; DELETE is revoked (a registration is a fact; nothing unregisters — named).
--   • `live_class_reminders`: NEW table — one row per (session, kind) once a reminder has been fanned out, so the
--     cadence job never sends the same reminder twice however many pods tick. REVOKE ALL from kv_app and kv_relay
--     first, then GRANT SELECT to kv_app (the host desk prints "reminded: 1 day · 1 hour") and SELECT, INSERT to
--     kv_relay (the runner's BYPASSRLS pool writes it, across tenants, in the transaction that writes the outbox rows).
--     Nobody updates or deletes a sent reminder.
--
-- PARTITION NOTE. None of the three is partitioned and none should be. A cooperative schedules a handful of classes a
-- week; a class has at most `capacity` registrations (canon: 500); a class has at most three reminder rows. A thousand
-- cooperatives × 200 classes/year × 500 members is 10⁸ registration rows over a decade — a size a single btree on
-- (tenant_id, session_id) serves; the hot tables of this module remain `enrollments` and `lesson_progress`. The
-- partial index on `(tenant_id, host_user_id, scheduled_at)` over live/scheduled rows is the clash read; the UNIQUE on
-- (session_id, kind) is over two NOT NULL columns, so `ON CONFLICT` is never asked to fire on a nullable key (6c-4).
-- ------------------------------------------------------------------------------------------------------------------

-- 0172.1 · the class the row could not hold
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS course_id              uuid REFERENCES courses(id),
  ADD COLUMN IF NOT EXISTS duration_mins          integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS capacity               integer,
  ADD COLUMN IF NOT EXISTS join_url               varchar(500),
  ADD COLUMN IF NOT EXISTS clash_accepted         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind                 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_count       integer,
  ADD COLUMN IF NOT EXISTS attendance_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_recorded_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS recording_attached_at  timestamptz,
  ADD COLUMN IF NOT EXISTS recording_lesson_id    uuid REFERENCES course_lessons(id);

COMMENT ON COLUMN live_sessions.course_id              IS 'PC-56 TENANT-7c · the course this class belongs to (W414 "recorded → lesson 7" — the recording becomes one of ITS lessons). NULL only on PC-26b channel sessions written before 0172; the writer requires it now.';
COMMENT ON COLUMN live_sessions.scheduled_at           IS 'PC-56 TENANT-7c · the instant the class STARTS. Typed by the host as a date and a wall-clock time in the COOPERATIVE''s timezone (tenants.country_code → countries.timezone, 6c-1''s resolution) and converted in SQL — never in the Node process''s zone.';
COMMENT ON COLUMN live_sessions.duration_mins          IS 'PC-56 TENANT-7c · planned length in minutes (5–480). A class is an interval: the clash check and the join window need an end.';
COMMENT ON COLUMN live_sessions.capacity               IS 'PC-56 TENANT-7c · the room''s declared capacity (W414 "500"). Registration is refused at capacity. NULL = unlimited. Above 500 needs the desk''s key (course.publish) — the canon''s "needs tenant approval", enforced as a permission, not as a metered budget nothing records.';
COMMENT ON COLUMN live_sessions.join_url               IS 'PC-56 TENANT-7c · the external meeting link the host pastes (https only). This platform runs no stream; the class is held here. Shown to registered members only inside the join window.';
COMMENT ON COLUMN live_sessions.clash_accepted         IS 'PC-56 TENANT-7c · W414 "Schedule anyway": the host saw that this class overlaps another of THEIR OWN classes and scheduled it regardless. Recorded so the choice is on the row, not only in the audit trail.';
COMMENT ON COLUMN live_sessions.remind                 IS 'PC-56 TENANT-7c · whether the reminder cadence (education.live_reminder_offsets_mins) fans out to registered members.';
COMMENT ON COLUMN live_sessions.cancelled_at           IS 'PC-56 TENANT-7c · when the class was cancelled. The reason is in audit_log (education.live.cancel).';
COMMENT ON COLUMN live_sessions.attendance_count       IS 'PC-56 TENANT-7c · attendance as the host RECORDED it after the class (W415 "Attendees 342 of 500"). A fact a person wrote down, never a live counter — no stream runs here to count on.';
COMMENT ON COLUMN live_sessions.recording_lesson_id    IS 'PC-56 TENANT-7c · the `live`-kind lesson the recording was published as (W414 "recorded → lesson 7"), created by the to_lesson ACT — DELTA-047''s "auto-publishes" has no job.';

-- 0172.2 · backfill before the CHECKs (widen before CHECK): every pre-0172 row gets the instants its status implies
UPDATE live_sessions SET cancelled_at = COALESCE(cancelled_at, updated_at, created_at, now()) WHERE status = 'cancelled' AND cancelled_at IS NULL;
UPDATE live_sessions SET started_at   = COALESCE(started_at, scheduled_at)                     WHERE status = 'live'      AND started_at   IS NULL;
UPDATE live_sessions SET ended_at     = COALESCE(ended_at, updated_at, created_at, now())     WHERE status = 'ended'     AND ended_at     IS NULL;

-- 0172.3 · the constraints
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_duration        CHECK (duration_mins BETWEEN 5 AND 480);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_capacity        CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 100000);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_join_url_https  CHECK (join_url IS NULL OR join_url ~ '^https://[^\s]+$');
-- the status and its instants agree: live has started; ended has ended; cancelled has been cancelled
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_started_whole   CHECK (status <> 'live' OR started_at IS NOT NULL);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_ended_whole     CHECK (status <> 'ended' OR ended_at IS NOT NULL);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_cancelled_whole CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));
-- attendance is recorded by somebody at some instant, all three or none, and only once the class has ended
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_attendance_whole CHECK ((attendance_count IS NULL) = (attendance_recorded_at IS NULL) AND (attendance_count IS NULL) = (attendance_recorded_by IS NULL));
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_attendance_nonneg CHECK (attendance_count IS NULL OR attendance_count >= 0);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_attendance_ended CHECK (attendance_count IS NULL OR status = 'ended');
-- a recording is a media asset attached at an instant; a lesson can only be made of a recording that exists
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_recording_whole CHECK (recording_attached_at IS NULL OR recording_media_id IS NOT NULL);
ALTER TABLE live_sessions ADD CONSTRAINT ck_live_lesson_needs_recording CHECK (recording_lesson_id IS NULL OR recording_media_id IS NOT NULL);

-- the clash read: the same host's other classes that are still on the calendar
CREATE INDEX IF NOT EXISTS idx_live_sessions_host_calendar ON live_sessions (tenant_id, host_user_id, scheduled_at) WHERE status IN ('scheduled','live');
-- W414's table: by when, per course
CREATE INDEX IF NOT EXISTS idx_live_sessions_when ON live_sessions (tenant_id, scheduled_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_live_sessions_course ON live_sessions (tenant_id, course_id, scheduled_at DESC) WHERE course_id IS NOT NULL;
-- the reminder job's read: scheduled classes that want reminding, across tenants (kv_relay)
CREATE INDEX IF NOT EXISTS idx_live_sessions_remind ON live_sessions (scheduled_at) WHERE status = 'scheduled' AND remind;

-- 0172.4 · registrations get the wall they never had
ALTER TABLE live_session_registrations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE live_session_registrations r SET tenant_id = s.tenant_id FROM live_sessions s WHERE s.id = r.session_id AND r.tenant_id IS DISTINCT FROM s.tenant_id;
-- a registration whose session is gone cannot be backfilled and cannot be trusted: none exist (FK), but say so
DELETE FROM live_session_registrations WHERE tenant_id IS NULL;
ALTER TABLE live_session_registrations ALTER COLUMN tenant_id SET NOT NULL;
COMMENT ON COLUMN live_session_registrations.tenant_id IS 'PC-56 TENANT-7c · the session''s tenant, copied by trg_lsr_tenant. Exists so RLS can hold the row, not only the join (0027 had none).';

CREATE OR REPLACE FUNCTION live_session_registrations_tenant_from_session() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE t uuid; found boolean;
BEGIN
  SELECT s.tenant_id, true INTO t, found FROM live_sessions s WHERE s.id = NEW.session_id;
  IF found IS NOT TRUE THEN
    RAISE EXCEPTION 'live_session_registrations: session % is not visible to this session — PC-56 TENANT-7c', NEW.session_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lsr_tenant ON live_session_registrations;
CREATE TRIGGER trg_lsr_tenant BEFORE INSERT OR UPDATE OF session_id, tenant_id ON live_session_registrations
  FOR EACH ROW EXECUTE FUNCTION live_session_registrations_tenant_from_session();

CREATE INDEX IF NOT EXISTS idx_lsr_session ON live_session_registrations (tenant_id, session_id);

ALTER TABLE live_session_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_session_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_live_session_registrations ON live_session_registrations;
CREATE POLICY tenant_isolation_live_session_registrations ON live_session_registrations
  USING (tenant_id = current_tenant_id());
REVOKE DELETE ON live_session_registrations FROM kv_app;

-- 0172.5 · reminders sent — once per (class, kind), whoever ticks
CREATE TABLE IF NOT EXISTS live_class_reminders (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  session_id  uuid NOT NULL REFERENCES live_sessions(id),
  kind        varchar(10) NOT NULL,                  -- day | hour | soon — the three offsets of education.live_reminder_offsets_mins
  sent_at     timestamptz NOT NULL DEFAULT now(),
  recipients  integer NOT NULL DEFAULT 0,            -- registered members the reminder was fanned out to (0 = nobody registered; the row still exists so it is not retried)
  UNIQUE (session_id, kind)
);
ALTER TABLE live_class_reminders ADD CONSTRAINT ck_lcr_kind CHECK (kind IN ('day','hour','soon'));
ALTER TABLE live_class_reminders ADD CONSTRAINT ck_lcr_recipients_nonneg CHECK (recipients >= 0);
CREATE INDEX IF NOT EXISTS idx_lcr_session ON live_class_reminders (tenant_id, session_id);
COMMENT ON TABLE live_class_reminders IS 'PC-56 TENANT-7c · W414 "Reminder cadence — 1 day, 1 hour, 10 min before". One row per class and offset once the cadence job (education/live-reminder) has written the outbox rows for its registered members. Written by kv_relay; read by the host desk.';

ALTER TABLE live_class_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_class_reminders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_live_class_reminders ON live_class_reminders;
CREATE POLICY tenant_isolation_live_class_reminders ON live_class_reminders
  USING (tenant_id = current_tenant_id());

-- LEAST PRIVILEGE: revoke the blanket default grants first, then the narrow ones.
REVOKE ALL ON live_class_reminders FROM kv_app;
REVOKE ALL ON live_class_reminders FROM kv_relay;
GRANT SELECT ON live_class_reminders TO kv_app;
GRANT SELECT, INSERT ON live_class_reminders TO kv_relay;

-- 0172.6 · the cadence (Law 6: a tenant admin should control it, so it is a setting, not a constant)
INSERT INTO setting_definitions (key, value_type, scope, default_value, description)
SELECT 'education.live_reminder_offsets_mins', 'json', 'tenant', '[1440,60,10]'::jsonb,
       'Minutes before a live class starts at which registered members are reminded (W414 "1 day, 1 hour, 10 min before"). Up to three offsets: the largest is the "day" reminder, the middle the "hour", the smallest the "soon". Empty array = no reminders.'
WHERE NOT EXISTS (SELECT 1 FROM setting_definitions WHERE key = 'education.live_reminder_offsets_mins');

-- 0172.7 · the notice, catalogued (Law 4: the job emits `education.live_reminder` on the outbox in the transaction that
--          records the reminder; the notification spine fans it out). Templates en/hi/gu live in db/seeds/core/0007 with
--          their versions, as every platform template since 6c-2. `important`, opt-out allowed: a reminder is a courtesy.
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable)
VALUES ('education.live_reminder', 'Live class reminder', 'important', '["push","inapp"]', true, false)
ON CONFLICT (code) DO NOTHING;
