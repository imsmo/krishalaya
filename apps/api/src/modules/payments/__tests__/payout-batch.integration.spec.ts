// modules/payments/__tests__/payout-batch.integration.spec.ts
// REAL Postgres proof of the API-W3-08 batched-payout slice:
//   1. queued payouts (across tenants) are CLAIMED into a batch + disbursed via the wallet boundary →
//      'success' with a zero-sum payouts→gateway ledger move; the batch records total + count, 'executed';
//   2. the booking-clocked-out handler (labour.wages_paid) PROMOTES a booking's queued payouts into the
//      wage lane only when the `wage_priority_payout` flag is ON (default OFF) — and only its own table;
//   3. the async RazorpayX payout webhook confirms a 'processing' payout → 'success' (idempotent on the
//      gateway event id) and REJECTS a forged signature (fail closed);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's payout.
// Schema/seeds from the REAL db/migrations + db/seeds. Batch/recon writes run on the ADMIN (privileged)
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
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';

import { PayoutRepository } from '../repositories/payout.repository';
import { PayoutBatchRepository } from '../repositories/payout-batch.repository';
import { PayoutService } from '../services/payout.service';
import { PayoutBatchService } from '../services/payout-batch.service';
import { PayoutApprovalService } from '../services/payout-approval.service';
import { OrgWalletReadModel } from '../read-models/org-wallet.read-model';
import { PaymentsPublisher } from '../events/payments.publisher';
import { BookingClockedOutHandler } from '../events/handlers/booking-clocked-out.handler';
import { RazorpayPayoutWebhookHandler } from '../events/handlers/razorpay-webhook.handler';
import { SandboxPayoutGateway } from '../gateway/sandbox-payout.gateway';
import { PayoutWebhookSignatureError } from '../domain/payments.errors';
import { WAGE_LANE_PRIORITY } from '../domain/payout.state';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('payout batch + wage lane + async webhook (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let repo: PayoutRepository; let batchRepo: PayoutBatchRepository;
  let outbox: PgOutboxWriter; let idem: PgIdempotencyService; let metrics: PromMetrics; let audit: AuditWriter;
  let publisher: PaymentsPublisher; let batches: PayoutBatchService; let webhook: RazorpayPayoutWebhookHandler;
  let isSuperuser = false;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const sellerA = randomUUID(); const sellerB = randomUUID();
  const bankA = randomUUID(); const bankB = randomUUID();
  const AMOUNT = 90000n;
  let flagBefore: { is_enabled: boolean; rollout_pct: number } | null = null;
  let maker = ''; let checker = '';
  let approvals: PayoutApprovalService;

  const svc = (mode: 'success' | 'failed') => new PayoutService(uow, outbox, idem, metrics, wallet, new SandboxPayoutGateway(mode), audit, repo);
  const fund = async (tenantId: string, userId: string, amount: bigint) => uow.run(tenantId, async (tx) => {
    await wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`,
      legs: [ { account: userMain(userId), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount } ] });
  }, { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, sellerA); await makeUser(admin, sellerB);
    await admin.query(`INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, vault_ref) VALUES ($1,$2,$3,'upi','fa_a') ON CONFLICT DO NOTHING`, [bankA, sellerA, tenantA]);
    await admin.query(`INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, vault_ref) VALUES ($1,$2,$3,'upi','fa_b') ON CONFLICT DO NOTHING`, [bankB, sellerB, tenantB]);
    // S3 review finding: requestPayout now gates on kyc_status='verified' — seed a verified role for
    // each seller (this fixture predates the KYC gate; makeUser() alone leaves no role row).
    await admin.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
       SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [sellerA, tenantA]);
    await admin.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
       SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [sellerB, tenantB]);
    // PC-56 TEST-1: the flag is a PLATFORM row shared by every suite. It used to be switched ON here and left on for the rest of
    // the run; its prior state is now remembered and restored in afterAll. (The handler under test takes its flag port as an
    // argument anyway — the row only matters to anything else that reads it.)
    flagBefore = (await admin.query(`SELECT is_enabled, rollout_pct FROM feature_flags WHERE key = 'wage_priority_payout'`)).rows[0] ?? null;
    await admin.query(`INSERT INTO feature_flags (key, is_enabled, rollout_pct, rules) VALUES ('wage_priority_payout', true, 100, '{}'::jsonb) ON CONFLICT (key) DO UPDATE SET is_enabled=true, rollout_pct=100`);
    // A WAGE payout is claimed as sardar or worker (TENANT-1's per-role KYC rule, payout-kyc.ts) — the fixture predates it and
    // gave the seller only a farmer role, so requestPayout refused with RoleKycRequiredError. And the approval plane's pre-flight
    // counts a payee as verified only WITH a penny-verified destination (W146), so bank A is verified.
    await admin.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
       SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='worker'
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [sellerA, tenantA]);
    await admin.query(`UPDATE bank_accounts SET penny_verified_at = now() WHERE id = $1`, [bankA]);
    [maker, checker] = [await makeUser(admin), await makeUser(admin)];
    // The organisation's checker threshold at this batch's size, so a SECOND person is required (needsChecker: total >= threshold;
    // below the default ₹1,00,000 a maker may sign their own run — that is the decision, and not what this test is about).
    await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'payouts.batch_checker_threshold_minor', to_jsonb($2::bigint))`, [tenantA, AMOUNT.toString()]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    outbox = new PgOutboxWriter(); idem = new PgIdempotencyService(pools); metrics = new PromMetrics(); audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    repo = new PayoutRepository(replica as any);
    batchRepo = new PayoutBatchRepository(pools);
    publisher = new PaymentsPublisher(outbox);
    batches = new PayoutBatchService(metrics, batchRepo, svc('success'), publisher);
    approvals = new PayoutApprovalService(uow, batchRepo, new OrgWalletReadModel(pools));
    const webhookConfig = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/test', JWT_ACCESS_SECRET: 'test-access-secret-min-16-chars', SANDBOX_WEBHOOK_SECRET: 'sandbox-secret' });
    webhook = new RazorpayPayoutWebhookHandler(uow, idem, metrics, wallet, audit, repo, publisher, webhookConfig);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => {
    if (flagBefore) await admin?.query(`UPDATE feature_flags SET is_enabled=$1, rollout_pct=$2 WHERE key='wage_priority_payout'`, [flagBefore.is_enabled, flagBefore.rollout_pct]);
    else await admin?.query(`DELETE FROM feature_flags WHERE key='wage_priority_payout'`).catch(() => undefined);
    // this suite's own queued payouts must not be left for another suite's cross-tenant claim
    await admin?.query(`UPDATE payouts SET status='cancelled' WHERE tenant_id = ANY($1::uuid[]) AND status='queued'`, [[tenantA, tenantB]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end();
  });

  // PC-56 TEST-1 · THIS USED TO CALL `PayoutBatchService.runBatch`, which opens a batch, claims EVERY tenant's queued payouts
  // into it and marks it `executing` with no approval. TENANT-4b ("money never moves without two humans") and the DB rule
  // that carries it — ck_payout_batch_approval_evidence (0114, widened to the tenant plane by 0174): `approved|executing|
  // executed` only with approver evidence — make that impossible, so the old test failed with 23514 after its claim had
  // already committed. runBatch is reached only by the GA-deferred, unwired WagePriorityLaneJob; it is NOT called here
  // (in a shared database it would claim and strand other suites' payouts — reported, not exercised). What is proven instead
  // is the path the decision requires, end to end against the real schema: a MAKER prepares the tenant's batch, a different
  // CHECKER approves it against a passing pre-flight, and the executor disburses it only once it is due.
  it('claims queued payouts into a batch + disburses them → executed with a zero-sum ledger (maker → checker → due → runApproved)', async () => {
    await fund(tenantA, sellerA, AMOUNT);
    // the organisation's own main balance — the pre-flight's funds_available line reads it
    await uow.run(tenantA, async (tx) => {
      await wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund-org:${randomUUID()}`,
        legs: [ { account: { kind: 'tenant', tenantId: tenantA, accountCode: 'main', currencyCode: 'INR' }, amountMinor: AMOUNT }, { account: platform(PlatformAccount.Gateway), amountMinor: -AMOUNT } ] });
    }, { userId: 'system' });
    const p = await svc('success').requestPayout(tenantA, sellerA, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId: bankA, purpose: 'settlement', currencyCode: 'INR' } as any);

    const t0 = new Date();
    const executeAt = new Date(t0.getTime() + 6 * 3600_000);
    const prep = await approvals.prepare(tenantA, maker, { batchType: 'settlement_run', executeAt }, t0);
    expect(prep.claimed).toBe(1);
    expect(prep.itemsTotalMinor).toBe(AMOUNT.toString());
    // nothing moves before a second person signs, nor before it is due
    expect((await batches.runApproved(admin as any, { batchId: prep.batchId, tenantId: tenantA, approvalRequired: true, now: executeAt })).refusedReason).toBe('not_approved');
    await expect(approvals.decide(tenantA, maker, prep.batchId, { decision: 'approved' }, t0)).rejects.toMatchObject({ details: expect.objectContaining({ code: 'PAYOUT_BATCH_CHECKER_IS_MAKER' }) });
    const d = await approvals.decide(tenantA, checker, prep.batchId, { decision: 'approved' }, t0);
    expect(d.status).toBe('approved');
    expect(d.preflight.passed).toBe(true);
    expect((await batches.runApproved(admin as any, { batchId: prep.batchId, tenantId: tenantA, approvalRequired: true, now: t0 })).refusedReason).toBe('not_due');

    const result = await batches.runApproved(admin as any, { batchId: prep.batchId, tenantId: tenantA, approvalRequired: true, now: executeAt });
    expect(result.status).toBe('executed');
    expect(result.succeeded).toBe(1);

    const row = await admin.query(`SELECT status, batch_id FROM payouts WHERE id=$1`, [p.payoutId]);
    expect(row.rows[0].status).toBe('success');
    expect(row.rows[0].batch_id).toBe(prep.batchId);
    const batch = await admin.query(`SELECT status, total_minor::text t, count, decided_by FROM payout_batches WHERE id=$1`, [prep.batchId]);
    expect(batch.rows[0].status).toBe('executed');
    expect(batch.rows[0].decided_by).toBe(checker);
    expect(BigInt(batch.rows[0].t)).toBe(AMOUNT);
    const exec = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM ledger_entries WHERE txn_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)`, [`payout-exec:${p.payoutId}`]);
    expect(exec.rows[0].s).toBe('0');
  });

  it('booking-clocked-out promotes a booking\'s queued payouts into the wage lane only when flagged ON', async () => {
    await fund(tenantA, sellerA, AMOUNT);
    const bookingId = randomUUID();
    const p = await svc('success').requestPayout(tenantA, sellerA, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId: bankA, purpose: 'wage', currencyCode: 'INR', referenceType: 'labour_booking', referenceId: bookingId } as any);
    const before = await admin.query(`SELECT priority FROM payouts WHERE id=$1`, [p.payoutId]);
    expect(before.rows[0].priority).toBeGreaterThan(WAGE_LANE_PRIORITY);

    const ev = { id: '1', tenantId: tenantA, aggregateType: 'labour_booking', aggregateId: bookingId, eventType: 'labour.wages_paid', payload: { v: 1 } };
    // flag OFF → no promotion
    const off = new BookingClockedOutHandler({ isEnabled: async () => false } as any, repo);
    await uow.run(tenantA, (tx) => off.handle(ev as any, tx), { userId: 'system' });
    expect((await admin.query(`SELECT priority FROM payouts WHERE id=$1`, [p.payoutId])).rows[0].priority).toBe(before.rows[0].priority);
    // flag ON → promoted into the wage lane
    const on = new BookingClockedOutHandler({ isEnabled: async () => true } as any, repo);
    await uow.run(tenantA, (tx) => on.handle(ev as any, tx), { userId: 'system' });
    expect((await admin.query(`SELECT priority FROM payouts WHERE id=$1`, [p.payoutId])).rows[0].priority).toBe(WAGE_LANE_PRIORITY);
  });

  it('async payout webhook confirms processing→success + rejects a forged signature', async () => {
    await fund(tenantA, sellerA, AMOUNT);
    const p = await svc('success').requestPayout(tenantA, sellerA, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId: bankA, purpose: 'settlement', currencyCode: 'INR' } as any);
    const gwId = `pout_${randomUUID()}`;
    await admin.query(`UPDATE payouts SET status='processing', gateway_payout_id=$2 WHERE id=$1`, [p.payoutId, gwId]);

    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payout.processed', payload: { payout: { entity: { id: gwId, status: 'processed', notes: { tenant_id: tenantA } } } } });
    await expect(webhook.ingest(body, 'deadbeef')).rejects.toBeInstanceOf(PayoutWebhookSignatureError);   // forged → fail closed
    const res = await webhook.ingest(body, webhook.sign(body));
    expect(res.status).toBe('success');
    const row = await admin.query(`SELECT status FROM payouts WHERE id=$1`, [p.payoutId]);
    expect(row.rows[0].status).toBe('success');
    const exec = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM ledger_entries WHERE txn_id=(SELECT id FROM ledger_transactions WHERE idempotency_key=$1)`, [`payout-exec:${p.payoutId}`]);
    expect(exec.rows[0].s).toBe('0');
  });

  it('RLS: tenant B cannot see tenant A\'s payout', async () => {
    await fund(tenantA, sellerA, AMOUNT);
    const p = await svc('success').requestPayout(tenantA, sellerA, `idem-${randomUUID()}`, { amountMinor: AMOUNT.toString(), bankAccountId: bankA, purpose: 'settlement', currencyCode: 'INR' } as any);
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM payouts WHERE id=$1`, [p.payoutId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[payout-batch] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
