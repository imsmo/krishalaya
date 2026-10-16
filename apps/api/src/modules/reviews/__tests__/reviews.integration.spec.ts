// modules/reviews/__tests__/reviews.integration.spec.ts
// REAL end-to-end proof of the verified-purchase review path against a live Postgres:
//   1. an order completes → the relay delivers orders.order_completed → OrderCompletedHandler records
//      a review_eligibility row (buyer + seller) — idempotent;
//   2. the buyer reviews the SELLER and the seller reviews the BUYER (target resolved server-side from
//      eligibility — the client never supplies target_id); a NON-party cannot review (not eligible);
//      a duplicate review on the same order is rejected;
//   3. the cached summary reflects the published rating; a moderator HIDES a review and the summary drops;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's review.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
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
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { uuidv7 } from '../../../core/database/uuid.util';

import { ReviewRepository } from '../repositories/review.repository';
import { ReviewService } from '../services/review.service';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { NotEligibleToReviewError, DuplicateReviewError } from '../domain/reviews.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('reviews slice (integration, real Postgres + RLS + outbox relay)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let reviews: ReviewService;
  let dispatcher: OutboxDispatcher;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const stranger = randomUUID();
  const orderId = uuidv7();
  let reviewId = '';
  const buyerActor = () => ({ userId: buyer, canModerate: false });
  const sellerActor = () => ({ userId: seller, canModerate: false });
  const moderator = () => ({ userId: randomUUID(), canModerate: true });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller); await makeUser(admin, stranger);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const repo = new ReviewRepository(replica as any);
    reviews = new ReviewService(uow, outbox, idem, cache, metrics, audit, repo);

    const registry = new OutboxHandlerRegistry();
    registry.register(new OrderCompletedHandler(repo));   // orders.order_completed → review_eligibility
    dispatcher = new OutboxDispatcher(admin, registry, metrics);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('order completed → relay records review eligibility (idempotent)', async () => {
    const seed = () => admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,'orders.order_completed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, buyerUserId: buyer, sellerUserId: seller, totalMinor: '100000' })]);
    await seed(); await dispatcher.relayBatch();
    await seed(); await dispatcher.relayBatch();   // re-deliver → still one row
    const e = await admin.query(`SELECT count(*)::int c FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId]);
    expect(e.rows[0].c).toBe(1);
  });

  it('buyer reviews seller; seller reviews buyer (target resolved server-side); non-party blocked; duplicate blocked', async () => {
    const r = await reviews.submit(tenantA, buyer, `idem-${randomUUID()}`, { orderId, stars: 5, body: 'great seller', subRatings: { quality: 5 } } as any);
    reviewId = r.id;
    // PC-56 HOTFIX-7 · B5: the author's own shape carries no target uuid — the target is read from the row
    expect(r.targetType).toBe('seller'); expect(r).not.toHaveProperty('targetId'); expect(r.isVerifiedPurchase).toBe(true);
    expect((await admin.query(`SELECT target_id FROM reviews WHERE id=$1`, [r.id])).rows[0].target_id).toBe(seller);

    const r2 = await reviews.submit(tenantA, seller, `idem-${randomUUID()}`, { orderId, stars: 4 } as any);
    expect(r2.targetType).toBe('buyer'); expect((await admin.query(`SELECT target_id FROM reviews WHERE id=$1`, [r2.id])).rows[0].target_id).toBe(buyer);

    await expect(reviews.submit(tenantA, stranger, `idem-${randomUUID()}`, { orderId, stars: 1 } as any)).rejects.toBeInstanceOf(NotEligibleToReviewError);
    await expect(reviews.submit(tenantA, buyer, `idem-${randomUUID()}`, { orderId, stars: 3 } as any)).rejects.toBeInstanceOf(DuplicateReviewError);
  });

  it('summary reflects published rating; moderation hides a review and the summary drops', async () => {
    // PC-56 HOTFIX-7 · B5: the public aggregate is the ORGANISATION's (published seller-target reviews in the tenant; the buyer-target one is not counted)
    let sum = await reviews.summary(tenantA, 'organisation');
    expect(sum.count).toBe(1); expect(Number(sum.avgStars)).toBe(5);

    await reviews.moderate(tenantA, moderator(), reviewId, { action: 'hide' }, null);
    sum = await reviews.summary(tenantA, 'organisation');   // cache was invalidated on moderate
    expect(sum.count).toBe(0);
    const row = await admin.query(`SELECT status FROM reviews WHERE id=$1`, [reviewId]);
    expect(row.rows[0].status).toBe('hidden');
  });

  it('RLS: tenant B cannot see tenant A\'s review', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM reviews WHERE id=$1`, [reviewId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[reviews] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
