// modules/payments/__tests__/commission-settlement.integration.spec.ts
// REAL proof of the commission/tax engine at settlement, against a live Postgres:
//   1. with commission_split ON, completing an order splits the held escrow into seller-net +
//      tenant commission + platform fees + GST(gst_payable) + 194-O TDS(tds_payable) — ZERO-SUM;
//   2. rule resolution honours a TENANT-SPECIFIC override (higher commission) over the platform
//      default, and isolates it: another tenant still gets the platform-default rate;
//   3. the seeded platform-default (3.5% / 5% GST / 1% TDS) drives tenant B's split.
// Commission rules are tenant-scoped (RLS: own OR platform-default NULL); the engine runs in the
// settlement tx. Schema/seeds from the REAL db/migrations + db/seeds.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { platform, PlatformAccount } from '../../../core/wallet/account-codes';

import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { SettlementPricingService } from '../services/settlement-pricing.service';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('commission/tax settlement (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let uow: PgUnitOfWork;
  let wallet: InProcessWalletClient;
  let handler: OrderCompletedHandler;

  const tenantA = randomUUID();   // gets a tenant-specific 10% override
  const tenantB = randomUUID();   // platform default (3.5%)
  const sellerA = randomUUID();
  const sellerB = randomUUID();
  const GROSS = 1_000_000n;       // ₹10,000

  const bal = async (kind: string, code: string, owner?: string) =>
    BigInt((await admin.query(
      `SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind=$1 AND account_code=$2 AND (($3::uuid IS NULL) OR owner_user_id=$3 OR owner_tenant_id=$3)`,
      [kind, code, owner ?? null])).rows[0]?.b ?? '0');

  const fundEscrow = async (tenantId: string, amount: bigint) => {
    await uow.run(tenantId, async (tx) => {
      await wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
        legs: [ { account: platform(PlatformAccount.Escrow), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount } ] });
    }, { userId: 'system' });
  };
  const settle = async (tenantId: string, sellerUserId: string, orderId: string) =>
    uow.run(tenantId, async (tx) => handler.handle({ id: '1', tenantId, aggregateType: 'order', aggregateId: orderId, eventType: 'orders.order_completed', payload: { sellerUserId, totalMinor: GROSS.toString(), currencyCode: 'INR', source: 'direct' } }, tx), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, sellerA); await makeUser(admin, sellerB);
    // commission_split ON for the test DB; tenant-A override = 10% commission (KV 10% share)
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=100 WHERE key='commission_split'`);
    await admin.query(
      `INSERT INTO commission_rules (tenant_id, category_id, source, seller_role_id, rate_bps, fixed_minor, cap_minor, platform_share_bps, charged_to, priority, effective_from, is_active)
       VALUES ($1, NULL, 'direct', NULL, 1000, 0, NULL, 1000, 'seller', 50, CURRENT_DATE, true)`, [tenantA]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const flags = new FlagsService(pools, new InMemoryCacheService());
    const pricing = new SettlementPricingService(new CommissionRuleRepository(replica as any), new TaxRuleRepository(replica as any));
    handler = new OrderCompletedHandler(wallet, flags, pricing, new SettlementLineRepository());
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('tenant A (10% override): escrow splits zero-sum into seller/commission/fees/GST/TDS', async () => {
    await fundEscrow(tenantA, GROSS);
    const order = randomUUID();
    await settle(tenantA, sellerA, order);

    // commission 100,000 (10%); platform share 10,000; tenant commission 90,000; GST 5,000; TDS 10,000
    expect(await bal('user', 'main', sellerA)).toBe(885_000n);          // residual seller net
    expect(await bal('tenant', 'commission', tenantA)).toBe(90_000n);
    expect(await bal('platform', PlatformAccount.Fees)).toBe(10_000n);
    expect(await bal('platform', PlatformAccount.GstPayable)).toBe(5_000n);
    expect(await bal('platform', PlatformAccount.TdsPayable)).toBe(10_000n);

    // the settlement transaction is zero-sum
    const sum = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM ledger_entries WHERE txn_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)`, [`settle:${order}`]);
    expect(sum.rows[0].s).toBe('0');
  });

  it('tenant B (platform default 3.5%): different split — rule resolution is tenant-isolated', async () => {
    await fundEscrow(tenantB, GROSS);
    const order = randomUUID();
    await settle(tenantB, sellerB, order);
    // commission 35,000 (3.5%); tenant commission 31,500; seller net 953,250 — proves A's override didn't leak
    expect(await bal('user', 'main', sellerB)).toBe(953_250n);
    expect(await bal('tenant', 'commission', tenantB)).toBe(31_500n);
  });

  it('settlement is idempotent — re-completing does not double-split', async () => {
    await fundEscrow(tenantB, GROSS);
    const order = randomUUID();
    await settle(tenantB, sellerB, order);
    const after1 = await bal('user', 'main', sellerB);
    await settle(tenantB, sellerB, order);              // replay same orderId
    expect(await bal('user', 'main', sellerB)).toBe(after1);   // unchanged — settled once
  });
});
