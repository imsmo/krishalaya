// modules/orders/__tests__/order-from-offer.integration.spec.ts
// REAL end-to-end proof that an ACCEPTED offer becomes an order purely through the OUTBOX RELAY
// (Law 4 — no synchronous cross-module calls), against a live Postgres:
//   1. a buyer makes an offer, the seller counters, the buyer accepts (offers service) → the offer is
//      'accepted' and offers.offer_accepted sits in the outbox;
//   2. the dispatcher relays it → OfferAcceptedHandler (orders) creates the order (source='offer',
//      offer_id set, agreed price × qty) and emits orders.order_from_offer_created;
//   3. the dispatcher relays THAT → OrderFromOfferCreatedHandler (offers) links back: the offer is
//      'converted' with converted_order_id = the new order;
//   4. re-relaying is a no-op — exactly ONE order exists for the offer (idempotent).
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
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PgQuotaService } from '../../../core/quota/quota.service.pg';

import { ListingOfferRepository } from '../../offers/repositories/listing-offer.repository';
import { ListingOfferService } from '../../offers/services/listing-offer.service';
import { OrderFromOfferCreatedHandler } from '../../offers/events/handlers/order-from-offer-created.handler';
import { OrderRepository } from '../repositories/order.repository';
import { OfferAcceptedHandler } from '../events/handlers/offer-accepted.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('order-from-accepted-offer via outbox relay (integration, real Postgres)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let offers: ListingOfferService;
  let dispatcher: OutboxDispatcher;

  const tenantA = randomUUID();
  const seller = randomUUID();
  const buyer = randomUUID();
  let listingId = '';
  let offerId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, seller); await makeUser(admin, buyer);
    const lf = await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: 100000n, qty: 100, title: 'Wheat Lot' });
    listingId = lf.id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const cache = new InMemoryCacheService();
    const quota = new PgQuotaService(pools, shards);
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(replica as any), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const offerRepo = new ListingOfferRepository(replica as any);
    offers = new ListingOfferService(uow, outbox, idem, metrics, listings, offerRepo);

    const flags = new FlagsService(pools, cache);
    const orderRepo = new OrderRepository(replica as any);
    const registry = new OutboxHandlerRegistry();
    registry.register(new OfferAcceptedHandler(orderRepo, listings, flags, outbox, metrics));         // orders consumes offers.offer_accepted
    registry.register(new OrderFromOfferCreatedHandler(offerRepo, outbox));                            // offers consumes orders.order_from_offer_created
    dispatcher = new OutboxDispatcher(admin, registry, metrics);                                       // relay on the privileged (admin) pool
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('accepted offer → relay → order created (source=offer) → offer converted', async () => {
    const made = await offers.make(tenantA, buyer, `idem-${randomUUID()}`, { listingId, quantity: '10', offeredPriceMinor: '90000' } as any);
    offerId = made.offerId;
    await offers.counter(tenantA, { userId: seller, canModerate: false }, offerId, '95000');
    const acc = await offers.accept(tenantA, { userId: buyer, canModerate: false }, offerId);
    expect(acc.status).toBe('accepted');

    const processed = await dispatcher.relayBatch();      // offer_accepted → order; order_from_offer_created → converted
    expect(processed).toBeGreaterThanOrEqual(2);

    const ord = await admin.query(`SELECT id, source, status, total_minor, subtotal_minor, buyer_user_id, seller_user_id FROM orders WHERE tenant_id=$1 AND offer_id=$2`, [tenantA, offerId]);
    expect(ord.rowCount).toBe(1);
    expect(ord.rows[0].source).toBe('offer');
    expect(ord.rows[0].status).toBe('created');                       // online_payments OFF → COD-style
    expect(String(ord.rows[0].subtotal_minor)).toBe('950000');         // 95000 × 10
    expect(String(ord.rows[0].total_minor)).toBe('950000');
    expect(ord.rows[0].buyer_user_id).toBe(buyer);
    expect(ord.rows[0].seller_user_id).toBe(seller);

    const off = await admin.query(`SELECT status, converted_order_id FROM listing_offers WHERE id=$1`, [offerId]);
    expect(off.rows[0].status).toBe('converted');
    expect(off.rows[0].converted_order_id).toBe(ord.rows[0].id);
  });

  it('re-relaying creates no duplicate order (idempotent)', async () => {
    await dispatcher.relayBatch();
    const n = await admin.query(`SELECT count(*)::int c FROM orders WHERE tenant_id=$1 AND offer_id=$2`, [tenantA, offerId]);
    expect(n.rows[0].c).toBe(1);
  });
});
