// modules/education/services/live-session.service.ts · PC-56 TENANT-7c · THE LIVE CLASS — the class record behind W414
// (the schedule), W415 (the host desk) and their two chains (W2671–W2674 form, W2675–W2677 mutate).
//
// WHAT IS DECLARED HONESTLY. This platform has no video provider: `STREAM_PROVIDER_URL` unset binds `NoopStreamGateway`
// (providerCode `noop`), which in production answers `provider_not_configured`. So a class here is SCHEDULED (an instant
// in the cooperative's own timezone, a duration, a capacity), HELD on a join link the host pastes (whatever the
// cooperative uses), marked ENDED by the host once it is over, its ATTENDANCE recorded as a number the host writes down,
// its RECORDING attached through core/media (store · scan · serve — nothing transcodes) and published as a `live`-kind
// lesson by an act a person performs with a reason. `start` — the one edge a provider would take — is refused by name
// unless a provider other than the noop is bound. Nothing here counts viewers, queues questions, transcribes voice,
// slows chat or seats a co-host: none of those has a table or a provider, and the pages say so.
//
// THE RULES THIS FILE KEEPS, all 7a's:
//   1. THE REVIEW AND THE WRITE ARE ONE FUNCTION. `preview`, `create` and `update` call `reviewLiveClass` over the same
//      facts (the course and its instructor, the class as it stands, the instant the DATABASE resolved for the typed
//      wall-clock, the host's other classes); a write is refused with the review's own codes (`LiveFormRefusedError`).
//   2. EVERY ACT IS A VERDICT FIRST. `liveActVerdict` answers the confirm screen and is re-taken on the locked row.
//   3. EVERY WRITE HAS A KEY AND AN AUDIT ROW. `education.live.<create|update|start|end|cancel|attendance|recording|
//      to_lesson|register>` on entity `live_session`, with before/after and — for the acts — the reason, in the transaction.
//   4. THE CLOCK IS THE COOPERATIVE'S. `LiveSessionRepository.resolveStart` converts in SQL through
//      `tenants.country_code → countries.timezone`; this file never builds a Date from digits.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { InfraError } from '../../../shared/errors/app-error';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ReviewResult, looksLikeId, submittedValues, writerIssuesOf } from '../../../shared/form-review';
import { STREAM_PROVIDER, StreamProvider } from '../gateway/stream-provider.port';
import { LiveSession } from '../domain/live-session.entity';
import { Course } from '../domain/course.entity';
import { CourseLesson } from '../domain/course-lesson.entity';
import { DomainEvent } from '../domain/creator.events';
import { LiveSessionRepository, LiveClassRow, LiveBox } from '../repositories/live-session.repository';
import { CourseRepository } from '../repositories/course.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { LiveSessionNotFoundError } from '../domain/creator.errors';
import { EducationForbiddenError, LiveActRefusedError, LiveFormRefusedError, LiveRegisterRefusedError } from '../domain/education.errors';
import { EducationActor } from './instructor.service';
import { CurrentClass, LiveReviewInput, liveFormValues, reviewLiveClass, storedLiveClass } from '../domain/live-class-review';
import { LiveAct, LiveActVerdict, allLiveVerdicts, isLiveAct, liveActVerdict } from '../domain/live-class-acts';
import { LiveFormDto, LiveWriterSchema } from '../dto/schedule-live.dto';
import { MediaFacts } from '../domain/lesson-review';
import { JoinWindow, ReminderKind, intervalOf, isWithin, joinWindowOf, noticeDayText, parseDateOnly, parseWallTime, reminderOffsets, remindersDue } from '../domain/live-clock';

/** The outbox type the reminder job emits; mapped to the catalogue's `education.live_reminder` in communication's event map. */
export const LIVE_REMINDER_EVENT = 'education.live_reminder';

export interface LiveClassListItem {
  session: Omit<ReturnType<LiveSession['toJSON']>, 'joinUrl'> & { joinUrl: string | null };
  localDate: string; localTime: string; timezone: string; registered: number;
  course: { id: string; defaultTitle: string } | null;
}
export interface LiveClassView extends LiveClassListItem {
  course: { id: string; defaultTitle: string; status: string } | null;
  window: JoinWindow;
  /** Whether THIS caller may see the join link now: the host and the desk always; a registered member inside the window. */
  joinVisible: boolean;
  /** The host or the desk — the callers who see everything and act. */
  isHost: boolean; privileged: boolean; canEdit: boolean; registeredSelf: boolean;
  providerConfigured: boolean;
  acts: LiveActVerdict[];
  recording: MediaFacts | null;
  recordingLesson: { id: string; defaultTitle: string; position: string } | null;
  reminders: Array<{ kind: ReminderKind; sentAt: Date; recipients: number }>;
  form: Record<string, string>;
}

@Injectable()
export class LiveSessionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(STREAM_PROVIDER) private readonly stream: StreamProvider,
    private readonly repo: LiveSessionRepository,
    private readonly courses: CourseRepository,
    private readonly instructors: InstructorRepository,
    private readonly lessons: CourseLessonRepository,
  ) {}

  /** The only honest meaning of "a provider is configured": something other than the noop is bound. */
  get providerConfigured(): boolean { return this.stream.providerCode !== 'noop'; }

  /* ---- READS ------------------------------------------------------------------------------------------------- */

  /** W414's table. Keyset on (scheduled_at, id); `upcoming` ascends, everything else descends. */
  async list(tenantId: string, actor: EducationActor, q: { box: LiveBox; courseId?: string; status?: string; cursor?: { at: string; id: string }; limit: number }) {
    const rows = await this.repo.listFor(tenantId, { box: q.box, hostUserId: q.box === 'mine' ? actor.userId : undefined, courseId: q.courseId, status: q.status as any, cursor: q.cursor, limit: q.limit });
    const titles = await this.courseTitles(tenantId, rows.map((r) => r.session.courseId));
    const items = rows.map((r) => this.listItem(r, actor, titles));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? Buffer.from(`${last.session.toProps().scheduledAt.toISOString()}|${last.session.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /** W415 — the host desk (and a member's view of a class: the join link only inside the window, only when registered). */
  async get(tenantId: string, actor: EducationActor, id: string, now = new Date()): Promise<LiveClassView> {
    const row = await this.repo.getById(tenantId, id);
    if (!row) throw new LiveSessionNotFoundError(id);
    const p = row.session.toProps();
    const course = p.courseId ? await this.courses.getById(tenantId, p.courseId) : null;
    const isHost = p.hostUserId === actor.userId;
    const privileged = isHost || actor.canPublish;
    const registeredSelf = privileged ? false : await this.repo.isRegistered(tenantId, id, actor.userId);
    const window = joinWindowOf(intervalOf(p.scheduledAt, p.durationMins));
    const joinVisible = p.joinUrl !== null && (privileged || (registeredSelf && p.status !== 'cancelled' && isWithin(now, window)));
    const recording = p.recordingMediaId ? await this.lessons.mediaFacts(tenantId, p.recordingMediaId) : null;
    const lesson = p.recordingLessonId && p.courseId ? await this.lessons.getById(tenantId, p.courseId, p.recordingLessonId) : null;
    const acts = allLiveVerdicts({
      canAuthor: actor.canAuthor, canPublish: actor.canPublish, isHost, courseStatus: course?.status ?? null, status: p.status, scheduledAt: p.scheduledAt, now,
      providerConfigured: this.providerConfigured, hasRecording: p.recordingMediaId !== null, recordingLessonId: p.recordingLessonId, recordingScanStatus: recording?.scanStatus ?? null,
    });
    const titles = course ? new Map([[course.id, course.toProps().defaultTitle]]) : new Map<string, string>();
    const item = this.listItem(row, actor, titles, joinVisible);
    return {
      ...item,
      course: course ? { id: course.id, defaultTitle: course.toProps().defaultTitle, status: course.status } : null,
      window, joinVisible, isHost, privileged, canEdit: privileged && p.status === 'scheduled' && course?.status !== 'archived', registeredSelf,
      providerConfigured: this.providerConfigured, acts, recording,
      recordingLesson: lesson ? { id: lesson.id, defaultTitle: lesson.toProps().defaultTitle, position: `${lesson.toProps().moduleNo}·${lesson.toProps().lessonNo}` } : null,
      reminders: await this.repo.remindersFor(tenantId, id),
      form: liveFormValues(this.current(row)),
    };
  }

  /* ---- THE FORM: review and write, one function ---------------------------------------------------------------- */

  async preview(tenantId: string, actor: EducationActor, dto: LiveFormDto & { id?: string }, now = new Date()): Promise<ReviewResult> {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    const { id, ...form } = dto;
    return this.uow.run(tenantId, async (tx) => reviewLiveClass(await this.reviewInput(tx, tenantId, actor, form, id ?? null, now)), { userId: actor.userId });
  }

  async create(tenantId: string, actor: EducationActor, idemKey: string, dto: LiveFormDto, ip: string | null, now = new Date()) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.live.create', () =>
      timed(this.metrics, 'education.live.schedule', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const input = await this.reviewInput(tx, tenantId, actor, dto, null, now);
          const stored = storedLiveClass(input);
          if (!stored) throw new LiveFormRefusedError(reviewLiveClass(input).refusals);
          const s = LiveSession.schedule({ id: uuidv7(), tenantId, ...stored });
          await this.repo.insert(tx, s);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.live.create', entityType: 'live_session', entityId: s.id, newValue: s.toJSON(), ip });
          await this.flush(tx, tenantId, s.id, s.pullEvents());
          return s.toJSON();
        }, { userId: actor.userId })));
  }

  async update(tenantId: string, actor: EducationActor, idemKey: string, id: string, dto: LiveFormDto, ip: string | null, now = new Date()) {
    if (!actor.canAuthor && !actor.canPublish) throw new EducationForbiddenError('requires course.author');
    return this.idem.remember(idemKey, actor.userId, 'education.live.update', () =>
      this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.getForUpdate(tx, tenantId, id);
        if (!row) throw new LiveSessionNotFoundError(id);
        const input = await this.reviewInput(tx, tenantId, actor, dto, id, now, row);
        const stored = storedLiveClass(input);
        if (!stored) throw new LiveFormRefusedError(reviewLiveClass(input).refusals);
        const before = row.session.toJSON();
        row.session.reschedule(stored);
        await this.repo.update(tx, row.session);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.live.update', entityType: 'live_session', entityId: id, oldValue: before, newValue: row.session.toJSON(), ip });
        return row.session.toJSON();
      }, { userId: actor.userId }));
  }

  /** Every fact the reviewer needs, gathered once so `preview` and the writers cannot disagree. */
  private async reviewInput(tx: TxContext, tenantId: string, actor: EducationActor, form: LiveFormDto, id: string | null, now: Date, locked?: LiveClassRow): Promise<LiveReviewInput> {
    const body = submittedValues(form as Record<string, unknown>);
    let current: CurrentClass | null | undefined = undefined;
    if (id !== null) {
      const row = locked ?? (looksLikeId(id) ? await this.repo.getById(tenantId, id, tx) : null);
      current = row ? this.current(row) : null;
    }
    const courseId = id !== null ? (current?.courseId ?? null) : (body.courseId ?? null);
    let course: LiveReviewInput['course'] = undefined; let isOwner = false; let hostUserId: string | null = null;
    if (courseId !== null) {
      const c = looksLikeId(courseId) ? await this.courses.getById(tenantId, courseId, tx) : null;
      const ours = c !== null && c.tenantId !== null;   // a platform course is not a tenant's to hold classes on
      if (!ours) course = null;
      else {
        const owner = await this.instructors.getById(tenantId, c!.instructorId, tx);
        hostUserId = owner?.userId ?? null; isOwner = hostUserId === actor.userId;
        course = { status: c!.status, instructorUserId: hostUserId };
      }
    }
    // The database is asked only about a wall-clock that IS one: `25:00` or `2026-02-30` is the review's refusal
    // (TIME_INVALID / DATE_INVALID), not a 22008 from Postgres — the live spec caught the first draft asking anyway.
    const date = parseDateOnly(body.date); const time = parseWallTime(body.time);
    const resolved = date !== null && time !== null ? await this.repo.resolveStart(tenantId, date, time, tx) : undefined;
    const others = hostUserId ? await this.repo.hostCalendar(tenantId, hostUserId, tx) : [];
    return {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish, isOwner, course, current, entered: form, resolved, others, now,
      writerIssues: writerIssuesOf(LiveWriterSchema, body),
    };
  }

  /* ---- THE ACTS: verdict, then act --------------------------------------------------------------------------- */

  async act(tenantId: string, actor: EducationActor, idemKey: string, id: string, actName: string, body: { reason: string; count?: string; mediaId?: string }, ip: string | null, now = new Date()) {
    if (!isLiveAct(actName)) throw new LiveActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: LiveAct = actName;
    return this.idem.remember(idemKey, actor.userId, `education.live.${act}`, async () => {
      // THE PROVIDER EDGE: provision OUTSIDE the tx (no network in a DB tx) — only when a provider is bound, only when the verdict allows.
      let provisioned: { providerStreamRef: string; playbackUrl: string | null } | null = null;
      if (act === 'start') {
        const pre = await this.get(tenantId, actor, id, now);
        const withReason = liveActVerdict({ ...this.verdictBase(pre, actor, now), act, reason: body.reason, count: undefined, media: undefined });
        if (!withReason.allowed) throw new LiveActRefusedError(act, withReason.refusals);
        const r = await this.stream.createStream({ idempotencyKey: id, tenantId, sessionId: id, hostUserId: pre.session.hostUserId, title: pre.session.title });
        if (!r.ok || !r.providerStreamRef) { this.metrics.inc('education.live.provision_failed', { reason: r.failureReason ?? 'unknown' }); throw new InfraError('LIVE_PROVIDER_UNAVAILABLE', 'Could not start the live stream right now', { reason: r.failureReason }); }
        provisioned = { providerStreamRef: r.providerStreamRef, playbackUrl: r.playbackUrl ?? null };
      }
      return this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.getForUpdate(tx, tenantId, id);
        if (!row) throw new LiveSessionNotFoundError(id);
        const s = row.session; const p = s.toProps();
        const isHost = p.hostUserId === actor.userId;
        if (!isHost && !actor.canPublish) throw new LiveSessionNotFoundError(id);   // 404-shaped for a probe, as 7a
        const course = p.courseId ? await this.courses.getById(tenantId, p.courseId, tx) : null;
        const mediaTyped = (body.mediaId ?? '').trim();
        const media = act === 'recording' ? (mediaTyped.length === 0 ? undefined : (looksLikeId(mediaTyped) ? await this.lessons.mediaFacts(tenantId, mediaTyped, tx) : null)) : undefined;
        const recording = p.recordingMediaId ? await this.lessons.mediaFacts(tenantId, p.recordingMediaId, tx) : null;
        const v = liveActVerdict({
          act, canAuthor: actor.canAuthor, canPublish: actor.canPublish, isHost, courseStatus: course?.status ?? null, status: p.status, scheduledAt: p.scheduledAt, now,
          providerConfigured: this.providerConfigured, hasRecording: p.recordingMediaId !== null, recordingLessonId: p.recordingLessonId, recordingScanStatus: recording?.scanStatus ?? null,
          media: media === null ? null : media ? { kind: media.kind, scanStatus: media.scanStatus } : undefined, count: body.count, reason: body.reason,
        });
        if (!v.allowed) throw new LiveActRefusedError(act, v.refusals);
        let before: Record<string, unknown>; let after: Record<string, unknown>;
        switch (act) {
          case 'start': before = { status: p.status }; s.start(provisioned!.providerStreamRef, provisioned!.playbackUrl, now); after = { status: s.status, startedAt: now }; break;
          case 'end': before = { status: p.status }; s.end(now); after = { status: s.status, endedAt: now }; break;
          case 'cancel': before = { status: p.status }; s.cancel(now); after = { status: s.status, cancelledAt: now }; break;
          case 'attendance': before = { attendanceCount: p.attendanceCount }; s.recordAttendance(Number((body.count ?? '').trim()), actor.userId, now); after = { attendanceCount: s.toProps().attendanceCount, registered: row.registered }; break;
          case 'recording': before = { recordingMediaId: p.recordingMediaId }; s.attachRecording((media as MediaFacts).id, now); after = { recordingMediaId: (media as MediaFacts).id, kind: (media as MediaFacts).kind, scanStatus: (media as MediaFacts).scanStatus }; break;
          case 'to_lesson': {
            // W414 "recorded → lesson 7": a `live`-kind lesson at the end of the course's LAST module, appended under a lock (7b's rule for a position)
            const lessonId = await this.publishRecordingAsLesson(tx, tenantId, course!, s, recording as MediaFacts, actor.userId, ip);
            before = { recordingLessonId: null }; s.publishedAsLesson(lessonId); after = { recordingLessonId: lessonId };
            break;
          }
        }
        await this.repo.update(tx, s);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `education.live.${act}`, entityType: 'live_session', entityId: id, oldValue: before, newValue: after, reason: body.reason, ip });
        await this.flush(tx, tenantId, id, s.pullEvents());
        return s.toJSON();
      }, { userId: actor.userId });
    });
  }

  private async publishRecordingAsLesson(tx: TxContext, tenantId: string, course: Course, s: LiveSession, recording: MediaFacts, by: string, ip: string | null): Promise<string> {
    const all = await this.lessons.listForCourse(tenantId, course.id, tx);
    const moduleNo = all.reduce((mx, l) => Math.max(mx, l.toProps().moduleNo), 0) || 1;
    const rows = await this.lessons.listModuleForUpdate(tx, tenantId, course.id, moduleNo);
    const lessonNo = rows.reduce((mx, l) => Math.max(mx, l.toProps().lessonNo), 0) + 1;
    const p = s.toProps();
    const l = CourseLesson.create({
      id: uuidv7(), courseId: course.id, moduleNo, lessonNo, defaultTitle: p.title, contentKind: 'live', mediaId: recording.id, body: null,
      durationSecs: recording.durationSecs ?? p.durationMins * 60, quiz: null, siblingLessonId: null, thumbnailFrameSecs: null, chapters: [], quizPassingPct: null,
    });
    await this.lessons.insert(tx, l, by);
    await this.audit.write(tx, { tenantId, actorUserId: by, action: 'education.lesson.create', entityType: 'lesson', entityId: l.id, newValue: { ...l.toJSON(), fromLiveSession: s.id }, ip });
    return l.id;
  }

  /* ---- REGISTER (any member) ---------------------------------------------------------------------------------- */

  /** A member registers for a class still on the calendar and not full. Idempotent by (session, user) and by key. */
  async register(tenantId: string, actor: EducationActor, idemKey: string | null, id: string, ip: string | null) {
    const work = () => this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.getForUpdate(tx, tenantId, id);
      if (!row) throw new LiveSessionNotFoundError(id);
      const p = row.session.toProps();
      if (p.status !== 'scheduled') throw new LiveRegisterRefusedError(['CLASS_NOT_OPEN']);
      const n = await this.repo.registrationCount(tx, tenantId, id);
      const already = await this.repo.isRegistered(tenantId, id, actor.userId, tx);
      if (!already && p.capacity !== null && n >= p.capacity) throw new LiveRegisterRefusedError(['CLASS_FULL']);
      const inserted = await this.repo.register(tx, tenantId, id, actor.userId);
      if (inserted) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'education.live.register', entityType: 'live_session', entityId: id, newValue: { userId: actor.userId, registered: n + 1 }, ip });
      return { registered: true, count: inserted ? n + 1 : n };
    }, { userId: actor.userId });
    return idemKey ? this.idem.remember(idemKey, actor.userId, 'education.live.register', work) : work();
  }

  /* ---- THE REMINDER CADENCE (kv_relay pool; registered in EducationModule) ------------------------------------ */

  /**
   * One tick: for every scheduled class that wants reminding, the kinds due at `now` that have not been sent. Each
   * (class, kind) is claimed by the UNIQUE row first; a pod that loses the race writes nothing. The outbox event carries
   * the registered members and the digits the notice prints — `day` and `time` as the DATABASE resolved them in the
   * cooperative's zone. Zero registered members still records the row (nothing to send, nothing to retry).
   */
  async remindTick(pool: Pool, now = new Date()): Promise<{ sent: number; recipients: number }> {
    const candidates = await this.repo.reminderCandidates(pool, now);
    let sent = 0; let recipients = 0;
    for (const c of candidates) {
      const due = remindersDue(now, c.scheduledAt, reminderOffsets(c.offsets), new Set(c.sent));
      for (const kind of due) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const claim = await client.query(`INSERT INTO live_class_reminders (tenant_id, session_id, kind, recipients) VALUES ($1,$2,$3,0) ON CONFLICT (session_id, kind) DO NOTHING RETURNING id`, [c.tenantId, c.id, kind]);
          if (!claim.rows[0]) { await client.query('ROLLBACK'); continue; }
          const members = (await client.query(`SELECT user_id FROM live_session_registrations WHERE session_id=$1`, [c.id])).rows.map((x: any) => x.user_id as string);
          if (members.length > 0) {
            await this.outbox.write({ query: client.query.bind(client), tenantId: c.tenantId } as unknown as TxContext, {
              tenantId: c.tenantId, aggregateType: 'live_session', aggregateId: c.id, eventType: LIVE_REMINDER_EVENT,
              payload: { v: 1, sessionId: c.id, kind, recipientUserIds: members, title: c.title, day: noticeDayText(c.localDate), time: c.localTime },
            });
            await client.query(`UPDATE live_class_reminders SET recipients=$2 WHERE id=$1`, [claim.rows[0].id, members.length]);
          }
          await client.query('COMMIT');
          sent += 1; recipients += members.length;
        } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
        finally { client.release(); }
      }
    }
    if (sent > 0) this.metrics.inc('education.live.reminders_sent', { n: String(sent) });
    return { sent, recipients };
  }

  /* ---- helpers ------------------------------------------------------------------------------------------------ */

  private verdictBase(v: LiveClassView, actor: EducationActor, now: Date) {
    return {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish, isHost: v.isHost, courseStatus: v.course?.status ?? null, status: v.session.status, scheduledAt: new Date(v.session.scheduledAt), now,
      providerConfigured: this.providerConfigured, hasRecording: v.session.recordingMediaId !== null, recordingLessonId: v.session.recordingLessonId, recordingScanStatus: v.recording?.scanStatus ?? null,
    };
  }
  private listItem(r: LiveClassRow, actor: EducationActor, titles: Map<string, string>, joinVisible?: boolean): LiveClassListItem {
    const j = r.session.toJSON();
    const privileged = j.hostUserId === actor.userId || actor.canPublish;
    const show = joinVisible ?? privileged;
    return {
      session: { ...j, joinUrl: show ? j.joinUrl : null },
      localDate: r.localDate, localTime: r.localTime, timezone: r.timezone, registered: r.registered,
      course: j.courseId ? { id: j.courseId, defaultTitle: titles.get(j.courseId) ?? '' } : null,
    };
  }
  private async courseTitles(tenantId: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const id of new Set(ids.filter((x): x is string => x !== null))) { const c = await this.courses.getById(tenantId, id); if (c) out.set(id, c.toProps().defaultTitle); }
    return out;
  }
  private current(r: LiveClassRow): CurrentClass {
    const p = r.session.toProps();
    return { id: p.id, status: p.status, courseId: p.courseId, hostUserId: p.hostUserId, title: p.title, scheduledAt: p.scheduledAt, durationMins: p.durationMins, capacity: p.capacity, joinUrl: p.joinUrl, clashAccepted: p.clashAccepted, remind: p.remind, localDate: r.localDate, localTime: r.localTime };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'live_session', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
