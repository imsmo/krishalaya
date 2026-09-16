// @krishalaya/sdk-js · education resource (module 9 — courses + enrollments). Learner surface: browse published
// courses, read a course + its lessons, ENROLL (idempotent — a paid enroll moves money, Law 3), and track per-
// lesson PROGRESS (seconds watched + quiz score + completed). Enrollments/progress are the caller's OWN (server
// resolves the learner — no IDOR). Money is bigint minor strings (Law 2). Gated server-side by the `education` flag.
import { HttpClient } from '../http';
import {
  Course, CourseLesson, Enrollment, LessonProgress, LearningResource, ResourceKind, CropCalendar, Page,
  CourseDesk, CourseTopic, CourseStats, CourseFormInput, CourseActs, CourseAct, FormReview,
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
  /** Author: add/replace one lesson (module/lesson number addressing; video/text via contentKind + mediaId/body;
   *  `quiz` carries the canonical quiz JSON `{questions:[{q,options,answer,hint?}]}` — the shape the mobile
   *  learner parser consumes). */
  async addLesson(courseId: string, input: { moduleNo?: number; lessonNo: number; defaultTitle: string; contentKind: string; mediaId?: string | null; body?: string | null; durationSecs?: number | null; quiz?: unknown }): Promise<CourseLesson> {
    return (await this.http.request<CourseLesson>('POST', `education/courses/${encodeURIComponent(courseId)}/lessons`, { body: input })).data;
  }
}

/** PC-26b: live-session hosting (education.host) + external content channels. Server-gated by the `education`
 *  flag; the studio only reflects legality. */
export interface EduChannel { id: string; provider: string; title: string; handle: string | null; externalUrl: string; topicId: string | null; description: string | null; status: string; createdAt?: string; }
export interface LiveSession { id: string; channelId: string; title: string; topicId: string | null; scheduledAt: string; status: string; startedAt?: string | null; endedAt?: string | null; createdAt?: string; }

export class LiveStudioResource {
  constructor(private readonly http: HttpClient) {}
  /** Host: schedule a live session on one of your channels. */
  async schedule(input: { channelId: string; title: string; topicId?: string | null; scheduledAt: string }): Promise<LiveSession> {
    return (await this.http.request<LiveSession>('POST', 'education/live-sessions', { body: input })).data;
  }
  async list(params: { box?: 'upcoming' | 'mine' | 'all'; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LiveSession>> {
    const r = await this.http.request<LiveSession[]>('GET', 'education/live-sessions', { query: { box: params.box ?? 'upcoming', cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<LiveSession> {
    return (await this.http.request<LiveSession>('GET', `education/live-sessions/${encodeURIComponent(id)}`, { signal })).data;
  }
  async start(id: string): Promise<LiveSession> {
    return (await this.http.request<LiveSession>('POST', `education/live-sessions/${encodeURIComponent(id)}/start`, {})).data;
  }
  async end(id: string): Promise<LiveSession> {
    return (await this.http.request<LiveSession>('POST', `education/live-sessions/${encodeURIComponent(id)}/end`, {})).data;
  }
  async cancel(id: string): Promise<LiveSession> {
    return (await this.http.request<LiveSession>('POST', `education/live-sessions/${encodeURIComponent(id)}/cancel`, {})).data;
  }
  // --- channels (a host registers external content channels; moderation is admin-side) ---
  async channels(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<EduChannel>> {
    const r = await this.http.request<EduChannel[]>('GET', 'education/channels', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async registerChannel(input: { provider: string; title: string; handle?: string | null; externalUrl: string; topicId?: string | null; description?: string | null }): Promise<EduChannel> {
    return (await this.http.request<EduChannel>('POST', 'education/channels', { body: input })).data;
  }
  // --- instructor self-profile ---
  async myInstructor(signal?: AbortSignal): Promise<{ id: string; bio: string | null } | null> {
    try { return (await this.http.request<{ id: string; bio: string | null }>('GET', 'education/instructors/me', { signal })).data; }
    catch { return null; }
  }
  async upsertInstructor(input: { bio?: string | null }): Promise<{ id: string; bio: string | null }> {
    return (await this.http.request<{ id: string; bio: string | null }>('PUT', 'education/instructors/me', { body: input })).data;
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
