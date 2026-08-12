// modules/payments/__tests__/buyer-charges.integration.spec.ts
// REAL proof of the buyer-charge engine + correct settlement routing, against a live Postgres:
//   1. the charge engine resolves the seeded charge_definitions (delivery slab + 2.5% platform fee)
//      and computes the right fees on a subtotal;
//   2. at settlement the buyer charges are routed to the PLATFORM (fees account) and EXCLUDED from
//      the seller's settleable gross — the seller never pockets delivery/platform fees — and the
//      whole transaction stays ZERO-SUM.
// Schema/seeds (incl. rules/0204 charge_definitions) come from the REAL db/migrations + db/seeds.
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
import { TxContext } from '../../../core/database/unit-of-work';

import { ChargeDefinitionRepository } from '../repositories/charge-definition.repository';
import { ChargePricingService } from '../services/charge-pricing.service';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { SettlementPricingService } from '../services/settlement-pricing.service';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('buyer charges + settlement routing (integration, real Postgres)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let uow: PgUnitOfWork;
  let wallet: InProcessWalletClient;
  let charges: ChargePricingService;
  let handler: OrderCompletedHandler;

  const tenantA = randomUUID();
  const seller = randomUUID();
  const SUBTOTAL = 1_000_000n;     // ₹10,000 (above the delivery free threshold)
  const PLATFORM_FEE = 25_000n;    // 2.5% of subtotal (seeded buyer_platform_fee)
  const TOTAL = SUBTOTAL + PLATFORM_FEE;

  const bal = async (kind: string, code: string, owner?: string) =>
    BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind=$1 AND account_code=$2 AND (($3::uuid IS NULL) OR owner_user_id=$3)`, [kind, code, owner ?? null])).rows[0]?.b ?? '0');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeUser(admin, seller);
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=100 WHERE key='commission_split'`);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    wallet = new InProcessWalletClient(new LedgerRepository());
    charges = new ChargePricingService(new ChargeDefinitionRepository(replica as any));
    const pricing = new SettlementPricingService(new CommissionRuleRepository(replica as any), new TaxRuleRepository(replica as any));
    handler = new OrderCompletedHandler(wallet, new FlagsService(pools, new InMemoryCacheService()), pricing, new SettlementLineRepository());
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('resolves seeded charge definitions (free delivery above threshold; 2.5% platform fee)', async () => {
    const c = await uow.run(tenantA, async (tx: TxContext) => charges.checkoutCharges(tx, tenantA, SUBTOTAL), { userId: 'system' });
    expect(c.deliveryFeeMinor).toBe(0n);             // subtotal > ₹399 → free delivery
    expect(c.platformFeeMinor).toBe(PLATFORM_FEE);   // 2.5%
    // a small order pays delivery
    const small = await uow.run(tenantA, async (tx: TxContext) => charges.checkoutCharges(tx, tenantA, 20_000n), { userId: 'system' });
    expect(small.deliveryFeeMinor).toBe(3900n);
  });

  it('settlement routes buyer charges to the platform; seller settles only the goods value (zero-sum)', async () => {
    // fund escrow with the full amount the buyer paid (subtotal + platform fee)
    await uow.run(tenantA, async (tx) => {
      await wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
        legs: [ { account: platform(PlatformAccount.Escrow), amountMinor: TOTAL }, { account: platform(PlatformAccount.Gateway), amountMinor: -TOTAL } ] });
    }, { userId: 'system' });

    const order = randomUUID();
    await uow.run(tenantA, async (tx) => handler.handle({ id: '1', tenantId: tenantA, aggregateType: 'order', aggregateId: order, eventType: 'orders.order_completed',
      payload: { sellerUserId: seller, totalMinor: TOTAL.toString(), deliveryFeeMinor: '0', platformFeeMinor: PLATFORM_FEE.toString(), source: 'direct', currencyCode: 'INR' } }, tx), { userId: 'system' });

    // commission on settleable 1,000,000 @3.5%: commission 35,000 (share 3,500), gst 1,750, tds 10,000, sellerNet 953,250
    expect(await bal('user', 'main', seller)).toBe(953_250n);     // seller does NOT get the platform fee
    expect(await bal('platform', PlatformAccount.Fees)).toBe(PLATFORM_FEE + 3_500n);   // buyer charge + commission share
    // the settlement line records the GOODS value, not the buyer-charge-inflated total
    const line = await admin.query(`SELECT gross_minor, net_minor FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [tenantA, order]);
    expect(String(line.rows[0].gross_minor)).toBe('1000000');
    expect(String(line.rows[0].net_minor)).toBe('953250');
    // zero-sum
    const sum = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM ledger_entries WHERE txn_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)`, [`settle:${order}`]);
    expect(sum.rows[0].s).toBe('0');
  });
});
