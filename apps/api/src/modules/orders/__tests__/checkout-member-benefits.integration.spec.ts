// modules/orders/__tests__/checkout-member-benefits.integration.spec.ts
// REAL end-to-end proof that a MEMBERSHIP overrides the buyer-side charges at checkout, against a live
// Postgres. With `buyer_charges` ON the default buyer platform fee is 2.5% (seed 0204); a member whose
// tier carries platform_fee_bps_override=100 (1%) + freeDelivery pays the OVERRIDDEN fee on their order.
// Isolated suite (its own flags + FlagsService) so the shared orders spec is unaffected.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { ChargePricingService } from '../../payments/services/charge-pricing.service';
import { ChargeDefinitionRepository } from '../../payments/repositories/charge-definition.repository';
import { CartRepository } from '../repositories/cart.repository';
import { CartItemRepository } from '../repositories/cart-item.repository';
import { CheckoutGroupRepository } from '../repositories/checkout-group.repository';
import { OrderRepository } from '../repositories/order.repository';
import { CartService } from '../services/cart.service';
import { CartItemService } from '../services/cart-item.service';
import { CheckoutService } from '../services/checkout.service';
import { CouponService } from '../../promotions/services/coupon.service';
import { PromotionRepository } from '../../promotions/repositories/promotion.repository';
import { CouponRepository } from '../../promotions/repositories/coupon.repository';
import { CouponRedemptionRepository } from '../../promotions/repositories/coupon-redemption.repository';
import { MembershipTierService } from '../../memberships/services/membership-tier.service';
import { UserMembershipService } from '../../memberships/services/user-membership.service';
import { MembershipTierRepository } from '../../memberships/repositories/membership-tier.repository';
import { UserMembershipRepository } from '../../memberships/repositories/user-membership.repository';
import { DeliveryZoneRepository } from '../../logistics/repositories/delivery-zone.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('checkout member benefits — platform fee override (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let carts: CartService; let checkout: CheckoutService; let tiers: MembershipTierService; let memberships: UserMembershipService;

  const tenantA = randomUUID();
  const seller = randomUUID();
  const memberBuyer = randomUUID();
  const plainBuyer = randomUUID();
  const PRICE = 60000n; const QTY = 3;          // subtotal 180000
  const SUBTOTAL = PRICE * BigInt(QTY);
  let listingId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, seller); await makeUser(admin, memberBuyer); await makeUser(admin, plainBuyer);
    listingId = (await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: PRICE, qty: 100, title: 'Wheat' })).id;
    // this suite owns its flags — buyer_charges + memberships ON; online_payments OFF (COD-style orders)
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key IN ('buyer_charges','memberships')`);

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
    const flags = new FlagsService(pools, cache);
    const wallet = new InProcessWalletClient(new LedgerRepository());
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as any), new PriceHistoryRepository(), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const cartRepo = new CartRepository(replica as any);
    const cartItemRepo = new CartItemRepository(replica as any);
    const checkoutGroupRepo = new CheckoutGroupRepository(replica as any);
    carts = new CartService(uow, metrics, listings, cartRepo, new CartItemService(uow, metrics, listings, cartRepo, cartItemRepo));
    const couponSvc = new CouponService(uow, outbox, idem, metrics, audit, new PromotionRepository(replica as any), new CouponRepository(replica as any), new CouponRedemptionRepository(replica as any));
    const tierRepo = new MembershipTierRepository(replica as any);
    const membershipRepo = new UserMembershipRepository(replica as any);
    tiers = new MembershipTierService(uow, outbox, idem, metrics, audit, tierRepo);
    memberships = new UserMembershipService(uow, outbox, idem, metrics, wallet, audit, tierRepo, membershipRepo);
    checkout = new CheckoutService(uow, outbox, quota, idem, metrics, flags, listings, cartRepo, new OrderRepository(replica as any), checkoutGroupRepo,
      new ChargePricingService(new ChargeDefinitionRepository(replica as any)), couponSvc, memberships,
      new DeliveryZoneRepository(replica as any)); // DEV-51: zones param (14th) — ctor drift fix
  }, 30000);

  afterAll(async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key IN ('buyer_charges','memberships')`).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  it('non-member pays the default 2.5% buyer platform fee', async () => {
    await carts.addItem(tenantA, plainBuyer, { listingId, quantity: QTY } as any);
    const res = await checkout.checkout(tenantA, plainBuyer, `idem-${randomUUID()}`, {} as any);
    const o = await admin.query(`SELECT platform_fee_minor, total_minor FROM orders WHERE id=$1`, [res.orders[0].id]);
    const defaultFee = (SUBTOTAL * 250n) / 10000n;   // 2.5% (seed 0204)
    expect(String(o.rows[0].platform_fee_minor)).toBe(defaultFee.toString());
    expect(String(o.rows[0].total_minor)).toBe((SUBTOTAL + defaultFee).toString());
  });

  it('a member with platform_fee_bps_override=100 (1%) + freeDelivery pays the OVERRIDDEN fee', async () => {
    // a free tier (so subscribe needs no wallet balance) carrying the fee override + free delivery
    const tier = await tiers.create(tenantA, { userId: seller, canManage: true } as any, `idem-${randomUUID()}`, {
      code: 'plus', defaultName: 'Plus', monthlyFeeMinor: '0', platformFeeBpsOverride: 100, benefits: { freeDelivery: true },
    } as any);
    await memberships.subscribe(tenantA, { userId: memberBuyer, tenantId: tenantA, canManage: false } as any, `idem-${randomUUID()}`, { tierId: tier.id, billingCycle: 'monthly' } as any);

    await carts.addItem(tenantA, memberBuyer, { listingId, quantity: QTY } as any);
    const res = await checkout.checkout(tenantA, memberBuyer, `idem-${randomUUID()}`, {} as any);
    const o = await admin.query(`SELECT platform_fee_minor, delivery_fee_minor, total_minor FROM orders WHERE id=$1`, [res.orders[0].id]);
    const memberFee = (SUBTOTAL * 100n) / 10000n;    // overridden to 1%
    expect(String(o.rows[0].platform_fee_minor)).toBe(memberFee.toString());
    expect(String(o.rows[0].delivery_fee_minor)).toBe('0');                     // freeDelivery
    expect(String(o.rows[0].total_minor)).toBe((SUBTOTAL + memberFee).toString());
    expect(memberFee).toBeLessThan((SUBTOTAL * 250n) / 10000n);                 // strictly cheaper than the default
  });
});
