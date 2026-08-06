// modules/schemes/__tests__/schemes.integration.spec.ts
// REAL end-to-end proof of the schemes spine against a live Postgres:
//   1. eligibility check against the seeded PM-KISAN rules (eligible farmer, ineligible large-holding);
//   2. apply to the seeded SMAM scheme (₹50 processing fee) → submit collects the fee (applicant → tenant
//      'main', zero-sum, service_fee) → officer verifies → approves → records an observed DBT credit
//      (no wallet movement) which moves the application to disbursed;
//   3. ROW-LEVEL SECURITY: tenant B cannot see tenant A's application.
// Schema/seeds come from the REAL db/migrations + db/seeds (incl. 0209 scheme catalogue + ensure_partitions).
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
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { QuotaService } from '../../../core/quota/quota.service';

import { SchemeVersionRepository } from '../repositories/scheme-version.repository';
import { SchemeRepository } from '../repositories/scheme.repository';
import { SchemeAuthorityRepository } from '../repositories/scheme-authority.repository';
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { DbtTransferRepository } from '../repositories/dbt-transfer.repository';
import { SchemeService } from '../services/scheme.service';
import { SchemeApplicationService } from '../services/scheme-application.service';
import { DbtTransferService } from '../services/dbt-transfer.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

const PM_KISAN = '33333333-0000-7000-8000-000000000101';   // seeded (db/seeds/rules/0209)
const SMAM = '33333333-0000-7000-8000-000000000102';       // seeded, ₹50 processing fee

run('schemes spine (integration, real Postgres + RLS + eligibility + processing fee)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let schemes: SchemeService; let appsSvc: SchemeApplicationService; let dbt: DbtTransferService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const applicant = randomUUID(); const officer = randomUUID();
  let appId = '';
  const applicantActor = { userId: applicant, canApply: true, canProcess: false };
  const officerActor = { userId: officer, canApply: false, canProcess: true };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const balTenant = async (t: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='main' AND owner_tenant_id=$1`, [t])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, applicant); await makeUser(admin, officer);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const schemeRepo = new SchemeRepository(replica as any); void new SchemeAuthorityRepository(replica as any);
    const versionRepo = new SchemeVersionRepository(replica as any);
    const appRepo = new SchemeApplicationRepository(replica as any); const dbtRepo = new DbtTransferRepository(replica as any);
    schemes = new SchemeService(schemeRepo, new SchemeAuthorityRepository(replica as any));
    appsSvc = new SchemeApplicationService(uow, outbox, idem, new AllowAllQuota(), metrics, audit, wallet, appRepo, schemeRepo, versionRepo);
    dbt = new DbtTransferService(uow, outbox, metrics, audit, dbtRepo, appRepo);

    await fund(applicant, 1_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('eligibility check explains pass/fail against PM-KISAN rules', async () => {
    const ok = await schemes.checkEligibility(tenantA, PM_KISAN, { roles: ['farmer'], landholdingAcres: 2 });
    expect(ok.eligible).toBe(true);
    const no = await schemes.checkEligibility(tenantA, PM_KISAN, { roles: ['farmer'], landholdingAcres: 9 });
    expect(no.eligible).toBe(false); expect(no.reasons[0]).toMatch(/landholding/);
  });

  it('apply → submit collects the ₹50 processing fee (applicant → tenant, zero-sum)', async () => {
    appId = (await appsSvc.apply(tenantA, applicantActor, `idem-${randomUUID()}`, { schemeId: SMAM, formData: { acres: 3 } } as any)).id;
    const aBefore = await balUser(applicant); const tBefore = await balTenant(tenantA);
    const submitted: any = await appsSvc.submit(tenantA, applicantActor, appId, `idem-${randomUUID()}`);
    expect(submitted.status).toBe('submitted'); expect(submitted.processingFeeMinor).toBe('5000');
    expect(aBefore - (await balUser(applicant))).toBe(5000n);   // applicant debited the fee
    expect((await balTenant(tenantA)) - tBefore).toBe(5000n);   // tenant pool credited
  });

  it('officer verifies → approves → records the observed DBT credit → application disbursed', async () => {
    await appsSvc.startVerification(tenantA, officerActor, appId);
    expect((await appsSvc.approve(tenantA, officerActor, appId, { govtAppRef: 'GOV-77' } as any, null)).status).toBe('approved');
    const t = await dbt.record(tenantA, officerActor, appId, { amountMinor: '600000', instalmentNo: 1, creditedOn: new Date().toISOString().slice(0, 10), pfmsRef: 'PFMS-ABC' } as any, null);
    expect(t.amountMinor).toBe('600000');
    expect((await appsSvc.getById(tenantA, officerActor, appId)).status).toBe('disbursed');   // DBT moved it to disbursed
  });

  it('RLS: tenant B cannot see tenant A\'s application', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM scheme_applications WHERE id=$1`, [appId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM scheme_applications WHERE id=$1`, [appId])).rows.length).toBe(1);
  });
});
