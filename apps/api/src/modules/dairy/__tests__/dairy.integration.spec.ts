// modules/dairy/__tests__/dairy.integration.spec.ts
// REAL end-to-end proof of the milk-procurement spine against a live Postgres:
//   1. a cooperative creates an MCC, a two-axis rate card, and enrols a farmer member;
//   2. two collections are recorded (priced float-free by the rate card → amount_minor) into the
//      PARTITIONED milk_collections table (partitions auto-created by migration 0014);
//   3. a milk bill is GENERATED over the period (aggregates the collections), previewed,
//      approved, and PAID: the wallet moves tenant 'main' → farmer userMain (zero-sum, txnType milk_payment);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's milk bill.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { platform, PlatformAccount, TenantAccount } from '../../../core/wallet/account-codes';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
// PC-56 TENANT-6d-2: the custody register the centre service writes in the same transaction as the column.
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
// PC-56 TENANT-6d-3: enrolment opens a membership's first route period, in the same transaction.
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { DairyDeductionAssemblerService } from '../services/dairy-deduction-assembler.service';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { LoanService } from '../../fintech/services/loan.service';
import { LoanRepository } from '../../fintech/repositories/loan.repository';
import { LoanRepaymentRepository } from '../../fintech/repositories/loan-repayment.repository';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('dairy milk-procurement spine (integration, real Postgres + RLS + wallet payout)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService; let collections: MilkCollectionService; let bills: MilkBillService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const operator = randomUUID();
  const farmer = randomUUID();
  let mccId = ''; let membershipId = ''; let billId = '';
  // [PC-56 TENANT-6c-3] `canCloseSettlement` is 0144's `settlement.close`, which W169 names on both the preview and
  // the approve. These fixtures drive one operator through the whole desk, so they carry both keys; the wave's own
  // spec is where the refusals live.
  const actor = { userId: operator, canManage: true, canCloseSettlement: true };
  const today = new Date().toISOString().slice(0, 10);

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const balTenant = async (t: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='main' AND owner_tenant_id=$1`, [t])).rows[0]?.b ?? '0');
  // Fund the cooperative's tenant 'main' wallet (e.g. from dairy sales) so it can pay members.
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, operator); await makeUser(admin, farmer);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const mccRepo = new MccCentreRepository(replica as any);
    const memRepo = new DairyMembershipRepository(replica as any);
    const cardRepo = new MilkRateCardRepository(replica as any);
    const collRepo = new MilkCollectionRepository(replica as any);
    const billRepo = new MilkBillRepository(replica as any);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    // PC-56 TENANT-6b-1: the record path now opens a quality review for a flagged pour and asks the flag service
    // whether the rate card's premium slabs apply — both real here, against the real database.
    const reviewRepo = new MilkQualityReviewRepository(replica as any);
    const flags = new FlagsService(pools, new InMemoryCacheService());
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags, new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never));
    // [PC-56 TENANT-6c-2] The bill service reads the tenant's dispute-window length before it can preview a bill.
    const lineRepo = new MilkBillDeductionRepository(replica as never);
    const typeRepo = new DairyDeductionTypeRepository(replica as never);
    const creditRepo = new DairyMemberCreditRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    const instructionRepo = new DairyDeductionInstructionRepository(replica as never);
    const assembler = new DairyDeductionAssemblerService(instructionRepo, creditRepo, typeRepo, memRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, new DairyBillCycleRepository(replica as never),
      // [PC-56 TENANT-6c-4] the deduction's destination: the lines, the vocabulary, the credits, the consent, the
      // applier that posts each line to what it pays, and the recovery kill-switch.
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags,
      // [PC-56 TENANT-6c-5] the REAL assembler — this is a live spec, so a mock here would be a spec that proves the
      // wiring of a fake.
      assembler);

    await fundTenant(tenantA, 10_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('cooperative sets up MCC + rate card + member', async () => {
    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-1', defaultName: 'Anand MCC' } as any, null)).id;
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Cow two-axis', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '50000', ratePerKgSnfMinor: '30000', effectiveFrom: '2026-01-01' } as any);
    membershipId = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmer, mccId, memberCode: 'C-001', paymentCycle: 'weekly', defaultAnimalType: 'cow' } as any)).id;
    expect(membershipId).toBeTruthy();
  });

  it('records two priced collections into the partitioned table', async () => {
    const c1 = await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId, shift: 'morning', collectedOn: today, weightKg: '10.000', fatPct: '4.50', snfPct: '8.50', waterFlag: false, adulterationFlags: [] } as any);
    const c2 = await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId, shift: 'evening', collectedOn: today, weightKg: '8.000', fatPct: '4.00', snfPct: '8.50', waterFlag: false, adulterationFlags: [] } as any);
    expect(c1.amountMinor).toBe('48000');                       // 0.45kg×500 + 0.85kg×300 = 480.00
    expect(c2.amountMinor).toBe('36400');                       // 0.32kg×500 + 0.68kg×300 = 160 + 204 = 364.00
  });

  it('refuses a duplicate collection (same member/shift/day)', async () => {
    await expect(collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId, shift: 'morning', collectedOn: today, weightKg: '5.000', fatPct: '4.00', snfPct: '8.00', waterFlag: false, adulterationFlags: [] } as any)).rejects.toThrow();
  });

  // [PC-56 TENANT-6c-1] This case used to net off `{ type: 'feed_credit', amountMinor: '8000' }` and assert that
  // 76,400 moved — pinning as correct a member being docked Rs 80 that `pay()` posts to NO account: the deducted
  // amount is not paid to the member and not paid to anything else, and `deductions.type` is a free-typed string with
  // no reference to the feed credit it names. `pay()` now REFUSES a bill carrying deductions (fail closed, the
  // COLLECTION_STAMP_LOST ruling), proven live in tenant6c1-cycle.integration.spec.ts. What this case proves is what
  // it always should have: the wallet movement itself is zero-sum, and the NET is what moves.
  it('generates → approves → PAYS the bill: tenant → farmer wallet (zero-sum)', async () => {
    const bill = await bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId, periodStart: today, periodEnd: today, deductions: [] } as any);
    billId = bill.id;
    expect(bill.grossMinor).toBe('84400'); expect(bill.netMinor).toBe('84400');   // 48000+36400, nothing deducted
    // [PC-56 TENANT-6c-2] W169 gives the member 24 hours between seeing the bill and the money moving, and `pay()` now
    // ENFORCES it. Paying at a moment past the window is what the cooperative actually does on payday; paying "now"
    // would be asserting that the promise is not kept.
    const AFTER_WINDOW = new Date(Date.now() + 25 * 3_600_000);
    await bills.preview(tenantA, actor, billId);
    await bills.approve(tenantA, actor, billId);
    const tBefore = await balTenant(tenantA); const fBefore = await balUser(farmer);
    const paid = await bills.pay(tenantA, actor, billId, `idem-${randomUUID()}`, null, AFTER_WINDOW);
    expect(paid.status).toBe('paid');
    const tAfter = await balTenant(tenantA); const fAfter = await balUser(farmer);
    expect(tBefore - tAfter).toBe(84400n);          // cooperative debited NET
    expect(fAfter - fBefore).toBe(84400n);          // farmer credited NET
    expect((tAfter - tBefore) + (fAfter - fBefore)).toBe(0n);   // ZERO-SUM
  });

  it('double-pay is refused (bill already paid)', async () => {
    await expect(bills.pay(tenantA, actor, billId, `idem-${randomUUID()}`, null, new Date(Date.now() + 25 * 3_600_000))).rejects.toThrow();
  });

  it('RLS: tenant B cannot see tenant A\'s milk bill', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM milk_bills WHERE id=$1`, [billId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM milk_bills WHERE id=$1`, [billId])).rows.length).toBe(1);
  });
});
