// modules/education/__tests__/tenant7a-course-desk.integration.spec.ts · PC-56 TENANT-7a · the course record and the
// desk against a REAL Postgres (the harness builds the database from the real chain, 0001…0170 + seeds), as `kv_app`
// under RLS. What this proves that the unit specs cannot:
//   • the review and the write agree on every fact they read from the database (topic registry, media asset, the
//     tenant's currency, the row as it stands);
//   • an act's audit row, its reason and its before/after exist in the same transaction as the status change;
//   • 0170's trigger refuses a maker publishing their own course even when the service is bypassed;
//   • the platform library's DRAFT rows are invisible to a tenant, its PUBLISHED rows visible;
//   • a tenant whose currency this platform holds no scale for cannot price a course.
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
import { InstructorService } from '../services/instructor.service';
import { CourseService } from '../services/course.service';
import { CourseActRefusedError, CourseFormRefusedError, CourseNotFoundError } from '../domain/education.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-7a · the course record & the desk (integration, real Postgres + RLS + 0170)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let courses: CourseService; let instructors: InstructorService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const author = randomUUID(); const other = randomUUID(); const desk = randomUUID(); const desk2 = randomUUID();
  const A = { userId: author, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const O = { userId: other, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const D = { userId: desk, canAuthor: false, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const D2 = { userId: desk2, canAuthor: false, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const key = () => `t7a-${randomUUID()}`;
  const form = (o: Record<string, string> = {}) => ({ defaultTitle: 'Groundnut: sowing to storage', topicCode: 'crop_care', level: 'basic', priceMajor: '', certEnabled: '1', ...o });
  let courseId = ''; let media = '';
  const audits = async (entityId: string) => (await admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE entity_type='course' AND entity_id=$1 ORDER BY id`, [entityId])).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [author, other, desk, desk2]) await makeUser(admin, u);
    media = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256) VALUES ($1,$2,'video',$3,'video/mp4',1,repeat('a',64))`, [media, tenantA, `t7a/${media}`]);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any);
    instructors = new InstructorService(uow, metrics, iRepo);
    courses = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo);
    app = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('the review refuses by name: no instructor profile, a topic not in the registry, a paid course without the desk key', async () => {
    const r0 = await courses.preview(tenantA, A, form());
    expect(r0.ready).toBe(false);
    expect(r0.refusals).toEqual([{ field: null, code: 'NO_INSTRUCTOR_PROFILE' }]);
    await instructors.become(tenantA, A, 'Dairy scientist with Anand FPO');
    const r1 = await courses.preview(tenantA, A, form({ topicCode: 'dairy', priceMajor: '149' }));
    expect(r1.refusals).toEqual([{ field: 'topicCode', code: 'TOPIC_UNKNOWN' }, { field: 'priceMajor', code: 'PAID_NEEDS_DESK' }]);
    // and the write is refused with the SAME codes — the rule lives in the act, not only in the review
    await expect(courses.create(tenantA, A, key(), form({ topicCode: 'dairy', priceMajor: '149' }), null)).rejects.toBeInstanceOf(CourseFormRefusedError);
    expect((await admin.query(`SELECT count(*)::int n FROM courses WHERE tenant_id=$1`, [tenantA])).rows[0].n).toBe(0);
  });

  it('a ready review is a write that succeeds; the currency is the TENANT\'s, the topic is resolved, the audit row is in the transaction; the key replays', async () => {
    const r = await courses.preview(tenantA, A, form({ coverMediaId: media }));
    expect(r.ready).toBe(true);
    expect(r.fields.find((f) => f.name === 'currencyCode')).toEqual({ name: 'currencyCode', entered: null, stored: 'INR', normalised: true });
    expect(r.fields.find((f) => f.name === 'topicCode')?.stored).toBe('crop_care · Crop care');
    const k = key();
    const c: any = await courses.create(tenantA, A, k, form({ coverMediaId: media }), null);
    courseId = c.id;
    expect(c.status).toBe('draft'); expect(c.currencyCode).toBe('INR'); expect(c.priceMinor).toBe('0'); expect(c.topicCode).toBe('crop_care'); expect(c.coverMediaId).toBe(media);
    const again: any = await courses.create(tenantA, A, k, form({ coverMediaId: media }), null);
    expect(again.id).toBe(courseId);
    expect((await admin.query(`SELECT count(*)::int n FROM courses WHERE tenant_id=$1`, [tenantA])).rows[0].n).toBe(1);
    const a = await audits(courseId);
    expect(a.map((x) => x.action)).toEqual(['education.course.create']); expect(a[0].actor_user_id).toBe(author);
  });

  it('a cover from another tenant\'s bucket is not a cover; a typo\'d id is a refusal, not a 22P02', async () => {
    const foreign = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256) VALUES ($1,$2,'image',$3,'image/jpeg',1,repeat('b',64))`, [foreign, tenantB, `t7a/${foreign}`]);
    expect((await courses.preview(tenantA, A, form({ coverMediaId: foreign }))).refusals).toEqual([{ field: 'coverMediaId', code: 'COVER_UNKNOWN' }]);
    expect((await courses.preview(tenantA, A, form({ coverMediaId: 'not-an-id' }))).refusals).toEqual([{ field: 'coverMediaId', code: 'COVER_UNKNOWN' }]);
  });

  it('edit: the author changes the title; only the desk may change the price; the audit row carries before/after', async () => {
    const r = await courses.preview(tenantA, A, { id: courseId, ...form({ defaultTitle: 'Groundnut: seed to sale', coverMediaId: media }) });
    expect(r.ready).toBe(true);
    expect(r.diff).toEqual([{ field: 'defaultTitle', before: 'Groundnut: sowing to storage', after: 'Groundnut: seed to sale' }]);
    await courses.update(tenantA, A, key(), courseId, form({ defaultTitle: 'Groundnut: seed to sale', coverMediaId: media }), null);
    await expect(courses.update(tenantA, A, key(), courseId, form({ defaultTitle: 'Groundnut: seed to sale', priceMajor: '149', coverMediaId: media }), null)).rejects.toMatchObject({ code: 'COURSE_FORM_REFUSED' });
    const priced: any = await courses.update(tenantA, D, key(), courseId, form({ defaultTitle: 'Groundnut: seed to sale', priceMajor: '149.00', coverMediaId: media }), null);
    expect(priced.priceMinor).toBe('14900');
    const a = await audits(courseId);
    expect(a.map((x) => x.action)).toEqual(['education.course.create', 'education.course.update', 'education.course.update']);
    expect(a[2].old_value.priceMinor).toBe('0'); expect(a[2].new_value.priceMinor).toBe('14900'); expect(a[2].actor_user_id).toBe(desk);
    // another author cannot even see it to edit it (404-shaped), and the review names why
    await expect(courses.update(tenantA, O, key(), courseId, form(), null)).rejects.toBeInstanceOf(CourseFormRefusedError);
    expect((await courses.preview(tenantA, O, { id: courseId, ...form({ defaultTitle: 'Groundnut: seed to sale', priceMajor: '149', coverMediaId: media }) })).refusals).toEqual([{ field: null, code: 'NOT_OWNER' }]);
  });

  it('the gate blocks submit and names the hollow lesson; a fixed lesson passes; submit records the maker', async () => {
    await courses.upsertLesson(tenantA, A, courseId, { moduleNo: 1, lessonNo: 1, defaultTitle: 'Seed selection', contentKind: 'video' } as any);
    const v0 = await courses.verdicts(tenantA, A, courseId);
    expect(v0.gate.ready).toBe(false); expect(v0.gate.blocking).toEqual(['NO_HOLLOW_LESSON']);
    expect(v0.gate.checks.find((c) => c.code === 'NO_HOLLOW_LESSON')?.named).toEqual(['1·1 Seed selection']);
    expect(v0.acts.find((a) => a.act === 'submit')).toMatchObject({ allowed: false, refusals: ['GATE_NOT_PASSED'] });
    await expect(courses.act(tenantA, A, key(), courseId, 'submit', 'ready for the desk', null)).rejects.toMatchObject({ code: 'COURSE_ACT_REFUSED', details: { refusals: ['GATE_NOT_PASSED'] } });
    await courses.upsertLesson(tenantA, A, courseId, { moduleNo: 1, lessonNo: 1, defaultTitle: 'Seed selection', contentKind: 'video', mediaId: media } as any);
    const v1 = await courses.verdicts(tenantA, A, courseId);
    expect(v1.gate.ready).toBe(true);
    expect(v1.gate.checks.filter((c) => c.state === 'not_measured').map((c) => c.code)).toEqual(['AUDIO_SIBLINGS', 'SUBTITLES_GU', 'SUBTITLES_HI', 'SUBTITLES_EN', 'QUIZ_EXPLANATIONS', 'THUMBNAILS_REAL']);
    // a reason too short is refused BEFORE anything is written
    await expect(courses.act(tenantA, A, key(), courseId, 'submit', 'ok', null)).rejects.toMatchObject({ details: { refusals: ['REASON_REQUIRED'] } });
    const s: any = await courses.act(tenantA, A, key(), courseId, 'submit', 'ready for the desk', null);
    expect(s.status).toBe('review'); expect(s.submittedBy).toBe(author); expect(s.submittedAt).toBeTruthy();
    const a = await audits(courseId);
    expect(a[a.length - 1]).toMatchObject({ action: 'education.course.submit', reason: 'ready for the desk', old_value: { status: 'draft' }, new_value: { status: 'review' } });
  });

  it('publish is the desk\'s act: the author is MAKER_IS_CHECKER; the desk publishes; the outbox holds the event', async () => {
    const vA = await courses.verdicts(tenantA, A, courseId);
    expect(vA.acts.find((a) => a.act === 'publish')?.refusals).toEqual(['NO_PERMISSION', 'MAKER_IS_CHECKER']);
    await expect(courses.act(tenantA, A, key(), courseId, 'publish', 'publishing my own', null)).rejects.toBeInstanceOf(CourseActRefusedError);
    // the desk RETURNS it first, with a note the instructor reads on W416
    const back: any = await courses.act(tenantA, D, key(), courseId, 'return', 'Lesson 1 needs a source citation — otherwise ready.', null);
    expect(back.status).toBe('draft'); expect(back.reviewNote).toBe('Lesson 1 needs a source citation — otherwise ready.'); expect(back.reviewedBy).toBe(desk);
    // the instructor resubmits; the note is cleared because this is a new submission
    const re: any = await courses.act(tenantA, A, key(), courseId, 'submit', 'citation added to lesson 1', null);
    expect(re.reviewNote).toBeNull(); expect(re.status).toBe('review');
    const pub: any = await courses.act(tenantA, D, key(), courseId, 'publish', 'checked by the content desk', null);
    expect(pub.status).toBe('published'); expect(pub.publishedAt).toBeTruthy(); expect(pub.reviewedBy).toBe(desk);
    const ob = await admin.query(`SELECT event_type FROM outbox_events WHERE aggregate_type='course' AND aggregate_id=$1 ORDER BY id`, [courseId]);
    expect(ob.rows.map((r) => r.event_type)).toEqual(['education.course_published']);
    // pause / resume keep published_at
    const paused: any = await courses.act(tenantA, D2, key(), courseId, 'pause', 'season over — hide until kharif', null);
    expect(paused.status).toBe('paused'); expect(new Date(paused.publishedAt).getTime()).toBe(new Date(pub.publishedAt).getTime());
    expect((await courses.act(tenantA, D2, key(), courseId, 'resume', 'kharif begins', null)).status).toBe('published');
  });

  it('0170\'s trigger is the wall behind the door: a direct UPDATE that lets the maker publish is refused', async () => {
    const id = randomUUID();
    await admin.query(`INSERT INTO courses (id, tenant_id, instructor_id, default_title, status, submitted_at, submitted_by) SELECT $1, $2, i.id, 'Trigger proof', 'review', now(), $3 FROM instructors i WHERE i.user_id=$3 AND i.tenant_id=$2`, [id, tenantA, author]);
    // the author's own instructor row as checker
    await expect(admin.query(`UPDATE courses SET status='published', published_at=now(), reviewed_at=now(), reviewed_by=$2 WHERE id=$1`, [id, author])).rejects.toMatchObject({ code: '23514' });
    // no checker at all
    await expect(admin.query(`UPDATE courses SET status='published', published_at=now() WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
    // a status with no instant behind it
    await expect(admin.query(`UPDATE courses SET status='archived' WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23514' });
    // the desk, properly
    await admin.query(`UPDATE courses SET status='published', published_at=now(), reviewed_at=now(), reviewed_by=$2 WHERE id=$1`, [id, desk]);
  });

  it('the platform library is its PUBLISHED rows: a KVK draft is invisible to the tenant, a published one is not; the desk summary counts both', async () => {
    const kvk = randomUUID(); const draftId = randomUUID(); const pubId = randomUUID();
    await makeUser(admin, kvk);
    await admin.query(`INSERT INTO instructors (id, user_id, tenant_id, bio) VALUES ($1, $2, NULL, 'KVK')`, [randomUUID(), kvk]);
    await admin.query(`INSERT INTO courses (id, tenant_id, instructor_id, default_title, status) SELECT $1, NULL, i.id, 'KVK draft', 'draft' FROM instructors i WHERE i.user_id=$2 AND i.tenant_id IS NULL`, [draftId, kvk]);
    await admin.query(`INSERT INTO courses (id, tenant_id, instructor_id, default_title, status, published_at) SELECT $1, NULL, i.id, 'Organic certification, step by step', 'published', now() FROM instructors i WHERE i.user_id=$2 AND i.tenant_id IS NULL`, [pubId, kvk]);
    await expect(courses.getById(tenantA, draftId)).rejects.toBeInstanceOf(CourseNotFoundError);
    expect((await courses.getById(tenantA, pubId)).isPlatformLibrary).toBe(true);
    const all = await courses.list(tenantA, D, { box: 'all', limit: 100, withStats: true });
    const ids = all.items.map((i) => i.id);
    expect(ids).toContain(pubId); expect(ids).not.toContain(draftId); expect(ids).toContain(courseId);
    expect(all.stats[courseId]).toBeUndefined();   // no enrolments yet → no row, not a zero this platform invented
    const summary = await courses.desk(tenantA, D);
    expect(summary.byStatus).toMatchObject({ published: 2, draft: 0, review: 0, paused: 0, archived: 0 }); expect(summary.libraryPublished).toBeGreaterThanOrEqual(1); expect(summary.windowDays).toBe(30);
    expect(summary.topics.map((t) => t.code)).toContain('crop_care');
    // an author without the desk key cannot read the desk
    await expect(courses.desk(tenantA, A)).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });
  });

  it('RLS + ownership: tenant B sees nothing of A\'s course; A\'s other author sees another author\'s draft as 404', async () => {
    await expect(courses.getById(tenantB, courseId)).rejects.toBeInstanceOf(CourseNotFoundError);
    const draft: any = await courses.create(tenantA, A, key(), form({ defaultTitle: 'Private draft' }), null);
    await expect(courses.verdicts(tenantA, O, draft.id)).rejects.toBeInstanceOf(CourseNotFoundError);
    expect((await courses.verdicts(tenantA, D, draft.id)).acts.find((a) => a.act === 'archive')?.allowed).toBe(true);
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await app.query(`SELECT id FROM courses WHERE id=$1`, [courseId])).rows.length).toBe(0);
  });

  it('archive carries its reason and its instant; an archived course refuses every act and every edit', async () => {
    const arch: any = await courses.act(tenantA, A, key(), courseId, 'archive', 'superseded by the 2027 edition', null);
    expect(arch.status).toBe('archived'); expect(arch.archivedAt).toBeTruthy();
    const a = await audits(courseId);
    expect(a[a.length - 1]).toMatchObject({ action: 'education.course.archive', reason: 'superseded by the 2027 edition' });
    const v = await courses.verdicts(tenantA, D, courseId);
    expect(v.acts.every((x) => !x.allowed && x.refusals.includes('ILLEGAL_FROM_STATUS'))).toBe(true);
    expect((await courses.preview(tenantA, D, { id: courseId, ...form() })).refusals).toEqual([{ field: null, code: 'COURSE_ARCHIVED' }]);
  });

  it('a tenant whose currency this platform holds no scale for cannot price a course — refused, not guessed', async () => {
    const tZ = randomUUID(); const uZ = randomUUID();
    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active) VALUES ('ZZ','Nowhere','ZZZ','+999','UTC',true) ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status) SELECT $1, $2, 'Z', 'Z', lv.id, 'ZZ', 'active' FROM lookup_values lv WHERE lv.type_code='tenant_type' AND lv.code='fpo' AND lv.tenant_id IS NULL LIMIT 1`, [tZ, 't' + tZ.replace(/-/g, '').slice(0, 20)]);
    await makeUser(admin, uZ);
    const Z = { userId: uZ, canAuthor: true, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
    await instructors.become(tZ, Z, null);
    const r = await courses.preview(tZ, Z, form({ priceMajor: '10' }));
    expect(r.ready).toBe(false);
    expect(r.refusals).toEqual([{ field: null, code: 'CURRENCY_UNKNOWN' }]);
    expect(r.fields.find((f) => f.name === 'currencyCode')?.stored).toBeNull();
    await expect(courses.create(tZ, Z, key(), form({ priceMajor: '10' }), null)).rejects.toBeInstanceOf(CourseFormRefusedError);
  });
});
