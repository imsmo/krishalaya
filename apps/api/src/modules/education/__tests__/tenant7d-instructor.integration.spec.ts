// modules/education/__tests__/tenant7d-instructor.integration.spec.ts · PC-56 TENANT-7d · the instructor against a REAL
// Postgres (the harness builds the database from the real chain, 0001…0173 + seeds), as `kv_app` under RLS.
// What this proves that the unit specs cannot:
//   • the profile and credential reviews read the facts the writers use (the platform language registry, the media
//     asset in THIS tenant's bucket, the row as it stands) and a refused write writes nothing;
//   • `is_verified` is written only by the desk's act, never by the instructor on themselves — refused by the verdict AND
//     by 0173's trigger on a direct admin UPDATE; a verification needs an accepted credential; its revocation exists;
//   • the credential's review is the desk's act with maker ≠ checker at the wall too, a rejection carries the note the
//     instructor reads, a re-upload returns the row to the queue, the last accepted credential cannot be withdrawn while
//     the instructor is verified;
//   • `instructor_credentials` and `lesson_progress` are under RLS (tenant B reads nothing of A's; a wrong tenant_id on a
//     direct INSERT is overwritten by the trigger; a platform instructor's credential is refused);
//   • W410's facts are integer sums over this instructor's own courses; the template registry is seeded and a course
//     scaffolded from one has its lessons at the positions the review showed; the `instructor` role holds course.author.
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
import { InstructorFormRefusedError, InstructorNotFoundError, StudioFormRefusedError } from '../domain/education.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-7d · the instructor (integration, real Postgres + RLS + 0173)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let instructors: InstructorService; let courses: CourseService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const me = randomUUID(); const other = randomUUID(); const desk = randomUUID(); const member = randomUUID();
  const I = { userId: me, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const O = { userId: other, canAuthor: true, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const D = { userId: desk, canAuthor: false, canPublish: true, isAdmin: true, canHost: false, canModerate: false };
  const M = { userId: member, canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: false };
  const key = () => `t7d-${randomUUID()}`;
  let instructorId = ''; let doc = ''; let docPending = ''; let foreignDoc = ''; let video = ''; let cred1 = ''; let cred2 = '';
  const audits = async (entityId: string) => (await admin.query(`SELECT action, actor_user_id, reason, old_value, new_value FROM audit_log WHERE entity_type='instructor' AND entity_id=$1 ORDER BY id`, [entityId])).rows;
  const media = async (tenant: string, kind: string, mime: string, scan = 'clean') => {
    const id = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1,$2,$3,$4,$5,1,repeat('b',64),$6)`, [id, tenant, kind, `t7d/${id}`, mime, scan]);
    return id;
  };
  const PROFILE = { displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist with Anand FPO. Fifteen years teaching clean milk practice.', languages: 'gu,hi,en', visibility: 'public' };
  const CRED = (o: Record<string, string> = {}) => ({ title: 'BVSc & AH', issuer: 'GAU (Gujarat Agricultural University)', yearAwarded: '2009', documentMediaId: doc, ...o });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [me, other, desk, member]) await makeUser(admin, u);
    doc = await media(tenantA, 'document', 'application/pdf'); docPending = await media(tenantA, 'image', 'image/jpeg', 'pending'); foreignDoc = await media(tenantB, 'document', 'application/pdf'); video = await media(tenantA, 'video', 'video/mp4');
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any);
    instructors = new InstructorService(uow, metrics, iRepo, audit, idem, cRepo);
    const lessons = new LessonService(uow, metrics, audit, idem, cRepo, lRepo, iRepo);
    courses = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo, lessons);
    app = new Pool({ connectionString: APP_URL });
    await instructors.become(tenantA, O, 'Another instructor');
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('the instructor role holds its one verb (0004), and the three template rows are seeded (0018)', async () => {
    expect((await admin.query(`SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code='instructor' AND rp.permission_code='course.author'`)).rows).toHaveLength(1);
    expect((await admin.query(`SELECT code FROM course_templates WHERE tenant_id IS NULL AND is_active ORDER BY sort_order`)).rows.map((r) => r.code)).toEqual(['clean_milk', 'crop_season_plan', 'scheme_walkthrough']);
  });

  it('the profile review refuses by name against the real registry; a ready review CREATES the row (PC-26\'s become, keyed and audited now); the key replays; an edit carries a diff', async () => {
    expect((await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE, languages: 'gu,xx' })).refusals).toEqual([{ field: 'languages', code: 'LANGUAGE_UNKNOWN' }]);
    expect((await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE, languages: 'mr' })).refusals).toEqual([{ field: 'languages', code: 'LANGUAGE_INACTIVE' }]);   // seeded inactive
    expect((await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE, bio: '' })).refusals).toEqual([{ field: 'bio', code: 'BIO_REQUIRED' }]);
    expect((await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE, bio: 'x'.repeat(2001) })).refusals).toEqual([{ field: 'bio', code: 'TOO_LONG' }]);
    await expect(instructors.saveProfile(tenantA, I, key(), { ...PROFILE, languages: 'gu,xx' }, null)).rejects.toBeInstanceOf(InstructorFormRefusedError);
    await expect(instructors.viewMine(tenantA, I)).rejects.toBeInstanceOf(InstructorNotFoundError);
    const r = await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE });
    expect(r.ready).toBe(true); expect(r.diff).toBeNull();
    expect(r.fields.find((f) => f.name === 'languages')!.stored).toBe('gu · ગુજરાતી (Gujarati)\nhi · हिन्दी (Hindi)\nen · English (English)');
    const k = key();
    const saved: any = await instructors.saveProfile(tenantA, I, k, PROFILE, null);
    instructorId = saved.id;
    expect(saved).toMatchObject({ userId: me, displayName: 'Dr. Kalpana Joshi', languages: ['gu', 'hi', 'en'], visibility: 'public', isVerified: false, verifiedAt: null });
    expect(((await instructors.saveProfile(tenantA, I, k, { ...PROFILE, bio: 'replay' }, null)) as any).bio).toBe(PROFILE.bio);
    expect((await audits(instructorId)).map((x) => x.action)).toEqual(['education.instructor.profile']);
    const edit = await instructors.preview(tenantA, I, { form: 'profile', ...PROFILE, visibility: 'private' });
    expect(edit.diff).toEqual([{ field: 'visibility', before: 'public', after: 'private' }]);
    const v = await instructors.viewMine(tenantA, I);
    expect(v).toMatchObject({ name: 'Dr. Kalpana Joshi', isSelf: true, privileged: false, credentials: [], rating: null });
    expect(v.completeness.map((c) => c.done)).toEqual([true, true, false, false, false]);
    expect(v.languages.map((l) => l.code)).toEqual(['hi', 'en', 'gu']);   // the registry's active rows, in its order
    expect(v.acts.map((a) => `${a.act}:${a.allowed}`)).toEqual(['verify:false', 'unverify:false']);
    expect(v.acts[0].refusals).toEqual(['NOT_DESK', 'MAKER_IS_CHECKER', 'NO_ACCEPTED_CREDENTIAL']);
  });

  it('the credential review reads the document in THIS tenant\'s bucket; a foreign or typo\'d id, a video, a missing profile are refused; filing writes the row for the desk', async () => {
    expect((await instructors.preview(tenantA, I, { form: 'credential', ...CRED({ documentMediaId: foreignDoc }) })).refusals).toEqual([{ field: 'documentMediaId', code: 'MEDIA_UNKNOWN' }]);
    expect((await instructors.preview(tenantA, I, { form: 'credential', ...CRED({ documentMediaId: 'not-an-id' }) })).refusals).toEqual([{ field: 'documentMediaId', code: 'MEDIA_UNKNOWN' }]);
    expect((await instructors.preview(tenantA, I, { form: 'credential', ...CRED({ documentMediaId: video }) })).refusals).toEqual([{ field: 'documentMediaId', code: 'MEDIA_KIND_MISMATCH' }]);
    expect((await instructors.preview(tenantA, I, { form: 'credential', ...CRED({ yearAwarded: '2099' }) })).refusals).toEqual([{ field: 'yearAwarded', code: 'YEAR_INVALID' }]);
    await expect(instructors.preview(tenantA, M, { form: 'credential', ...CRED() })).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });   // no education verb at all: the guard, as 7a/7c
    expect((await instructors.preview(tenantA, D, { form: 'credential', ...CRED() })).refusals).toEqual([{ field: null, code: 'NO_AUTHOR' }]);   // the desk has no profile of its own to file on
    await expect(instructors.fileCredential(tenantA, I, key(), CRED({ documentMediaId: foreignDoc }), null)).rejects.toMatchObject({ code: 'INSTRUCTOR_FORM_REFUSED', details: { refusals: [{ field: 'documentMediaId', code: 'MEDIA_UNKNOWN' }] } });
    const k = key();
    const c1: any = await instructors.fileCredential(tenantA, I, k, CRED(), null);
    cred1 = c1.id;
    expect(c1).toMatchObject({ instructorId, status: 'submitted', title: 'BVSc & AH', yearAwarded: 2009, documentMediaId: doc, reviewedBy: null });
    expect(((await instructors.fileCredential(tenantA, I, k, CRED({ title: 'replay' }), null)) as any).id).toBe(cred1);
    const c2: any = await instructors.fileCredential(tenantA, I, key(), CRED({ title: 'PhD Dairy Science', issuer: '', yearAwarded: '', documentMediaId: docPending }), null);
    cred2 = c2.id;
    expect(c2).toMatchObject({ status: 'submitted', issuer: null, yearAwarded: null });
    expect((await admin.query(`SELECT tenant_id FROM instructor_credentials WHERE id=$1`, [cred1])).rows[0].tenant_id).toBe(tenantA);   // the trigger's copy
    const v = await instructors.viewMine(tenantA, I);
    expect(v.credentials.map((c) => `${c.credential.status}:${c.document?.scanStatus}`)).toEqual(['submitted:clean', 'submitted:pending']);
    expect(v.completeness.map((c) => c.done)).toEqual([true, true, true, false, false]);
    // the instructor's own acts on their credentials: withdraw only
    expect(v.acts.filter((a) => a.credentialId === cred1).map((a) => `${a.act}:${a.allowed}:${a.refusals.join('+')}`)).toEqual(['accept:false:NOT_DESK+MAKER_IS_CHECKER', 'reject:false:NOT_DESK+MAKER_IS_CHECKER', 'withdraw:true:']);
  });

  it('verify is refused until a credential is accepted; the desk accepts only a CLEAN document, never their own; the instructor cannot accept their own — the verdict says so and 0173\'s trigger says so', async () => {
    await expect(instructors.act(tenantA, D, key(), instructorId, 'verify', { reason: 'known to the cooperative' }, null)).rejects.toMatchObject({ code: 'INSTRUCTOR_ACT_REFUSED', details: { refusals: ['NO_ACCEPTED_CREDENTIAL'] } });
    await expect(instructors.act(tenantA, I, key(), instructorId, 'accept', { reason: 'my own certificate', credentialId: cred1 }, null)).rejects.toMatchObject({ details: { refusals: ['NOT_DESK', 'MAKER_IS_CHECKER'] } });
    await expect(instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'looks fine', credentialId: cred2 }, null)).rejects.toMatchObject({ details: { refusals: ['DOCUMENT_NOT_CLEAN'] } });
    await expect(instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'looks fine' }, null)).rejects.toMatchObject({ details: { refusals: ['CREDENTIAL_REQUIRED'] } });
    await expect(instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'looks fine', credentialId: randomUUID() }, null)).rejects.toMatchObject({ details: { refusals: ['CREDENTIAL_UNKNOWN'] } });
    await expect(instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'ok', credentialId: cred1 }, null)).rejects.toMatchObject({ details: { refusals: ['REASON_REQUIRED'] } });
    await expect(instructors.act(tenantA, O, key(), instructorId, 'withdraw', { reason: 'not mine to touch', credentialId: cred1 }, null)).rejects.toBeInstanceOf(InstructorNotFoundError);   // 404-shaped for another author
    // the wall behind the door: a direct admin UPDATE naming the instructor as their own reviewer
    await expect(admin.query(`UPDATE instructor_credentials SET status='accepted', reviewed_at=now(), reviewed_by=$2 WHERE id=$1`, [cred1, me])).rejects.toMatchObject({ code: '23514' });
    // a rejection with no note is refused by the CHECK
    await expect(admin.query(`UPDATE instructor_credentials SET status='rejected', reviewed_at=now(), reviewed_by=$2 WHERE id=$1`, [cred1, desk])).rejects.toMatchObject({ code: '23514' });
    const k = key();
    const acc: any = await instructors.act(tenantA, D, k, instructorId, 'accept', { reason: 'certificate checked against the GAU register', credentialId: cred1 }, null);
    expect(acc.credential).toMatchObject({ id: cred1, status: 'accepted', reviewedBy: desk, reviewNote: 'certificate checked against the GAU register' });
    expect(((await instructors.act(tenantA, D, k, instructorId, 'accept', { reason: 'replay', credentialId: cred1 }, null)) as any).credential.status).toBe('accepted');   // the same key never acts twice
    await expect(instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'again', credentialId: cred1 }, null)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
  });

  it('a rejection carries the note the instructor reads; the re-upload form opens without the rejected document; a re-file returns the row to the queue', async () => {
    const rej: any = await instructors.act(tenantA, D, key(), instructorId, 'reject', { reason: 'the certificate photo was too blurred to read the seal', credentialId: cred2 }, null);
    expect(rej.credential).toMatchObject({ status: 'rejected', reviewNote: 'the certificate photo was too blurred to read the seal' });
    const form = await instructors.credentialForm(tenantA, I, cred2);
    expect(form).toEqual({ title: 'PhD Dairy Science', issuer: '', yearAwarded: '', documentMediaId: '', reviewNote: 'the certificate photo was too blurred to read the seal' });
    await expect(instructors.credentialForm(tenantA, O, cred2)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    // only a REJECTED credential re-files; the accepted one is refused by name
    expect((await instructors.preview(tenantA, I, { form: 'credential', credentialId: cred1, ...CRED() })).refusals).toEqual([{ field: null, code: 'CREDENTIAL_NOT_REJECTED' }]);
    expect((await instructors.preview(tenantA, I, { form: 'credential', credentialId: randomUUID(), ...CRED() })).refusals).toEqual([{ field: null, code: 'CREDENTIAL_NOT_FOUND' }]);
    const r = await instructors.preview(tenantA, I, { form: 'credential', credentialId: cred2, ...CRED({ title: 'PhD Dairy Science', documentMediaId: doc }) });
    expect(r.ready).toBe(true);
    expect(r.fields.find((f) => f.name === 'answersNote')!.stored).toBe('the certificate photo was too blurred to read the seal');
    expect(r.diff).toEqual([{ field: 'issuer', before: null, after: 'GAU (Gujarat Agricultural University)' }, { field: 'yearAwarded', before: null, after: '2009' }, { field: 'documentMediaId', before: docPending, after: doc }, { field: 'status', before: 'rejected', after: 'submitted' }]);
    const re: any = await instructors.refileCredential(tenantA, I, key(), cred2, CRED({ title: 'PhD Dairy Science', documentMediaId: doc }), null);
    expect(re).toMatchObject({ id: cred2, status: 'submitted', documentMediaId: doc, reviewedBy: null, reviewNote: null });
    await expect(instructors.refileCredential(tenantA, I, key(), cred2, CRED(), null)).rejects.toMatchObject({ details: { refusals: [{ field: null, code: 'CREDENTIAL_NOT_REJECTED' }] } });
    await expect(instructors.refileCredential(tenantA, O, key(), cred2, CRED(), null)).rejects.toMatchObject({ details: { refusals: [{ field: null, code: 'CREDENTIAL_NOT_FOUND' }] } });
    const acc: any = await instructors.act(tenantA, D, key(), instructorId, 'accept', { reason: 'the new scan is legible', credentialId: cred2 }, null);
    expect(acc.credential.status).toBe('accepted');
  });

  it('the desk verifies (is_verified written by an ACT for the first time since 0012), never themselves; the trigger refuses a self-verification on a direct UPDATE; the last accepted credential cannot go while verified; unverify revokes', async () => {
    await expect(instructors.act(tenantA, I, key(), instructorId, 'verify', { reason: 'I am who I say I am' }, null)).rejects.toMatchObject({ details: { refusals: ['NOT_DESK', 'MAKER_IS_CHECKER'] } });
    // the wall behind the door
    await expect(admin.query(`UPDATE instructors SET is_verified=true, verified_at=now(), verified_by=$2 WHERE id=$1`, [instructorId, me])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE instructors SET is_verified=true WHERE id=$1`, [instructorId])).rejects.toMatchObject({ code: '23514' });   // verified with no checker and no instant
    const k = key();
    const v: any = await instructors.act(tenantA, D, k, instructorId, 'verify', { reason: 'two accepted credentials; known to the cooperative board' }, null);
    expect(v.instructor).toMatchObject({ isVerified: true, verifiedBy: desk, verificationNote: 'two accepted credentials; known to the cooperative board' });
    expect(v.instructor.verifiedAt).not.toBeNull();
    expect(((await instructors.act(tenantA, D, k, instructorId, 'verify', { reason: 'replay' }, null)) as any).instructor.isVerified).toBe(true);
    await expect(instructors.act(tenantA, D, key(), instructorId, 'verify', { reason: 'again' }, null)).rejects.toMatchObject({ details: { refusals: ['ALREADY_VERIFIED'] } });
    // withdraw one accepted credential: allowed (another remains); the last: refused while verified
    const w: any = await instructors.act(tenantA, I, key(), instructorId, 'withdraw', { reason: 'listing the PhD under a different title', credentialId: cred2 }, null);
    expect(w.credential.status).toBe('withdrawn');
    await expect(instructors.act(tenantA, I, key(), instructorId, 'withdraw', { reason: 'and this one', credentialId: cred1 }, null)).rejects.toMatchObject({ details: { refusals: ['LAST_ACCEPTED_CREDENTIAL'] } });
    const view = await instructors.viewById(tenantA, D, instructorId);
    expect(view).toMatchObject({ isSelf: false, privileged: true, instructor: { isVerified: true } });
    expect(view.completeness.map((c) => c.done)).toEqual([true, true, true, true, true]);
    expect(view.acts.filter((a) => a.credentialId === null).map((a) => `${a.act}:${a.allowed}`)).toEqual(['verify:false', 'unverify:true']);
    const u: any = await instructors.act(tenantA, D, key(), instructorId, 'unverify', { reason: 'the board withdrew its endorsement pending an enquiry' }, null);
    expect(u.instructor).toMatchObject({ isVerified: false, verifiedAt: null, verifiedBy: null, verificationNote: null });
    const rows = await audits(instructorId);
    expect(rows.map((x) => x.action)).toEqual(['education.instructor.profile', 'education.instructor.credential.file', 'education.instructor.credential.file', 'education.instructor.accept', 'education.instructor.reject', 'education.instructor.credential.refile', 'education.instructor.accept', 'education.instructor.verify', 'education.instructor.withdraw', 'education.instructor.unverify']);
    expect(rows[7]).toMatchObject({ actor_user_id: desk, reason: 'two accepted credentials; known to the cooperative board', old_value: { isVerified: false }, new_value: { isVerified: true, verifiedBy: desk } });
    expect(rows[9].new_value).toEqual({ isVerified: false });
  });

  it('who reads the profile: a member reads a PUBLIC one; a PRIVATE one is 404-shaped for a member and readable by the desk and the instructor; a member sees no credentials, no acts, no form of another', async () => {
    const pub = await instructors.viewById(tenantA, M, instructorId);
    expect(pub).toMatchObject({ name: 'Dr. Kalpana Joshi', isSelf: false, privileged: false, credentials: [], acts: [], rating: null });
    await instructors.saveProfile(tenantA, I, key(), { ...PROFILE, visibility: 'private' }, null);
    await expect(instructors.viewById(tenantA, M, instructorId)).rejects.toBeInstanceOf(InstructorNotFoundError);
    await expect(instructors.viewById(tenantA, M, 'not-an-id')).rejects.toBeInstanceOf(InstructorNotFoundError);
    expect((await instructors.viewById(tenantA, D, instructorId)).credentials).toHaveLength(2);
    expect((await instructors.viewById(tenantA, I, instructorId)).isSelf).toBe(true);
    await expect(instructors.viewById(tenantB, D, instructorId)).rejects.toBeInstanceOf(InstructorNotFoundError);   // another tenant's row is not visible
    const list = await instructors.listForDesk(tenantA, D, { limit: 50 });
    expect(list.items.map((i) => `${i.instructor.id === instructorId}:${i.pendingCredentials}:${i.acceptedCredentials}`)).toContain('true:0:1');
    expect((await instructors.listForDesk(tenantA, D, { verified: true, limit: 50 })).items.find((i) => i.instructor.id === instructorId)).toBeUndefined();
    await expect(instructors.listForDesk(tenantA, I, { limit: 50 })).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });
  });

  it('RLS: credentials and lesson_progress are walled (tenant B reads 0 of A\'s as kv_app; a wrong tenant_id is overwritten; a platform instructor\'s credential is refused); grants as 0173 states', async () => {
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await app.query(`SELECT 1 FROM instructor_credentials WHERE instructor_id=$1`, [instructorId])).rows).toHaveLength(0);
    expect((await app.query(`SELECT 1 FROM instructors WHERE id=$1`, [instructorId])).rows).toHaveLength(0);
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await app.query(`SELECT 1 FROM instructor_credentials WHERE instructor_id=$1`, [instructorId])).rows).toHaveLength(2);
    // a wrong tenant on a direct INSERT is overwritten with the instructor's
    const stray = randomUUID();
    await admin.query(`INSERT INTO instructor_credentials (id, tenant_id, instructor_id, title, document_media_id) VALUES ($1,$2,$3,'stray',$4)`, [stray, tenantB, instructorId, doc]);
    expect((await admin.query(`SELECT tenant_id FROM instructor_credentials WHERE id=$1`, [stray])).rows[0].tenant_id).toBe(tenantA);
    // a platform instructor (tenant_id NULL) cannot carry a tenant credential (Law 11)
    const platformUser = await makeUser(admin); const platformInstructor = randomUUID();
    await admin.query(`INSERT INTO instructors (id, user_id, tenant_id, bio) VALUES ($1,$2,NULL,'KVK')`, [platformInstructor, platformUser]);
    await expect(admin.query(`INSERT INTO instructor_credentials (id, tenant_id, instructor_id, title, document_media_id) VALUES ($1,$2,$3,'x',$4)`, [randomUUID(), tenantA, platformInstructor, doc])).rejects.toMatchObject({ code: '23514' });
    const rls = (await admin.query(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('instructor_credentials','lesson_progress','course_templates') ORDER BY 1`)).rows;
    expect(rls).toEqual([{ relname: 'course_templates', relrowsecurity: true, relforcerowsecurity: true }, { relname: 'instructor_credentials', relrowsecurity: true, relforcerowsecurity: true }, { relname: 'lesson_progress', relrowsecurity: true, relforcerowsecurity: true }]);
    const grants = (await admin.query(`SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) p FROM information_schema.role_table_grants WHERE table_name IN ('instructor_credentials','course_templates','lesson_progress') AND grantee IN ('kv_app','kv_relay') GROUP BY 1,2 ORDER BY 1,2`)).rows;
    expect(grants).toEqual([
      { table_name: 'course_templates', grantee: 'kv_app', p: 'SELECT' },
      { table_name: 'instructor_credentials', grantee: 'kv_app', p: 'INSERT,SELECT,UPDATE' },
      { table_name: 'lesson_progress', grantee: 'kv_app', p: 'INSERT,SELECT,UPDATE' },
      { table_name: 'lesson_progress', grantee: 'kv_relay', p: 'DELETE,INSERT,SELECT,UPDATE' },
    ]);
  });

  it('the studio form: a template the registry holds scaffolds a DRAFT course with its lessons at the positions the review showed; an unknown template is refused; W410\'s facts sum THIS instructor\'s learners and watch-seconds under RLS', async () => {
    expect((await courses.previewFromTemplate(tenantA, I, { templateCode: 'nope', title: '' })).refusals).toEqual([{ field: 'templateCode', code: 'TEMPLATE_UNKNOWN' }]);
    await expect(courses.previewFromTemplate(tenantA, M, { templateCode: 'clean_milk' })).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });
    expect((await courses.previewFromTemplate(tenantA, D, { templateCode: 'clean_milk' })).refusals).toEqual([{ field: null, code: 'NO_AUTHOR' }]);   // the desk's key is not an author's
    expect((await courses.previewFromTemplate(tenantA, { ...M, canAuthor: true }, { templateCode: 'clean_milk' })).refusals).toEqual([{ field: null, code: 'NO_INSTRUCTOR_PROFILE' }]);
    await expect(courses.createFromTemplate(tenantA, I, key(), { templateCode: 'nope' }, null)).rejects.toBeInstanceOf(StudioFormRefusedError);
    const r = await courses.previewFromTemplate(tenantA, I, { templateCode: 'clean_milk', title: '' });
    expect(r.ready).toBe(true);
    expect(r.fields.find((f) => f.name === 'counts')!.stored).toBe('3 · 7 · 2');
    expect(r.fields.find((f) => f.name === 'topic')!.stored).toBe('safety · Farm safety'); expect(r.fields.find((f) => f.name === 'currency')!.stored).toBe('INR');
    const k = key();
    const made: any = await courses.createFromTemplate(tenantA, I, k, { templateCode: 'clean_milk', title: 'Clean Milk — Anand' }, null);
    expect(made).toMatchObject({ defaultTitle: 'Clean Milk — Anand', status: 'draft', priceMinor: '0', currencyCode: 'INR', lessons: 7, topicCode: 'safety' });
    expect(((await courses.createFromTemplate(tenantA, I, k, { templateCode: 'clean_milk' }, null)) as any).id).toBe(made.id);
    const lessons = (await admin.query(`SELECT module_no, lesson_no, default_title, content_kind, status, media_id, quiz FROM course_lessons WHERE course_id=$1 ORDER BY module_no, lesson_no`, [made.id])).rows;
    expect(lessons.map((l) => `${l.module_no}·${l.lesson_no} ${l.content_kind} ${l.status}`)).toEqual(['1·1 video draft', '1·2 article draft', '2·1 video draft', '2·2 video draft', '2·3 quiz draft', '3·1 audio draft', '3·2 quiz draft']);
    expect(lessons.every((l) => l.media_id === null && l.quiz === null)).toBe(true);
    expect((await admin.query(`SELECT new_value->>'fromTemplate' AS t, new_value->>'lessons' AS n FROM audit_log WHERE entity_type='course' AND entity_id=$1 AND action='education.course.create'`, [made.id])).rows[0]).toMatchObject({ n: '7' });
    // W410's facts: a learner enrols and watches; the tile is the sum, this instructor's courses only
    const learner = await makeUser(admin); const enrollment = randomUUID();
    await admin.query(`INSERT INTO enrollments (id, tenant_id, course_id, learner_user_id, certificate_media_id) VALUES ($1,$2,$3,$4,$5)`, [enrollment, tenantA, made.id, learner, doc]);
    const lessonId = (await admin.query(`SELECT id FROM course_lessons WHERE course_id=$1 AND module_no=1 AND lesson_no=1`, [made.id])).rows[0].id;
    await admin.query(`INSERT INTO lesson_progress (enrollment_id, lesson_id, seconds_watched, tenant_id) VALUES ($1,$2,1800,$3)`, [enrollment, lessonId, tenantB]);   // a wrong tenant, overwritten
    expect((await admin.query(`SELECT tenant_id FROM lesson_progress WHERE enrollment_id=$1`, [enrollment])).rows[0].tenant_id).toBe(tenantA);
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await app.query(`SELECT 1 FROM lesson_progress WHERE enrollment_id=$1`, [enrollment])).rows).toHaveLength(0);
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await app.query(`SELECT 1 FROM lesson_progress WHERE enrollment_id=$1`, [enrollment])).rows).toHaveLength(1);
    const studio = await instructors.studio(tenantA, I);
    expect(studio.instructor?.instructor.id).toBe(instructorId);
    expect(studio.facts).toMatchObject({ learnersWindow: 1, learnersLifetime: 1, watchSecondsLifetime: '1800', certificatesLifetime: 1, upcomingClasses: 0, nextClass: null });
    expect(studio.byStatus).toEqual({ draft: 1 }); expect(studio.courses.map((c) => c.stats?.learners)).toEqual([1]);
    expect(studio.templates.map((t) => t.code)).toEqual(['clean_milk', 'crop_season_plan', 'scheme_walkthrough']);
    // another instructor's studio: none of these numbers
    const o = await instructors.studio(tenantA, O);
    expect(o.facts).toMatchObject({ learnersWindow: 0, learnersLifetime: 0, watchSecondsLifetime: '0', certificatesLifetime: 0 });
    // a member with no profile: the studio says so, and lists the templates they could start from once they have one
    expect(await instructors.studio(tenantA, { ...M, canAuthor: true })).toMatchObject({ instructor: null, facts: null, courses: [] });
    await expect(instructors.studio(tenantA, M)).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });
  });
});
