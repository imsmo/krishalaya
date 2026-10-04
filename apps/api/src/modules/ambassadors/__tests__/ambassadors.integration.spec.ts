// modules/ambassadors/__tests__/ambassadors.integration.spec.ts
// REAL end-to-end proof of the ambassador spine against a live Postgres (with the seeded commission plans 0207):
//   1. admin enrolls an ambassador; the ambassador mints a referral code; a new farmer claims it;
//   2. admin activates the referral → an onboarding commission accrues (₹25 farmer_onboarded);
//   3. payout settles the unpaid earnings → PC-56 TENANT-SW-b: an exception run, a second tenant_admin confirms, a ZERO-SUM 'ambassador_run'
//      transfer tenant Main → ambassador credits the ambassador's wallet;
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
import { AmbassadorRosterReadModel } from '../read-models/ambassador-roster.read-model';
import { AmbassadorProfileService } from '../services/ambassador-profile.service';
import { ReferralService } from '../services/referral.service';
import { AmbassadorEarningService } from '../services/ambassador-earning.service';
import { PayoutRunService } from '../services/payout-run.service';
import { PayoutRunRepository } from '../repositories/payout-run.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('ambassadors spine (integration, real Postgres + RLS + commission payout)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let profiles: AmbassadorProfileService; let referrals: ReferralService; let earnings: AmbassadorEarningService; let runs: PayoutRunService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const ambUser = randomUUID(); const adminUser = randomUUID(); const farmer = randomUUID(); const checkerUser = randomUUID();
  let ambassadorId = ''; let referralId = '';
  const adminActor = { userId: adminUser, canManage: true };
  const ambActor = { userId: ambUser, canManage: false };
  const farmerActor = { userId: farmer, canManage: false };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, ambUser); await makeUser(admin, adminUser); await makeUser(admin, farmer); await makeUser(admin, checkerUser);
    // PC-56 TENANT-10a: a recruit must be an existing MEMBER of the cooperative (an active role in tenant A).
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'farmer' ON CONFLICT DO NOTHING`, [ambUser, tenantA]);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const pRepo = new AmbassadorProfileRepository(replica as any); const plRepo = new CommissionPlanRepository(replica as any);
    const eRepo = new AmbassadorEarningRepository(replica as any); const rRepo = new ReferralRepository(replica as any);
    profiles = new AmbassadorProfileService(uow, outbox, metrics, idem, audit, pRepo, new AmbassadorRosterReadModel(replica as any));
    earnings = new AmbassadorEarningService(uow, outbox, idem, metrics, wallet, audit, plRepo, eRepo, pRepo);
    runs = new PayoutRunService(uow, outbox, idem, metrics, wallet, audit, new PayoutRunRepository(replica as any), eRepo, pRepo);
    referrals = new ReferralService(uow, outbox, idem, metrics, audit, rRepo, pRepo, earnings);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('admin enrolls an ambassador; ambassador mints a code; farmer claims it', async () => {
    ambassadorId = (await profiles.enroll(tenantA, adminActor, { userId: ambUser, clusterRegionIds: [], kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: '0' }, `idem-${randomUUID()}`, null)).id;
    const r: any = await referrals.create(tenantA, ambActor, `idem-${randomUUID()}`, { code: 'KRISHI10' } as any);
    referralId = r.id; expect(r.status).toBe('invited');
    expect((await referrals.claim(tenantA, farmerActor, { code: 'KRISHI10' } as any)).status).toBe('signed_up');
  });

  it('activation accrues the ₹25 farmer_onboarded commission (seeded plan)', async () => {
    await referrals.activate(tenantA, adminActor, referralId, 'first sale confirmed');
    const { items } = await earnings.listForAmbassador(tenantA, ambassadorId, { limit: 50 });
    const onboard = items.find((e: any) => e.eventCode === 'farmer_onboarded');
    expect(onboard).toBeTruthy(); expect(onboard!.amountMinor).toBe('2500');   // ₹25 from seed 0207
  });

  // PC-56 TENANT-SW-b: the payout is an EXCEPTION RUN now — prepared by one person, confirmed by a DIFFERENT tenant_admin, paid from the
  // TENANT Main wallet (the tenant is funded first; the platform Fees account no longer pays).
  it('payout settles unpaid earnings to the ambassador wallet (zero-sum, tenant Main → ambassador, maker-checker)', async () => {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT u, $2, r.id, true FROM roles r, unnest($1::uuid[]) u WHERE r.code='tenant_admin' ON CONFLICT DO NOTHING`, [[adminUser, checkerUser], tenantA]);
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund-tenant:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: { kind: 'tenant', tenantId: tenantA, accountCode: 'main' }, amountMinor: 10000n }, { account: { kind: 'platform', accountCode: 'gateway' }, amountMinor: -10000n }] }), { userId: 'system' });
    const before = await balUser(ambUser);
    const prepared: any = await runs.prepareByPerson(tenantA, { userId: adminUser }, { kind: 'exception', ambassadorId, reason: 'weekly run' }, `idem-${randomUUID()}`);
    const out: any = await runs.confirm(tenantA, { userId: checkerUser }, prepared.id, 'weekly run checked', `idem-${randomUUID()}`);
    expect(out).toMatchObject({ paid: 1, paidMinor: '2500', status: 'paid' });
    expect((await balUser(ambUser)) - before).toBe(2500n);
    // a second exception run now finds nothing owed (red at 9743e8b: DEV-55 stamped zero rows and this second call paid again)
    await expect(runs.prepareByPerson(tenantA, { userId: adminUser }, { kind: 'exception', ambassadorId, reason: 'weekly run' }, `idem-${randomUUID()}`)).rejects.toMatchObject({ code: 'AMB_RUN_NOTHING_OWED' });
  });

  it('RLS: tenant B cannot see tenant A\'s earnings', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM ambassador_earnings WHERE ambassador_id=$1`, [ambassadorId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM ambassador_earnings WHERE ambassador_id=$1`, [ambassadorId])).rows.length).toBeGreaterThan(0);
  });
});
