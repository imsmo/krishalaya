// modules/requirements/__tests__/requirements.integration.spec.ts
// REAL end-to-end proof of the reverse-marketplace path against a live Postgres:
//   1. a buyer posts a requirement (open); two sellers quote (each with their own published listing);
//   2. the buyer shortlists one quote → requirement partially_matched; then accepts it → the quote is
//      'accepted', the requirement 'fulfilled', and requirements.quote_accepted is in the same-tx outbox;
//   3. the buyer CANNOT quote on their own requirement (self-deal); a seller sees ONLY their own quote
//      (no peeking at competitors); duplicate quote by the same seller is rejected;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's requirement.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makePublishedListing } from '../../../../test/helpers/fixtures';

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
import { AuditWriter } from '../../../core/audit/audit.writer';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';

import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { RequirementService } from '../services/requirement.service';
import { RequirementResponseService } from '../services/requirement-response.service';
import { SellerIsBuyerError, DuplicateResponseError } from '../domain/requirements.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('requirements slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let requirements: RequirementService;
  let responses: RequirementResponseService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const buyer = randomUUID();
  const seller1 = randomUUID();
  const seller2 = randomUUID();
  let listing1 = ''; let listing2 = '';
  let requirementId = ''; let quote1 = '';

  const buyerActor = () => ({ userId: buyer, canModerate: false });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller1); await makeUser(admin, seller2);
    listing1 = (await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller1, priceMinor: 100000n, qty: 100, title: 'S1 Wheat' })).id;
    listing2 = (await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller2, priceMinor: 110000n, qty: 100, title: 'S2 Wheat' })).id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const quota = new PgQuotaService(pools, shards);
    const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(replica as any), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const reqRepo = new RequirementRepository(replica as any);
    const respRepo = new RequirementResponseRepository(replica as any);
    requirements = new RequirementService(uow, outbox, idem, metrics, audit, reqRepo);
    responses = new RequirementResponseService(uow, outbox, idem, metrics, audit, listings, reqRepo, respRepo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('buyer posts a requirement; two sellers quote; the buyer cannot self-quote', async () => {
    const r = await requirements.create(tenantA, buyer, `idem-${randomUUID()}`, { title: 'Need 50q wheat', quantity: '50', unitCode: 'quintal' } as any);
    requirementId = r.id; expect(r.status).toBe('open');

    const q1 = await responses.submit(tenantA, seller1, requirementId, `idem-${randomUUID()}`, { quotedPriceMinor: '90000', quantity: '50', listingId: listing1 } as any);
    quote1 = q1.id; expect(q1.status).toBe('submitted');
    await responses.submit(tenantA, seller2, requirementId, `idem-${randomUUID()}`, { quotedPriceMinor: '95000', quantity: '50', listingId: listing2 } as any);

    await expect(responses.submit(tenantA, buyer, requirementId, `idem-${randomUUID()}`, { quotedPriceMinor: '80000', quantity: '50' } as any)).rejects.toBeInstanceOf(SellerIsBuyerError);
    await expect(responses.submit(tenantA, seller1, requirementId, `idem-${randomUUID()}`, { quotedPriceMinor: '88000', quantity: '50', listingId: listing1 } as any)).rejects.toBeInstanceOf(DuplicateResponseError);
  });

  it('a seller sees only their own quote; the buyer sees all', async () => {
    const asSeller1 = await responses.listForRequirement(tenantA, { userId: seller1, canModerate: false }, requirementId, { limit: 50 });
    expect(asSeller1.items.length).toBe(1);
    expect(asSeller1.items[0].sellerUserId).toBe(seller1);
    const asBuyer = await responses.listForRequirement(tenantA, buyerActor(), requirementId, { limit: 50 });
    expect(asBuyer.items.length).toBe(2);
  });

  it('buyer shortlists then accepts a quote → fulfilled + quote_accepted in the outbox', async () => {
    const sl = await responses.shortlist(tenantA, buyerActor(), quote1);
    expect(sl.status).toBe('shortlisted');
    const reqMid = await admin.query(`SELECT status FROM requirements WHERE id=$1`, [requirementId]);
    expect(reqMid.rows[0].status).toBe('partially_matched');

    const acc = await responses.accept(tenantA, buyerActor(), quote1, null);
    expect(acc.status).toBe('accepted');
    const req = await admin.query(`SELECT status FROM requirements WHERE id=$1`, [requirementId]);
    expect(req.rows[0].status).toBe('fulfilled');
    const ob = await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='requirements.quote_accepted'`, [quote1]);
    expect(ob.rowCount).toBe(1);
    expect(ob.rows[0].payload).toMatchObject({ buyerUserId: buyer, sellerUserId: seller1, listingId: listing1, quotedPriceMinor: '90000', quantity: '50' });
  });

  it('RLS: tenant B cannot see tenant A\'s requirement', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM requirements WHERE id=$1`, [requirementId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[requirements] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
