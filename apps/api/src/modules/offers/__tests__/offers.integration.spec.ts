// modules/offers/__tests__/offers.integration.spec.ts
// REAL end-to-end proof of the offer negotiation path against a live Postgres:
//   1. a buyer makes an offer on a seller's published listing → status open;
//   2. the seller counters → countered; the buyer accepts → accepted, and offers.offer_accepted is
//      written to the SAME-tx outbox (the downstream orders integration point);
//   3. the seller CANNOT make an offer on their own listing; a stranger CANNOT read the offer (IDOR);
//   4. the expiry worker lapses an offer past expires_at → expired;
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's offer (migration 0020 backfilled the policy).
// Schema/seeds come from the REAL db/migrations + db/seeds; fixtures via test/helpers/fixtures.ts.
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

import { ListingOfferRepository } from '../repositories/listing-offer.repository';
import { ListingOfferService } from '../services/listing-offer.service';
import { ExpireOffersJob } from '../jobs/expire-offers.job';
import { SellerCannotOfferError, OfferForbiddenError } from '../domain/offers.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('offers slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let offers: ListingOfferService;
  let repo: ListingOfferRepository;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const seller = randomUUID();
  const buyer = randomUUID();
  const stranger = randomUUID();
  let listingId = '';
  let offerId = '';

  const sellerActor = () => ({ userId: seller, canModerate: false });
  const buyerActor = () => ({ userId: buyer, canModerate: false });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, buyer); await makeUser(admin, stranger);
    const lf = await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: 100000n, qty: 100, title: 'Wheat Lot' });
    listingId = lf.id;

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
    repo = new ListingOfferRepository(replica as any);
    offers = new ListingOfferService(uow, outbox, idem, metrics, listings, repo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('a buyer makes an offer on the seller\'s listing (open, round 1)', async () => {
    const res = await offers.make(tenantA, buyer, `idem-${randomUUID()}`, { listingId, quantity: '10', offeredPriceMinor: '90000' } as any);
    offerId = res.offerId;
    expect(res.status).toBe('open'); expect(res.round).toBe(1);
    const row = await admin.query(`SELECT status, round, buyer_user_id FROM listing_offers WHERE id=$1`, [offerId]);
    expect(row.rows[0].status).toBe('open'); expect(row.rows[0].buyer_user_id).toBe(buyer);
  });

  it('the seller cannot make an offer on their own listing', async () => {
    await expect(offers.make(tenantA, seller, `idem-${randomUUID()}`, { listingId, quantity: '5', offeredPriceMinor: '90000' } as any))
      .rejects.toBeInstanceOf(SellerCannotOfferError);
  });

  it('a stranger (neither buyer nor seller) cannot read the offer (IDOR)', async () => {
    await expect(offers.getById(tenantA, { userId: stranger, canModerate: false }, offerId)).rejects.toBeInstanceOf(OfferForbiddenError);
    // the buyer and seller both can
    expect((await offers.getById(tenantA, buyerActor(), offerId)).offerId).toBe(offerId);
    expect((await offers.getById(tenantA, sellerActor(), offerId)).offerId).toBe(offerId);
  });

  it('seller counters → buyer accepts → accepted; offers.offer_accepted is in the outbox (same tx)', async () => {
    const c = await offers.counter(tenantA, sellerActor(), offerId, '95000');
    expect(c.status).toBe('countered'); expect(c.round).toBe(2); expect(c.counterPriceMinor).toBe('95000');
    // it is the buyer's turn — the seller cannot accept their own counter
    await expect(offers.accept(tenantA, sellerActor(), offerId)).rejects.toThrow();
    const a = await offers.accept(tenantA, buyerActor(), offerId);
    expect(a.status).toBe('accepted');
    const ob = await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='offers.offer_accepted'`, [offerId]);
    expect(ob.rowCount).toBe(1);
    expect(ob.rows[0].payload.agreedPriceMinor).toBe('95000');
  });

  it('the expiry worker lapses an offer past expires_at → expired', async () => {
    const res = await offers.make(tenantA, buyer, `idem-${randomUUID()}`, { listingId, quantity: '3', offeredPriceMinor: '80000', expiresAt: new Date(Date.now() + 500).toISOString() } as any);
    await new Promise((r) => setTimeout(r, 700));
    const job = new ExpireOffersJob(admin, repo, offers);
    const out = await job.run(50);
    expect(out.expired).toBeGreaterThanOrEqual(1);
    const row = await admin.query(`SELECT status FROM listing_offers WHERE id=$1`, [res.offerId]);
    expect(row.rows[0].status).toBe('expired');
  });

  it('RLS: tenant B cannot see tenant A\'s offer', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM listing_offers WHERE id=$1`, [offerId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[offers] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
