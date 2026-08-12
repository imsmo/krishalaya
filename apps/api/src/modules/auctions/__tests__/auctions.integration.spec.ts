// modules/auctions/__tests__/auctions.integration.spec.ts
// REAL end-to-end proof of the auctions money + lifecycle path against a live Postgres:
//   1. a seller opens an auction on their listing; it goes live;
//   2. bidders place bids → each bidder's EMD is HELD (wallet main → hold) once; the seller CANNOT
//      bid on their own auction; a too-low bid is rejected;
//   3. closing resolves the highest valid bid as the winner and RELEASES every bidder's EMD
//      (hold → main) — zero money lost;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's auction.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, userHold, platform, PlatformAccount } from '../../../core/wallet/account-codes';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';

import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionService } from '../services/auction.service';
import { BidService } from '../services/bid.service';
import { AuctionsPublisher } from '../events/auctions.publisher';
import { AuctionWatcherRepository } from '../repositories/auction-watcher.repository';
import { SellerCannotBidError, BidTooLowError } from '../domain/auctions.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('auctions slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let uow: PgUnitOfWork;
  let wallet: InProcessWalletClient;
  let auctions: AuctionService;
  let bidsSvc: BidService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const seller = randomUUID();
  const bidder1 = randomUUID();
  const bidder2 = randomUUID();
  const EMD = 5000n;
  let listingId = ''; let auctionId = '';

  const holdBal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [u])).rows[0]?.b ?? '0');
  const mainBal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main'`, [u])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, async (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, legs: [ { account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount } ] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, bidder1); await makeUser(admin, bidder2);
    const lf = await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: 100000n, qty: 1, title: 'Auction Lot' });
    listingId = lf.id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const quota = new PgQuotaService(pools, shards);
    const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const auctionRepo = new AuctionRepository(replica as any);
    const bidRepo = new BidRepository(replica as any);
    const publisher = new AuctionsPublisher(outbox);
    auctions = new AuctionService(uow, outbox, idem, metrics, wallet, audit, listings, auctionRepo, bidRepo, new AuctionWatcherRepository(replica as any), publisher);   // TENANT-2a sweep: ctor gained watchers + publisher
    bidsSvc = new BidService(uow, outbox, idem, metrics, wallet, listings, auctionRepo, bidRepo, publisher);

    // fund both bidders so EMD holds succeed
    await fund(bidder1, 1_000_000n); await fund(bidder2, 1_000_000n);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('seller opens an auction; it can be made live', async () => {
    const startsAt = new Date(Date.now() - 1000).toISOString();
    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    const res = await auctions.create(tenantA, seller, `idem-${randomUUID()}`, { listingId, kind: 'english_open', startPriceMinor: '100000', minIncrementMinor: '10000', emdMinor: EMD.toString(), startsAt, endsAt } as any);
    auctionId = res.auctionId;
    await auctions.open(tenantA, auctionId);
    const row = await admin.query(`SELECT status FROM auctions WHERE id=$1`, [auctionId]);
    expect(row.rows[0].status).toBe('live');
  });

  it('bids hold EMD once per bidder; seller cannot bid; too-low is rejected', async () => {
    await bidsSvc.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '100000', null);
    expect(await holdBal(bidder1)).toBe(EMD);                       // EMD held
    expect(await mainBal(bidder1)).toBe(1_000_000n - EMD);

    await bidsSvc.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '110000', null);
    expect(await holdBal(bidder2)).toBe(EMD);

    // bidder1 raises — EMD hold is reused (not doubled)
    await bidsSvc.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '120000', null);
    expect(await holdBal(bidder1)).toBe(EMD);

    await expect(bidsSvc.placeBid(tenantA, seller, auctionId, `idem-${randomUUID()}`, '130000', null)).rejects.toBeInstanceOf(SellerCannotBidError);
    await expect(bidsSvc.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '125000', null)).rejects.toBeInstanceOf(BidTooLowError); // < 120000 + 10000
  });

  it('closing resolves the winner and releases every bidder\'s EMD', async () => {
    await auctions.closeAndResolve(tenantA, auctionId);
    const a = await admin.query(`SELECT status, winning_bid_id FROM auctions WHERE id=$1`, [auctionId]);
    expect(a.rows[0].status).toBe('settled');
    const winning = await admin.query(`SELECT bidder_user_id, amount_minor FROM bids WHERE id=$1`, [a.rows[0].winning_bid_id]);
    expect(winning.rows[0].bidder_user_id).toBe(bidder1);          // highest (120000)
    expect(String(winning.rows[0].amount_minor)).toBe('120000');
    // EMD released for both — holds back to zero, main fully restored
    expect(await holdBal(bidder1)).toBe(0n);
    expect(await holdBal(bidder2)).toBe(0n);
    expect(await mainBal(bidder1)).toBe(1_000_000n);
    expect(await mainBal(bidder2)).toBe(1_000_000n);
  });

  it('RLS: tenant B cannot see tenant A\'s auction', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM auctions WHERE id=$1`, [auctionId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[auctions] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
