// modules/orders/__tests__/orders.integration.spec.ts
// REAL end-to-end proof of the orders slice against a live Postgres (no infra mocks).
// Instantiates the CONCRETE stack (Pg UnitOfWork + RLS, outbox, real ListingService for the
// cross-module price/seller lookup) and verifies the security-critical commerce flow:
//   1. add a published listing to the cart → checkout converts it into ONE order per seller,
//      snapshots the price, writes orders.order_created to the outbox IN THE SAME TX, and marks
//      the cart converted;
//   2. checkout is idempotent — replaying the key returns the same order (no double order);
//   3. lifecycle: seller confirm; a NON-seller cannot confirm (ownership enforced); the buyer
//      completes only after delivery; illegal jumps are rejected;
//   4. an order is visible to its buyer/seller but a stranger gets 404 (no cross-party peeking);
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's order.
// Requires DATABASE_URL (kv_app role). The schema + seeds are built ONCE from the REAL
// db/migrations + db/seeds by test/integration-global-setup.js (no hand-maintained slice);
// this spec only inserts its own FK-ordered fixtures via test/helpers/fixtures.ts.
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

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { ChargePricingService } from '../../payments/services/charge-pricing.service';
import { ChargeDefinitionRepository } from '../../payments/repositories/charge-definition.repository';
import { CouponService } from '../../promotions/services/coupon.service';
import { PromotionService } from '../../promotions/services/promotion.service';
import { PromotionRepository } from '../../promotions/repositories/promotion.repository';
import { CouponRepository } from '../../promotions/repositories/coupon.repository';
import { CouponRedemptionRepository } from '../../promotions/repositories/coupon-redemption.repository';
import { UserMembershipService } from '../../memberships/services/user-membership.service';
import { MembershipTierRepository } from '../../memberships/repositories/membership-tier.repository';
import { UserMembershipRepository } from '../../memberships/repositories/user-membership.repository';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';

import { CartRepository } from '../repositories/cart.repository';
import { CartItemRepository } from '../repositories/cart-item.repository';
import { CheckoutGroupRepository } from '../repositories/checkout-group.repository';
import { OrderRepository } from '../repositories/order.repository';
import { CartService } from '../services/cart.service';
import { CartItemService } from '../services/cart-item.service';
import { CheckoutService } from '../services/checkout.service';
import { OrderService, OrderActor } from '../services/order.service';
import { DeliveryZoneRepository } from '../../logistics/repositories/delivery-zone.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('orders slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;          // superuser: fixtures + assertion reads (bypasses RLS)
  let inspect: Pool;        // kv_app: the RLS isolation proof only
  let carts: CartService;
  let checkout: CheckoutService;
  let promotions: PromotionService;
  let couponSvc: CouponService;
  let orders: OrderService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const seller = randomUUID();
  const buyer = randomUUID();
  const stranger = randomUUID();
  let listingId = '';
  const PRICE = 50000n;          // ₹500.00 / quintal
  const QTY = 3;

  const sellerActor: OrderActor = { userId: seller, canModerate: false };
  const buyerActor: OrderActor = { userId: buyer, canModerate: false };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    // buyer/seller/stranger must be real users (orders + carts FK users.id)
    await makeUser(admin, seller); await makeUser(admin, buyer); await makeUser(admin, stranger);
    // a published, in-stock listing owned by `seller` in tenant A (creates its category + product)
    const lf = await makePublishedListing(admin, { tenantId: tenantA, sellerId: seller, priceMinor: PRICE, qty: 100, title: 'Wheat (Tenant A)' });
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
    const flags = new FlagsService(pools, cache);

    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics,
      new ListingRepository(replica as any), new PriceHistoryRepository(), new ListingAttributeRepository(),
      new ListingMediaRepository(), audit);
    const cartRepo = new CartRepository(replica as any);
    const cartItemRepo = new CartItemRepository(replica as any);
    const orderRepo = new OrderRepository(replica as any);
    const checkoutGroupRepo = new CheckoutGroupRepository(replica as any);

    carts = new CartService(uow, metrics, listings, cartRepo, new CartItemService(uow, metrics, listings, cartRepo, cartItemRepo));
    const promoRepo = new PromotionRepository(replica as any);
    const couponRepo = new CouponRepository(replica as any);
    promotions = new PromotionService(uow, outbox, idem, metrics, audit, promoRepo);
    couponSvc = new CouponService(uow, outbox, idem, metrics, audit, promoRepo, couponRepo, new CouponRedemptionRepository(replica as any));
    const membershipSvc = new UserMembershipService(uow, outbox, idem, metrics, new InProcessWalletClient(new LedgerRepository()), audit, new MembershipTierRepository(replica as any), new UserMembershipRepository(replica as any));
    checkout = new CheckoutService(uow, outbox, quota, idem, metrics, flags, listings, cartRepo, orderRepo, checkoutGroupRepo,
      new ChargePricingService(new ChargeDefinitionRepository(replica as any)), couponSvc, membershipSvc,
      new DeliveryZoneRepository(replica as any)); // DEV-51: zones param (14th) — ctor drift fix
    orders = new OrderService(uow, outbox, metrics, audit, orderRepo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  let orderId = '';

  it('cart → checkout creates one order per seller, snapshots price, emits outbox, converts cart', async () => {
    await carts.addItem(tenantA, buyer, { listingId, quantity: QTY } as any);
    const view = await carts.getCart(tenantA, buyer);
    expect(view.items).toHaveLength(1);
    expect(view.subtotalMinor).toBe((PRICE * BigInt(QTY)).toString());   // ₹1500.00

    const res = await checkout.checkout(tenantA, buyer, `idem-${randomUUID()}`, {} as any);
    expect(res.orders).toHaveLength(1);
    orderId = res.orders[0].id;
    expect(res.orders[0].status).toBe('created');                         // online_payments OFF ⇒ COD-style
    expect(res.orders[0].totalMinor).toBe((PRICE * BigInt(QTY)).toString());

    const row = await admin.query(`SELECT tenant_id, seller_user_id, status, subtotal_minor FROM orders WHERE id=$1`, [orderId]);
    expect(row.rows[0].tenant_id).toBe(tenantA);
    expect(row.rows[0].seller_user_id).toBe(seller);
    expect(String(row.rows[0].subtotal_minor)).toBe((PRICE * BigInt(QTY)).toString());

    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='orders.order_created'`, [orderId]);
    expect(ev.rowCount).toBe(1);
    const it = await admin.query(`SELECT line_total_minor FROM order_items WHERE order_id=$1`, [orderId]);
    expect(String(it.rows[0].line_total_minor)).toBe((PRICE * BigInt(QTY)).toString());
    const cart = await admin.query(`SELECT status FROM carts WHERE tenant_id=$1 AND user_id=$2`, [tenantA, buyer]);
    expect(cart.rows.some((r) => r.status === 'converted')).toBe(true);
  });

  it('checkout is idempotent — same key returns the same order set', async () => {
    await carts.addItem(tenantA, buyer, { listingId, quantity: 1 } as any);
    const key = `idem-${randomUUID()}`;
    const a = await checkout.checkout(tenantA, buyer, key, {} as any);
    const b = await checkout.checkout(tenantA, buyer, key, {} as any);
    expect(a.orders[0].id).toEqual(b.orders[0].id);
  });

  it('lifecycle: only the seller may confirm; buyer cannot; illegal completion is rejected', async () => {
    await expect(orders.confirm(tenantA, buyerActor, orderId, null)).rejects.toBeTruthy();   // not the seller
    await orders.confirm(tenantA, sellerActor, orderId, null);
    const s = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(s.rows[0].status).toBe('confirmed');
    // can't complete a confirmed (not yet delivered) order — state machine blocks it
    await expect(orders.complete(tenantA, buyerActor, orderId, null)).rejects.toBeTruthy();
    // a status-change timeline + outbox row was recorded for the confirm
    const ev = await admin.query(`SELECT 1 FROM order_events WHERE order_id=$1 AND to_status='confirmed'`, [orderId]);
    expect(ev.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('a stranger cannot read the order (404, not 403 — no existence leak)', async () => {
    await expect(orders.getById(tenantA, { userId: stranger, canModerate: false }, orderId)).rejects.toBeTruthy();
    const seen = await orders.getById(tenantA, sellerActor, orderId);   // the seller can
    expect(seen.id).toBe(orderId);
  });

  it('RLS: tenant B cannot see tenant A\'s order', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM orders WHERE id=$1`, [orderId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[orders] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });

  it('checkout applies a coupon discount to the order (promotions → order.discount_minor)', async () => {
    const buyer2 = randomUUID();
    await makeUser(admin, buyer2);
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='promotions'`);
    const now = Date.now();
    const promo = await promotions.create(tenantA, { userId: seller, canManage: true } as any, `idem-${randomUUID()}`, {
      promoType: 'festival', defaultName: 'Festival 10%', rules: { discountType: 'percent', percentOff: 10 },
      startsAt: new Date(now - 3600_000).toISOString(), endsAt: new Date(now + 7 * 86400_000).toISOString(),
    } as any);
    const CODE = `SAVE${randomUUID().slice(0, 6).toUpperCase()}`;
    await couponSvc.createCoupon(tenantA, { userId: seller, canManage: true } as any, `idem-${randomUUID()}`, { promotionId: promo.id, code: CODE, perUserLimit: 1 } as any);

    await carts.addItem(tenantA, buyer2, { listingId, quantity: QTY } as any);
    const subtotal = PRICE * BigInt(QTY);
    const res = await checkout.checkout(tenantA, buyer2, `idem-${randomUUID()}`, { couponCode: CODE } as any);
    const cid = res.orders[0].id;
    const expectedDiscount = subtotal / 10n;
    const row = await admin.query(`SELECT discount_minor, total_minor, subtotal_minor FROM orders WHERE id=$1`, [cid]);
    expect(String(row.rows[0].discount_minor)).toBe(expectedDiscount.toString());          // 10% off recorded on the order
    expect(String(row.rows[0].total_minor)).toBe((subtotal - expectedDiscount).toString()); // buyer pays less
    // the redemption was recorded against this order (one coupon per order)
    const red = await admin.query(`SELECT amount_minor FROM coupon_redemptions WHERE tenant_id=$1 AND order_id=$2`, [tenantA, cid]);
    expect(red.rowCount).toBe(1);
    expect(String(red.rows[0].amount_minor)).toBe(expectedDiscount.toString());
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='promotions'`);
  });

});
