// modules/ambassadors/__tests__/ambassadors.integration.spec.ts
// REAL end-to-end proof of the ambassador spine against a live Postgres (with the seeded commission plans 0207):
//   1. admin enrolls an ambassador; the ambassador mints a referral code; a new farmer claims it;
//   2. admin activates the referral → an onboarding commission accrues (₹25 farmer_onboarded);
//   3. payout settles the unpaid earnings → a ZERO-SUM 'commission' transfer credits the ambassador's wallet;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's earnings.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { CommissionPlanRepository } from '../repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { ReferralRepository } from '../repositories/referral.repository';
import { AmbassadorProfileService } from '../services/ambassador-profile.service';
import { ReferralService } from '../services/referral.service';
import { AmbassadorEarningService } from '../services/ambassador-earning.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('ambassadors spine (integration, real Postgres + RLS + commission payout)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let profiles: AmbassadorProfileService; let referrals: ReferralService; let earnings: AmbassadorEarningService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const ambUser = randomUUID(); const adminUser = randomUUID(); const farmer = randomUUID();
  let ambassadorId = ''; let referralId = '';
  const adminActor = { userId: adminUser, canManage: true };
  const ambActor = { userId: ambUser, canManage: false };
  const farmerActor = { userId: farmer, canManage: false };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, ambUser); await makeUser(admin, adminUser); await makeUser(admin, farmer);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const pRepo = new AmbassadorProfileRepository(replica as any); const plRepo = new CommissionPlanRepository(replica as any);
    const eRepo = new AmbassadorEarningRepository(replica as any); const rRepo = new ReferralRepository(replica as any);
    profiles = new AmbassadorProfileService(uow, outbox, metrics, audit, pRepo);
    earnings = new AmbassadorEarningService(uow, outbox, idem, metrics, wallet, plRepo, eRepo, pRepo);
    referrals = new ReferralService(uow, outbox, idem, metrics, rRepo, pRepo, earnings);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('admin enrolls an ambassador; ambassador mints a code; farmer claims it', async () => {
    ambassadorId = (await profiles.enroll(tenantA, adminActor, { userId: ambUser, clusterRegionIds: [], kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: '0' } as any, null)).id;
    const r: any = await referrals.create(tenantA, ambActor, `idem-${randomUUID()}`, { code: 'KRISHI10' } as any);
    referralId = r.id; expect(r.status).toBe('invited');
    expect((await referrals.claim(tenantA, farmerActor, { code: 'KRISHI10' } as any)).status).toBe('signed_up');
  });

  it('activation accrues the ₹25 farmer_onboarded commission (seeded plan)', async () => {
    await referrals.activate(tenantA, adminActor, referralId);
    const { items } = await earnings.listForAmbassador(tenantA, ambassadorId, { limit: 50 });
    const onboard = items.find((e: any) => e.eventCode === 'farmer_onboarded');
    expect(onboard).toBeTruthy(); expect(onboard!.amountMinor).toBe('2500');   // ₹25 from seed 0207
  });

  it('payout settles unpaid earnings to the ambassador wallet (zero-sum commission)', async () => {
    const before = await balUser(ambUser);
    const out: any = await earnings.payoutAmbassador(tenantA, ambassadorId, `idem-${randomUUID()}`);
    expect(out.paidMinor).toBe('2500');
    expect((await balUser(ambUser)) - before).toBe(2500n);
    // re-payout now finds nothing unpaid
    await expect(earnings.payoutAmbassador(tenantA, ambassadorId, `idem-${randomUUID()}`)).rejects.toMatchObject({ code: 'NOTHING_TO_PAYOUT' });
  });

  it('RLS: tenant B cannot see tenant A\'s earnings', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM ambassador_earnings WHERE ambassador_id=$1`, [ambassadorId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM ambassador_earnings WHERE ambassador_id=$1`, [ambassadorId])).rows.length).toBeGreaterThan(0);
  });
});
