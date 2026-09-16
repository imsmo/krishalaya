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
- **Live sessions** — an approved-channel host schedules a session, then `start`s it: the external streaming
  provider (resilience-wrapped `STREAM_PROVIDER` port; HTTP adapter by config else noop) issues a stream ref +
  playback URL; lifecycle `scheduled → live → ended` (cancel only while scheduled). Any learner can register.

Surface: `POST/GET/PATCH /v1/education/channels` + `POST /:id/{approve,suspend,reject}` (moderator);
`POST/GET /v1/education/resources` + `POST /:id/{approve,takedown}`; `POST/GET /v1/education/live-sessions`,
`GET /:id`, `POST /:id/{start,end,cancel,register}`. New perms: `channel.host`, `content.moderate`.

Threats: only a channel's owner may edit it / host its sessions (404, not 403, on non-owners); an unapproved
channel can't publish or stream (fail-closed); moderation is `content.moderate`-only + audited; external URLs
are anchored-regex validated (no `javascript:`/SSRF bait); the stream provider degrades to a typed 503 (no
half-started sessions); RLS isolates channels/resources/sessions per tenant.

## Deferred (schema present, not built)

Certificate (PDF) issuance on completion (`cert_enabled` + `certificate_media_id` are stored; rendering reuses
the media/PDF pipeline when wired); the online payment-intent enrol path (wallet purchase is the path here);
instructor payout aggregation jobs; quiz auto-grading; external channel-metadata fetch + live recording
retrieval (the `recording_media_id` slot is stored, ingestion deferred).

## Tests

`__tests__/education-domain.spec.ts` (revenue split zero-sum, course state machine, progress recompute, royalty
bounds), `enrollment.service.spec.ts` (free vs paid wallet split, unpublished/own-course/double-enrol guards,
404 IDOR), `tenant-isolation.spec.ts` (CI gate), `education.integration.spec.ts` (real Postgres: author →
publish → paid enrol split ₹500→₹400+₹100 → complete → cross-tenant RLS denial; runs when `DATABASE_URL` is set).
