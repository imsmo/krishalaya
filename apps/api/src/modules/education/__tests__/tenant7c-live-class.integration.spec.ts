// modules/education/__tests__/tenant7c-live-class.integration.spec.ts · PC-56 TENANT-7c · the live class against a REAL
// Postgres (the harness builds the database from the real chain, 0001…0172 + seeds), as `kv_app` under RLS.
// What this proves that the unit specs cannot:
//   • the wall-clock a host types becomes an instant in the COOPERATIVE's zone — resolved by the database through
//     `tenants.country_code → countries.timezone` — and reads back as the same wall-clock whatever TZ this process has
//     (run under Asia/Kolkata AND UTC);
//   • the review and the write agree on every fact they read (the course and its instructor, the host's other classes,
//     the media asset in THIS tenant's bucket), and a refused write writes nothing;
//   • `live_session_registrations` is under RLS since 0172 (tenant B reads nothing of A's; a wrong tenant_id is
//     overwritten by the trigger), a full class refuses, the same member registers once;
//   • the acts: `start` refused BY NAME with the noop provider and allowed with a bound one; `end` from `scheduled` only
//     once the start has passed; attendance recorded; the recording attached and published as a `live` lesson at the end
//     of the course's last module, once; every act with its reason on the audit row; the same key never acts twice;
//   • the reminder cadence claims each (class, kind) once through the UNIQUE row and writes the outbox rows the
//     notification spine fans out — with the wall-clock digits the database resolved — and the templates resolve.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseRepository } from '../repositories/course.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { LiveSessionRepository } from '../repositories/live-session.repository';
import { InstructorService } from '../services/instructor.service';
import { CourseService } from '../services/course.service';
import { LessonService } from '../services/lesson.service';
import { LiveSessionService, LIVE_REMINDER_EVENT } from '../services/live-session.service';
import { NoopStreamGateway } from '../gateway/noop-stream.gateway';
import { StreamProvider } from '../gateway/stream-provider.port';
import { LiveFormRefusedError } from '../domain/education.errors';
import { LiveSessionNotFoundError } from '../domain/creator.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

/** The wall-clock in Asia/Kolkata (the seeded zone of country IN, the fixture tenant's country) for an instant. */
const IST = 'Asia/Kolkata';
function wallIn(zone: string, at: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
}
/** An instant N minutes from now, rounded to the minute — as the host would type it. */
function future(mins: number): { at: Date; date: string; time: string } {
  const at = new Date(Math.floor((Date.now() + mins * 60_000) / 60_000) * 60_000);
  return { at, ...wallIn(IST, at) };
}

run('PC-56 TENANT-7c · the live class (integration, real Postgres + RLS + 0172)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let live: LiveSessionService; let liveWithProvider: LiveSessionService; let courses: CourseService; let instructors: InstructorService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const host = randomUUID(); const other = randomUUID(); const desk = randomUUID(); const m1 = randomUUID(); const m2 = randomUUID();
  const H = { userId: host, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const O = { userId: other, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const D = { userId: desk, canAuthor: false, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const M1 = { userId: m1, canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const M2 = { userId: m2, canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const key = () => `t7c-${randomUUID()}`;
  let courseId = ''; let otherCourseId = ''; let video = ''; let pdf = ''; let foreignVideo = '';
  let classId = ''; let heldId = '';
  const audits = async (entityId: string) => (await admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE entity_type='live_session' AND entity_id=$1 ORDER BY id`, [entityId])).rows;
  const media = async (tenant: string, kind: string, mime: string, scan = 'pending') => {
    const id = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1,$2,$3,$4,$5,1,repeat('a',64),$6)`, [id, tenant, kind, `t7c/${id}`, mime, scan]);
    return id;
  };
  const F = (o: Record<string, string | undefined> = {}) => { const f = future(3 * 24 * 60); return { courseId, title: 'Mastitis: spot it early', date: f.date, time: f.time, durationMins: '90', capacity: '500', joinUrl: 'https://meet.example/mastitis', remind: '1', ...o }; };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [host, other, desk, m1, m2]) await makeUser(admin, u);
    video = await media(tenantA, 'video', 'video/mp4'); pdf = await media(tenantA, 'document', 'application/pdf', 'clean'); foreignVideo = await media(tenantB, 'video', 'video/mp4', 'clean');
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any); const sRepo = new LiveSessionRepository(replica as any);
    instructors = new InstructorService(uow, metrics, iRepo, audit, idem, cRepo);
    const lessons = new LessonService(uow, metrics, audit, idem, cRepo, lRepo, iRepo);
    courses = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo, lessons);
    live = new LiveSessionService(uow, outbox, metrics, audit, idem, new NoopStreamGateway(config), sRepo, cRepo, iRepo, lRepo);
    const bound: StreamProvider = { providerCode: 'fake-http', createStream: async () => ({ ok: true, providerStreamRef: 'st-1', playbackUrl: 'https://play.example/1' }) };
    liveWithProvider = new LiveSessionService(uow, outbox, metrics, audit, idem, bound, sRepo, cRepo, iRepo, lRepo);
    app = new Pool({ connectionString: APP_URL });
    await instructors.become(tenantA, H, 'Dairy scientist with Anand FPO');
    await instructors.become(tenantA, O, 'Another instructor');
    courseId = ((await courses.create(tenantA, H, key(), { defaultTitle: 'Buffalo Dairy Nutrition', topicCode: 'crop_care', level: 'basic', priceMajor: '', certEnabled: '' }, null)) as any).id;
    otherCourseId = ((await courses.create(tenantA, O, key(), { defaultTitle: 'Somebody else\'s course', topicCode: 'crop_care', level: 'basic', priceMajor: '', certEnabled: '' }, null)) as any).id;
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('the review refuses by name and the write refuses with the same codes, writing nothing', async () => {
    expect((await live.preview(tenantA, H, F({ courseId: '' }))).refusals).toEqual([{ field: 'courseId', code: 'COURSE_REQUIRED' }]);
    expect((await live.preview(tenantA, H, F({ courseId: randomUUID() }))).refusals).toEqual([{ field: 'courseId', code: 'COURSE_NOT_FOUND' }]);
    expect((await live.preview(tenantA, H, F({ courseId: 'not-an-id' }))).refusals).toEqual([{ field: 'courseId', code: 'COURSE_NOT_FOUND' }]);
    expect((await live.preview(tenantA, H, F({ courseId: otherCourseId }))).refusals).toEqual([{ field: null, code: 'NOT_OWNER' }]);
    expect((await live.preview(tenantA, H, F({ date: '2020-01-01' }))).refusals).toEqual([{ field: 'time', code: 'STARTS_IN_PAST' }]);
    expect((await live.preview(tenantA, H, F({ capacity: '501' }))).refusals).toEqual([{ field: 'capacity', code: 'CAPACITY_NEEDS_DESK' }]);
    expect((await live.preview(tenantA, D, F({ capacity: '501' }))).ready).toBe(true);   // the desk's key
    expect((await live.preview(tenantA, H, F({ joinUrl: 'http://meet.example/x' }))).refusals).toEqual([{ field: 'joinUrl', code: 'JOIN_URL_INVALID' }]);
    expect((await live.preview(tenantA, H, F({ time: '25:00' }))).refusals).toEqual([{ field: 'time', code: 'TIME_INVALID' }]);
    await expect(live.create(tenantA, H, key(), F({ capacity: '501' }), null)).rejects.toMatchObject({ code: 'LIVE_FORM_REFUSED', details: { refusals: [{ field: 'capacity', code: 'CAPACITY_NEEDS_DESK' }] } });
    await expect(live.create(tenantA, O, key(), F(), null)).rejects.toBeInstanceOf(LiveFormRefusedError);
    expect((await admin.query(`SELECT count(*)::int n FROM live_sessions WHERE tenant_id=$1`, [tenantA])).rows[0].n).toBe(0);
  });

  it('a ready review is a write: the wall-clock typed is an instant in the COOPERATIVE\'s zone (IST for country IN), read back as the same wall-clock; the audit row; the key replays', async () => {
    const f = F();
    const r = await live.preview(tenantA, H, f);
    expect(r.ready).toBe(true);
    const shown = r.fields.find((x) => x.name === 'startsAt')!.stored!;
    expect(shown.startsWith(`${f.date} ${f.time} Asia/Kolkata · `)).toBe(true);
    const k = key();
    const s: any = await live.create(tenantA, H, k, f, null);
    classId = s.id;
    // the instant the row holds, formatted in IST, is what the host typed — whatever TZ this process runs in
    expect(wallIn(IST, new Date(s.scheduledAt))).toEqual({ date: f.date, time: f.time });
    // IST is UTC+5:30: the stored instant is the UTC wall-clock of the digits minus 330 minutes
    const [y, mo, d] = f.date.split('-').map(Number); const [hh, mm] = f.time.split(':').map(Number);
    expect(Date.UTC(y, mo - 1, d, hh, mm) - new Date(s.scheduledAt).getTime()).toBe(330 * 60_000);
    expect(s).toMatchObject({ status: 'scheduled', hostUserId: host, courseId, durationMins: 90, capacity: 500, joinUrl: 'https://meet.example/mastitis', remind: true, clashAccepted: false });
    expect(((await live.create(tenantA, H, k, F({ title: 'replay' }), null)) as any).id).toBe(classId);
    expect((await audits(classId)).map((x) => x.action)).toEqual(['education.live.create']);
    const v = await live.get(tenantA, H, classId);
    expect(v).toMatchObject({ localDate: f.date, localTime: f.time, timezone: IST, registered: 0, isHost: true, privileged: true, canEdit: true, providerConfigured: false, joinVisible: true });
    expect(v.form).toMatchObject({ date: f.date, time: f.time, durationMins: '90', capacity: '500', remind: '1' });
    // a blank duration and capacity: the default and nothing
    const s2: any = await live.create(tenantA, H, key(), F({ title: 'Short talk', date: future(5 * 24 * 60).date, durationMins: '', capacity: '', joinUrl: '' }), null);
    expect(s2).toMatchObject({ durationMins: 60, capacity: null, joinUrl: null });
    heldId = s2.id;
  });

  it('W414 "Time clash — Schedule anyway": the host\'s OWN overlapping class refuses until accepted; another host\'s class at the same hour is no clash', async () => {
    const f = F({ title: 'Monsoon feeding: live Q&A', time: undefined });
    const base = await live.get(tenantA, H, classId);
    const startPlus30 = wallIn(IST, new Date(new Date(base.session.scheduledAt).getTime() + 30 * 60_000));
    const clash = { ...f, date: startPlus30.date, time: startPlus30.time };
    const r = await live.preview(tenantA, H, clash);
    expect(r.refusals).toEqual([{ field: 'clashAccepted', code: 'HOST_CLASH' }]);
    expect(r.fields.find((x) => x.name === 'clash')!.stored).toContain('Mastitis: spot it early');
    await expect(live.create(tenantA, H, key(), clash, null)).rejects.toBeInstanceOf(LiveFormRefusedError);
    const ok: any = await live.create(tenantA, H, key(), { ...clash, clashAccepted: '1' }, null);
    expect(ok.clashAccepted).toBe(true);
    // the desk schedules on the OTHER instructor's course: the HOST is that instructor, and their calendar is the one checked
    const d: any = await live.create(tenantA, D, key(), { ...clash, courseId: otherCourseId, title: 'Desk-scheduled on another course' }, null);
    expect(d.hostUserId).toBe(other); expect(d.clashAccepted).toBe(false);
  });

  it('registrations are under RLS (0172): a member registers once, the class fills, tenant B reads nothing, a wrong tenant_id is overwritten', async () => {
    const small: any = await live.create(tenantA, H, key(), F({ title: 'One seat', date: future(6 * 24 * 60).date, capacity: '1' }), null);
    expect(await live.register(tenantA, M1, key(), small.id, null)).toEqual({ registered: true, count: 1 });
    expect(await live.register(tenantA, M1, key(), small.id, null)).toEqual({ registered: true, count: 1 });   // once
    await expect(live.register(tenantA, M2, key(), small.id, null)).rejects.toMatchObject({ code: 'LIVE_REGISTER_REFUSED', details: { refusals: ['CLASS_FULL'] } });
    expect((await admin.query(`SELECT tenant_id FROM live_session_registrations WHERE session_id=$1`, [small.id])).rows).toEqual([{ tenant_id: tenantA }]);
    await admin.query(`INSERT INTO live_session_registrations (tenant_id, session_id, user_id) VALUES ($1,$2,$3)`, [tenantB, small.id, m2]);   // a writer gets it wrong
    expect((await admin.query(`SELECT tenant_id FROM live_session_registrations WHERE session_id=$1 AND user_id=$2`, [small.id, m2])).rows[0].tenant_id).toBe(tenantA);
    await admin.query(`DELETE FROM live_session_registrations WHERE session_id=$1 AND user_id=$2`, [small.id, m2]);
    // RLS as kv_app
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await app.query(`SELECT 1 FROM live_session_registrations WHERE session_id=$1`, [small.id])).rows).toHaveLength(0);
    expect((await app.query(`SELECT 1 FROM live_sessions WHERE id=$1`, [small.id])).rows).toHaveLength(0);
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await app.query(`SELECT 1 FROM live_session_registrations WHERE session_id=$1`, [small.id])).rows).toHaveLength(1);
    await expect(live.get(tenantB, M1, small.id)).rejects.toBeInstanceOf(LiveSessionNotFoundError);
    expect((await audits(small.id)).filter((x) => x.action === 'education.live.register')).toHaveLength(1);
  });

  it('the join link is the host\'s always, a registered member\'s inside the window only, nobody else\'s', async () => {
    await live.register(tenantA, M1, key(), classId, null);
    const start = new Date((await live.get(tenantA, H, classId)).session.scheduledAt);
    const before = new Date(start.getTime() - 16 * 60_000); const open = new Date(start.getTime() - 14 * 60_000); const late = new Date(start.getTime() + 90 * 60_000 + 31 * 60_000);
    expect((await live.get(tenantA, M1, classId, before))).toMatchObject({ registeredSelf: true, joinVisible: false, privileged: false }); expect((await live.get(tenantA, M1, classId, before)).session.joinUrl).toBeNull();
    expect((await live.get(tenantA, M1, classId, open))).toMatchObject({ joinVisible: true }); expect((await live.get(tenantA, M1, classId, open)).session.joinUrl).toBe('https://meet.example/mastitis');
    expect((await live.get(tenantA, M1, classId, late)).joinVisible).toBe(false);
    expect((await live.get(tenantA, M2, classId, open))).toMatchObject({ registeredSelf: false, joinVisible: false });
    expect((await live.get(tenantA, D, classId, before))).toMatchObject({ privileged: true, joinVisible: true });
    // the list shows the link to the host and the desk, to nobody else
    const mine = await live.list(tenantA, H, { box: 'mine', limit: 50 }); expect(mine.items.every((x) => x.session.joinUrl === null || x.session.hostUserId === host)).toBe(true);
    const asMember = await live.list(tenantA, M1, { box: 'upcoming', limit: 50 }); expect(asMember.items.every((x) => x.session.joinUrl === null)).toBe(true);
  });

  it('W414\'s table: keyset by (scheduled_at, id), upcoming ascending, a course filter, a page turn', async () => {
    const p1 = await live.list(tenantA, H, { box: 'upcoming', limit: 2 });
    expect(p1.items).toHaveLength(2); expect(p1.nextCursor).not.toBeNull();
    expect(new Date(p1.items[0].session.scheduledAt).getTime()).toBeLessThanOrEqual(new Date(p1.items[1].session.scheduledAt).getTime());
    const c = Buffer.from(p1.nextCursor!, 'base64').toString().split('|');
    const p2 = await live.list(tenantA, H, { box: 'upcoming', limit: 2, cursor: { at: c[0], id: c[1] } });
    expect(p2.items.map((x) => x.session.id)).not.toContain(p1.items[0].session.id);
    expect(new Date(p2.items[0].session.scheduledAt).getTime()).toBeGreaterThanOrEqual(new Date(p1.items[1].session.scheduledAt).getTime());
    const byCourse = await live.list(tenantA, H, { box: 'all', courseId: otherCourseId, limit: 50 });
    expect(byCourse.items).toHaveLength(1); expect(byCourse.items[0].course).toMatchObject({ id: otherCourseId, defaultTitle: 'Somebody else\'s course' });
    expect(byCourse.items[0]).toMatchObject({ timezone: IST });
    expect((await live.list(tenantA, H, { box: 'past', limit: 50 })).items).toHaveLength(0);
  });

  it('the acts: `start` refused BY NAME with the noop provider, `end` refused before the start, allowed after; attendance; the recording; the lesson; the reasons on the audit rows; the key never acts twice', async () => {
    const v = await live.get(tenantA, H, heldId);
    const start = new Date(v.session.scheduledAt);
    const reason = 'held on the meet link as planned';
    // start: the provider edge
    await expect(live.act(tenantA, H, key(), heldId, 'start', { reason }, null, new Date(start.getTime() - 60_000))).rejects.toMatchObject({ code: 'LIVE_ACT_REFUSED', details: { refusals: ['PROVIDER_NOT_CONFIGURED'] } });
    expect(v.acts.find((a) => a.act === 'start')).toMatchObject({ allowed: false, refusals: expect.arrayContaining(['PROVIDER_NOT_CONFIGURED']) });
    // end: held elsewhere — not before the start
    await expect(live.act(tenantA, H, key(), heldId, 'end', { reason }, null, new Date(start.getTime() - 60_000))).rejects.toMatchObject({ details: { refusals: ['BEFORE_START'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'end', { reason: 'ok' }, null, new Date(start.getTime() + 60_000))).rejects.toMatchObject({ details: { refusals: ['REASON_REQUIRED'] } });
    // another author is 404-shaped; the desk may act
    await expect(live.act(tenantA, O, key(), heldId, 'end', { reason }, null, new Date(start.getTime() + 60_000))).rejects.toBeInstanceOf(LiveSessionNotFoundError);
    expect((await admin.query(`SELECT status FROM live_sessions WHERE id=$1`, [heldId])).rows[0].status).toBe('scheduled');
    const k = key(); const after = new Date(start.getTime() + 61 * 60_000);
    const ended: any = await live.act(tenantA, H, k, heldId, 'end', { reason }, null, after);
    expect(ended.status).toBe('ended'); expect(new Date(ended.endedAt).getTime()).toBe(after.getTime()); expect(ended.startedAt).toBeNull();
    expect(((await live.act(tenantA, H, k, heldId, 'end', { reason }, null, after)) as any).status).toBe('ended');   // the same key replays, does not throw ILLEGAL
    await expect(live.act(tenantA, H, key(), heldId, 'end', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'cancel', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
    // attendance: a number the host writes down
    await expect(live.act(tenantA, H, key(), heldId, 'attendance', { reason, count: '' }, null, after)).rejects.toMatchObject({ details: { refusals: ['ATTENDANCE_REQUIRED'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'attendance', { reason, count: '12.5' }, null, after)).rejects.toMatchObject({ details: { refusals: ['ATTENDANCE_INVALID'] } });
    const att: any = await live.act(tenantA, H, key(), heldId, 'attendance', { reason: 'counted from the meet participants list', count: '342' }, null, after);
    expect(att).toMatchObject({ attendanceCount: 342, attendanceRecordedBy: host });
    // the recording: THIS tenant's video or audio
    await expect(live.act(tenantA, H, key(), heldId, 'recording', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['MEDIA_REQUIRED'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'recording', { reason, mediaId: foreignVideo }, null, after)).rejects.toMatchObject({ details: { refusals: ['MEDIA_UNKNOWN'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'recording', { reason, mediaId: 'nope' }, null, after)).rejects.toMatchObject({ details: { refusals: ['MEDIA_UNKNOWN'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'recording', { reason, mediaId: pdf }, null, after)).rejects.toMatchObject({ details: { refusals: ['MEDIA_KIND_MISMATCH'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'to_lesson', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['RECORDING_REQUIRED'] } });
    const rec: any = await live.act(tenantA, H, key(), heldId, 'recording', { reason: 'uploaded from the phone', mediaId: video }, null, after);
    expect(rec.recordingMediaId).toBe(video); expect(rec.recordingAttachedAt).not.toBeNull();
    // W414 "recorded → lesson 7": refused while the scan is pending, then a `live` lesson at the end of the last module, once
    await expect(live.act(tenantA, H, key(), heldId, 'to_lesson', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['MEDIA_NOT_CLEAN'] } });
    expect((await live.get(tenantA, H, heldId, after)).acts.find((a) => a.act === 'to_lesson')).toMatchObject({ allowed: false, refusals: ['MEDIA_NOT_CLEAN'] });
    await admin.query(`UPDATE media_assets SET scan_status='clean' WHERE id=$1`, [video]);
    const pub: any = await live.act(tenantA, H, key(), heldId, 'to_lesson', { reason: 'the recording is the lesson' }, null, after);
    expect(pub.recordingLessonId).toBeTruthy();
    const lesson = (await admin.query(`SELECT course_id, module_no, lesson_no, content_kind, media_id, default_title, status, duration_secs, tenant_id FROM course_lessons WHERE id=$1`, [pub.recordingLessonId])).rows[0];
    expect(lesson).toMatchObject({ course_id: courseId, module_no: 1, lesson_no: 1, content_kind: 'live', media_id: video, default_title: 'Short talk', status: 'draft', duration_secs: 3600, tenant_id: tenantA });
    await expect(live.act(tenantA, H, key(), heldId, 'to_lesson', { reason }, null, after)).rejects.toMatchObject({ details: { refusals: ['LESSON_EXISTS'] } });
    await expect(live.act(tenantA, H, key(), heldId, 'recording', { reason, mediaId: video }, null, after)).rejects.toMatchObject({ details: { refusals: ['LESSON_EXISTS'] } });
    const view = await live.get(tenantA, H, heldId, after);
    expect(view.recordingLesson).toMatchObject({ id: pub.recordingLessonId, position: '1·1', defaultTitle: 'Short talk' });
    expect(view.recording).toMatchObject({ id: video, kind: 'video', scanStatus: 'clean' });
    const rows = await audits(heldId);
    expect(rows.map((x) => x.action)).toEqual(['education.live.create', 'education.live.end', 'education.live.attendance', 'education.live.recording', 'education.live.to_lesson']);
    expect(rows[1].reason).toBe(reason); expect(rows[2].new_value).toMatchObject({ attendanceCount: 342 }); expect(rows[4].new_value).toMatchObject({ recordingLessonId: pub.recordingLessonId });
    // the lesson's own audit row names the class it came from
    expect((await admin.query(`SELECT new_value FROM audit_log WHERE entity_type='lesson' AND entity_id=$1`, [pub.recordingLessonId])).rows[0].new_value).toMatchObject({ fromLiveSession: heldId });
    // an edit is refused once the class is no longer scheduled
    expect((await live.preview(tenantA, H, { ...F(), id: heldId })).refusals).toContainEqual({ field: null, code: 'CLASS_NOT_SCHEDULED' });
  });

  it('with a stream provider BOUND, `start` goes live (not more than 15 minutes early) and `end` follows; `cancel` only while scheduled', async () => {
    const s: any = await liveWithProvider.create(tenantA, H, key(), F({ title: 'Streamed, for once', date: future(8 * 24 * 60).date, capacity: '' }), null);
    const start = new Date(s.scheduledAt);
    expect((await liveWithProvider.get(tenantA, H, s.id)).providerConfigured).toBe(true);
    await expect(liveWithProvider.act(tenantA, H, key(), s.id, 'start', { reason: 'going live now' }, null, new Date(start.getTime() - 16 * 60_000))).rejects.toMatchObject({ details: { refusals: ['TOO_EARLY'] } });
    const at = new Date(start.getTime() - 10 * 60_000);
    const lv: any = await liveWithProvider.act(tenantA, H, key(), s.id, 'start', { reason: 'going live now' }, null, at);
    expect(lv).toMatchObject({ status: 'live', playbackUrl: 'https://play.example/1' }); expect(new Date(lv.startedAt).getTime()).toBe(at.getTime());
    await expect(liveWithProvider.act(tenantA, H, key(), s.id, 'cancel', { reason: 'too late' }, null, at)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
    expect(((await liveWithProvider.act(tenantA, H, key(), s.id, 'end', { reason: 'stream over' }, null, new Date(at.getTime() + 60 * 60_000))) as any).status).toBe('ended');
    const c: any = await live.create(tenantA, H, key(), F({ title: 'To be cancelled', date: future(9 * 24 * 60).date, capacity: '' }), null);
    const cx: any = await live.act(tenantA, H, key(), c.id, 'cancel', { reason: 'the vet is away that week' }, null);
    expect(cx.status).toBe('cancelled'); expect(cx.cancelledAt).not.toBeNull();
    await expect(live.register(tenantA, M1, key(), c.id, null)).rejects.toMatchObject({ details: { refusals: ['CLASS_NOT_OPEN'] } });
  });

  it('an EDIT while scheduled: the diff, the moved instant, the clash re-checked without the class itself', async () => {
    const v = await live.get(tenantA, H, classId);
    const moved = wallIn(IST, new Date(new Date(v.session.scheduledAt).getTime() + 24 * 60 * 60_000));
    const r = await live.preview(tenantA, H, { ...F({ title: 'Mastitis: spot it early (rescheduled)', date: moved.date, time: moved.time, capacity: '400' }), courseId: undefined, id: classId });
    expect(r.ready).toBe(true);
    expect(r.diff!.map((d) => d.field)).toEqual(['title', 'startsAt', 'capacity']);
    const u: any = await live.update(tenantA, H, key(), classId, F({ title: 'Mastitis: spot it early (rescheduled)', date: moved.date, time: moved.time, capacity: '400' }), null);
    expect(u).toMatchObject({ title: 'Mastitis: spot it early (rescheduled)', capacity: 400 });
    expect(wallIn(IST, new Date(u.scheduledAt))).toEqual(moved);
    // re-editing its own values is not a clash with itself
    expect((await live.preview(tenantA, H, { ...F({ title: 'x', date: moved.date, time: moved.time, capacity: '400' }), id: classId })).refusals).toEqual([]);
    expect((await audits(classId)).filter((x) => x.action === 'education.live.update')).toHaveLength(1);
  });

  it('the database keeps the acts honest: CHECKs on a direct admin UPDATE', async () => {
    await expect(admin.query(`UPDATE live_sessions SET status='ended' WHERE id=$1`, [classId])).rejects.toMatchObject({ code: '23514' });                       // ended needs ended_at
    await expect(admin.query(`UPDATE live_sessions SET attendance_count=5, attendance_recorded_at=now(), attendance_recorded_by=$2 WHERE id=$1`, [classId, host])).rejects.toMatchObject({ code: '23514' });   // not on a scheduled class
    await expect(admin.query(`UPDATE live_sessions SET join_url='http://x.example' WHERE id=$1`, [classId])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE live_sessions SET duration_mins=1000 WHERE id=$1`, [classId])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE live_sessions SET recording_lesson_id=$2 WHERE id=$1`, [classId, randomUUID()])).rejects.toMatchObject({ code: expect.stringMatching(/23514|23503/) });   // no recording → no lesson (and no such lesson)
  });

  it('the reminder cadence: each (class, kind) once, the outbox row with the registered members and the cooperative wall-clock digits, templates that resolve', async () => {
    const f = future(30);   // half an hour ahead: the "day" and the "hour" reminders are both due, the "soon" is not
    const s: any = await live.create(tenantA, H, key(), { courseId, title: 'Reminder test', date: f.date, time: f.time, durationMins: '30', remind: '1' }, null);
    await live.register(tenantA, M1, key(), s.id, null); await live.register(tenantA, M2, key(), s.id, null);
    const quiet: any = await live.create(tenantA, H, key(), { courseId, title: 'No reminders please', date: future(120).date, time: future(120).time, durationMins: '30' }, null);   // remind unchecked; 90 minutes clear of the class above
    const now = new Date();
    const t1 = await live.remindTick(admin, now);
    const mine = (await admin.query(`SELECT kind, recipients FROM live_class_reminders WHERE session_id=$1 ORDER BY kind`, [s.id])).rows;
    expect(mine).toEqual([{ kind: 'day', recipients: 2 }, { kind: 'hour', recipients: 2 }]);
    expect(t1.sent).toBeGreaterThanOrEqual(2);
    expect((await admin.query(`SELECT count(*)::int n FROM live_class_reminders WHERE session_id=$1`, [quiet.id])).rows[0].n).toBe(0);
    const evts = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2 ORDER BY id`, [s.id, LIVE_REMINDER_EVENT])).rows.map((x) => x.payload);
    expect(evts).toHaveLength(2);
    expect(evts[0]).toMatchObject({ v: 1, sessionId: s.id, title: 'Reminder test', time: f.time, day: `${f.date.slice(8, 10)}/${f.date.slice(5, 7)}` });
    expect([...evts[0].recipientUserIds].sort()).toEqual([m1, m2].sort());
    // a second tick sends nothing new for this class
    await live.remindTick(admin, new Date(now.getTime() + 60_000));
    expect((await admin.query(`SELECT count(*)::int n FROM live_class_reminders WHERE session_id=$1`, [s.id])).rows[0].n).toBe(2);
    // the "soon" reminder becomes due inside ten minutes of the start
    await live.remindTick(admin, new Date(new Date(s.scheduledAt).getTime() - 9 * 60_000));
    expect((await admin.query(`SELECT count(*)::int n FROM live_class_reminders WHERE session_id=$1`, [s.id])).rows[0].n).toBe(3);
    expect((await live.get(tenantA, H, s.id)).reminders.map((r) => r.kind)).toEqual(['day', 'hour', 'soon']);
    // the words exist: catalogue row + six templates with a serving version, en/hi/gu × push/inapp
    expect((await admin.query(`SELECT priority, user_can_opt_out FROM notification_events WHERE code='education.live_reminder'`)).rows[0]).toEqual({ priority: 'important', user_can_opt_out: true });
    const tpl = (await admin.query(`SELECT t.channel, t.language_code FROM notification_templates t JOIN notification_template_versions v ON v.id=t.serving_version_id WHERE t.event_code='education.live_reminder' AND v.lifecycle='approved' ORDER BY 1,2`)).rows;
    expect(tpl.map((x) => `${x.channel}/${x.language_code}`)).toEqual(['inapp/en', 'inapp/gu', 'inapp/hi', 'push/en', 'push/gu', 'push/hi']);
    // the grants: kv_app reads the reminders and cannot write them; kv_relay writes them
    const grants = (await admin.query(`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='live_class_reminders' AND grantee IN ('kv_app','kv_relay') ORDER BY 1,2`)).rows;
    expect(grants).toEqual([{ grantee: 'kv_app', privilege_type: 'SELECT' }, { grantee: 'kv_relay', privilege_type: 'INSERT' }, { grantee: 'kv_relay', privilege_type: 'SELECT' }]);
    expect((await admin.query(`SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('live_session_registrations','live_class_reminders')`)).rows.every((r) => r.relforcerowsecurity)).toBe(true);
  });
});
