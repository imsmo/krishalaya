// @krishalaya/sdk-js · education resource (module 9 — courses + enrollments). Learner surface: browse published
// courses, read a course + its lessons, ENROLL (idempotent — a paid enroll moves money, Law 3), and track per-
// lesson PROGRESS (seconds watched + quiz score + completed). Enrollments/progress are the caller's OWN (server
// resolves the learner — no IDOR). Money is bigint minor strings (Law 2). Gated server-side by the `education` flag.
import { HttpClient } from '../http';
import {
  Course, CourseLesson, Enrollment, LessonProgress, LearningResource, ResourceKind, CropCalendar, Page,
  CourseDesk, CourseTopic, CourseStats, CourseFormInput, CourseActs, CourseAct, FormReview,
  CourseOutline, LessonRecord, LessonFormInput, SubtitleFormInput, QuestionFormInput, LessonAct,
  LiveBox, LiveClass, LiveClassListItem, LiveClassView, LiveFormInput, LiveAct,
  Instructor, InstructorCredential, InstructorView, InstructorListItem, InstructorAct, ProfileFormInput, CredentialFormInput, StudioView, CourseTemplate, TemplateFormInput,
  EarningsView, EarningsStatementLine, RoyaltyPayoutInput, RoyaltyPayoutReview, RoyaltyRuleView, InstructorAgreement, AgreementAct, ExportJob, PayoutSummary,
} from '../types';

export class CoursesResource {
  constructor(private readonly http: HttpClient) {}
  /** Browse/list courses. `box=browse` = published catalogue (learners). Keyset. */
  async list(params: { box?: 'browse' | 'mine' | 'all'; topicId?: string; level?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Course>> {
    const r = await this.http.request<Course[]>('GET', 'education/courses', { query: { box: params.box ?? 'browse', topicId: params.topicId, level: params.level, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** A course with its lessons (the detail read also embeds `lessons`). */
  async get(id: string, signal?: AbortSignal): Promise<Course & { lessons?: CourseLesson[] }> {
    return (await this.http.request<Course & { lessons?: CourseLesson[] }>('GET', `education/courses/${encodeURIComponent(id)}`, { signal })).data;
  }
  async lessons(courseId: string, signal?: AbortSignal): Promise<CourseLesson[]> {
    return (await this.http.request<CourseLesson[]>('GET', `education/courses/${encodeURIComponent(courseId)}/lessons`, { signal })).data;
  }

  // --- AUTHOR/STUDIO surface (PC-26, rebuilt by PC-56 TENANT-7a as the course RECORD and the DESK) ------------
  // The form chain (W2546–W2549) and the mutate chain (W2550–W2552) are one review + one write each:
  //   preview(form)            → what will be stored and every refusal, computed by the API (no key — writes nothing)
  //   create(form, key)        → the same body; refused with the review's own codes when the review is not ready
  //   update(id, form, key)    → the same, with a diff against the row as it stands
  //   acts(id)                 → every act's verdict for this caller + W416's publish gate
  //   act(id, act, reason, key)→ submit · publish · return · pause · resume · archive — WITH A REASON, audited
  // The PC-26 `submit/publish/pause/archive` methods are gone: their routes took no reason and wrote no audit row.
  /** The desk's tiles and chips (W178) — `course.publish`. */
  async desk(signal?: AbortSignal): Promise<CourseDesk> {
    return (await this.http.request<CourseDesk>('GET', 'education/courses/desk', { signal })).data;
  }
  /** The topic registry (`course_topic`), for the form's select — any author. */
  async topics(signal?: AbortSignal): Promise<CourseTopic[]> {
    return (await this.http.request<CourseTopic[]>('GET', 'education/courses/topics', { signal })).data;
  }
  /** W178's table: the desk's rows (`box=all`) with Learners/Completion per row. Keyset. */
  async listDesk(params: { status?: string; topicId?: string; level?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Course> & { stats: Record<string, CourseStats> }> {
    const r = await this.http.request<Course[]>('GET', 'education/courses', { query: { box: 'all', status: params.status, topicId: params.topicId, level: params.level, cursor: params.cursor, limit: params.limit ?? 50, withStats: 'true' }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, stats: ((r.meta as { stats?: Record<string, CourseStats> } | undefined)?.stats) ?? {} };
  }
  /** The review step. No idempotency key: it writes nothing. `id` makes it an EDIT's review, with a diff. */
  async preview(input: CourseFormInput & { id?: string }): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', 'education/courses/preview', { body: input })).data;
  }
  async create(input: CourseFormInput, idempotencyKey: string): Promise<Course> {
    return (await this.http.request<Course>('POST', 'education/courses', { idempotencyKey, body: input })).data;
  }
  async update(id: string, input: CourseFormInput, idempotencyKey: string): Promise<Course> {
    return (await this.http.request<Course>('PATCH', `education/courses/${encodeURIComponent(id)}`, { idempotencyKey, body: input })).data;
  }
  /** W179/W416: every act's verdict for this caller, the object, and the publish gate. */
  async acts(id: string, signal?: AbortSignal): Promise<CourseActs> {
    return (await this.http.request<CourseActs>('GET', `education/courses/${encodeURIComponent(id)}/acts`, { signal })).data;
  }
  /** The act, with its reason (3–300 chars — the audit row's own words). */
  async act(id: string, act: CourseAct, reason: string, idempotencyKey: string): Promise<Course> {
    return (await this.http.request<Course>('POST', `education/courses/${encodeURIComponent(id)}/acts/${encodeURIComponent(act)}`, { idempotencyKey, body: { reason } })).data;
  }

  // --- THE LESSON RECORD (PC-56 TENANT-7b: W411 · W412 · W413 + the lesson-form, lesson-mutate and quiz-form chains) ---
  // Same shape as the course record above: one review + one write each, an Idempotency-Key on every write, and the
  // acts as verdicts. PC-26's `addLesson` (an upsert keyed on module·lesson, no key, no audit row) is gone.
  /** W411: the outline — every lesson with its position, subtitle coverage, learner reality, the gate, `canEdit`. */
  async outline(courseId: string, signal?: AbortSignal): Promise<CourseOutline> {
    return (await this.http.request<CourseOutline>('GET', `education/courses/${encodeURIComponent(courseId)}/outline`, { signal })).data;
  }
  /** W412/W413: one lesson with its media facts, twin, tracks, quiz summary and every act's verdict for this caller. */
  async lesson(courseId: string, lessonId: string, signal?: AbortSignal): Promise<LessonRecord> {
    return (await this.http.request<LessonRecord>('GET', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`, { signal })).data;
  }
  /** The lesson form's review. No key: it writes nothing. `lessonId` makes it an EDIT's review, with a diff. */
  async previewLesson(courseId: string, input: LessonFormInput & { lessonId?: string }): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons/preview`, { body: input })).data;
  }
  async createLesson(courseId: string, input: LessonFormInput, idempotencyKey: string): Promise<CourseLesson> {
    return (await this.http.request<CourseLesson>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons`, { idempotencyKey, body: input })).data;
  }
  async updateLesson(courseId: string, lessonId: string, input: LessonFormInput, idempotencyKey: string): Promise<CourseLesson> {
    return (await this.http.request<CourseLesson>('PATCH', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`, { idempotencyKey, body: input })).data;
  }
  /** W412 "Subtitle tracks — Edit": one track per (lesson, language), reviewed by a person or not. */
  async previewSubtitle(courseId: string, lessonId: string, input: SubtitleFormInput): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/subtitles/preview`, { body: input })).data;
  }
  async saveSubtitle(courseId: string, lessonId: string, input: SubtitleFormInput, idempotencyKey: string): Promise<{ languageCode: string; status: string; bodyLength: number }> {
    return (await this.http.request<{ languageCode: string; status: string; bodyLength: number }>('PUT', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/subtitles`, { idempotencyKey, body: input })).data;
  }
  /** W413 "Save question": question `n` (1-based; `count + 1` appends). The threshold rides on every question's form. */
  async previewQuestion(courseId: string, lessonId: string, n: number, input: QuestionFormInput): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/questions/${n}/preview`, { body: input })).data;
  }
  async saveQuestion(courseId: string, lessonId: string, n: number, input: QuestionFormInput, idempotencyKey: string): Promise<CourseLesson> {
    return (await this.http.request<CourseLesson>('PUT', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/questions/${n}`, { idempotencyKey, body: input })).data;
  }
  /** PC-56 TENANT-7d · the studio form (W2775–W2778 "Start from template"): the registry, its review, and the write. */
  async templates(signal?: AbortSignal): Promise<CourseTemplate[]> {
    return (await this.http.request<CourseTemplate[]>('GET', 'education/courses/templates', { signal })).data;
  }
  async previewFromTemplate(input: TemplateFormInput): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', 'education/courses/from-template/preview', { body: input })).data;
  }
  async createFromTemplate(input: TemplateFormInput, idempotencyKey: string): Promise<Course & { lessons: number }> {
    return (await this.http.request<Course & { lessons: number }>('POST', 'education/courses/from-template', { idempotencyKey, body: input })).data;
  }
  /** The lesson act, with its reason: ready · reopen · move_up · move_down (W412 "Mark ready", W411's row menu). */
  async lessonAct(courseId: string, lessonId: string, act: LessonAct, reason: string, idempotencyKey: string): Promise<CourseLesson> {
    return (await this.http.request<CourseLesson>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/acts/${encodeURIComponent(act)}`, { idempotencyKey, body: { reason } })).data;
  }
}

/** PC-26b: external content channels (channel.host; moderation is admin-side). The live methods that lived here are GONE
 *  since PC-56 TENANT-7c (`LiveClassesResource`); the instructor self-profile (`myInstructor` · `upsertInstructor`, no key,
 *  no audit row) is GONE since PC-56 TENANT-7d — the instructor is `InstructorsResource` below. */
export interface EduChannel { id: string; provider: string; title: string; handle: string | null; externalUrl: string; topicId: string | null; description: string | null; status: string; createdAt?: string; }

export class LiveStudioResource {
  constructor(private readonly http: HttpClient) {}
  // --- channels (a host registers external content channels; moderation is admin-side) ---
  async channels(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<EduChannel>> {
    const r = await this.http.request<EduChannel[]>('GET', 'education/channels', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async registerChannel(input: { provider: string; title: string; handle?: string | null; externalUrl: string; topicId?: string | null; description?: string | null }): Promise<EduChannel> {
    return (await this.http.request<EduChannel>('POST', 'education/channels', { body: input })).data;
  }
}

/** PC-56 TENANT-7c · THE LIVE CLASS (W414 · W415 + the live-form and live-mutate chains). Declared honestly: this platform
 *  has no video provider, so a class is SCHEDULED (an instant in the cooperative's own timezone), HELD on a join link
 *  the host pastes, marked ENDED, its ATTENDANCE recorded, its RECORDING attached through core/media and published as a
 *  lesson by an act. Same shape as the course and lesson records: one review + one write each, an Idempotency-Key on
 *  every write, the acts as verdicts. */
export class LiveClassesResource {
  constructor(private readonly http: HttpClient) {}
  /** W414's table. Keyset on (scheduled_at, id): `upcoming` ascends, `past`/`mine`/`all` descend. */
  async list(params: { box?: LiveBox; courseId?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LiveClassListItem>> {
    const r = await this.http.request<LiveClassListItem[]>('GET', 'education/live-sessions', { query: { box: params.box ?? 'upcoming', courseId: params.courseId, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** W415: the class with its window, its acts' verdicts for this caller, its recording, the reminders sent. */
  async get(id: string, signal?: AbortSignal): Promise<LiveClassView> {
    return (await this.http.request<LiveClassView>('GET', `education/live-sessions/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** The form's review. No key: it writes nothing. `id` makes it an EDIT's review, with a diff. */
  async preview(input: LiveFormInput & { id?: string }): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', 'education/live-sessions/preview', { body: input })).data;
  }
  async create(input: LiveFormInput, idempotencyKey: string): Promise<LiveClass> {
    return (await this.http.request<LiveClass>('POST', 'education/live-sessions', { idempotencyKey, body: input })).data;
  }
  async update(id: string, input: LiveFormInput, idempotencyKey: string): Promise<LiveClass> {
    return (await this.http.request<LiveClass>('PATCH', `education/live-sessions/${encodeURIComponent(id)}`, { idempotencyKey, body: input })).data;
  }
  /** The act, with its reason (3–300 chars); `count` for attendance, `mediaId` for the recording. */
  async act(id: string, act: LiveAct, body: { reason: string; count?: string; mediaId?: string }, idempotencyKey: string): Promise<LiveClass> {
    return (await this.http.request<LiveClass>('POST', `education/live-sessions/${encodeURIComponent(id)}/acts/${encodeURIComponent(act)}`, { idempotencyKey, body })).data;
  }
  /** A member registers (refused `CLASS_NOT_OPEN` / `CLASS_FULL`). */
  async register(id: string, idempotencyKey: string): Promise<{ registered: boolean; count: number }> {
    return (await this.http.request<{ registered: boolean; count: number }>('POST', `education/live-sessions/${encodeURIComponent(id)}/register`, { idempotencyKey, body: {} })).data;
  }
}

/** PC-56 TENANT-7d · THE INSTRUCTOR (W410 · W419 + the instructor-form and instructor-mutate chains). One review + one
 *  write per form, an Idempotency-Key on every write, the acts as verdicts. `isVerified` is written only by the desk's acts. */
export class InstructorsResource {
  constructor(private readonly http: HttpClient) {}
  /** W410 — the caller's own desk. */
  async studio(signal?: AbortSignal): Promise<StudioView> {
    return (await this.http.request<StudioView>('GET', 'education/instructors/studio', { signal })).data;
  }
  /** The platform language registry's active rows (Law 6) — the form's choices. */
  async languages(signal?: AbortSignal): Promise<Array<{ code: string; nameEnglish: string; nameNative: string }>> {
    return (await this.http.request<Array<{ code: string; nameEnglish: string; nameNative: string }>>('GET', 'education/instructors/languages', { signal })).data;
  }
  /** W419 for the caller. `INSTRUCTOR_NOT_FOUND` when they have no profile yet. */
  async me(signal?: AbortSignal): Promise<InstructorView> {
    return (await this.http.request<InstructorView>('GET', 'education/instructors/me', { signal })).data;
  }
  /** W419 for an instructor — themselves, the desk, or anyone for a PUBLIC profile. */
  async get(id: string, signal?: AbortSignal): Promise<InstructorView> {
    return (await this.http.request<InstructorView>('GET', `education/instructors/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** The desk's list (course.publish). Keyset. */
  async list(params: { verified?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<InstructorListItem>> {
    const r = await this.http.request<InstructorListItem[]>('GET', 'education/instructors', { query: { verified: params.verified === undefined ? undefined : String(params.verified), cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The form's review. No key: it writes nothing. `credentialId` makes a credential review a RE-UPLOAD's, with a diff. */
  async preview(input: ({ form: 'profile' } & ProfileFormInput) | ({ form: 'credential'; credentialId?: string } & CredentialFormInput)): Promise<FormReview> {
    return (await this.http.request<FormReview>('POST', 'education/instructors/preview', { body: input })).data;
  }
  /** W419 "Save profile" — creates the row on the first save. */
  async saveProfile(input: ProfileFormInput, idempotencyKey: string): Promise<Instructor> {
    return (await this.http.request<Instructor>('PUT', 'education/instructors/me', { idempotencyKey, body: input })).data;
  }
  /** W419 "Add credential". */
  async fileCredential(input: CredentialFormInput, idempotencyKey: string): Promise<InstructorCredential> {
    return (await this.http.request<InstructorCredential>('POST', 'education/instructors/me/credentials', { idempotencyKey, body: input })).data;
  }
  /** The re-upload form's first values (the rejected credential, without its document) and the desk's note. */
  async credentialForm(credentialId: string, signal?: AbortSignal): Promise<Record<string, string> & { reviewNote: string }> {
    return (await this.http.request<Record<string, string> & { reviewNote: string }>('GET', `education/instructors/me/credentials/${encodeURIComponent(credentialId)}/form`, { signal })).data;
  }
  /** W419 "Re-upload a clearer scan" — a REJECTED credential, re-filed. */
  async refileCredential(credentialId: string, input: CredentialFormInput, idempotencyKey: string): Promise<InstructorCredential> {
    return (await this.http.request<InstructorCredential>('PATCH', `education/instructors/me/credentials/${encodeURIComponent(credentialId)}`, { idempotencyKey, body: input })).data;
  }
  /** The act, with its reason (3–300 chars); `credentialId` for accept · reject · withdraw. */
  async act(instructorId: string, act: InstructorAct, body: { reason: string; credentialId?: string }, idempotencyKey: string): Promise<{ instructor: Instructor; credential: InstructorCredential | null }> {
    return (await this.http.request<{ instructor: Instructor; credential: InstructorCredential | null }>('POST', `education/instructors/${encodeURIComponent(instructorId)}/acts/${encodeURIComponent(act)}`, { idempotencyKey, body })).data;
  }
}

export class EnrollmentsResource {
  constructor(private readonly http: HttpClient) {}
  /** Enrol in a course. Idempotent (Law 3) — a retried tap (or a paid enrol) can't double-charge/double-enrol. */
  async enroll(courseId: string, idempotencyKey: string): Promise<Enrollment> {
    return (await this.http.request<Enrollment>('POST', 'education/enrollments', { idempotencyKey, body: { courseId } })).data;
  }
  /** The caller's own enrollments. Keyset. */
  async list(params: { completedOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Enrollment>> {
    const r = await this.http.request<Enrollment[]>('GET', 'education/enrollments', { query: { completedOnly: params.completedOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Enrollment> {
    return (await this.http.request<Enrollment>('GET', `education/enrollments/${encodeURIComponent(id)}`, { signal })).data;
  }
  async listProgress(enrollmentId: string, signal?: AbortSignal): Promise<LessonProgress[]> {
    return (await this.http.request<LessonProgress[]>('GET', `education/enrollments/${encodeURIComponent(enrollmentId)}/progress`, { signal })).data;
  }
  /** Record progress on a lesson (seconds watched / quiz score / completed). The server recomputes the
   * enrollment's overall progress + completion (the client never sets progressPct directly). */
  async markProgress(enrollmentId: string, lessonId: string, input: { secondsWatched?: number; quizScore?: number | null; completed?: boolean }): Promise<LessonProgress> {
    return (await this.http.request<LessonProgress>('POST', `education/enrollments/${encodeURIComponent(enrollmentId)}/lessons/${encodeURIComponent(lessonId)}/progress`, { body: input })).data;
  }
}

/** Curated learning resources / tips (read surface for P-20 tips + crop hub). `box=browse` returns only APPROVED
 * resources (server-enforced — the app can't request another tenant's drafts). There is NO get-by-id endpoint, so
 * a detail screen re-reads the list and finds the row. Keyset; never offset. */
export class ResourcesResource {
  constructor(private readonly http: HttpClient) {}
  async list(params: { kind?: ResourceKind; topicId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LearningResource>> {
    const r = await this.http.request<LearningResource[]>('GET', 'education/resources', { query: { box: 'browse', kind: params.kind, topicId: params.topicId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Editorial crop-agronomy calendars (P1-5): reference growth-stage timelines by crop/season/region (read-only). */
  async cropCalendars(params: { crop?: string; season?: string; regionId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<CropCalendar[]> {
    return (await this.http.request<CropCalendar[]>('GET', 'education/resources/crop-calendars', { query: { crop: params.crop, season: params.season, regionId: params.regionId, limit: params.limit }, signal })).data;
  }
}

/** PC-56 TENANT-7d-money · W418 — the instructor's earnings over the royalty ledger (0174). Every figure is a SUM the API
 *  made per currency in minor units; this resource carries strings and formats nothing. `EARNINGS_DISABLED` (404 with a
 *  code) is W418's flagged-off state. Money OUT is the payment plane's request (purpose `course_royalty`), which rides the
 *  tenant's two-person batch — the SDK never posts a leg. */
export class InstructorEarningsResource {
  constructor(private readonly http: HttpClient) {}
  /** W418 — the caller's own desk; `instructorId` for the finance desk. */
  async view(instructorId?: string | null, signal?: AbortSignal): Promise<EarningsView> {
    return (await this.http.request<EarningsView>('GET', 'education/earnings', { query: { instructor: instructorId ?? undefined }, signal })).data;
  }
  /** The statement of lines. Keyset. */
  async statement(params: { instructorId?: string | null; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<EarningsStatementLine>> {
    const r = await this.http.request<EarningsStatementLine[]>('GET', 'education/earnings/statement', { query: { instructor: params.instructorId ?? undefined, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The confirm step's verdict (writes nothing). */
  async payoutReview(input: RoyaltyPayoutInput): Promise<RoyaltyPayoutReview> {
    return (await this.http.request<RoyaltyPayoutReview>('POST', 'education/earnings/payouts/review', { body: input })).data;
  }
  /** The payout request — queued on the payment plane; it leaves only through the tenant's approved batch. */
  async requestPayout(input: RoyaltyPayoutInput, idempotencyKey: string): Promise<PayoutSummary & { payoutId: string }> {
    return (await this.http.request<PayoutSummary & { payoutId: string }>('POST', 'education/earnings/payouts', { idempotencyKey, body: input })).data;
  }
  /** W418's Export → the tenant export plane (dataset `education.instructor_earnings`). */
  async enqueueExport(idempotencyKey: string): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('POST', 'education/earnings/export', { idempotencyKey, body: {} })).data;
  }
  /** The tenant's split rule: in force, the platform default, the history. */
  async rule(signal?: AbortSignal): Promise<RoyaltyRuleView> {
    return (await this.http.request<RoyaltyRuleView>('GET', 'education/earnings/rule', { signal })).data;
  }
  /** The finance desk proposes ONLY the instructor share; the platform's is copied, the tenant's is the remainder. */
  async proposeRule(input: { instructorShareBps: number; note?: string | null }, idempotencyKey: string): Promise<{ id: string; status: string; instructorBps: number; tenantBps: number; platformBps: number }> {
    return (await this.http.request<{ id: string; status: string; instructorBps: number; tenantBps: number; platformBps: number }>('POST', 'education/earnings/rule', { idempotencyKey, body: input })).data;
  }
  /** A DIFFERENT finance person approves or rejects (with a note). */
  async decideRule(ruleId: string, input: { act: 'approve' | 'reject'; note?: string | null }, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `education/earnings/rule/${encodeURIComponent(ruleId)}/decide`, { idempotencyKey, body: input })).data;
  }
  /** The desk offers an instructor an agreement (at the rule in force, or a negotiated instructor share). */
  async offerAgreement(input: { instructorId: string; instructorShareBps?: number | null; termsNote?: string | null }, idempotencyKey: string): Promise<InstructorAgreement> {
    return (await this.http.request<InstructorAgreement>('POST', 'education/earnings/agreements', { idempotencyKey, body: input })).data;
  }
  /** accept · decline (the instructor) · supersede (the desk). Acceptance releases every held line. */
  async actAgreement(agreementId: string, act: AgreementAct, idempotencyKey: string): Promise<{ id: string; version: number; status: string; released: Array<{ currencyCode: string; amountMinor: string; lines: number; txnId: string }> }> {
    return (await this.http.request<{ id: string; version: number; status: string; released: Array<{ currencyCode: string; amountMinor: string; lines: number; txnId: string }> }>('POST', `education/earnings/agreements/${encodeURIComponent(agreementId)}/${act}`, { idempotencyKey, body: {} })).data;
  }
}
