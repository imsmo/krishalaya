// modules/payments/__tests__/payout-execution.integration.spec.ts
// REAL proof of money-OUT completion + ledger reconciliation against a live Postgres:
//   1. a seller has wallet funds; requestPayout reserves them (wallet → platform payouts), queued;
//   2. the PayoutExecutionJob claims it (→processing) and disburses via the sandbox gateway →
//      'success', with a zero-sum payouts→gateway ledger move;
//   3. a SECOND payout that the gateway DEFINITIVELY rejects is REVERSED — the reserved funds are
//      returned to the seller's wallet (status 'reversed');
//   4. ReconciliationService confirms the ledger is zero-sum + balances match; an injected
//      imbalance is detected (mismatch) — proving the safety net actually fires.
// Schema/seeds from the REAL db/migrations + db/seeds. The job/recon run on the ADMIN (privileged)
// pool — production runs them in the worker as kv_relay/kv_wallet.
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
import { ReconciliationService } from '../../../core/wallet/reconciliation.service';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { TxContext } from '../../../core/database/unit-of-work';

import { PayoutRepository } from '../repositories/payout.repository';
import { PayoutService } from '../services/payout.service';
import { PayoutExecutionJob } from '../jobs/payout-execution.job';
import { SandboxPayoutGateway } from '../gateway/sandbox-payout.gateway';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('payout execution + reconciliation (integration, real Postgres)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let uow: PgUnitOfWork;
  let wallet: InProcessWalletClient;
  let repo: PayoutRepository;
  let outbox: PgOutboxWriter; let idem: PgIdempotencyService; let metrics: PromMetrics; let audit: AuditWriter;
  let recon: ReconciliationService;

  const tenantA = randomUUID();
  const seller = randomUUID();
  const bankAccountId = randomUUID();
  const AMOUNT = 120000n;

  const sysTx = (): TxContext => ({ query: (sql, params) => admin.query(sql, params as any) as any, tenantId: '', userId: 'system' });
  const sellerBal = async () => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main'`, [seller])).rows[0]?.b ?? '0');

  // credit the seller's wallet with funds to withdraw (balanced: gateway −X, seller +X)
  const fundSeller = async (amount: bigint) => {
    await uow.run(tenantA, async (tx) => {
      await wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
        legs: [ { account: userMain(seller), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount } ] });
    }, { userId: 'system' });
  };
  const svc = (mode: 'success' | 'failed') => new PayoutService(uow, outbox, idem, metrics, wallet, new SandboxPayoutGateway(mode), audit, repo);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeUser(admin, seller);
    await admin.query(`INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, vault_ref) VALUES ($1,$2,$3,'upi','fa_seller') ON CONFLICT DO NOTHING`, [bankAccountId, seller, tenantA]);
    // S3 review finding: requestPayout now gates on kyc_status='verified' — seed a verified role for
    // the seller (this fixture predates KV-BL-0xx/the KYC gate; makeUser() alone leaves no role row).
    await admin.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
       SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [seller, tenantA]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    outbox = new PgOutboxWriter(); idem = new PgIdempotencyService(pools); metrics = new PromMetrics(); audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    repo = new PayoutRepository(replica as any);
    recon = new ReconciliationService();
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('queued payout → job executes → success + zero-sum payouts→gateway ledger move', async () => {
    await fundSeller(AMOUNT);
    expect(await sellerBal()).toBe(AMOUNT);
    const res = await svc('success').requestPayout(tenantA, seller, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId, purpose: 'settlement', currencyCode: 'INR' } as any);
    expect(await sellerBal()).toBe(0n);              // reserved out of the wallet

    const job = new PayoutExecutionJob(admin, repo, svc('success'));
    const out = await job.run(50);
    expect(out.claimed).toBeGreaterThanOrEqual(1);

    const row = await admin.query(`SELECT status FROM payouts WHERE id=$1`, [res.payoutId]);
    expect(row.rows[0].status).toBe('success');
    const exec = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM ledger_entries WHERE txn_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)`, [`payout-exec:${res.payoutId}`]);
    expect(exec.rows[0].s).toBe('0');                // the disbursement ledger txn is balanced
  });

  it('a gateway-rejected payout is REVERSED → reserved funds returned to the seller', async () => {
    await fundSeller(AMOUNT);
    const before = await sellerBal();
    const res = await svc('failed').requestPayout(tenantA, seller, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId, purpose: 'settlement', currencyCode: 'INR' } as any);
    expect(await sellerBal()).toBe(before - AMOUNT);  // reserved
    await svc('failed').execute(tenantA, res.payoutId);
    const row = await admin.query(`SELECT status FROM payouts WHERE id=$1`, [res.payoutId]);
    expect(row.rows[0].status).toBe('reversed');
    expect(await sellerBal()).toBe(before);           // funds returned — no money lost
  });

  it('reconciliation: ledger is zero-sum + balances match; an injected imbalance is caught', async () => {
    const zs = await recon.runZeroSumCheck(sysTx(), 24);
    expect(zs.ok).toBe(true);
    const bal = await recon.runInternalBalanceCheck(sysTx());
    expect(bal.ok).toBe(true);

    // inject corruption: tamper one entry's amount → zero-sum must now FAIL (the net fires).
    // PC-56 TEST-1: ledger_entries is now append-only by TRIGGER (Golden Law 2 — every role, the owner included), so the tamper
    // runs with triggers off for that one statement (session_replication_role = replica, superuser-only: exactly the
    // out-of-band corruption the net exists to catch). And it is UNDONE afterwards: as written this left a permanently
    // unbalanced transaction in the shared database, so every later "the whole ledger nets to zero" spec failed by run order.
    const tamper = async (delta: 1 | -1, id: string) => {
      const c = await admin.connect();
      try {
        await c.query(`SET session_replication_role = replica`);
        await c.query(`UPDATE ledger_entries SET amount_minor = amount_minor + $2 WHERE id = $1`, [id, delta]);
      } finally { await c.query(`RESET session_replication_role`).catch(() => undefined); c.release(); }
    };
    const victim = String((await admin.query(`SELECT id FROM ledger_entries ORDER BY id DESC LIMIT 1`)).rows[0].id);
    await tamper(1, victim);
    try {
      const zs2 = await recon.runZeroSumCheck(sysTx(), 24);
      expect(zs2.ok).toBe(false);
      expect(zs2.mismatches.length).toBeGreaterThanOrEqual(1);
      const persisted = await admin.query(`SELECT status FROM reconciliation_runs WHERE id=$1`, [zs2.runId]);
      expect(persisted.rows[0].status).toBe('mismatch');
    } finally {
      await tamper(-1, victim);
    }
    expect((await recon.runZeroSumCheck(sysTx(), 24)).ok).toBe(true);   // and the ledger is whole again
  });
});
