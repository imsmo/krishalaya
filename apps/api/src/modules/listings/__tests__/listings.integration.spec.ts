// modules/listings/__tests__/listings.integration.spec.ts
// REAL end-to-end proof of the listings vertical slice against a live Postgres.
// It instantiates the CONCRETE infrastructure (PgUnitOfWork + RLS, PgOutboxWriter,
// PgQuotaService, PgIdempotencyService, replica reads) — no mocks — and verifies:
//   1. create() persists the listing AND writes listing.created to the outbox in the SAME tx,
//   2. publish() transitions + writes listing.published,
//   3. the read-model returns the published listing off the replica path,
//   4. idempotency: the same Idempotency-Key returns the same id,
//   5. plan quota is enforced at the data layer (QuotaExceededError),
//   6. ROW-LEVEL SECURITY isolates tenants — tenant B cannot see tenant A's rows.
//
// The schema + base seeds are built ONCE from the REAL db/migrations + db/seeds by
// test/integration-global-setup.js. This spec inserts only its own FK-ordered fixtures
// (tenant → seller user → category → product → plan/subscription) via test/helpers/fixtures.ts.
// Requires DATABASE_URL (kv_app role); DATABASE_ADMIN_URL (superuser) is used for fixtures +
// assertion reads (which bypass RLS); the dedicated RLS test uses kv_app to prove isolation.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makeCategory, makeProduct, makePlan, activateSubscription } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgQuotaService } from '../../../core/quota/quota.service.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';

import { ListingRepository } from '../repositories/listing.repository';
import { PriceHistoryRepository } from '../repositories/price-history.repository';
import { ListingAttributeRepository } from '../repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../repositories/listing-media.repository';
import { ListingSearchReadModel } from '../read-models/listing-search.read-model';
import { ListingService } from '../services/listing.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { QuotaExceededError } from '../../../shared/errors/app-error';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const uuid = () => randomUUID();

const run = APP_URL ? describe : describe.skip;

run('listings slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let svc: ListingService;
  let readModel: ListingSearchReadModel;
  let admin: Pool;          // superuser: fixtures + assertion reads (bypasses RLS)
  let inspect: Pool;        // kv_app: the RLS isolation proof only
  let isSuperuser = false;

  // dto built per-test against REAL product/category fixtures (FKs are enforced now)
  const dto = (ids: { productId: string; categoryId: string }) => ({
    productId: ids.productId, categoryId: ids.categoryId, title: 'Integration Wheat',
    quantityTotal: 100, minOrderQty: 1, unitCode: 'quintal',
    priceMinor: '1440000', currencyCode: 'INR', organicClaim: 'none' as const,
    saleType: 'direct' as const, visibility: 'public' as const, attributes: [], mediaIds: [] as string[],
  });

  /** Provision a fresh (tenant, seller, product, category) bundle with an active subscription. */
  async function provision(planId: string) {
    const tenant = await makeTenant(admin);
    const seller = await makeUser(admin);
    const categoryId = await makeCategory(admin);
    const productId = await makeProduct(admin, { categoryId, tenantId: tenant });
    await activateSubscription(admin, tenant, planId);
    return { tenant, seller, productId, categoryId };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });

    const config = new AppConfig({
      NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'test-secret-test-secret', SHARD_COUNT: '1',
    });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const quota = new PgQuotaService(pools, shards);
    const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    const repo = new ListingRepository(replica as any);
    svc = new ListingService(uow, outbox, quota, idem, cache, metrics, repo,
      new PriceHistoryRepository(replica as any), new ListingAttributeRepository(), new ListingMediaRepository(), new AuditWriter(pools));
    readModel = new ListingSearchReadModel(replica as any, metrics);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('create → persists row + outbox listing.created in one tx; publish → listing.published', async () => {
    const planUnlimited = await makePlan(admin);                 // no plan_limit ⇒ unlimited
    const { tenant, seller, productId, categoryId } = await provision(planUnlimited);

    const { id } = await svc.create(tenant, seller, `idem-${uuid()}`, dto({ productId, categoryId }));
    expect(id).toBeTruthy();

    const row = await admin.query(`SELECT status, tenant_id FROM listings WHERE id=$1`, [id]);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].status).toBe('draft');

    const created = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='listing.created'`, [id]);
    expect(created.rowCount).toBe(1);

    await svc.publish(tenant, { userId: seller, canModerate: false }, id);
    const pub = await admin.query(`SELECT status FROM listings WHERE id=$1`, [id]);
    expect(pub.rows[0].status).toBe('published');
    const published = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='listing.published'`, [id]);
    expect(published.rowCount).toBe(1);

    const page = await readModel.query(tenant, { limit: 20, sort: 'newest' } as any);
    expect(page.items.map((i) => i.id)).toContain(id);
  });

  it('owner view (mine): a seller sees their OWN listings across every status (drafts included), never another seller\'s', async () => {
    const plan = await makePlan(admin);
    const tenant = await makeTenant(admin);
    const categoryId = await makeCategory(admin);
    const productId = await makeProduct(admin, { categoryId, tenantId: tenant });
    await activateSubscription(admin, tenant, plan);
    const sellerA = await makeUser(admin);
    const sellerB = await makeUser(admin);

    const { id: draftA } = await svc.create(tenant, sellerA, `idem-${uuid()}`, dto({ productId, categoryId })); // left in 'draft'
    const { id: listingB } = await svc.create(tenant, sellerB, `idem-${uuid()}`, dto({ productId, categoryId }));
    await svc.publish(tenant, { userId: sellerB, canModerate: false }, listingB);

    // Public search never surfaces seller A's draft; it does surface seller B's published listing.
    const pub = await readModel.query(tenant, { limit: 20, sort: 'newest' } as any);
    expect(pub.items.map((i) => i.id)).not.toContain(draftA);
    expect(pub.items.map((i) => i.id)).toContain(listingB);

    // Owner view for seller A: sees their own draft, never seller B's.
    const mineA = await readModel.query(tenant, { limit: 20, sort: 'newest' } as any, { ownerUserId: sellerA });
    expect(mineA.items.map((i) => i.id)).toContain(draftA);
    expect(mineA.items.map((i) => i.id)).not.toContain(listingB);
  });

  it('is idempotent — same Idempotency-Key returns the same id', async () => {
    const { tenant, seller, productId, categoryId } = await provision(await makePlan(admin));
    const key = `idem-${uuid()}`;
    const a = await svc.create(tenant, seller, key, dto({ productId, categoryId }));
    const b = await svc.create(tenant, seller, key, dto({ productId, categoryId }));
    expect(a.id).toEqual(b.id);
    const cnt = await admin.query(`SELECT count(*)::int n FROM listings WHERE tenant_id=$1`, [tenant]);
    expect(cnt.rows[0].n).toBe(1); // only ONE listing despite two calls
  });

  it('enforces plan quota at the data layer (QuotaExceededError on the 2nd create)', async () => {
    const planQuota1 = await makePlan(admin, { limitCode: 'max_listings_month', limitValue: 1 });
    const { tenant, seller, productId, categoryId } = await provision(planQuota1);
    await svc.create(tenant, seller, `idem-${uuid()}`, dto({ productId, categoryId }));
    await expect(svc.create(tenant, seller, `idem-${uuid()}`, dto({ productId, categoryId })))
      .rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('RLS isolates tenants — tenant B cannot see tenant A rows', async () => {
    const { tenant: tenantA, seller, productId, categoryId } = await provision(await makePlan(admin));
    const tenantB = await makeTenant(admin);
    await svc.create(tenantA, seller, `idem-${uuid()}`, dto({ productId, categoryId }));

    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM listings`);
        await c.query('COMMIT');
        return r.rows[0].n as number;
      } finally { c.release(); }
    };

    if (isSuperuser) {
      // eslint-disable-next-line no-console
      console.warn('[integration] DATABASE_URL is a superuser; skipping strict RLS assertion. Use kv_app.');
      expect(await countAs(tenantA)).toBeGreaterThanOrEqual(1);
      return;
    }
    expect(await countAs(tenantA)).toBeGreaterThanOrEqual(1);
    expect(await countAs(tenantB)).toBe(0); // RLS blocks cross-tenant reads
  });
});
