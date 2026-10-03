// modules/promotions/__tests__/tenant10b-promotion-money.integration.spec.ts · PC-56 TENANT-10b — real PG16, the harness's
// database (the real migrations through 0185 + seeds), every tenant-realm query as `kv_app` under RLS, the settlement run
// on the relay's transaction AS kv_relay (SET SESSION AUTHORIZATION — so the wallet's RESET ROLE lands back on kv_relay, not
// on the superuser, and a missing grant is a real 42501).
//
// FOUNDER DECISION F-2: THE TENANT WALLET FUNDS THE DISCOUNT. What this file proves, live:
//   1. A1 — a checkout with a coupon RESERVES the discount: tenant Main drops, tenant Hold rises, the redemption carries the
//      promo_hold txn, the promotion's spend is that reservation (A6), the attempt is recorded (A4);
//   2. A2 — settlement (as kv_relay) pays the seller the FULL goods value (escrow on the discounted total + the top-up) and
//      empties the Hold; a replay moves nothing;
//   3. A1 — a tenant that cannot fund it: the order is placed at FULL price with TENANT_FUNDS_UNAVAILABLE, nothing is
//      reserved (a partially funded Main is untouched — the savepoint), the attempt is recorded;
//   4. F-21 — a spent budget is a kind refusal: the order proceeds at full price, nothing aborts;
//   5. F-22 / A5 — the preview and the redeem give the same answer on the per-user limit;
//   6. A3 — a cancelled order's reservation returns to Main; uses and spend are given back; settlement then pays nothing;
//   7. F-17 — two rows in the SAME millisecond, page size 1: page two is the second row (coupons, promotions, redemptions);
//   8. A4 — kv_app on coupon_redemption_attempts: a cross-tenant INSERT is refused by RLS; UPDATE / DELETE refused (grant)
//      and refused by the trigger even for the owner; coupon_redemptions money columns are frozen by trigger;
//   9. F-29 — the order-created backstop run with the relay's transaction AS kv_relay no longer dies 42501;
//  10. B4 / F-10 — the festival scheduler opens a system-closed festival in its window and never re-opens a human pause;
//      the budget watch closes a spent promotion, which reads `exhausted`, not `paused`.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../../../test/helpers/fixtures';
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
import { platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { TxContext } from '../../../core/database/unit-of-work';

import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { ChargePricingService } from '../../payments/services/charge-pricing.service';
import { ChargeDefinitionRepository } from '../../payments/repositories/charge-definition.repository';
import { SettlementPricingService } from '../../payments/services/settlement-pricing.service';
import { CommissionRuleRepository } from '../../payments/repositories/commission-rule.repository';
import { TaxRuleRepository } from '../../payments/repositories/tax-rule.repository';
import { SettlementLineRepository } from '../../payments/repositories/settlement-line.repository';
import { OrderCompletedHandler } from '../../payments/events/handlers/order-completed.handler';
import { CartRepository } from '../../orders/repositories/cart.repository';
import { CartItemRepository } from '../../orders/repositories/cart-item.repository';
import { CheckoutGroupRepository } from '../../orders/repositories/checkout-group.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { CartService } from '../../orders/services/cart.service';
import { CartItemService } from '../../orders/services/cart-item.service';
import { CheckoutService } from '../../orders/services/checkout.service';
import { UserMembershipService } from '../../memberships/services/user-membership.service';
import { MembershipTierRepository } from '../../memberships/repositories/membership-tier.repository';
import { UserMembershipRepository } from '../../memberships/repositories/user-membership.repository';
import { DeliveryZoneRepository } from '../../logistics/repositories/delivery-zone.repository';

import { PromotionRepository } from '../repositories/promotion.repository';
import { CouponRepository } from '../repositories/coupon.repository';
import { CouponRedemptionRepository } from '../repositories/coupon-redemption.repository';
import { CouponAttemptRepository } from '../repositories/coupon-attempt.repository';
import { PromotionService } from '../services/promotion.service';
import { CouponService } from '../services/coupon.service';
import { CouponMoneyService } from '../services/coupon-money.service';
import { CouponRedemptionService } from '../services/coupon-redemption.service';
import { OffersReadModel } from '../read-models/offers.read-model';
import { OrderCreatedHandler } from '../events/handlers/order-created.handler';
import { OrderClosedHandler } from '../events/handlers/order-closed.handler';
import { FestivalCampaignSchedulerJob } from '../jobs/festival-campaign-scheduler.job';
import { PromoBudgetWatchJob } from '../jobs/promo-budget-watch.job';
import { decodeCursor } from '../domain/cursor';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

run('PC-56 TENANT-10b · promotion money — the tenant wallet funds the discount (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let wallet: InProcessWalletClient; let promotions: PromotionService; let coupons: CouponService; let checkout: CheckoutService; let carts: CartService;
  let redemptionsSvc: CouponRedemptionService; let settle: OrderCompletedHandler; let offers: OffersReadModel; let promoRepo: PromotionRepository;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const mgrUser = randomUUID(); const seller = randomUUID(); const sellerB = randomUUID();
  const buyer1 = randomUUID(); const buyer2 = randomUUID(); const buyer3 = randomUUID(); const buyer4 = randomUUID(); const buyerB = randomUUID();
  const mgr = { userId: mgrUser, canManage: true };
  const PRICE = 50000n; const QTY = 2; const SUBTOTAL = PRICE * BigInt(QTY);   // 100000 → 10% = 10000
  let listingA = ''; let listingB = '';
  let promoId = ''; const CODE = `KHARIF${randomUUID().slice(0, 4).toUpperCase()}`; let couponId = '';
  let order1 = '';

  const tenantBal = async (t: string, code: 'main' | 'hold') => BigInt((await admin.query(`SELECT cached_balance_minor b FROM wallet_accounts WHERE owner_kind='tenant' AND owner_tenant_id=$1 AND account_code=$2`, [t, code])).rows[0]?.b ?? '0');
  const userBal = async (u: string) => BigInt((await admin.query(`SELECT cached_balance_minor b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main'`, [u])).rows[0]?.b ?? '0');
  const fund = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'billing_adjustment', idempotencyKey: `fund-${randomUUID()}`,
    legs: [{ account: platform(PlatformAccount.Suspense), amountMinor: -amount }, { account: { kind: 'tenant', tenantId: t, accountCode: 'main', currencyCode: 'INR' }, amountMinor: amount }] }), { userId: 'system' });
  const window = () => ({ startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
  const placeOrder = async (t: string, listingId: string, buyer: string, couponCode: string) => {
    await carts.addItem(t, buyer, { listingId, quantity: QTY } as never);
    return checkout.checkout(t, buyer, `idem-${randomUUID()}`, { couponCode } as never) as Promise<{ orders: Array<{ id: string; totalMinor: string }>; couponNotice?: { code: string; outcome: string; messageKey: string } }>;
  };
  /** The relay's own transaction, AS kv_relay — committed (settlement is a real write). */
  async function asRelay<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_relay');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const tx: TxContext = { query: (sql: string, p?: readonly unknown[]) => c.query(sql, p as unknown[]) as never, tenantId, userId: 'system' };
      const out = await fn(tx);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  const completed = (orderId: string, totalMinor: string, sellerUserId: string) =>
    ({ id: randomUUID(), tenantId: tenantA, aggregateType: 'order', aggregateId: orderId, eventType: 'orders.order_completed', payload: { sellerUserId, totalMinor, deliveryFeeMinor: '0', platformFeeMinor: '0' } }) as never;
  /** A published listing. The shared `makePublishedListing` / `makeProduct` fixtures are red at this HEAD (each binds one
   *  parameter as two types — "inconsistent types deduced for parameter $2 / $3", pre-existing, named in the report, not
   *  fixed here); these are the same inserts with every use typed. */
  const makeListing = async (tenantId: string, sellerId: string, title: string): Promise<string> => {
    const categoryId = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Test Category',$3::ltree,1,true)`, [categoryId, code, code]);
    await ensureUnitCurrency(admin, 'quintal');
    const productId = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,$3::text,'quintal',$4,true, to_tsvector('simple',$3::text))`, [productId, categoryId, title, tenantId]);
    const id = randomUUID();
    await admin.query(`INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
      VALUES ($1,$2,$3,$4,$5,$6,1000,1000,1,'quintal',$7,'INR','published','public')`, [id, tenantId, sellerId, productId, categoryId, title, PRICE.toString()]);
    return id;
  };
  const sqlState = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [mgrUser, seller, sellerB, buyer1, buyer2, buyer3, buyer4, buyerB]) await makeUser(admin, u);
    await admin.query(`INSERT INTO addresses (user_id, line1, village, is_default) VALUES ($1, 'Plot 4', 'Rajkot', true)`, [buyer1]);
    listingA = await makeListing(tenantA, seller, 'Groundnut');
    listingB = await makeListing(tenantB, sellerB, 'Cumin');
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='promotions'`);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const quota = new PgQuotaService(pools, shards); const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService(); const metrics = new PromMetrics(); const audit = new AuditWriter(pools); const flags = new FlagsService(pools, cache);
    wallet = new InProcessWalletClient(new LedgerRepository());
    promoRepo = new PromotionRepository(replica as never);
    const couponRepo = new CouponRepository(replica as never); const redRepo = new CouponRedemptionRepository(replica as never); const attempts = new CouponAttemptRepository();
    const money = new CouponMoneyService(wallet, redRepo);
    promotions = new PromotionService(uow, outbox, idem, metrics, audit, promoRepo);
    coupons = new CouponService(uow, outbox, idem, metrics, audit, promoRepo, couponRepo, redRepo, attempts, money);
    redemptionsSvc = new CouponRedemptionService(uow, outbox, metrics, couponRepo, promoRepo, redRepo, attempts, money);
    offers = new OffersReadModel(replica as never);
    const listings = new ListingService(uow, outbox, quota, idem, cache, metrics, new ListingRepository(replica as never), new PriceHistoryRepository(replica as never), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const cartRepo = new CartRepository(replica as never);
    carts = new CartService(uow, metrics, listings, cartRepo, new CartItemService(uow, metrics, listings, cartRepo, new CartItemRepository(replica as never)));
    const memberships = new UserMembershipService(uow, outbox, idem, metrics, wallet, audit, new MembershipTierRepository(replica as never), new UserMembershipRepository(replica as never));
    checkout = new CheckoutService(uow, outbox, quota, idem, metrics, flags, listings, cartRepo, new OrderRepository(replica as never), new CheckoutGroupRepository(replica as never),
      new ChargePricingService(new ChargeDefinitionRepository(replica as never)), coupons, memberships, new DeliveryZoneRepository(replica as never));
    // `commission_split` is a GLOBAL flag row other payments specs switch ON while they run. Until PC-56 HOTFIX-2 that turned this
    // handler onto its split path, where it read `commission_rules` as kv_relay and died 42501 (the 11b/11c "red only in parallel"
    // runs). The split path now reads the rules as kv_app and survives the flag (relay-handlers-as-kv-relay gate, B4). The pin stays
    // because THIS spec's figures are the unsplit settlement (seller Main = the FULL goods value) and its synthetic completion events
    // carry no `source` for a rule lookup — so the real handler runs with the flag pinned to its seeded default (OFF), as 11c does.
    const pinnedFlags = { isEnabled: async (key: string, c?: unknown) => (key === 'commission_split' ? false : flags.isEnabled(key, c as never)) } as unknown as FlagsService;
    settle = new OrderCompletedHandler(wallet, pinnedFlags, new SettlementPricingService(new CommissionRuleRepository(replica as never), new TaxRuleRepository(replica as never)), new SettlementLineRepository(), money, uow);

    promoId = (await promotions.create(tenantA, mgr, `k-${randomUUID()}`, { promoType: 'discount', defaultName: 'Kharif input 10%', rules: { discountType: 'percent', percentOff: 10, maxDiscountMinor: '50000' }, budgetMinor: '40000', ...window() } as never)).id;
    couponId = (await coupons.createCoupon(tenantA, mgr, `k-${randomUUID()}`, { promotionId: promoId, code: CODE, maxUses: 1000, perUserLimit: 1 } as never)).id;
  }, 120000);
  afterAll(async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='promotions'`).catch(() => undefined);
    await pools?.onModuleDestroy(); await app?.end(); await admin?.end();
  });

  it('A1 · redeem RESERVES the discount: tenant Main drops, Hold rises, the redemption carries the promo_hold txn, spend = the reservation', async () => {
    await fund(tenantA, 100000n);
    const res = await placeOrder(tenantA, listingA, buyer1, CODE);
    order1 = res.orders[0].id;
    expect(res.couponNotice).toBeUndefined();
    const o = (await admin.query(`SELECT discount_minor::text d, total_minor::text t FROM orders WHERE id=$1`, [order1])).rows[0];
    expect(o).toEqual({ d: '10000', t: '90000' });
    expect(await tenantBal(tenantA, 'main')).toBe(90000n);
    expect(await tenantBal(tenantA, 'hold')).toBe(10000n);
    const red = (await admin.query(`SELECT id, hold_txn_id, settled_txn_id, released_txn_id, amount_minor::text a FROM coupon_redemptions WHERE tenant_id=$1 AND order_id=$2`, [tenantA, order1])).rows;
    expect(red).toHaveLength(1);
    expect(red[0]).toMatchObject({ a: '10000', settled_txn_id: null, released_txn_id: null });
    const txn = (await admin.query(`SELECT t.idempotency_key, lv.code, t.reference_type FROM ledger_transactions t JOIN lookup_values lv ON lv.id=t.txn_type_id WHERE t.id=$1`, [red[0].hold_txn_id])).rows[0];
    expect(txn).toEqual({ idempotency_key: `promo-hold:${order1}:${couponId}`, code: 'promo_hold', reference_type: 'coupon_redemption' });
    expect(String((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [promoId])).rows[0].spent_minor)).toBe('10000');
    const att = (await admin.query(`SELECT stage, outcome::text, amount_minor::text a FROM coupon_redemption_attempts WHERE tenant_id=$1 AND order_id=$2`, [tenantA, order1])).rows;
    expect(att).toEqual([{ stage: 'redeem', outcome: 'applied', a: '10000' }]);
  }, 60000);

  it('A2 · settlement AS kv_relay pays the seller the FULL goods value and empties the Hold; a replay moves nothing', async () => {
    const before = await userBal(seller);
    await asRelay(tenantA, (tx) => settle.handle(completed(order1, '90000', seller), tx));
    expect((await userBal(seller)) - before).toBe(100000n);                                   // 90000 escrow (unchanged leg) + 10000 top-up
    expect(await tenantBal(tenantA, 'hold')).toBe(0n);
    expect(await tenantBal(tenantA, 'main')).toBe(90000n);                                   // the tenant paid the discount, once
    const red = (await admin.query(`SELECT settled_txn_id, settled_at FROM coupon_redemptions WHERE order_id=$1`, [order1])).rows[0];
    expect(red.settled_txn_id).toBeTruthy(); expect(red.settled_at).toBeTruthy();
    const legs = (await admin.query(`SELECT wa.owner_kind, wa.account_code, e.amount_minor::text a FROM ledger_entries e JOIN wallet_accounts wa ON wa.id=e.account_id WHERE e.txn_id=$1 ORDER BY e.amount_minor`, [red.settled_txn_id])).rows;
    expect(legs).toEqual([{ owner_kind: 'tenant', account_code: 'hold', a: '-10000' }, { owner_kind: 'user', account_code: 'main', a: '10000' }]);
    const escrow = (await admin.query(`SELECT count(*)::int n FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.txn_id WHERE t.idempotency_key=$1`, [`settle:${order1}`])).rows[0].n;
    expect(escrow).toBe(2);                                                                   // the escrow txn itself is unchanged: escrow −90000 → seller +90000
    await asRelay(tenantA, (tx) => settle.handle(completed(order1, '90000', seller), tx));   // replay
    expect((await userBal(seller)) - before).toBe(100000n);
  }, 60000);

  it('A1 · a tenant that CANNOT fund it: the order is placed at FULL price with TENANT_FUNDS_UNAVAILABLE; nothing is reserved (a partly funded Main is untouched)', async () => {
    const pB = (await promotions.create(tenantB, mgr, `k-${randomUUID()}`, { promoType: 'discount', defaultName: 'Cumin 10%', rules: { discountType: 'percent', percentOff: 10 }, budgetMinor: '40000', ...window() } as never)).id;
    const codeB = `CUMIN${randomUUID().slice(0, 4).toUpperCase()}`;
    const cB = (await coupons.createCoupon(tenantB, mgr, `k-${randomUUID()}`, { promotionId: pB, code: codeB, perUserLimit: 5 } as never)).id;
    await fund(tenantB, 5000n);                                                               // half of what the discount needs
    const res = await placeOrder(tenantB, listingB, buyerB, codeB);
    expect(res.couponNotice).toEqual({ code: 'TENANT_FUNDS_UNAVAILABLE', outcome: 'tenant_funds_unavailable', messageKey: 'coupon.notice.tenant_funds_unavailable' });
    const oid = res.orders[0].id;
    expect((await admin.query(`SELECT discount_minor::text d, total_minor::text t FROM orders WHERE id=$1`, [oid])).rows[0]).toEqual({ d: '0', t: SUBTOTAL.toString() });
    expect(await tenantBal(tenantB, 'main')).toBe(5000n);
    expect(await tenantBal(tenantB, 'hold')).toBe(0n);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key=$1`, [`promo-hold:${oid}:${cB}`])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_entries e JOIN wallet_accounts wa ON wa.id=e.account_id WHERE wa.owner_tenant_id=$1 AND wa.account_code='hold'`, [tenantB])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1`, [cB])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT uses FROM coupons WHERE id=$1`, [cB])).rows[0].uses).toBe(0);
    expect(String((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [pB])).rows[0].spent_minor)).toBe('0');
    expect((await admin.query(`SELECT outcome::text o, amount_minor::text a FROM coupon_redemption_attempts WHERE order_id=$1`, [oid])).rows).toEqual([{ o: 'tenant_funds_unavailable', a: '10000' }]);
  }, 60000);

  it('F-21 · a spent budget is a KIND refusal — the order proceeds at full price, nothing aborts', async () => {
    const pTight = (await promotions.create(tenantA, mgr, `k-${randomUUID()}`, { promoType: 'discount', defaultName: 'Flat 100 on inputs', rules: { discountType: 'flat', amountOffMinor: '10000' }, budgetMinor: '15000', ...window() } as never)).id;
    const code = `FLAT${randomUUID().slice(0, 4).toUpperCase()}`;
    await coupons.createCoupon(tenantA, mgr, `k-${randomUUID()}`, { promotionId: pTight, code, perUserLimit: 1 } as never);
    const first = await placeOrder(tenantA, listingA, buyer2, code);
    expect(first.couponNotice).toBeUndefined();
    const second = await placeOrder(tenantA, listingA, buyer3, code);                           // 10000 + 10000 > 15000
    expect(second.couponNotice).toMatchObject({ code: 'BUDGET_EXHAUSTED', outcome: 'budget_exhausted', messageKey: 'coupon.notice.budget_exhausted' });
    expect(second.orders[0].totalMinor).toBe(SUBTOTAL.toString());
    expect(String((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [pTight])).rows[0].spent_minor)).toBe('10000');
    expect((await admin.query(`SELECT outcome::text o FROM coupon_redemption_attempts WHERE order_id=$1`, [second.orders[0].id])).rows).toEqual([{ o: 'budget_exhausted' }]);
  }, 60000);

  it('F-22 / A5 · preview = redeem on the per-user limit (buyer1 has used the coupon once; the limit is 1)', async () => {
    const preview = await coupons.validate(tenantA, buyer1, CODE, SUBTOTAL);
    expect(preview).toMatchObject({ applied: false, outcome: 'user_limit', discountMinor: '0' });
    await carts.addItem(tenantA, buyer1, { listingId: listingA, quantity: QTY } as never);
    const bill = await checkout.previewTotals(tenantA, buyer1, { couponCode: CODE } as never) as { discountMinor: string; sellers: Array<{ couponNotice?: { outcome: string } }> };
    expect(bill.discountMinor).toBe('0');
    expect(bill.sellers[0].couponNotice?.outcome).toBe('user_limit');
    const placed = await checkout.checkout(tenantA, buyer1, `idem-${randomUUID()}`, { couponCode: CODE } as never) as { couponNotice?: { outcome: string } };
    expect(placed.couponNotice?.outcome).toBe('user_limit');                                  // the redeem says what the preview said
    const stages = (await admin.query(`SELECT stage, outcome::text o FROM coupon_redemption_attempts WHERE coupon_id=$1 AND user_id=$2 AND outcome <> 'applied' ORDER BY created_at`, [couponId, buyer1])).rows;
    expect(stages.map((s) => s.o)).toEqual(['user_limit', 'user_limit', 'user_limit']);
    expect(stages.map((s) => s.stage)).toEqual(['preview', 'preview', 'redeem']);
  }, 60000);

  it('A3 · a CANCELLED order gives its reservation back: Hold → Main, released, use and spend returned; settlement then pays nothing', async () => {
    const mainBefore = await tenantBal(tenantA, 'main'); const holdBefore = await tenantBal(tenantA, 'hold');
    const spentBefore = BigInt((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [promoId])).rows[0].spent_minor);
    const usesBefore = (await admin.query(`SELECT uses FROM coupons WHERE id=$1`, [couponId])).rows[0].uses as number;
    const res = await placeOrder(tenantA, listingA, buyer4, CODE);
    const oid = res.orders[0].id;
    expect(await tenantBal(tenantA, 'main')).toBe(mainBefore - 10000n);
    const handler = new OrderClosedHandler('orders.order_cancelled', redemptionsSvc);
    const ev = { id: randomUUID(), tenantId: tenantA, aggregateType: 'order', aggregateId: oid, eventType: 'orders.order_cancelled', payload: { reasonId: null, by: buyer4, role: 'buyer' } } as never;
    await asRelay(tenantA, (tx) => handler.handle(ev, tx));
    expect(await tenantBal(tenantA, 'main')).toBe(mainBefore);
    expect(await tenantBal(tenantA, 'hold')).toBe(holdBefore);
    const red = (await admin.query(`SELECT released_txn_id, released_at, settled_txn_id FROM coupon_redemptions WHERE order_id=$1`, [oid])).rows[0];
    expect(red.released_txn_id).toBeTruthy(); expect(red.settled_txn_id).toBeNull();
    expect((await admin.query(`SELECT uses FROM coupons WHERE id=$1`, [couponId])).rows[0].uses).toBe(usesBefore);
    expect(BigInt((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [promoId])).rows[0].spent_minor)).toBe(spentBefore);
    await asRelay(tenantA, (tx) => handler.handle(ev, tx));                                   // replay: nothing moves twice
    expect(await tenantBal(tenantA, 'main')).toBe(mainBefore);
    const sellerBefore = await userBal(seller);
    await asRelay(tenantA, (tx) => settle.handle(completed(oid, '90000', seller), tx));      // a (wrong) settlement after cancel pays no top-up
    expect((await userBal(seller)) - sellerBefore).toBe(90000n);
    expect(await tenantBal(tenantA, 'hold')).toBe(holdBefore);
    expect(await coupons.validate(tenantA, buyer4, CODE, SUBTOTAL)).toMatchObject({ applied: true });   // a released use no longer counts
  }, 60000);

  it('F-17 · two rows in the SAME millisecond, page size 1: page two is the second row (coupons · promotions · redemptions panel)', async () => {
    const t = randomUUID(); await makeTenant(admin, t, 'C');
    const p = (await admin.query(`INSERT INTO promotions (tenant_id, promo_type, default_name, rules, budget_minor, starts_at, ends_at, created_at) VALUES
        ($1,'discount','P-early','{"discountType":"flat","amountOffMinor":"100"}',1000, now(), now() + interval '1 day', '2026-03-01 10:00:00.123111+00'),
        ($1,'discount','P-late','{"discountType":"flat","amountOffMinor":"100"}',1000, now(), now() + interval '1 day', '2026-03-01 10:00:00.123999+00') RETURNING id, default_name`, [t])).rows;
    const pLate = p.find((r) => r.default_name === 'P-late')!.id;
    await admin.query(`INSERT INTO coupons (tenant_id, promotion_id, code, created_at) VALUES ($1,$2,'EARLY1','2026-03-01 10:00:00.555111+00'),($1,$2,'LATE01','2026-03-01 10:00:00.555999+00')`, [t, pLate]);
    const c1 = await offers.coupons(t, { limit: 1 });
    expect(c1.items.map((x) => x.code)).toEqual(['LATE01']);
    const c2 = await offers.coupons(t, { cursor: decodeCursor(c1.nextCursor), limit: 1 });
    expect(c2.items.map((x) => x.code)).toEqual(['EARLY1']);                                 // a ms cursor skipped this row
    const p1 = await promotions.list(t, mgr, { limit: 1 });
    expect(p1.items.map((x) => x.defaultName)).toEqual(['P-late']); expect(p1.total).toBe(2);
    const p2 = await promotions.list(t, mgr, { cursor: decodeCursor(p1.nextCursor), limit: 1 });
    expect(p2.items.map((x) => x.defaultName)).toEqual(['P-early']);
    const cid = (await admin.query(`SELECT id FROM coupons WHERE tenant_id=$1 AND code='LATE01'`, [t])).rows[0].id;
    await admin.query(`INSERT INTO coupon_redemption_attempts (tenant_id, coupon_id, user_id, stage, outcome, amount_minor, created_at) VALUES
        ($1,$2,$3,'preview','user_limit',100,'2026-03-02 09:00:00.777111+00'),($1,$2,$3,'preview','window',100,'2026-03-02 09:00:00.777999+00')`, [t, cid, buyer1]);
    const r1 = await offers.couponRedemptions(t, cid, { limit: 1 });
    expect(r1.items.map((x) => x.outcome)).toEqual(['window']);
    const r2 = await offers.couponRedemptions(t, cid, { cursor: decodeCursor(r1.nextCursor), limit: 1 });
    expect(r2.items.map((x) => x.outcome)).toEqual(['user_limit']);
  }, 60000);

  it('W130 panel · applied rows say what happened to the money; the buyer is a MASKED phone and a place; declined rows carry the reason', async () => {
    const page = await offers.couponRedemptions(tenantA, couponId, { limit: 20 });
    const settled = page.items.find((x) => x.orderId === order1)!;
    expect(settled).toMatchObject({ outcome: 'applied', moneyState: 'settled', amountMinor: '10000', buyerPlace: 'Rajkot' });
    expect(settled.buyerPhoneMasked).toMatch(/^(\+\d+ )?\d{2}••• ••\d{3}$/);
    expect(settled.orderNo).toBeTruthy();
    expect(page.items.some((x) => x.outcome === 'applied' && x.moneyState === 'released')).toBe(true);
    expect(page.items.some((x) => x.outcome === 'user_limit')).toBe(true);
    const list = await offers.coupons(tenantA, { limit: 50 });
    const row = list.items.find((x) => x.id === couponId)!;
    expect(row).toMatchObject({ code: CODE, promotionName: 'Kharif input 10%', status: 'active', redeemedValueMinor: '10000', perUserLimit: 1, maxUses: 1000 });
    const sum = await offers.summary(tenantA);
    expect(BigInt(sum.spentYearMinor)).toBeGreaterThanOrEqual(20000n);                      // KHARIF 10000 (settled) + FLAT 10000 (reserved)
    expect(sum.couponOrders30d).toBeGreaterThanOrEqual(2);
    expect(sum.gmvToSpendTenths).not.toBeNull();
  }, 60000);

  it('A4 · kv_app on coupon_redemption_attempts: cross-tenant INSERT refused (RLS WITH CHECK); UPDATE / DELETE refused; the trigger refuses even the owner', async () => {
    const asApp = async (tenantId: string, sql: string, params: unknown[]) => {
      const c = await app.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]); const r = await c.query(sql, params); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    };
    expect(await sqlState(asApp(tenantA, `INSERT INTO coupon_redemption_attempts (tenant_id, coupon_id, user_id, stage, outcome) VALUES ($1, NULL, $2, 'preview', 'invalid')`, [tenantB, buyer1]))).toBe('42501');
    expect(await sqlState(asApp(tenantA, `INSERT INTO coupon_redemption_attempts (tenant_id, coupon_id, user_id, stage, outcome) VALUES ($1, NULL, $2, 'preview', 'invalid')`, [tenantA, buyer1]))).toBe('ok');
    expect(await sqlState(asApp(tenantA, `UPDATE coupon_redemption_attempts SET outcome='applied' WHERE tenant_id=$1`, [tenantA]))).toBe('42501');
    expect(await sqlState(asApp(tenantA, `DELETE FROM coupon_redemption_attempts WHERE tenant_id=$1`, [tenantA]))).toBe('42501');
    const seenByB = await asApp(tenantB, `SELECT count(*)::int n FROM coupon_redemption_attempts WHERE tenant_id=$1`, [tenantA]);
    expect(seenByB.rows[0].n).toBe(0);
    // the OWNER is refused by the trigger (Law 2 holds whoever asks)
    const ownerUpdate = await admin.query(`UPDATE coupon_redemption_attempts SET outcome='applied' WHERE tenant_id=$1`, [tenantA]).then(() => 'ok', (e: Error & { code?: string }) => `${e.code}:${/append-only/.test(e.message)}`);
    expect(ownerUpdate).toBe('42501:true');
    const ownerDelete = await admin.query(`DELETE FROM coupon_redemption_attempts WHERE tenant_id=$1`, [tenantA]).then(() => 'ok', (e: Error & { code?: string }) => `${e.code}:${/append-only/.test(e.message)}`);
    expect(ownerDelete).toBe('42501:true');
    // coupon_redemptions: the money columns are frozen by trigger; kv_relay may not touch them at all
    expect(await sqlState(admin.query(`UPDATE coupon_redemptions SET amount_minor = amount_minor + 1 WHERE order_id=$1`, [order1]))).toBe('23514');
    expect(await sqlState(admin.query(`UPDATE coupon_redemptions SET settled_txn_id = gen_random_uuid() WHERE order_id=$1`, [order1]))).toBe('23514');   // a settlement is final
    expect(await sqlState(admin.query(`DELETE FROM coupon_redemptions WHERE order_id=$1`, [order1]))).toBe('42501');
    expect(await sqlState(asRelay(tenantA, (tx) => tx.query(`UPDATE coupon_redemptions SET amount_minor = 1 WHERE order_id=$1`, [order1])))).toBe('42501');
  }, 60000);

  it('F-29 · the order-created backstop run with the relay\'s transaction AS kv_relay no longer dies 42501 (and records nothing twice)', async () => {
    const handler = new OrderCreatedHandler(redemptionsSvc);
    const before = (await admin.query(`SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1`, [couponId])).rows[0].n;
    await asRelay(tenantA, (tx) => handler.handle({ id: randomUUID(), tenantId: tenantA, aggregateType: 'order', aggregateId: order1, eventType: 'orders.order_created',
      payload: { orderId: order1, couponCode: CODE, buyerUserId: buyer1, discountMinor: '10000' } } as never, tx));
    expect((await admin.query(`SELECT count(*)::int n FROM coupon_redemptions WHERE coupon_id=$1`, [couponId])).rows[0].n).toBe(before);
    // and the relay role really cannot write that table (the reason the handler no longer uses the relay's tx)
    expect(await sqlState(asRelay(tenantA, (tx) => tx.query(`INSERT INTO coupon_redemptions (coupon_id, tenant_id, user_id, order_id, amount_minor) VALUES ($1,$2,$3,$4,1)`, [couponId, tenantA, buyer1, uuidv7()])))).toBe('42501');
  }, 60000);

  it('B4 / F-10 · the festival scheduler opens a system-closed festival in its window and NEVER re-opens a human pause; the budget watch closes a spent one (reads exhausted)', async () => {
    const mk = async (name: string) => (await promotions.create(tenantA, mgr, `k-${randomUUID()}`, { promoType: 'festival', defaultName: name, rules: { discountType: 'flat', amountOffMinor: '500' }, budgetMinor: '5000', ...window() } as never)).id;
    const sysClosed = await mk('Ghee festival (system closed)');
    const humanPaused = await mk('Ghee festival (paused by a person)');
    await admin.query(`UPDATE promotions SET is_active=false WHERE id=$1`, [sysClosed]);
    await promotions.setActive(tenantA, mgr, humanPaused, false, 'stock of ghee ran out at the BMC', null);
    const job = new FestivalCampaignSchedulerJob(admin, promoRepo, promotions);
    await job.run(); await job.run();                                                          // idempotent: a second sweep changes nothing
    const state = async (id: string) => (await admin.query(`SELECT is_active, paused_at, paused_by_user_id FROM promotions WHERE id=$1`, [id])).rows[0];
    expect((await state(sysClosed)).is_active).toBe(true);
    expect(await state(humanPaused)).toMatchObject({ is_active: false, paused_by_user_id: mgrUser });
    expect((await promotions.getById(tenantA, mgr, humanPaused)).status).toBe('paused');
    const audit = (await admin.query(`SELECT reason, old_value, new_value FROM audit_log WHERE action='promotion.paused' AND entity_id=$1`, [humanPaused])).rows[0];
    expect(audit).toMatchObject({ reason: 'stock of ghee ran out at the BMC', old_value: { status: 'active' }, new_value: { status: 'paused' } });
    // the budget watch: a spent, still-active promotion is closed — and reads `exhausted`, never `paused`
    await admin.query(`UPDATE promotions SET spent_minor = budget_minor WHERE id=$1`, [sysClosed]);
    await new PromoBudgetWatchJob(admin, promoRepo, promotions).run();
    expect((await state(sysClosed)).is_active).toBe(false);
    expect((await promotions.getById(tenantA, mgr, sysClosed)).status).toBe('exhausted');
  }, 60000);
});
