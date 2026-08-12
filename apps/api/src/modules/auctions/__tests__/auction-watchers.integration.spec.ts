// modules/auctions/__tests__/auction-watchers.integration.spec.ts
// REAL Postgres proof of the API-W3-11 slice:
//   1. a member WATCHES an auction (idempotent) + lists their watch-list; a non-member (other tenant)
//      gets 404 (auction not visible — no cross-tenant enumeration);
//   2. release-losing-emd releases LOSING bidders' EMD (hold → main) for a closed auction while the
//      WINNER keeps their hold — zero money lost, idempotent on the shared wallet key;
//   3. the auction payment-succeeded handler releases the WINNER's EMD once they pay (referenceType
//      'auction'), idempotent;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's auction_watchers row.
// Schema/seeds from the REAL db/migrations + db/seeds.
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
import { TxContext } from '../../../core/database/unit-of-work';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';

import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionWatcherRepository } from '../repositories/auction-watcher.repository';
import { AuctionService } from '../services/auction.service';
import { BidService } from '../services/bid.service';
import { AuctionWatcherService } from '../services/auction-watcher.service';
import { AuctionsPublisher } from '../events/auctions.publisher';
import { AuctionPaymentSucceededHandler } from '../events/handlers/payment-succeeded.handler';
import { AuctionNotFoundError } from '../domain/auctions.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('auction watchers + EMD-release glue (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let auctions: AuctionService; let bidsSvc: BidService; let watchers: AuctionWatcherService;
  let paymentHandler: AuctionPaymentSucceededHandler;
  let isSuperuser = false;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const seller = randomUUID(); const bidder1 = randomUUID(); const bidder2 = randomUUID(); const strangerB = randomUUID();
  let listingId = ''; let auctionId = ''; let winningBidId = '';
  const EMD = 5000n;

  const holdBal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [u])).rows[0]?.b ?? '0');
  const fund = async (u: string, amt: bigint) => uow.run(tenantA, async (tx) => {
    await wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
      legs: [ { account: userMain(u), amountMinor: amt }, { account: platform(PlatformAccount.Gateway), amountMinor: -amt } ] });
  }, { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, bidder1); await makeUser(admin, bidder2); await makeUser(admin, strangerB);
    listingId = (await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: 100000n, qty: 1, title: 'Auction Lot' })).id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const quota = new PgQuotaService(pools, shards); const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics(); const audit = new AuditWriter(pools); const cache = new InMemoryCacheService();
    wallet = new InProcessWalletClient(new LedgerRepository());
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(replica as any), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const auctionRepo = new AuctionRepository(replica as any);
    const bidRepo = new BidRepository(replica as any);
    const watcherRepo = new AuctionWatcherRepository(replica as any);
    const publisher = new AuctionsPublisher(outbox);
    auctions = new AuctionService(uow, outbox, idem, metrics, wallet, audit, listings, auctionRepo, bidRepo, new AuctionWatcherRepository(replica as any), publisher);   // TENANT-2a sweep: ctor gained watchers + publisher
    bidsSvc = new BidService(uow, outbox, idem, metrics, wallet, listings, auctionRepo, bidRepo, publisher);
    watchers = new AuctionWatcherService(uow, metrics, auctionRepo, watcherRepo, publisher);
    paymentHandler = new AuctionPaymentSucceededHandler(wallet, auctionRepo, bidRepo, publisher);

    await fund(bidder1, 1_000_000n); await fund(bidder2, 1_000_000n);
    const c = await auctions.create(tenantA, seller, `idem-${randomUUID()}`, { listingId, kind: 'english_open', startPriceMinor: '100000', minIncrementMinor: '10000', emdMinor: EMD.toString(), startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString() } as any);
    auctionId = c.auctionId;
    await auctions.open(tenantA, auctionId);
    await bidsSvc.placeBid(tenantA, bidder2, auctionId, `idem-${randomUUID()}`, '100000', null);          // loser
    const w = await bidsSvc.placeBid(tenantA, bidder1, auctionId, `idem-${randomUUID()}`, '120000', null); // winner (high)
    winningBidId = w.bidId;
    // close to 'ended' + record the winner WITHOUT releasing EMD (so the W3-11 release paths are exercised)
    await admin.query(`UPDATE auctions SET status='ended', winning_bid_id=$2, updated_at=now() WHERE id=$1`, [auctionId, winningBidId]);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('watch is idempotent + lists in my watch-list; a non-member gets 404', async () => {
    await watchers.watch(tenantA, bidder1, auctionId);
    await watchers.watch(tenantA, bidder1, auctionId);   // idempotent
    const cnt = await admin.query(`SELECT count(*)::int c FROM auction_watchers WHERE auction_id=$1 AND user_id=$2`, [auctionId, bidder1]);
    expect(cnt.rows[0].c).toBe(1);
    const mine = await watchers.listMine(tenantA, bidder1, { limit: 20 });
    expect(mine.items.find((x) => x.auctionId === auctionId)).toBeTruthy();
    // a user acting in tenant B cannot watch tenant A's auction (not visible → 404)
    await expect(watchers.watch(tenantB, strangerB, auctionId)).rejects.toBeInstanceOf(AuctionNotFoundError);
  });

  it('release-losing-emd returns LOSERS\' EMD and keeps the WINNER\'s hold', async () => {
    expect(await holdBal(bidder1)).toBe(EMD); expect(await holdBal(bidder2)).toBe(EMD);
    const res = await auctions.releaseLosingEmd(tenantA, auctionId);
    expect(res.released).toBe(1);                       // only the loser
    expect(await holdBal(bidder2)).toBe(0n);            // loser refunded
    expect(await holdBal(bidder1)).toBe(EMD);           // winner still held
    // idempotent: re-running releases nothing new
    expect((await auctions.releaseLosingEmd(tenantA, auctionId)).released).toBe(0);
  });

  it('winner EMD is released when they pay (payments.payment_succeeded, referenceType auction)', async () => {
    await uow.run(tenantA, (tx: TxContext) => paymentHandler.handle(
      { id: '1', tenantId: tenantA, aggregateType: 'payment', aggregateId: randomUUID(), eventType: 'payments.payment_succeeded', payload: { v: 1, referenceType: 'auction', referenceId: auctionId } } as any, tx), { userId: 'system' });
    expect(await holdBal(bidder1)).toBe(0n);            // winner's EMD returned on payment
  });

  it('RLS: tenant B cannot see tenant A\'s auction_watchers row', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id WHERE w.auction_id=$1`, [auctionId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[auction-watchers] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
