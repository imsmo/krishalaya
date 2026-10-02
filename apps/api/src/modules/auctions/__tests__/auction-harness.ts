// modules/auctions/__tests__/auction-harness.ts · PC-56 TENANT-11a · the integration wiring the three auctions specs share
// (NOT a spec). Real PG16: the harness database (every migration + seeds), tenant-realm queries as `kv_app` under RLS.
//
// The shared `makePublishedListing` / `makeProduct` fixtures are red at this HEAD (each binds one parameter as two types —
// "inconsistent types deduced for parameter $2 / $3", pre-existing, named in the 10b report, not fixed here); `makeListing`
// below is the same inserts with every use typed (10b's own workaround). The orders module's online-payments flag is a
// per-spec switch (`flags.online`), so a spec can prove both collection modes without flipping the GLOBAL feature_flags
// row other suites read.
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ensureUnitCurrency } from '../../../../test/helpers/fixtures';
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
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { AuctionOrderService } from '../../orders/services/auction-order.service';
import { CartRepository } from '../../orders/repositories/cart.repository';
import { CartItemRepository } from '../../orders/repositories/cart-item.repository';
import { CartService } from '../../orders/services/cart.service';
import { CartItemService } from '../../orders/services/cart-item.service';
import { PaymentRepository } from '../../payments/repositories/payment.repository';
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionWatcherRepository } from '../repositories/auction-watcher.repository';
import { AuctionSettlementRepository } from '../repositories/auction-settlement.repository';
import { AuctionService } from '../services/auction.service';
import { BidService } from '../services/bid.service';
import { AuctionWatcherService } from '../services/auction-watcher.service';
import { AuctionsPublisher } from '../events/auctions.publisher';
import { AuctionLiveReadModel } from '../read-models/auction-live.read-model';
import { MyBidsReadModel } from '../read-models/my-bids.read-model';

export interface AuctionHarness {
  pools: PgPoolProvider; uow: PgUnitOfWork; wallet: InProcessWalletClient; replica: PgReadReplicaProvider;
  listings: ListingService; auctions: AuctionService; bids: BidService; watchers: AuctionWatcherService; live: AuctionLiveReadModel; myBids: MyBidsReadModel;
  auctionRepo: AuctionRepository; settlements: AuctionSettlementRepository; payments: PaymentRepository; carts: CartService;
  flags: { online: boolean };
  close(): Promise<void>;
}

export function buildHarness(appUrl: string): AuctionHarness {
  const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: appUrl, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
  const pools = new PgPoolProvider(config);
  const shards = new ShardRouter(config);
  const uow = new PgUnitOfWork(pools, shards);
  const replica = new PgReadReplicaProvider(pools, shards);
  const outbox = new PgOutboxWriter(); const quota = new PgQuotaService(pools, shards); const idem = new PgIdempotencyService(pools);
  const cache = new InMemoryCacheService(); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
  const wallet = new InProcessWalletClient(new LedgerRepository());
  const flags = { online: false };
  const flagsSvc = { isEnabled: async (key: string) => (key === 'online_payments' ? flags.online : false) } as never;
  const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as never), new PriceHistoryRepository(replica as never), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
  const auctionRepo = new AuctionRepository(replica as never);
  const bidRepo = new BidRepository(replica as never);
  const watcherRepo = new AuctionWatcherRepository(replica as never);
  const settlements = new AuctionSettlementRepository(replica as never);
  const publisher = new AuctionsPublisher(outbox);
  const auctionOrders = new AuctionOrderService(new OrderRepository(replica as never), flagsSvc, outbox, metrics);
  const auctions = new AuctionService(uow, outbox, idem, metrics, wallet, audit, listings, auctionRepo, bidRepo, watcherRepo, publisher, settlements, auctionOrders);
  const bids = new BidService(uow, outbox, idem, metrics, wallet, listings, auctionRepo, bidRepo, publisher);
  const watchers = new AuctionWatcherService(uow, metrics, auctionRepo, watcherRepo, publisher);
  const live = new AuctionLiveReadModel(metrics, replica as never, auctionRepo, bidRepo, listings);
  const myBids = new MyBidsReadModel(metrics, bidRepo);
  const cartRepo = new CartRepository(replica as never);
  const carts = new CartService(uow, metrics, listings, cartRepo, new CartItemService(uow, metrics, listings, cartRepo, new CartItemRepository(replica as never)));
  return { pools, uow, wallet, replica, listings, auctions, bids, watchers, live, myBids, auctionRepo, settlements, payments: new PaymentRepository(replica as never), carts, flags,
    close: async () => { await pools.onModuleDestroy(); } };
}

/** A published listing of `qty` `unit` (typed inserts — see the header). */
export async function makeListing(admin: Pool, tenantId: string, sellerId: string, title: string, qty = 200, unit = 'kg', priceMinor = 61000n): Promise<string> {
  const categoryId = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Test Category',$3::ltree,1,true)`, [categoryId, code, code]);
  await ensureUnitCurrency(admin, unit);
  const productId = randomUUID();
  await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,$3::text,$4::text,$5,true, to_tsvector('simple',$3::text))`, [productId, categoryId, title, unit, tenantId]);
  const id = randomUUID();
  await admin.query(`INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
    VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,$7::numeric,1,$8::text,$9,'INR','published','public')`, [id, tenantId, sellerId, productId, categoryId, title, qty, unit, priceMinor.toString()]);
  return id;
}

/** Credit a user's Main from the platform gateway (a test deposit). */
export const fundUser = (h: AuctionHarness, tenantId: string, userId: string, amount: bigint) => h.uow.run(tenantId, (tx) => h.wallet.post(tx, {
  tenantId, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
  legs: [{ account: userMain(userId), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

export const balanceOf = async (admin: Pool, userId: string, code: 'main' | 'hold') =>
  BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code=$2`, [userId, code])).rows[0]?.b ?? '0');

/** A pg-Pool-shaped object whose every query runs AS kv_relay (SET SESSION AUTHORIZATION on an admin connection) — the
 *  pool the ScheduledJobsRunner hands a job. A missing grant is a real 42501. */
export function relayPool(admin: Pool): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const c: PoolClient = await admin.connect();
      try { await c.query('SET SESSION AUTHORIZATION kv_relay'); return await c.query(sql, params as unknown[]); }
      finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
    },
  } as unknown as Pool;
}
