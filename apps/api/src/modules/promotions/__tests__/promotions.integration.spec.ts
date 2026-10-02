// modules/promotions/__tests__/promotions.integration.spec.ts
// REAL end-to-end proof of the coupon engine against a live Postgres:
//   1. an admin creates a budgeted promotion (10% off, ₹150 budget) + a coupon (maxUses 2, perUser 1);
//   2. validate() previews the discount; redeem() applies it (records the append-only redemption,
//      increments uses + spent) — idempotent per (coupon, order);
//   3. the per-user cap and the promotion BUDGET both fail CLOSED (no oversell), under row locks — and since PC-56
//      TENANT-10b they DECLINE (an outcome with a kind notice) instead of throwing, and the discount is RESERVED from the
//      tenant's wallet (the tenant's Main is funded first, as a cooperative's would be);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's promotion.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { PromotionRepository } from '../repositories/promotion.repository';
import { CouponRepository } from '../repositories/coupon.repository';
import { CouponRedemptionRepository } from '../repositories/coupon-redemption.repository';
import { PromotionService } from '../services/promotion.service';
import { CouponService } from '../services/coupon.service';
import { DuplicateRedemptionError } from '../domain/promotions.errors';
import { CouponAttemptRepository } from '../repositories/coupon-attempt.repository';
import { CouponMoneyService } from '../services/coupon-money.service';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { platform, PlatformAccount } from '../../../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('promotions slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let promotions: PromotionService; let coupons: CouponService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminUser = randomUUID();
  const buyer1 = randomUUID();
  const buyer2 = randomUUID();
  const mgr = () => ({ userId: adminUser, canManage: true });
  let promotionId = '';
  const CODE = 'DIWALI10';
  const SUBTOTAL = 100000n;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, adminUser); await makeUser(admin, buyer1); await makeUser(admin, buyer2);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const promoRepo = new PromotionRepository(replica as any);
    const couponRepo = new CouponRepository(replica as any);
    const redemptionRepo = new CouponRedemptionRepository(replica as any);
    promotions = new PromotionService(uow, outbox, idem, metrics, audit, promoRepo);
    const wallet = new InProcessWalletClient(new LedgerRepository());
    coupons = new CouponService(uow, outbox, idem, metrics, audit, promoRepo, couponRepo, redemptionRepo, new CouponAttemptRepository(), new CouponMoneyService(wallet, redemptionRepo));
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'billing_adjustment', idempotencyKey: `fund-${randomUUID()}`,
      legs: [{ account: platform(PlatformAccount.Suspense), amountMinor: -1000000n }, { account: { kind: 'tenant', tenantId: tenantA, accountCode: 'main', currencyCode: 'INR' }, amountMinor: 1000000n }] }), { userId: 'system' });

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('admin creates a budgeted promotion + coupon; validate previews the discount', async () => {
    const now = Date.now();
    const p = await promotions.create(tenantA, mgr(), `idem-${randomUUID()}`, {
      promoType: 'festival', defaultName: 'Diwali 10%', rules: { discountType: 'percent', percentOff: 10 },
      budgetMinor: '15000', startsAt: new Date(now - 3600_000).toISOString(), endsAt: new Date(now + 7 * 86400_000).toISOString(),
    } as any);
    promotionId = p.id; expect(p.status).toBe('active');
    await coupons.createCoupon(tenantA, mgr(), `idem-${randomUUID()}`, { promotionId, code: CODE, maxUses: 2, perUserLimit: 1 } as any);
    const v = await coupons.validate(tenantA, buyer1, CODE, SUBTOTAL);
    expect(v).toMatchObject({ applied: true, discountMinor: '10000' });   // 10% of 100000
  });

  it('redeem applies the discount, records the redemption, increments uses + spent (idempotent per order)', async () => {
    const order1 = randomUUID();
    const r = await coupons.redeem(tenantA, buyer1, `idem-${randomUUID()}`, { code: CODE, orderId: order1, subtotalMinor: SUBTOTAL });
    expect(r).toMatchObject({ applied: true, discountMinor: '10000' });
    const c = await admin.query(`SELECT uses FROM coupons WHERE tenant_id=$1 AND code=$2`, [tenantA, CODE]);
    expect(c.rows[0].uses).toBe(1);
    const pr = await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [promotionId]);
    expect(String(pr.rows[0].spent_minor)).toBe('10000');
    expect((await admin.query(`SELECT count(*)::int n FROM coupon_redemptions WHERE tenant_id=$1 AND order_id=$2`, [tenantA, order1])).rows[0].n).toBe(1);

    // DB-level idempotency: same coupon+order via a NEW idem key → DuplicateRedemptionError (no double-spend)
    await expect(coupons.redeem(tenantA, buyer1, `idem-${randomUUID()}`, { code: CODE, orderId: order1, subtotalMinor: SUBTOTAL })).rejects.toBeInstanceOf(DuplicateRedemptionError);
    expect((await admin.query(`SELECT uses FROM coupons WHERE tenant_id=$1 AND code=$2`, [tenantA, CODE])).rows[0].uses).toBe(1);
  });

  it('per-user cap and promotion budget both fail closed — as a DECLINE with a kind notice, never an abort', async () => {
    // buyer1 already redeemed once; perUserLimit=1 → a second (different order) is declined
    const u = await coupons.redeem(tenantA, buyer1, `idem-${randomUUID()}`, { code: CODE, orderId: randomUUID(), subtotalMinor: SUBTOTAL });
    expect(u).toMatchObject({ applied: false, outcome: 'user_limit', notice: { messageKey: 'coupon.notice.user_limit' } });
    // buyer2 is fresh, but the budget (15000) only had 5000 left after buyer1's 10000 → 10000 discount exceeds it
    const b = await coupons.redeem(tenantA, buyer2, `idem-${randomUUID()}`, { code: CODE, orderId: randomUUID(), subtotalMinor: SUBTOTAL });
    expect(b).toMatchObject({ applied: false, outcome: 'budget_exhausted' });
    // nothing persisted by the declined attempts (but each attempt is recorded)
    expect((await admin.query(`SELECT uses FROM coupons WHERE tenant_id=$1 AND code=$2`, [tenantA, CODE])).rows[0].uses).toBe(1);
    expect(String((await admin.query(`SELECT spent_minor FROM promotions WHERE id=$1`, [promotionId])).rows[0].spent_minor)).toBe('10000');
    expect((await admin.query(`SELECT outcome::text o FROM coupon_redemption_attempts WHERE tenant_id=$1 AND stage='redeem' AND outcome <> 'applied' ORDER BY created_at`, [tenantA])).rows.map((x) => x.o)).toEqual(['user_limit', 'budget_exhausted']);
  });

  it('RLS: tenant B cannot see tenant A\'s promotion', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM promotions WHERE id=$1`, [promotionId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[promotions] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
