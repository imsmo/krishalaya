// modules/requirements/__tests__/quote-to-order.integration.spec.ts
// REAL end-to-end proof that an ACCEPTED quote becomes an order purely through the OUTBOX RELAY
// (Law 4 — no synchronous cross-module calls), against a live Postgres:
//   1. a buyer posts a requirement; a seller quotes (their own listing); the buyer accepts;
//   2. the dispatcher relays requirements.quote_accepted → QuoteAcceptedHandler (orders) creates the
//      order (source='requirement', requirement_id set, quoted price × qty);
//   3. re-relaying is a no-op — exactly ONE order exists for the requirement (idempotent).
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { QuoteAcceptedHandler } from '../../orders/events/handlers/quote-accepted.handler';

import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { RequirementService } from '../services/requirement.service';
import { RequirementResponseService } from '../services/requirement-response.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('order-from-accepted-quote via outbox relay (integration, real Postgres)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let requirements: RequirementService;
  let responses: RequirementResponseService;
  let dispatcher: OutboxDispatcher;

  const tenantA = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  let listingId = ''; let requirementId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, buyer); await makeUser(admin, seller);
    listingId = (await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: 100000n, qty: 100, title: 'Wheat' })).id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const quota = new PgQuotaService(pools, shards);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const cache = new InMemoryCacheService();
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(replica as any), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const reqRepo = new RequirementRepository(replica as any);
    const respRepo = new RequirementResponseRepository(replica as any);
    requirements = new RequirementService(uow, outbox, idem, metrics, audit, reqRepo);
    responses = new RequirementResponseService(uow, outbox, idem, metrics, audit, listings, reqRepo, respRepo);

    const flags = new FlagsService(pools, cache);
    const orderRepo = new OrderRepository(replica as any);
    const registry = new OutboxHandlerRegistry();
    registry.register(new QuoteAcceptedHandler(orderRepo, listings, flags, outbox, metrics));   // orders consumes requirements.quote_accepted
    dispatcher = new OutboxDispatcher(admin, registry, metrics);
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('accepted quote → relay → order created (source=requirement, requirement_id set)', async () => {
    const r = await requirements.create(tenantA, buyer, `idem-${randomUUID()}`, { title: 'Need 40q', quantity: '40', unitCode: 'quintal' } as any);
    requirementId = r.id;
    const q = await responses.submit(tenantA, seller, requirementId, `idem-${randomUUID()}`, { quotedPriceMinor: '92000', quantity: '40', listingId } as any);
    await responses.accept(tenantA, { userId: buyer, canModerate: false }, q.id, null);

    const processed = await dispatcher.relayBatch();
    expect(processed).toBeGreaterThanOrEqual(1);

    const ord = await admin.query(`SELECT source, status, subtotal_minor, total_minor, buyer_user_id, seller_user_id FROM orders WHERE tenant_id=$1 AND requirement_id=$2`, [tenantA, requirementId]);
    expect(ord.rowCount).toBe(1);
    expect(ord.rows[0].source).toBe('requirement');
    expect(ord.rows[0].status).toBe('created');                 // online_payments OFF
    expect(String(ord.rows[0].subtotal_minor)).toBe('3680000');  // 92000 × 40
    expect(ord.rows[0].buyer_user_id).toBe(buyer);
    expect(ord.rows[0].seller_user_id).toBe(seller);
  });

  it('re-relaying creates no duplicate order (idempotent)', async () => {
    await dispatcher.relayBatch();
    const n = await admin.query(`SELECT count(*)::int c FROM orders WHERE tenant_id=$1 AND requirement_id=$2`, [tenantA, requirementId]);
    expect(n.rows[0].c).toBe(1);
  });
});
