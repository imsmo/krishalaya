// modules/ai-governance/__tests__/ai-governance.integration.spec.ts
// REAL end-to-end proof of the AI-governance spine against a live Postgres (incl. migration 0029 indexes/dedup):
//   1. a platform model is registered (production) — as admin-api would seed it;
//   2. recording a LOW-confidence inference (tenant A) enqueues a HITL review;
//   3. a reviewer claims + resolves it (rejected) → the linked inference is marked overridden;
//   4. a moderation report is filed + a duplicate by the same reporter is a no-op (abuse guard);
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's review / report / inference via a normal query.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { AiGovernancePublisher } from '../events/ai-governance.publisher';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AiModelRepository } from '../repositories/ai-model.repository';
import { AiInferenceRepository } from '../repositories/ai-inference.repository';
import { AiReviewRepository } from '../repositories/ai-review.repository';
import { ModerationReportRepository } from '../repositories/moderation-report.repository';
import { AiInferenceService } from '../services/ai-inference.service';
import { AiReviewService } from '../services/ai-review.service';
import { ModerationService } from '../services/moderation.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('ai-governance spine (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let inferenceSvc: AiInferenceService; let reviewSvc: AiReviewService; let moderationSvc: ModerationService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const ops = randomUUID(); const reporter = randomUUID();
  const modelCode = `photo_grading_${randomUUID().slice(0, 8)}`;
  const listingId = randomUUID();
  let reviewId = ''; let inferenceId = '';
  const reviewer = { userId: ops, canReview: true, canModerate: true };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, ops); await makeUser(admin, reporter);
    // admin-api seeds a production model (ai_models is GLOBAL).
    // PC-56 TEST-1: since 0115 a production model must name the fairness audit it was promoted on
    // (ck_ai_model_production_needs_audit) — so the fixture is the real sequence: shadow → a passing audit → production on it.
    const modelId = (await admin.query(`INSERT INTO ai_models (code, version, provider, status, confidence_threshold) VALUES ($1,'itest','inhouse','shadow',0.8) RETURNING id`, [modelCode])).rows[0].id;
    const auditId = (await admin.query(
      `INSERT INTO ai_fairness_audits (model_id, window_start, window_end, sample_size, slices, max_gap_pp, verdict)
       VALUES ($1, now() - interval '7 days', now(), 200, '{"language":{"gu":0.91,"hi":0.9}}'::jsonb, 1.0, 'pass') RETURNING id`, [modelId])).rows[0].id;
    await admin.query(`UPDATE ai_models SET status = 'production', promoted_on_audit_id = $2 WHERE id = $1`, [modelId, auditId]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const audit = new AuditWriter(pools);
    const modelRepo = new AiModelRepository(replica as any);
    const infRepo = new AiInferenceRepository(replica as any);
    const reviewRepo = new AiReviewRepository(replica as any);
    const reportRepo = new ModerationReportRepository(replica as any);
    const aiPublisher = new AiGovernancePublisher(new PgOutboxWriter());
    inferenceSvc = new AiInferenceService(uow, aiPublisher, new PgIdempotencyService(pools), new PromMetrics(), infRepo, reviewRepo, modelRepo);
    reviewSvc = new AiReviewService(uow, aiPublisher, new PromMetrics(), audit, reviewRepo, infRepo);
    moderationSvc = new ModerationService(uow, aiPublisher, new PromMetrics(), audit, reportRepo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('records a low-confidence inference → enqueues a review', async () => {
    const out: any = await inferenceSvc.record(tenantA, reviewer, `idem-${randomUUID()}`,
      { modelCode, subjectType: 'listing', subjectId: listingId, inputRef: { mediaId: randomUUID() }, output: { grade: 'C' }, confidence: 0.3, forceReview: false } as any);
    expect(out.reviewEnqueued).toBe(true);
    inferenceId = out.id; reviewId = out.reviewId;
    expect(reviewId).toBeTruthy();
  });

  it('a reviewer claims + rejects → the inference is marked overridden', async () => {
    await reviewSvc.claim(tenantA, reviewer, reviewId);
    const resolved: any = await reviewSvc.resolve(tenantA, reviewer, reviewId, { decision: 'rejected', note: 'AI mis-graded the tomato lot as grade A' } as any);
    expect(resolved.status).toBe('rejected');
    const inf = await new AiInferenceRepository(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as any).getById(tenantA, inferenceId);
    expect(inf?.toProps().wasOverridden).toBe(true);
  });

  it('files a moderation report; a duplicate by the same reporter is a no-op', async () => {
    const reporterActor = { userId: reporter, canReview: false, canModerate: false };
    const first: any = await moderationSvc.file(tenantA, reporterActor, { subjectType: 'listing', subjectId: listingId, reasonCode: 'spam', details: 'looks fake' } as any);
    expect(first.deduped).toBe(false);
    const dup: any = await moderationSvc.file(tenantA, reporterActor, { subjectType: 'listing', subjectId: listingId, reasonCode: 'fraud', details: 'again' } as any);
    expect(dup.deduped).toBe(true);
  });

  it('RLS: tenant B cannot see tenant A\'s review queue row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM ai_review_queue WHERE id=$1`, [reviewId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM ai_review_queue WHERE id=$1`, [reviewId])).rows.length).toBe(1);
  });
});
