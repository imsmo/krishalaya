# education (PRD M09, §9.9) — the agri-learning library

Instructors author courses; learners enrol (free or paid) and learn. Gated by the `education` feature flag
(default **OFF**).

## What it owns

- **Instructors** — a per-user profile (`royalty_bps`, default 8000 = 80% per the Revenue Playbook). Platform
  instructors (tenant_id NULL, e.g. KVK) are admin-created only (Law 11).
- **Courses** — authored by an instructor. Lifecycle `draft → review → published ↔ paused → archived`
  (state machine, Law 5). `price_minor` is **bigint minor units** (Law 2; 0 = free). Browse is published-only;
  the platform library (tenant_id NULL) is visible to every tenant.
- **Lessons** — ordered by `(module_no, lesson_no)`; video/pdf/article/quiz/audio/live; idempotent upsert.
- **Enrollments** — one per `(course, learner)`. **Free** → instant. **Paid** → the learner buys a seat:
  a **zero-sum, idempotent `course_purchase`** wallet transfer — learner `userMain` → instructor `userMain`
  (royalty, floored) + platform `Fees` (remainder) — in the same tx as the enrollment (Law 2 + Law 4),
  idempotency key `coursebuy:<enrollmentId>`. A learner can't enrol twice nor in their own course.
- **Lesson progress** — per-lesson `seconds_watched`/`quiz_score`/completion; marking lessons recomputes the
  enrollment's `progress_pct` and stamps `completed_at` (+ `CourseCompleted`) exactly once at 100%.

## Surface (v1, all under the `education` flag)

`PUT/GET /v1/education/instructors/me` (`course.author`). Courses (`course.author` to author, `course.publish` for the
desk — PC-56 TENANT-7a): `POST /v1/education/courses/preview` (the form chain's review, no key), `GET /desk`,
`GET /topics`, `POST /v1/education/courses` (the FORM body: topicCode · priceMajor at the tenant's currency scale;
Idempotency-Key; audited), `GET` (box=`browse|mine|all`, `withStats`), `GET /:id`, `PATCH /:id` (same body, diff),
`GET /:id/acts` (every act's verdict + W416's gate + this course's stats), `POST /:id/acts/:act` with `{reason}` for
`submit · publish · return · pause · resume · archive` (Idempotency-Key; audited with the reason; publish is refused
to the maker — and 0170's trigger refuses it again), `POST/GET /:id/lessons`. Enrollments (any learner):
`POST /v1/education/enrollments` (Idempotency-Key), `GET`, `GET /:id`,
`POST /:id/lessons/:lessonId/progress`, `GET /:id/progress`.

## Threats considered (§4)

- **Tenant isolation / RLS** — `tenant_id` binds every tenant query; `instructors`/`courses`/`enrollments` are
  RLS-protected (courses/instructors also allow NULL = platform library). `course_lessons`/`lesson_progress`
  carry no `tenant_id` and are gated via the tenant-scoped course/enrollment JOIN.
- **No IDOR** — only a course's own instructor may edit it / add lessons (404, not 403, on a non-owner);
  enrolments + progress are learner-owned (404 for a non-owner); a learner can't probe another's enrolment.
- **No privilege escalation** — publishing is gated by `course.publish`; `royalty_bps` is not client-settable
  (no inflating your own cut); platform instructors/courses aren't writable via the tenant API.
- **Money correctness** — bigint minor units only; the split is zero-sum by construction (instructor floor +
  platform remainder = price); idempotent purchase (Law 3) so a retry never double-charges.
- **Abuse/DoS** — bounded list `LIMIT` + keyset pagination; enrol is idempotent per (user, endpoint).

## Creator content (channels + resources + live streaming) — migration 0027

A community-learning layer so any role (with `channel.host`) can share knowledge, **gated by tenant-admin
approval** (`content.moderate`):

- **Channels** — register an external content channel (`youtube`/`vimeo`/`website`/`podcast`/`other`) with a
  validated http(s) URL. Born `pending`; a moderator `approve`/`suspend`/`reject`s it (state machine; each
  moderation writes an `audit_log` row in the same tx). The approved channel IS the host-authority gate.
- **Resources** — curated items (`video`/`blog`/`post`/`audio`/`article`) pointing at an external URL or a media
  file. Under the host's **own approved channel** a resource auto-approves (trust established); otherwise it's
  `pending` until a moderator approves. Moderators can take a resource down.
- **Live sessions** — PC-26b's channel-gated stream (schedule on an approved channel → `start` via the provider →
  end) is GONE since PC-56 TENANT-7c. See **The live class** below.

Surface: `POST/GET/PATCH /v1/education/channels` + `POST /:id/{approve,suspend,reject}` (moderator);
`POST/GET /v1/education/resources` + `POST /:id/{approve,takedown}`. Perms: `channel.host`, `content.moderate`.

Threats: only a channel's owner may edit it (404, not 403, on non-owners); an unapproved channel can't publish
(fail-closed); moderation is `content.moderate`-only + audited; external URLs are anchored-regex validated (no
`javascript:`/SSRF bait); RLS isolates channels/resources per tenant.

## The live class (W414 · W415 + the live-form and live-mutate chains) — PC-56 TENANT-7c, migration 0172

**Declared honestly: this platform has no video provider.** `STREAM_PROVIDER_URL` unset binds `NoopStreamGateway`
(providerCode `noop`), which in production answers `provider_not_configured`. So a class is a SCHEDULED CLASS on a
course, hosted by the course's instructor (or acted on by the content desk, `course.publish`):

- **Scheduled in the cooperative's own timezone.** The host types a date and a wall-clock time; the DATABASE resolves
  the instant `AT TIME ZONE` `tenants.country_code → countries.timezone` (`LiveSessionRepository.resolveStart`, 6c-1's
  resolution) and every read hands back `local_date`/`local_time` in the same zone. Nothing builds a Date from digits.
- **Reviewed before written** (`domain/live-class-review.ts`, one function for `preview` · `create` · `update`): the
  instant and the end shown as rows the form never asked for; refusals by name (`NOT_OWNER`, `COURSE_ARCHIVED`,
  `STARTS_IN_PAST`, `CAPACITY_NEEDS_DESK` above 500 without the desk's key, `JOIN_URL_INVALID` — https only,
  `HOST_CLASH` against the host's OWN classes on this cooperative's calendar, lifted by *Schedule anyway* → stored
  `clash_accepted`). No calendar crosses tenants (RLS is the wall).
- **Held on a join link** the host pastes; shown to registered members from 15 minutes before the start to 30 after
  the end (`live-clock.ts`), to the host and the desk always. `register` refuses `CLASS_NOT_OPEN` / `CLASS_FULL`.
- **Acts as verdicts** (`domain/live-class-acts.ts`), re-taken on the locked row, a reason on every audit row
  (`education.live.<act>` on entity `live_session`), an Idempotency-Key on every write: `start` (refused
  `PROVIDER_NOT_CONFIGURED` unless something other than the noop is bound; `TOO_EARLY` beyond 15 min) · `end` (from
  `live`, or from `scheduled` once the start has passed — *held elsewhere*, `live-session.state.ts`) · `cancel` ·
  `attendance` (a number the host records — never a live counter) · `recording` (a video/audio asset in THIS tenant's
  bucket, through core/media: store · scan · serve) · `to_lesson` (a `live`-kind lesson appended to the course's last
  module, once, only when the scan is clean — DELTA-047's "auto-publishes" performed by a person).
- **Reminders** (`jobs/live-reminder.cadence-job.ts`, registered in `SCHEDULED_JOB_REGISTRY`, kv_relay pool): offsets
  from the tenant setting `education.live_reminder_offsets_mins` (default 1 day · 1 hour · 10 min); each (class, kind)
  claimed once through `live_class_reminders`' UNIQUE row; outbox `education.live_reminder` with the registered members
  and the cooperative wall-clock digits → the notification spine (templates en/hi/gu, seed 0007).
- **RLS**: `live_session_registrations` carries the session's `tenant_id` by trigger since 0172, ENABLE + FORCE (0027
  had none); `live_class_reminders` REVOKE ALL then SELECT to kv_app, SELECT/INSERT to kv_relay.

Surface: `GET /v1/education/live-sessions` (keyset by `(scheduled_at, id)`; `box=upcoming|past|mine|all`, `courseId`,
`status`) · `POST /preview` · `POST /` · `GET /:id` · `PATCH /:id` · `POST /:id/acts/:act` · `POST /:id/register`.

NOT HERE, BY NAME (no table, no provider): a live attendee counter, the question queue with voice transcripts, slow
mode, a co-host, low-bandwidth mode, *connection dropped · rejoin*, auto-record, a shared cross-tenant calendar, the
"best turnout" hint band, and *Retry* as an act.

## Deferred (schema present, not built)

Certificate (PDF) issuance on completion (`cert_enabled` + `certificate_media_id` are stored; rendering reuses
the media/PDF pipeline when wired); the online payment-intent enrol path (wallet purchase is the path here);
instructor payout aggregation jobs; quiz auto-grading; external channel-metadata fetch. The live class's recording is
attached by the host through core/media (TENANT-7c); nothing on this platform records or retrieves a stream.

## Tests

`__tests__/education-domain.spec.ts` (revenue split zero-sum, course state machine, progress recompute, royalty
bounds), `enrollment.service.spec.ts` (free vs paid wallet split, unpublished/own-course/double-enrol guards,
404 IDOR), `tenant-isolation.spec.ts` (CI gate), `education.integration.spec.ts` (real Postgres: author →
publish → paid enrol split ₹500→₹400+₹100 → complete → cross-tenant RLS denial; runs when `DATABASE_URL` is set).
