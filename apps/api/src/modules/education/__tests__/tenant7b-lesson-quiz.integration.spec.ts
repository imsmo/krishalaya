// modules/education/__tests__/tenant7b-lesson-quiz.integration.spec.ts · PC-56 TENANT-7b · the lesson record against a
// REAL Postgres (the harness builds the database from the real chain, 0001…0171 + seeds), as `kv_app` under RLS.
// What this proves that the unit specs cannot:
//   • the review and the write agree on every fact they read from the database (the media asset in THIS tenant's
//     bucket and its kind, the audio twin among THIS course's lessons and whether it is already paired, the tenant's
//     languages, the lesson as it stands);
//   • the reorder is transactional through UNIQUE(course, module, lesson), renumbers to 1..n, and the same key does
//     not move twice;
//   • `course_lessons` and `course_lesson_subtitles` are under RLS (0171): tenant B reads nothing of A's, and a
//     `tenant_id` a writer gets wrong is overwritten by the trigger with the course's;
//   • W416's six checks that 7a printed `not_measured` are measured here and gate the course's submission.
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
import { LessonService } from '../services/lesson.service';
import { LessonFormRefusedError, LessonNotFoundError } from '../domain/education.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-7b · the lesson & the quiz (integration, real Postgres + RLS + 0171)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let courses: CourseService; let lessons: LessonService; let instructors: InstructorService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const author = randomUUID(); const other = randomUUID(); const desk = randomUUID();
  const A = { userId: author, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const O = { userId: other, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const D = { userId: desk, canAuthor: false, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const B = { userId: randomUUID(), canAuthor: true, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const key = () => `t7b-${randomUUID()}`;
  let courseId = ''; let video = ''; let audio = ''; let foreignVideo = '';
  let audioLesson = ''; let videoLesson = ''; let quizLesson = ''; let pdfLesson = '';
  const audits = async (entityId: string) => (await admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE entity_type='lesson' AND entity_id=$1 ORDER BY id`, [entityId])).rows;
  const media = async (tenant: string, kind: string, mime: string, scan = 'pending') => {
    const id = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1,$2,$3,$4,$5,1,repeat('a',64),$6)`, [id, tenant, kind, `t7b/${id}`, mime, scan]);
    return id;
  };
  const VIDEO = (o: Record<string, string> = {}) => ({ defaultTitle: 'Colostrum & calf feeding', contentKind: 'video', mediaId: video, duration: '6:45', thumbnailAt: '2:31', chapters: '00:00 Why colostrum\n02:14 How much', ...o });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [author, other, desk, B.userId]) await makeUser(admin, u);
    video = await media(tenantA, 'video', 'video/mp4'); audio = await media(tenantA, 'audio', 'audio/mpeg', 'clean'); foreignVideo = await media(tenantB, 'video', 'video/mp4', 'clean');
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any);
    instructors = new InstructorService(uow, metrics, iRepo, audit, idem, cRepo);
    lessons = new LessonService(uow, metrics, audit, idem, cRepo, lRepo, iRepo);
    courses = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo, lessons);
    app = new Pool({ connectionString: APP_URL });
    await instructors.become(tenantA, A, 'Dairy scientist with Anand FPO');
    await instructors.become(tenantA, O, 'Another instructor');
    const c: any = await courses.create(tenantA, A, key(), { defaultTitle: 'Buffalo Dairy Nutrition — season by season', topicCode: 'crop_care', level: 'basic', priceMajor: '', certEnabled: '1' }, null);
    courseId = c.id;
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('the review refuses by name and the write refuses with the same codes, writing nothing: no media, a foreign asset, the wrong kind, a bad clock', async () => {
    expect((await lessons.preview(tenantA, A, courseId, VIDEO({ mediaId: '' }))).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_REQUIRED' }]);
    expect((await lessons.preview(tenantA, A, courseId, VIDEO({ mediaId: foreignVideo }))).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_UNKNOWN' }]);
    expect((await lessons.preview(tenantA, A, courseId, VIDEO({ mediaId: 'not-an-id' }))).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_UNKNOWN' }]);
    expect((await lessons.preview(tenantA, A, courseId, VIDEO({ mediaId: audio }))).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_KIND_MISMATCH' }]);
    expect((await lessons.preview(tenantA, A, courseId, VIDEO({ duration: '6:75', thumbnailAt: '' }))).refusals).toEqual([{ field: 'duration', code: 'DURATION_INVALID' }]);
    await expect(lessons.create(tenantA, A, key(), courseId, VIDEO({ mediaId: foreignVideo }), null)).rejects.toMatchObject({ code: 'LESSON_FORM_REFUSED', details: { refusals: [{ field: 'mediaId', code: 'MEDIA_UNKNOWN' }] } });
    expect((await admin.query(`SELECT count(*)::int n FROM course_lessons WHERE course_id=$1`, [courseId])).rows[0].n).toBe(0);
    // another author sees the course but may not add to it; the desk may
    expect((await lessons.preview(tenantA, O, courseId, VIDEO())).refusals).toEqual([{ field: null, code: 'NOT_OWNER' }]);
    await expect(lessons.create(tenantA, O, key(), courseId, VIDEO(), null)).rejects.toBeInstanceOf(LessonFormRefusedError);
    expect((await lessons.preview(tenantA, D, courseId, VIDEO())).ready).toBe(true);
  });

  it('a ready review is a write: positions are given (1·1, 1·2), the clock is stored as seconds, the audit row is in the transaction, the key replays', async () => {
    const r0 = await lessons.preview(tenantA, A, courseId, { defaultTitle: 'Colostrum & calf feeding (audio-only)', contentKind: 'audio', mediaId: audio, duration: '6:45' });
    expect(r0.ready).toBe(true); expect(r0.fields.find((f) => f.name === 'position')?.stored).toBe('1·1');
    const k = key();
    const a: any = await lessons.create(tenantA, A, k, courseId, { defaultTitle: 'Colostrum & calf feeding (audio-only)', contentKind: 'audio', mediaId: audio, duration: '6:45' }, null);
    audioLesson = a.id;
    expect(a).toMatchObject({ moduleNo: 1, lessonNo: 1, status: 'draft', durationSecs: 405, mediaId: audio });
    expect(((await lessons.create(tenantA, A, k, courseId, { defaultTitle: 'x', contentKind: 'audio', mediaId: audio, duration: '1' }, null)) as any).id).toBe(audioLesson);
    const r1 = await lessons.preview(tenantA, A, courseId, VIDEO({ siblingLessonId: audioLesson }));
    expect(r1.ready).toBe(true); expect(r1.fields.find((f) => f.name === 'position')?.stored).toBe('1·2');
    expect(r1.fields.find((f) => f.name === 'siblingLessonId')?.stored).toBe(`${audioLesson} · Colostrum & calf feeding (audio-only)`);
    expect(r1.fields.find((f) => f.name === 'mediaId')?.stored).toBe(`${video} · video · pending`);
    const v: any = await lessons.create(tenantA, A, key(), courseId, VIDEO({ siblingLessonId: audioLesson }), null);
    videoLesson = v.id;
    expect(v).toMatchObject({ moduleNo: 1, lessonNo: 2, siblingLessonId: audioLesson, thumbnailFrameSecs: 151, durationSecs: 405, chapters: [{ at: 0, title: 'Why colostrum' }, { at: 134, title: 'How much' }] });
    expect((await audits(videoLesson)).map((x) => x.action)).toEqual(['education.lesson.create']);
    // the row carries the course's tenant, written by the trigger
    expect((await admin.query(`SELECT tenant_id FROM course_lessons WHERE id=$1`, [videoLesson])).rows[0].tenant_id).toBe(tenantA);
  });

  it('one audio twin serves one video: a second video naming it is SIBLING_TAKEN in the review, the write, and the index', async () => {
    const r = await lessons.preview(tenantA, A, courseId, VIDEO({ defaultTitle: 'Dry period nutrition', siblingLessonId: audioLesson }));
    expect(r.refusals).toEqual([{ field: 'siblingLessonId', code: 'SIBLING_TAKEN' }]);
    await expect(lessons.create(tenantA, A, key(), courseId, VIDEO({ defaultTitle: 'Dry period nutrition', siblingLessonId: audioLesson }), null)).rejects.toBeInstanceOf(LessonFormRefusedError);
    await expect(admin.query(`INSERT INTO course_lessons (course_id, module_no, lesson_no, default_title, content_kind, sibling_lesson_id) VALUES ($1, 9, 1, 'walk past the door', 'video', $2)`, [courseId, audioLesson])).rejects.toMatchObject({ code: '23505' });
    // the SAME video re-naming its own twin on an edit is fine
    expect((await lessons.preview(tenantA, A, courseId, { ...VIDEO({ siblingLessonId: audioLesson }), lessonId: videoLesson })).ready).toBe(true);
  });

  it('subtitles: a track per tenant language; a language the tenant does not teach in is refused; a DRAFT track is not a reviewed one', async () => {
    expect((await lessons.previewSubtitle(tenantA, A, courseId, videoLesson, { languageCode: 'ta', body: 'x' })).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_UNKNOWN' }]);
    expect((await lessons.previewSubtitle(tenantA, A, courseId, audioLesson, { languageCode: 'gu', body: 'x' })).ready).toBe(true);
    await lessons.saveSubtitle(tenantA, A, key(), courseId, videoLesson, { languageCode: 'gu', body: 'WEBVTT\n\n00:00.000 --> 00:04.000\nનમસ્તે' }, null);
    const rec0 = await lessons.record(tenantA, A, courseId, videoLesson);
    expect(rec0.tracks.map((t) => [t.languageCode, t.status])).toEqual([['gu', 'draft']]);
    expect(rec0.subtitles).toEqual({ gu: 'draft' });
    // reviewed: the diff shows the status change; the row is signed by the reviewer
    const r = await lessons.previewSubtitle(tenantA, A, courseId, videoLesson, { languageCode: 'gu', body: 'WEBVTT\n\n00:00.000 --> 00:04.000\nનમસ્તે', reviewed: '1' });
    expect(r.diff).toEqual([{ field: 'reviewed', before: 'draft', after: 'reviewed' }]);
    for (const lang of ['gu', 'hi', 'en']) {
      await lessons.saveSubtitle(tenantA, A, key(), courseId, videoLesson, { languageCode: lang, body: `WEBVTT\n\n00:00.000 --> 00:04.000\n${lang}`, reviewed: '1' }, null);
      await lessons.saveSubtitle(tenantA, A, key(), courseId, audioLesson, { languageCode: lang, body: `WEBVTT\n\n00:00.000 --> 00:04.000\n${lang}`, reviewed: '1' }, null);
    }
    const row = (await admin.query(`SELECT status, reviewed_by, tenant_id FROM course_lesson_subtitles WHERE lesson_id=$1 AND language_code='gu'`, [videoLesson])).rows[0];
    expect(row).toMatchObject({ status: 'reviewed', reviewed_by: author, tenant_id: tenantA });
    expect((await admin.query(`SELECT count(*)::int n FROM course_lesson_subtitles WHERE lesson_id=$1`, [videoLesson])).rows[0].n).toBe(3);   // upserted, not duplicated
    expect((await audits(videoLesson)).filter((x) => x.action === 'education.lesson.subtitle')).toHaveLength(4);
  });

  it('the quiz: a shell is created through the lesson form; a question is refused until every option teaches something; the threshold is a column', async () => {
    const q: any = await lessons.create(tenantA, A, key(), courseId, { defaultTitle: 'Quick check: nutrients & timing', contentKind: 'quiz' }, null);
    quizLesson = q.id;
    expect(q).toMatchObject({ lessonNo: 3, quiz: null, quizPassingPct: null });
    const FULL = { q: 'How soon after calving should a calf get its first colostrum feed?', opt1: 'Within 1 hour', expl1: 'Correct — the calf\'s gut can only absorb antibodies well in the first hour.', opt2: 'Within 6 hours', expl2: 'Too late — absorption drops fast after the first hour.', opt3: 'Within 24 hours', expl3: 'Much too late — see the lesson\'s first chapter again.', answer: '1', passingPct: '70%' };
    const r0 = await lessons.previewQuestion(tenantA, A, courseId, quizLesson, 1, { ...FULL, expl2: '', passingPct: '' });
    expect(r0.refusals).toEqual([{ field: 'expl2', code: 'EXPLANATION_REQUIRED' }, { field: 'passingPct', code: 'THRESHOLD_REQUIRED' }]);
    await expect(lessons.saveQuestion(tenantA, A, key(), courseId, quizLesson, 1, { ...FULL, expl2: '' }, null)).rejects.toMatchObject({ code: 'LESSON_FORM_REFUSED' });
    expect((await lessons.previewQuestion(tenantA, A, courseId, videoLesson, 1, FULL)).refusals).toEqual([{ field: null, code: 'NOT_A_QUIZ' }]);
    expect((await lessons.previewQuestion(tenantA, A, courseId, quizLesson, 2, FULL)).refusals).toEqual([{ field: null, code: 'QUESTION_NOT_FOUND' }]);
    const saved: any = await lessons.saveQuestion(tenantA, A, key(), courseId, quizLesson, 1, FULL, null);
    expect(saved.quizPassingPct).toBe(70);
    expect(saved.quiz).toEqual({ questions: [{ q: FULL.q, options: ['Within 1 hour', 'Within 6 hours', 'Within 24 hours'], answer: 0, explanations: [FULL.expl1, FULL.expl2, FULL.expl3] }] });
    expect((await admin.query(`SELECT quiz_passing_pct FROM course_lessons WHERE id=$1`, [quizLesson])).rows[0].quiz_passing_pct).toBe(70);
    // the second question appends and may keep the threshold blank; the record counts them
    const two: any = await lessons.saveQuestion(tenantA, A, key(), courseId, quizLesson, 2, { ...FULL, q: 'Which mineral mix?', passingPct: '' }, null);
    expect(two.quiz.questions).toHaveLength(2); expect(two.quizPassingPct).toBe(70);
    const rec = await lessons.record(tenantA, A, courseId, quizLesson);
    expect(rec.quiz).toEqual({ questions: 2, missingExplanations: [] });
    // the CHECK on the column is a wall behind the door
    await expect(admin.query(`UPDATE course_lessons SET quiz_passing_pct=120 WHERE id=$1`, [quizLesson])).rejects.toMatchObject({ code: '23514' });
  });

  it('acts: ready is refused while the scan is pending, allowed once clean; an edit on a ready lesson is refused; reopen; the reason is the audit row', async () => {
    const rec = await lessons.record(tenantA, A, courseId, videoLesson);
    expect(rec.acts.find((a) => a.act === 'ready')).toMatchObject({ allowed: false, refusals: ['MEDIA_NOT_CLEAN'] });
    expect(rec.media).toMatchObject({ kind: 'video', scanStatus: 'pending', mimeType: 'video/mp4' });
    await expect(lessons.act(tenantA, A, key(), courseId, videoLesson, 'ready', 'checked the chapters', null)).rejects.toMatchObject({ code: 'LESSON_ACT_REFUSED', details: { refusals: ['MEDIA_NOT_CLEAN'] } });
    await admin.query(`UPDATE media_assets SET scan_status='clean' WHERE id=$1`, [video]);
    await expect(lessons.act(tenantA, A, key(), courseId, videoLesson, 'ready', 'ok', null)).rejects.toMatchObject({ details: { refusals: ['REASON_REQUIRED'] } });
    const ready: any = await lessons.act(tenantA, A, key(), courseId, videoLesson, 'ready', 'checked the chapters and the tracks', null);
    expect(ready).toMatchObject({ status: 'ready', readyBy: author }); expect(ready.readyAt).toBeTruthy();
    expect((await audits(videoLesson)).slice(-1)[0]).toMatchObject({ action: 'education.lesson.ready', reason: 'checked the chapters and the tracks', old_value: { status: 'draft' }, new_value: { status: 'ready' } });
    expect((await lessons.preview(tenantA, A, courseId, { ...VIDEO({ siblingLessonId: audioLesson }), lessonId: videoLesson })).refusals).toEqual([{ field: null, code: 'LESSON_READY' }]);
    await expect(lessons.update(tenantA, A, key(), courseId, videoLesson, VIDEO({ siblingLessonId: audioLesson }), null)).rejects.toBeInstanceOf(LessonFormRefusedError);
    await expect(lessons.act(tenantA, A, key(), courseId, videoLesson, 'ready', 'twice', null)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
    // 0171's CHECK: a ready status with no instant is refused on a direct admin UPDATE
    await expect(admin.query(`UPDATE course_lessons SET status='ready' WHERE id=$1`, [audioLesson])).rejects.toMatchObject({ code: '23514' });
    const reopened: any = await lessons.act(tenantA, A, key(), courseId, videoLesson, 'reopen', 'fixing the second chapter', null);
    expect(reopened).toMatchObject({ status: 'draft', readyAt: null, readyBy: null });
    const edited: any = await lessons.update(tenantA, A, key(), courseId, videoLesson, VIDEO({ siblingLessonId: audioLesson, chapters: '00:00 Why colostrum\n02:14 How much, how often\n04:50 Common mistakes' }), null);
    expect(edited.chapters).toHaveLength(3); expect(edited.lessonNo).toBe(2);
    await lessons.act(tenantA, A, key(), courseId, videoLesson, 'ready', 'checked again', null);
    // a hollow quiz cannot be ready; the quiz with its questions can
    const hollowQuiz: any = await lessons.create(tenantA, A, key(), courseId, { defaultTitle: 'Empty check', contentKind: 'quiz' }, null);
    await expect(lessons.act(tenantA, A, key(), courseId, hollowQuiz.id, 'ready', 'no questions yet', null)).rejects.toMatchObject({ details: { refusals: ['HOLLOW', 'QUIZ_EXPLANATIONS_MISSING', 'QUIZ_THRESHOLD_MISSING'] } });
    await lessons.act(tenantA, A, key(), courseId, quizLesson, 'ready', 'two questions, all explained', null);
    // another author is 404-shaped; the desk may act
    await expect(lessons.act(tenantA, O, key(), courseId, audioLesson, 'ready', 'not mine to mark', null)).rejects.toBeInstanceOf(LessonNotFoundError);
    expect(((await lessons.act(tenantA, D, key(), courseId, audioLesson, 'ready', 'the desk checked the audio twin', null)) as any).status).toBe('ready');
    pdfLesson = hollowQuiz.id;   // kept for the reorder below (position 4)
  });

  it('reorder: the move is a plan applied through UNIQUE(course, module, lesson); positions stay 1..n; the same key does not move twice; the edges refuse', async () => {
    const before = (await lessons.outline(tenantA, A, courseId)).lessons.map((v) => [v.position, v.lesson.id]);
    expect(before).toEqual([[1, audioLesson], [2, videoLesson], [3, quizLesson], [4, pdfLesson]]);
    const rec = await lessons.record(tenantA, A, courseId, audioLesson);
    expect(rec.acts.find((a) => a.act === 'move_up')).toMatchObject({ allowed: false, refusals: ['AT_TOP'] });
    expect(rec.acts.find((a) => a.act === 'move_down')).toMatchObject({ allowed: true });
    await expect(lessons.act(tenantA, A, key(), courseId, audioLesson, 'move_up', 'already first', null)).rejects.toMatchObject({ details: { refusals: ['AT_TOP'] } });
    const k = key();
    const moved: any = await lessons.act(tenantA, A, k, courseId, quizLesson, 'move_up', 'the quiz follows the video it checks', null);
    expect(moved.lessonNo).toBe(2);
    const again: any = await lessons.act(tenantA, A, k, courseId, quizLesson, 'move_up', 'the quiz follows the video it checks', null);
    expect(again.lessonNo).toBe(2);   // the same key: the same answer, not a second move
    const after = (await lessons.outline(tenantA, A, courseId)).lessons.map((v) => [v.position, v.lesson.lessonNo, v.lesson.id]);
    expect(after).toEqual([[1, 1, audioLesson], [2, 2, quizLesson], [3, 3, videoLesson], [4, 4, pdfLesson]]);
    expect((await audits(quizLesson)).slice(-1)[0]).toMatchObject({ action: 'education.lesson.move_up', old_value: { moduleNo: 1, lessonNo: 3 }, new_value: { moduleNo: 1, lessonNo: 2, order: [audioLesson, quizLesson, videoLesson, pdfLesson] } });
    // a gapped module (a PC-26 row numbered 9) is renumbered contiguous by the next move that touches it
    await admin.query(`UPDATE course_lessons SET lesson_no=9 WHERE id=$1`, [pdfLesson]);
    await lessons.act(tenantA, A, key(), courseId, pdfLesson, 'move_up', 'tidy', null);
    expect((await lessons.outline(tenantA, A, courseId)).lessons.map((v) => v.lesson.lessonNo)).toEqual([1, 2, 3, 4]);
    await lessons.act(tenantA, A, key(), courseId, pdfLesson, 'move_down', 'back to the end', null);
    expect((await lessons.outline(tenantA, A, courseId)).lessons.map((v) => v.lesson.id)).toEqual([audioLesson, quizLesson, videoLesson, pdfLesson]);
  });

  it('W416: the six checks are measured on the record and gate the course; the hollow quiz is named; removed from the way, the course submits', async () => {
    const v0 = await courses.verdicts(tenantA, A, courseId);
    expect(v0.gate.checks.filter((c) => c.state === 'not_measured')).toEqual([]);
    expect(v0.gate.checks.filter((c) => c.code === 'SUBTITLES').map((c) => c.lang)).toEqual(['hi', 'en', 'gu']);   // the platform's active languages: this tenant declared none
    expect(v0.gate.blocking).toEqual(['NO_HOLLOW_LESSON', 'QUIZ_WELL_FORMED', 'LESSONS_READY', 'QUIZ_EXPLANATIONS', 'QUIZ_THRESHOLD']);
    for (const code of v0.gate.blocking) expect(v0.gate.checks.find((c) => c.code === code)?.named).toEqual(['1·4 Empty check']);
    expect(v0.gate.checks.find((c) => c.code === 'AUDIO_SIBLINGS')).toMatchObject({ state: 'pass', measured: { met: 1, of: 1 } });
    expect(v0.gate.checks.find((c) => c.code === 'THUMBNAILS_REAL')).toMatchObject({ state: 'pass', measured: { met: 1, of: 1 } });
    expect(v0.gate.checks.find((c) => c.code === 'SUBTITLES' && c.lang === 'en')).toMatchObject({ state: 'pass', measured: { met: 2, of: 2 } });
    // the outline carries the same gate, and the per-lesson learner reality is nothing for a course nobody opened
    const o = await lessons.outline(tenantA, A, courseId);
    expect(o.gate.blocking).toEqual(v0.gate.blocking); expect(o.canEdit).toBe(true); expect(o.lessons.every((l) => l.stats === null)).toBe(true);
    expect((await lessons.outline(tenantA, O, courseId)).canEdit).toBe(false);   // W411 "Read-only outline"
    // there is no delete act (the canon names none): the empty quiz becomes an article with a body, ready
    await lessons.update(tenantA, A, key(), courseId, pdfLesson, { defaultTitle: 'Season-wise ration planning', contentKind: 'article', body: 'Ration planning by season.' }, null);
    await lessons.act(tenantA, A, key(), courseId, pdfLesson, 'ready', 'written and checked', null);
    const v1 = await courses.verdicts(tenantA, A, courseId);
    expect(v1.gate.blocking).toEqual([]); expect(v1.gate.ready).toBe(true);
    expect(((await courses.act(tenantA, A, key(), courseId, 'submit', 'every lesson is ready', null)) as any).status).toBe('review');
  });

  it('RLS (0171): tenant B reads nothing of A\'s lessons or tracks, and a tenant_id a writer gets wrong is overwritten with the course\'s', async () => {
    await expect(lessons.outline(tenantB, B, courseId)).rejects.toMatchObject({ code: 'COURSE_NOT_FOUND' });
    const c = await app.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantB]);
      expect((await c.query(`SELECT count(*)::int n FROM course_lessons WHERE course_id=$1`, [courseId])).rows[0].n).toBe(0);
      expect((await c.query(`SELECT count(*)::int n FROM course_lesson_subtitles WHERE lesson_id=$1`, [videoLesson])).rows[0].n).toBe(0);
      await c.query('ROLLBACK');
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA]);
      expect((await c.query(`SELECT count(*)::int n FROM course_lessons WHERE course_id=$1`, [courseId])).rows[0].n).toBe(4);
      const wrong = await c.query(`INSERT INTO course_lessons (course_id, module_no, lesson_no, default_title, content_kind, tenant_id) VALUES ($1, 2, 1, 'trigger test', 'article', $2) RETURNING tenant_id`, [courseId, tenantB]);
      expect(wrong.rows[0].tenant_id).toBe(tenantA);
      await c.query('ROLLBACK');
    } finally { c.release(); }
    expect((await admin.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='course_lessons'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await admin.query(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants WHERE table_name='course_lesson_subtitles' AND grantee='kv_app'`)).rows[0].p).toBe('INSERT,SELECT,UPDATE');
    expect((await admin.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_name='course_lesson_subtitles' AND grantee='kv_relay'`)).rows[0].n).toBe(0);
  });
});
