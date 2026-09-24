// modules/education/__tests__/education.integration.spec.ts
// REAL end-to-end proof of the education spine against a live Postgres:
//   1. an instructor profile + a PAID course (₹500, 80% royalty) with 2 lessons, published;
//   2. a learner enrolls → a ZERO-SUM course_purchase splits ₹500 → instructor ₹400 + platform ₹100;
//   3. marking both lessons complete drives progress_pct to 100 + stamps completion;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's enrollment.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';

import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseRepository } from '../repositories/course.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { EnrollmentRepository } from '../repositories/enrollment.repository';
import { InstructorEarningsRepository } from '../repositories/instructor-earnings.repository';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { LessonProgressRepository } from '../repositories/lesson-progress.repository';
import { InstructorService } from '../services/instructor.service';
import { CourseService } from '../services/course.service';
import { LessonService } from '../services/lesson.service';
import { EnrollmentService } from '../services/enrollment.service';
import { LessonProgressService } from '../services/lesson-progress.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('education spine (integration, real Postgres + RLS + royalty split)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let instructors: InstructorService; let courses: CourseService; let lessons: LessonService; let enroll: EnrollmentService; let progress: LessonProgressService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const instr = randomUUID(); const learner = randomUUID(); const desk = randomUUID();
  let courseId = ''; let enrollmentId = ''; const lessonIds: string[] = [];
  // canHost/canModerate were added to EducationActor when live sessions landed (PC-26b); this spec predates them.
  // PC-56 TENANT-7a: the instructor no longer publishes their own course (maker ≠ checker) — a DESK actor does.
  const instrActor = { userId: instr, canAuthor: true, canPublish: false, canHost: true, canModerate: true, isAdmin: false };
  const deskActor = { userId: desk, canAuthor: false, canPublish: true, canHost: false, canModerate: false, isAdmin: true };
  const learnerActor = { userId: learner, canAuthor: false, canPublish: false, canHost: false, canModerate: false, isAdmin: false };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fund = (u: string, amt: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amt }, { account: platform(PlatformAccount.Gateway), amountMinor: -amt }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, instr); await makeUser(admin, learner); await makeUser(admin, desk);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any);
    const eRepo = new EnrollmentRepository(replica as any); const pRepo = new LessonProgressRepository(replica as any);
    instructors = new InstructorService(uow, metrics, iRepo, audit, idem, cRepo);
    const lessonsSvc = new LessonService(uow, metrics, audit, idem, cRepo, lRepo, iRepo);
    lessons = lessonsSvc;
    courses = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo, lessonsSvc);
    // PC-56 TENANT-7d-money: the split's facts (0174) and the flag — OFF here, so this spec still proves the pre-0174 shape
    // (instructor ₹400 to MAIN, platform ₹100, tenant 0) — but in the COURSE's currency and WITH a line recording it.
    // The flag is pinned OFF here (not read from the table: another suite may flip the real flag while this one runs).
    enroll = new EnrollmentService(uow, outbox, idem, metrics, wallet, cRepo, iRepo, eRepo, new InstructorEarningsRepository(replica as any), { isEnabled: async () => false } as unknown as FlagsService);
    progress = new LessonProgressService(uow, outbox, metrics, eRepo, pRepo, lRepo);
    await fund(learner, 1_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('instructor authors + publishes a paid course with 2 lessons', async () => {
    await instructors.become(tenantA, instrActor, 'KVK trainer');
    // A PAID course needs the desk's key (W178: "paid courses need tenant_admin (money)") — so the desk creates it
    // on the instructor's behalf here? No: the desk holds no instructor row. The instructor creates it FREE and the
    // desk PRICES it (a price change is the desk's act), which is the two-key path the canon describes.
    const c: any = await courses.create(tenantA, instrActor, `idem-${randomUUID()}`, { defaultTitle: 'Drip irrigation', topicCode: 'crop_care', level: 'basic', priceMajor: '0', certEnabled: '0' }, null);
    courseId = c.id;
    const priced: any = await courses.update(tenantA, deskActor, `idem-${randomUUID()}`, courseId, { defaultTitle: 'Drip irrigation', topicCode: 'crop_care', level: 'basic', priceMajor: '500.00', certEnabled: '0' }, null);
    expect(priced.priceMinor).toBe('50000');
    // A gate that passes needs lessons that are not hollow and are READY (PC-56 TENANT-7b): two article lessons, marked ready.
    for (const n of [1, 2]) {
      const l: any = await lessons.create(tenantA, instrActor, `idem-${randomUUID()}`, courseId, { defaultTitle: `Lesson ${n}`, contentKind: 'article', body: `Drip lesson ${n}` }, null);
      lessonIds.push(l.id);
      await lessons.act(tenantA, instrActor, `idem-${randomUUID()}`, courseId, l.id, 'ready', 'complete and checked', null);
    }
    await courses.act(tenantA, instrActor, `idem-${randomUUID()}`, courseId, 'submit', 'ready for the desk', null);
    expect((await courses.act(tenantA, deskActor, `idem-${randomUUID()}`, courseId, 'publish', 'checked by the desk', null)).status).toBe('published');
  });

  it('learner enrolls → ZERO-SUM split ₹500 → instructor ₹400 + platform ₹100', async () => {
    const lBefore = await balUser(learner); const iBefore = await balUser(instr);
    const e: any = await enroll.enroll(tenantA, learnerActor, courseId, `idem-${randomUUID()}`);
    enrollmentId = e.id; expect(e.pricePaidMinor).toBe('50000');
    expect(lBefore - (await balUser(learner))).toBe(50000n);   // learner debited ₹500
    expect((await balUser(instr)) - iBefore).toBe(40000n);     // instructor credited 80%
    // 7d-money: the line records exactly what was posted — flag OFF ⇒ the row's royalty, tenant 0, the rest platform, currency INR at scale 2
    expect((await admin.query(`SELECT currency_code, minor_units, gross_minor, instructor_minor, tenant_minor, platform_minor, state, rule_id FROM instructor_royalty_lines WHERE enrollment_id=$1`, [enrollmentId])).rows[0])
      .toEqual({ currency_code: 'INR', minor_units: 2, gross_minor: '50000', instructor_minor: '40000', tenant_minor: '0', platform_minor: '10000', state: 'paid_to_wallet', rule_id: null });
  });

  it('completing both lessons drives progress to 100 + completion', async () => {
    await progress.mark(tenantA, learnerActor, enrollmentId, lessonIds[0], { secondsWatched: 60, completed: true } as any);
    const r: any = await progress.mark(tenantA, learnerActor, enrollmentId, lessonIds[1], { secondsWatched: 60, completed: true } as any);
    expect(Number(r.enrollment.progressPct)).toBe(100); expect(r.enrollment.completedAt).toBeTruthy();
  });

  it('RLS: tenant B cannot see tenant A\'s enrollment', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM enrollments WHERE id=$1`, [enrollmentId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM enrollments WHERE id=$1`, [enrollmentId])).rows.length).toBe(1);
  });
});

// ---- CREATOR CONTENT (channels / resources / live sessions) against real Postgres + RLS ------------------
import { LearningChannelRepository } from '../repositories/learning-channel.repository';
import { LearningResourceRepository } from '../repositories/learning-resource.repository';
import { LearningChannelService } from '../services/learning-channel.service';
import { LearningResourceService } from '../services/learning-resource.service';
import { AuditWriter } from '../../../core/audit/audit.writer';

run('education creator-content (integration, real Postgres + RLS + approval gate)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let channels: LearningChannelService; let resources: LearningResourceService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const hostU = randomUUID(); const modU = randomUUID();
  let channelId = '';
  const hostActor = { userId: hostU, canAuthor: false, canPublish: false, isAdmin: false, canHost: true, canModerate: false };
  const modActor = { userId: modU, canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: true };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, hostU); await makeUser(admin, modU);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const chRepo = new LearningChannelRepository(replica as any); const rRepo = new LearningResourceRepository(replica as any);
    channels = new LearningChannelService(uow, outbox, metrics, audit, chRepo);
    resources = new LearningResourceService(uow, outbox, metrics, audit, rRepo, chRepo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('host registers a channel (pending); a moderator approves it', async () => {
    const c: any = await channels.register(tenantA, hostActor, { provider: 'youtube', title: 'KrishiTV', handle: '@krishi', externalUrl: `https://youtube.com/@krishi-${randomUUID()}` } as any);
    channelId = c.id; expect(c.status).toBe('pending');
    expect((await channels.moderate(tenantA, modActor, channelId, 'approve', null, null)).status).toBe('approved');
  });
  it('a resource under the host\'s own approved channel auto-approves', async () => {
    const r: any = await resources.publish(tenantA, hostActor, { channelId, kind: 'video', title: 'Drip 101', externalUrl: 'https://youtu.be/abc' } as any);
    expect(r.status).toBe('approved');
  });
  // PC-56 TENANT-7c: the live class has its own live suite (tenant7c-live-class.integration.spec.ts); PC-26b's channel-gated schedule/start/end are gone.
  it('RLS: tenant B cannot see tenant A\'s channel or live session', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM learning_channels WHERE id=$1`, [channelId])).rows.length).toBe(0);
        await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM learning_channels WHERE id=$1`, [channelId])).rows.length).toBe(1);
  });
});
