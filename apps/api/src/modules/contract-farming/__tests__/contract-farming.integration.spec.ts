// modules/contract-farming/__tests__/contract-farming.integration.spec.ts
// REAL end-to-end proof of the contract-farming spine against a live Postgres:
//   1. a buyer creates a FIXED-price contract (₹500/qtl), proposes → signs → activates it;
//   2. enrols a grower; DISBURSES a ₹2,000 input advance (buyer → grower wallet);
//   3. SETTLES the grower for 10 qtl delivered (gross ₹5,000): the advance is recovered and the ₹3,000 net
//      is paid buyer → grower (zero-sum); the advance shows fully recovered;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's contract.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makeProduct, makeCategory, ensureUnitCurrency } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { QuotaService } from '../../../core/quota/quota.service';

import { ContractTemplateRepository } from '../repositories/contract-template.repository';
import { FarmingContractRepository } from '../repositories/farming-contract.repository';
import { ContractGrowerRepository } from '../repositories/contract-grower.repository';
import { ContractMilestoneRepository } from '../repositories/contract-milestone.repository';
import { InputAdvanceRepository } from '../repositories/input-advance.repository';
import { FarmingContractService } from '../services/farming-contract.service';
import { ContractGrowerService } from '../services/contract-grower.service';
import { InputAdvanceService } from '../services/input-advance.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

run('contract-farming spine (integration, real Postgres + RLS + advance/settlement)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let contracts: FarmingContractService; let growers: ContractGrowerService; let advances: InputAdvanceService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const buyer = randomUUID(); const farmer = randomUUID();
  let productId = ''; let contractId = ''; let growerId = '';
  const buyerActor = { userId: buyer, canManage: true, isAdmin: false };

  const bal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, farmer);
    await ensureUnitCurrency(admin, 'quintal');
    productId = await makeProduct(admin, { categoryId: await makeCategory(admin), tenantId: tenantA, unit: 'quintal' });

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const cRepo = new FarmingContractRepository(replica as any); const gRepo = new ContractGrowerRepository(replica as any); const aRepo = new InputAdvanceRepository(replica as any);
    void new ContractTemplateRepository(replica as any); void new ContractMilestoneRepository(replica as any);
    contracts = new FarmingContractService(uow, outbox, idem, new AllowAllQuota(), metrics, audit, wallet, cRepo, gRepo, aRepo);
    growers = new ContractGrowerService(uow, outbox, idem, metrics, gRepo, cRepo);
    advances = new InputAdvanceService(uow, outbox, idem, metrics, audit, wallet, aRepo, cRepo, gRepo);

    await fund(buyer, 10_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('buyer creates a fixed-price contract → propose → sign → activate', async () => {
    contractId = (await contracts.create(tenantA, buyerActor, `idem-${randomUUID()}`, { contractKind: 'forward', productId, totalQuantity: '100.000', unitCode: 'quintal', priceModel: 'fixed', priceTerms: { fixed_minor: '50000' }, qualitySpec: {}, season: 'rabi-2026' } as any)).id;
    await contracts.propose(tenantA, buyerActor, contractId);
    await contracts.sign(tenantA, buyerActor, contractId);
    expect((await contracts.activate(tenantA, buyerActor, contractId)).status).toBe('active');
  });

  it('enrols a grower + disburses a ₹2,000 advance (buyer → grower wallet)', async () => {
    growerId = (await growers.enrol(tenantA, buyerActor, contractId, `idem-${randomUUID()}`, { farmerUserId: farmer, committedQuantity: '10.000' } as any)).id;
    const gBefore = await bal(farmer); const bBefore = await bal(buyer);
    const adv = await advances.disburse(tenantA, buyerActor, contractId, `idem-${randomUUID()}`, { growerId, valueMinor: '200000', description: 'Seed + fertiliser' } as any, null);   // TENANT-2a sweep: disburse gained the audit ip param
    expect(adv.valueMinor).toBe('200000');
    expect((await bal(farmer)) - gBefore).toBe(200000n);   // grower funded
    expect(bBefore - (await bal(buyer))).toBe(200000n);    // buyer debited
  });

  it('SETTLES the grower (10 qtl × ₹500 = ₹5,000): recover ₹2,000, pay net ₹3,000 (zero-sum)', async () => {
    const gBefore = await bal(farmer); const bBefore = await bal(buyer);
    const res = await contracts.settleGrower(tenantA, buyerActor, contractId, `idem-${randomUUID()}`, { growerId, deliveredQuantity: '10.000' } as any, null);
    expect(res.grossMinor).toBe('500000'); expect(res.recoveredMinor).toBe('200000'); expect(res.netMinor).toBe('300000');
    expect((await bal(farmer)) - gBefore).toBe(300000n);   // grower receives the net
    expect(bBefore - (await bal(buyer))).toBe(300000n);    // buyer pays the net
    // the advance is now fully recovered
    const advs = await advances.list(tenantA, buyerActor, contractId, growerId);
    expect(advs[0].recoveredMinor).toBe('200000'); expect(advs[0].outstandingMinor).toBe('0');
  });

  it('RLS: tenant B cannot see tenant A\'s contract', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM farming_contracts WHERE id=$1`, [contractId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM farming_contracts WHERE id=$1`, [contractId])).rows.length).toBe(1);
  });
});
