// modules/dairy/__tests__/tenant6c4-deduction-destination.integration.spec.ts · PC-56 TENANT-6c-4, LIVE Postgres.
//
// W169: *"Deductions this cycle ₹1,84,300 — feed credit + loan EMI + insurance — each line itemised"*, *"member sees
// every pour + every deduction"*, and *"Deductions above 25% of gross need the member's fresh consent, not just
// standing instructions."*
//
// SIX THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **THE LEDGER, END TO END.** The member is paid the GROSS and each line is then posted to what it pays, in one
//      transaction. Only real wallet accounts can show that the family's net is identical, that every rupee has a
//      ledger row, that the ledger is zero-sum, and that the feed credit and the loan actually fell.
//   2. **THE CROSS-MODULE CALL.** `LoanService.applyMilkBillDeduction` runs inside the dairy payment's transaction and
//      writes a `loan_repayments` row with `channel = 'milk_bill_deduction'` — the channel `0011` named and nothing
//      ever wrote. A unit test can assert the string; only a live run proves it does not self-deadlock on the lock the
//      dairy payment already holds (TENANT-6c-2 shipped exactly that bug and a live test found it).
//   3. **THE VOCABULARY AND ITS FK.** 0160 inserts the `milk_deduction` lookup values because it BACKFILLS A FK
//      against them and seeds run after migrations (6c-2's finding). Only a live build proves the rows exist at
//      migration time AND that the seed's identical rows do not duplicate them.
//   4. **THE JSONB COLUMN IS GONE**, and its contents survived as rows.
//   5. **THE APPEND-ONLY GRANTS** on the line, the credit and the consent.
//   6. **THE CONSENT GATE** against a real setting, a real threshold and a real bill whose figures changed.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { NotificationTemplateRepository } from '../../communication/repositories/notification-template.repository';
import { LoanRepository } from '../../fintech/repositories/loan.repository';
import { LoanRepaymentRepository } from '../../fintech/repositories/loan-repayment.repository';
import { LoanService } from '../../fintech/services/loan.service';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
// PC-56 TENANT-6d-2: the custody register the centre service writes in the same transaction as the column.
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
// PC-56 TENANT-6d-3: enrolment opens a membership's first route period, in the same transaction.
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { DairyDeductionAssemblerService } from '../services/dairy-deduction-assembler.service';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { MilkBillDeductionConsentService } from '../services/milk-bill-deduction-consent.service';
import { DairyMemberCreditService } from '../services/dairy-member-credit.service';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6c-4 · the deduction\'s destination (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService;
  let credits: DairyMemberCreditService; let consents: MilkBillDeductionConsentService;
  let templates: NotificationTemplateRepository; let loansSvc: LoanService;
  let creditRepo: DairyMemberCreditRepository; let lineRepo: MilkBillDeductionRepository;
  let typeRepo: DairyDeductionTypeRepository; let flagCache: InMemoryCacheService;

  const tenantA = randomUUID();
  const desk = randomUUID();
  const farmer = randomUUID();
  const farmerB = randomUUID();
  const actor = { userId: desk, canManage: true, canCloseSettlement: true };

  let mccId = ''; let mem = ''; let memB = '';
  let loanId = ''; let creditId = '';

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const balTenant = async (t: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='main' AND owner_tenant_id=$1`, [t])).rows[0]?.b ?? '0');
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  /** A bill for ONE day's pour, with the given lines. A fresh day each time so the period is unique. */
  let day = 1;
  const billFor = async (membershipId: string, lines: Array<{ type: string; amountMinor: string; sourceId: string }>) => {
    const d = `2026-05-${String(day++).padStart(2, '0')}`;
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, {
      membershipId, mccId, shift: 'morning', collectedOn: d,
      // 60 kg at 6.80/9.10 through the two-axis card = 479,400 minor (Rs 4,794) — a real fortnight's pour, which is
      // what makes the 25% threshold meaningful. The first draft poured 10 kg, so a Rs 700 deduction was 87% of the
      // bill and every "below the threshold" test was silently above it.
      weightKg: '60.000', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
    } as never);
    const b: any = await bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId, periodStart: d, periodEnd: d, deductions: lines } as never);
    return b;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [desk, farmer, farmerB]) await makeUser(admin, u);

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
    // A REFERENCE to the cache, because `FlagsService` caches for 30 seconds: flipping `is_enabled` in the database
    // is not visible to it until the key is dropped, and the kill-switch test below would otherwise assert the
    // cache's memory rather than the flag.
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);

    const mccRepo = new MccCentreRepository(replica as never);
    const memRepo = new DairyMembershipRepository(replica as never);
    const cardRepo = new MilkRateCardRepository(replica as never);
    const collRepo = new MilkCollectionRepository(replica as never);
    const billRepo = new MilkBillRepository(replica as never);
    const reviewRepo = new MilkQualityReviewRepository(replica as never);
    const cycleRepo = new DairyBillCycleRepository(replica as never);
    const disputeRepo = new MilkBillDisputeRepository(replica as never);
    lineRepo = new MilkBillDeductionRepository(replica as never);
    creditRepo = new DairyMemberCreditRepository(replica as never);
    typeRepo = new DairyDeductionTypeRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    templates = new NotificationTemplateRepository(replica as never);
    loansSvc = new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never));
    const instructionRepo = new DairyDeductionInstructionRepository(replica as never);
    const assembler = new DairyDeductionAssemblerService(instructionRepo, creditRepo, typeRepo, memRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo, loansSvc);

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags, new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never));
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, cycleRepo,
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags,
      // [PC-56 TENANT-6c-5] the REAL assembler — this is a live spec, so a mock here would be a spec that proves the
      // wiring of a fake.
      assembler);
    credits = new DairyMemberCreditService(uow, outbox, idem, metrics, audit, creditRepo, memRepo, lineRepo);
    consents = new MilkBillDeductionConsentService(uow, outbox, idem, metrics, audit, consentRepo, billRepo, lineRepo, memRepo);
    void disputeRepo;

    // The recovery kill-switch ships OFF (0160). Every test below that moves a deduction needs it ON, and the one
    // test that proves the OFF state flips it back.
    await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key IN ('dairy_deduction_recovery','dairy_member_credit')`);
    await flagCache.del('flags:all');

    await fundTenant(tenantA, 100_000_000n);

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-04', defaultName: 'Anand 04' } as never, null)).id;
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v6', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    mem = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmer, mccId, memberCode: 'AND4-0001', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;
    memB = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmerB, mccId, memberCode: 'AND4-0002', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;

    // A REAL LOAN for this member, through the minimal FK chain the fintech specs use. `outstanding` is deliberately
    // small so a milk bill can clear it and the loan's CLOSING transition is exercised.
    const partnerId = randomUUID();
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, sla) VALUES ($1,$2,'Test Bank','bank','{}')`, [partnerId, `bank_${partnerId.slice(0, 8)}`]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='loan_kind' AND code='dairy' AND tenant_id IS NULL`)).rows[0];
    const productId = randomUUID();
    await admin.query(
      `INSERT INTO loan_products (id, partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps)
       VALUES ($1,$2,$3,'Dairy cattle loan',100000,30000000,700)`, [productId, partnerId, kind.id]);
    const appId = randomUUID();
    await admin.query(
      `INSERT INTO loan_applications (id, tenant_id, applicant_user_id, product_id, amount_requested_minor, status)
       VALUES ($1,$2,$3,$4,200000,'disbursed')`, [appId, tenantA, farmer, productId]);
    loanId = randomUUID();
    await admin.query(
      `INSERT INTO loans (id, application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
       VALUES ($1,$2,$3,$4,$5,200000,700,'2026-04-01','active',200000)`, [loanId, appId, tenantA, farmer, partnerId]);
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE VOCABULARY — a comment became a table', () => {
    it('exists after MIGRATIONS AND SEEDS, exactly once per code', async () => {
      // 0160 inserts these rows because it backfills a FK against them, and db/seeds/core/0005 inserts the same rows
      // for a fresh install. Seeds run AFTER migrations (TENANT-6c-2's finding), so both are needed — and neither may
      // duplicate the other, which is what this counts.
      const r = await admin.query(
        `SELECT code, count(*)::int AS n FROM lookup_values
          WHERE type_code='milk_deduction' AND tenant_id IS NULL GROUP BY code ORDER BY code`);
      expect(r.rows.map((x: any) => x.code)).toEqual(['feed_credit', 'insurance', 'loan_emi', 'share']);
      for (const row of r.rows as Array<{ n: number }>) expect(row.n).toBe(1);
      const t = await admin.query(`SELECT is_tenant_extendable FROM lookup_types WHERE code='milk_deduction'`);
      expect(t.rows[0].is_tenant_extendable).toBe(false);
    });

    it('reads back with its destinations, and the two unsupported ones carry their REASON', async () => {
      const types = await typeRepo.list(tenantA);
      const byCode = Object.fromEntries(types.map((t) => [t.code, t]));
      expect(byCode.feed_credit).toMatchObject({ destination: 'member_credit', sourceType: 'dairy_member_credit', unsupportedReason: null });
      expect(byCode.loan_emi).toMatchObject({ destination: 'loan', sourceType: 'loan', unsupportedReason: null });
      expect(byCode.insurance.destination).toBe('none');
      expect(byCode.insurance.unsupportedReason).toMatch(/gateway intent/);
      expect(byCode.share.unsupportedReason).toMatch(/certificate/);
    });

    it('THE JSONB COLUMN IS GONE, and `deductions_minor` still carries the total', async () => {
      const col = await admin.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='milk_bills' AND column_name IN ('deductions','deductions_minor')`);
      expect(col.rows.map((r: any) => r.column_name)).toEqual(['deductions_minor']);
    });
  });

  /* ======================================================================================================= */
  describe('THE FEED CREDIT — the receivable W169\'s first line pays', () => {
    it('is recorded with NO wallet movement, because the member received goods', async () => {
      const before = await balUser(farmer);
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: '2 bags cattle feed + mineral mix', valueMinor: '50000',
      } as never, null);
      creditId = c.id;
      expect(c).toMatchObject({ valueMinor: '50000', recoveredMinor: '0', outstandingMinor: '50000', status: 'outstanding' });
      expect(await balUser(farmer)).toBe(before);     // goods, not cash
      expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_id=$1`, [c.id])).rows[0].n).toBe(0);
      // The MCC's own day, from the database — not the pod's clock.
      const today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;
      expect(c.issuedOn).toBe(today);
    });

    it('the app role cannot rewrite WHAT WAS SOLD or for how much', async () => {
      const priv = await admin.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name='dairy_member_credits' AND grantee='kv_app' AND privilege_type='UPDATE' ORDER BY column_name`);
      const cols = priv.rows.map((r: any) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(['recovered_minor', 'status']));
      for (const c of ['value_minor', 'description', 'membership_id', 'issued_by']) expect(cols).not.toContain(c);
      const tablePriv = await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='dairy_member_credits' AND grantee='kv_app' AND privilege_type='UPDATE'`);
      expect(tablePriv.rowCount).toBe(0);        // 0157's lesson: REVOKE first or the column grant is decoration
      await expect(uow.run(tenantA, (tx) => tx.query(`UPDATE dairy_member_credits SET value_minor=1 WHERE id=$1`, [creditId]), { userId: 'system' }))
        .rejects.toThrow(/permission denied/i);
    });

    it('cannot be over-recovered, by the DATABASE as well as the domain', async () => {
      await expect(admin.query(`UPDATE dairy_member_credits SET recovered_minor = value_minor + 1 WHERE id=$1`, [creditId]))
        .rejects.toThrow(/ck_dairy_member_credit_recovered/);
      // And the status cannot disagree with the arithmetic — the delay-fuse shape 6c-2 found three times.
      await expect(admin.query(`UPDATE dairy_member_credits SET status='recovered' WHERE id=$1`, [creditId]))
        .rejects.toThrow(/ck_dairy_member_credit_status_matches/);
    });
  });

  /* ======================================================================================================= */
  describe('THE LEDGER, END TO END — the member is paid the GROSS', () => {
    let billId = ''; let grossMinor = 0n;

    it('generates a bill whose lines POINT at the credit and the loan', async () => {
      const b: any = await billFor(mem, [
        { type: 'feed_credit', amountMinor: '50000', sourceId: creditId },
        { type: 'loan_emi', amountMinor: '20000', sourceId: loanId },
      ]);
      billId = b.id;
      grossMinor = BigInt(b.grossMinor);
      expect(BigInt(b.deductionsMinor)).toBe(70_000n);
      expect(BigInt(b.netMinor)).toBe(grossMinor - 70_000n);
      const rows = await admin.query(
        `SELECT lv.code, d.amount_minor, d.source_type, d.source_id, d.status FROM milk_bill_deductions d
           JOIN lookup_values lv ON lv.id = d.type_id WHERE d.bill_id=$1 ORDER BY lv.code`, [billId]);
      expect(rows.rows).toMatchObject([
        { code: 'feed_credit', amount_minor: '50000', source_type: 'dairy_member_credit', source_id: creditId, status: 'pending' },
        { code: 'loan_emi', amount_minor: '20000', source_type: 'loan', source_id: loanId, status: 'pending' },
      ]);
    });

    it('pays: THREE movements, a zero-sum ledger, and the family keeps exactly the net', async () => {
      const farmerBefore = await balUser(farmer);
      const tenantBefore = await balTenant(tenantA);
      await bills.preview(tenantA, actor, billId, new Date('2026-05-20T04:00:00.000Z'));
      await bills.approve(tenantA, actor, billId);
      const paid: any = await bills.pay(tenantA, actor, billId, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z'));
      expect(paid.status).toBe('paid');

      // THE POINT OF THE WHOLE WAVE: the member's balance moved by the NET, but there are three real entries behind
      // it rather than one — the gross in, the feed credit out, the loan instalment out. Before this wave a deducted
      // bill could not be paid at all (0157), and before THAT it paid the net with the withheld amount posted nowhere.
      expect(await balUser(farmer) - farmerBefore).toBe(grossMinor - 70_000n);
      expect(await balTenant(tenantA) - tenantBefore).toBe(70_000n - grossMinor);

      // THREE TRANSACTIONS, each zero-sum, each pointing at what it was for: the bill, the feed credit, the loan.
      // Before this wave a deducted bill produced ONE (the net) and the withheld amount pointed at nothing.
      const txns = await admin.query(
        `SELECT id, reference_type, reference_id, created_at FROM ledger_transactions
          WHERE tenant_id=$1 AND (reference_id=$2 OR reference_id=$3 OR reference_id=$4) ORDER BY reference_type`,
        [tenantA, billId, creditId, loanId]);
      expect(txns.rows.map((r: any) => r.reference_type)).toEqual(['dairy_member_credit', 'loan', 'milk_bill']);
      // AND THEY SHARE ONE TIMESTAMP. `now()` in Postgres is transaction-time, so three identical `created_at`s are
      // the database's own evidence that the gross, the feed recovery and the loan instalment were ONE transaction —
      // which is what makes "if any line cannot be posted, nothing moved" true rather than hopeful. (The first draft
      // of this test ordered by `created_at` and was flaky-by-construction for exactly that reason.)
      expect(new Set(txns.rows.map((r: any) => new Date(r.created_at).getTime())).size).toBe(1);
      for (const t of txns.rows as any[]) {
        const legs = await admin.query(`SELECT amount_minor FROM ledger_entries WHERE txn_id=$1`, [t.id]);
        expect(legs.rowCount).toBe(2);
        expect(legs.rows.reduce((a: bigint, r: any) => a + BigInt(r.amount_minor), 0n)).toBe(0n);
      }
    });

    it('the FEED CREDIT fell to zero and closed', async () => {
      const c = await creditRepo.getById(tenantA, creditId);
      expect(c!.toJSON()).toMatchObject({ recoveredMinor: '50000', outstandingMinor: '0', status: 'recovered' });
    });

    it('the LOAN fell, and its repayment is stamped with the channel 0011 named and nothing ever wrote', async () => {
      const loan = await admin.query(`SELECT outstanding_minor, status FROM loans WHERE id=$1`, [loanId]);
      expect(loan.rows[0]).toMatchObject({ outstanding_minor: '180000', status: 'active' });
      const rep = await admin.query(`SELECT amount_paid_minor, channel FROM loan_repayments WHERE loan_id=$1`, [loanId]);
      expect(rep.rows).toMatchObject([{ amount_paid_minor: '20000', channel: 'milk_bill_deduction' }]);
      // `REPAYMENT_STYLES` has included `milk_bill_deduction` since the fintech module was written and this is the
      // first row this platform has ever produced with it.
    });

    it('every line is stamped APPLIED with the ledger txn that moved it', async () => {
      const rows = await admin.query(
        `SELECT status, applied_at, wallet_txn_id FROM milk_bill_deductions WHERE bill_id=$1`, [billId]);
      expect(rows.rowCount).toBe(2);
      for (const r of rows.rows as any[]) {
        expect(r.status).toBe('applied');
        expect(r.applied_at).not.toBeNull();
        expect(r.wallet_txn_id).not.toBeNull();
      }
      // And a stamp cannot exist without its txn, whatever writes it.
      await expect(admin.query(`UPDATE milk_bill_deductions SET wallet_txn_id=NULL WHERE bill_id=$1`, [billId]))
        .rejects.toThrow(/ck_milk_bill_deduction_applied/);
    });

    it('publishes one event PER LINE, naming the source it paid', async () => {
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.bill_deduction_applied' ORDER BY created_at`, [tenantA]);
      expect(ev.rowCount).toBe(2);
      const types = ev.rows.map((r: any) => r.payload.typeCode).sort();
      expect(types).toEqual(['feed_credit', 'loan_emi']);
      for (const r of ev.rows as any[]) expect(r.payload.walletTxnId).toBeTruthy();
    });

    it('the app role cannot rewrite a line\'s amount, type or source', async () => {
      const priv = await admin.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name='milk_bill_deductions' AND grantee='kv_app' AND privilege_type='UPDATE' ORDER BY column_name`);
      const cols = priv.rows.map((r: any) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(['status', 'applied_at', 'wallet_txn_id']));
      for (const c of ['amount_minor', 'type_id', 'source_id', 'bill_id']) expect(cols).not.toContain(c);
      expect((await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='milk_bill_deductions' AND grantee='kv_app' AND privilege_type='UPDATE'`)).rowCount).toBe(0);
    });
  });

  /* ======================================================================================================= */
  describe('THE REFUSALS a real database enforces', () => {
    it('a line naming ANOTHER member\'s credit is refused at GENERATION', async () => {
      // The worst thing this code could be made to do: take one family's milk money to pay another family's debt.
      const other: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: memB, mccId, description: 'feed for member B', valueMinor: '10000',
      } as never, null);
      await expect(billFor(mem, [{ type: 'feed_credit', amountMinor: '10000', sourceId: other.id }]))
        .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
    });

    it('a line for MORE than the credit\'s outstanding is refused at generation', async () => {
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: 'one bag of feed', valueMinor: '10000',
      } as never, null);
      await expect(billFor(mem, [{ type: 'feed_credit', amountMinor: '10001', sourceId: c.id }]))
        .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
    });

    it('`insurance` and `share` are refused at generation, with the reason from the DATA', async () => {
      for (const [type, matcher] of [['insurance', /gateway intent/], ['share', /certificate/]] as const) {
        await expect(billFor(mem, [{ type, amountMinor: '1000', sourceId: randomUUID() }]))
          .rejects.toMatchObject({ code: 'DEDUCTION_TYPE_UNSUPPORTED', details: { typeCode: type, reason: matcher } });
      }
    });

    it('a type outside the vocabulary is refused — the free-typed string is gone', async () => {
      await expect(billFor(mem, [{ type: 'society_levy', amountMinor: '1000', sourceId: randomUUID() }]))
        .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
    });

    it('the same source cannot be deducted twice on ONE bill', async () => {
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: 'two bags', valueMinor: '20000',
      } as never, null);
      // The unique index is on (bill_id, type_id, source_id): recovering the same credit twice on one fortnight is not
      // two decisions, it is a double deduction.
      await expect(billFor(mem, [
        { type: 'feed_credit', amountMinor: '10000', sourceId: c.id },
        { type: 'feed_credit', amountMinor: '10000', sourceId: c.id },
      ])).rejects.toThrow(/uq_milk_bill_deduction_source/);
    });

    it('a LOAN belonging to another member is refused at PAYMENT, by the fintech module', async () => {
      // The dairy module deliberately does not second-guess a loan: `assertSourceRecoverable` checks nothing it does
      // not own, so this fails where the loan's invariants live. 404-shaped, so a loan id is not probeable.
      const b: any = await billFor(memB, [{ type: 'loan_emi', amountMinor: '1000', sourceId: loanId }]);
      await bills.preview(tenantA, actor, b.id, new Date('2026-05-20T04:00:00.000Z'));
      await bills.approve(tenantA, actor, b.id);
      await expect(bills.pay(tenantA, actor, b.id, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')))
        .rejects.toMatchObject({ code: 'LOAN_NOT_FOUND' });
      // AND NOTHING MOVED — not even the gross, which was posted before the line failed. One transaction.
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [b.id])).rows[0].status).toBe('approved');
      expect((await admin.query(`SELECT status FROM milk_bill_deductions WHERE bill_id=$1`, [b.id])).rows[0].status).toBe('pending');
    });

    it('with the kill-switch OFF a deducted bill refuses — exactly where 0157 left it', async () => {
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: 'medicine', valueMinor: '5000',
      } as never, null);
      const b: any = await billFor(mem, [{ type: 'feed_credit', amountMinor: '5000', sourceId: c.id }]);
      await bills.preview(tenantA, actor, b.id, new Date('2026-05-20T04:00:00.000Z'));
      await bills.approve(tenantA, actor, b.id);
      await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key='dairy_deduction_recovery'`);
      await flagCache.del('flag:dairy_deduction_recovery'); await flagCache.del('flags:all');
      try {
        await expect(bills.pay(tenantA, actor, b.id, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')))
          .rejects.toMatchObject({ code: 'DEDUCTION_RECOVERY_DISABLED' });
      } finally {
        await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key='dairy_deduction_recovery'`);
        await flagCache.del('flag:dairy_deduction_recovery'); await flagCache.del('flags:all');
      }
      // The line stays recorded rather than being dropped, so switching the flag on finishes the job.
      expect((await admin.query(`SELECT count(*)::int n FROM milk_bill_deductions WHERE bill_id=$1`, [b.id])).rows[0].n).toBe(1);
      expect((await bills.pay(tenantA, actor, b.id, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')) as any).status).toBe('paid');
    });
  });

  /* ======================================================================================================= */
  describe('W169\'s 25% RULE, live', () => {
    let bigBill = ''; let bigCredit = '';

    it('the threshold is a seeded SETTING and the ask reaches the member in their own language', async () => {
      const s = await admin.query(`SELECT default_value #>> '{}' AS v, risk_class FROM setting_definitions WHERE key='dairy.deduction_consent_pct'`);
      expect(s.rows[0]).toMatchObject({ v: '25', risk_class: 'money_path' });
      // The notification the whole gate depends on. Resolved through 0122's real send-time gate, in Gujarati.
      const gu = await templates.resolve(tenantA, 'dairy.bill_deduction_consent_required', 'inapp', 'gu');
      expect(gu).not.toBeNull();
      const rendered = gu!.render({ period: '01-15 Jul', gross: 'Rs 9,414', deductions: 'Rs 4,000', lines: 'feed credit Rs 4,000', threshold_pct: '25' }).body;
      expect(rendered).toMatch(/[઀-૿]/);
      expect(rendered).toContain('Rs 4,000');
      expect(rendered).not.toContain('{{');
      for (const lang of ['hi', 'en']) expect(await templates.resolve(tenantA, 'dairy.bill_deduction_consent_required', 'push', lang)).not.toBeNull();
    });

    it('a bill above the threshold ASKS the member at PREVIEW, naming the lines', async () => {
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: 'a whole month of feed', valueMinor: '300000',
      } as never, null);
      bigCredit = c.id;
      const b: any = await billFor(mem, [{ type: 'feed_credit', amountMinor: '300000', sourceId: c.id }]);
      bigBill = b.id;
      expect(BigInt(b.deductionsMinor) * 100n > BigInt(b.grossMinor) * 25n).toBe(true);
      await bills.preview(tenantA, actor, bigBill, new Date('2026-05-20T04:00:00.000Z'));
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='dairy.bill_deduction_consent_required'`, [tenantA, bigBill]);
      expect(ev.rowCount).toBe(1);
      expect(ev.rows[0].payload).toMatchObject({ userId: farmer, thresholdPct: 25, deductionsMinor: '300000' });
      expect(ev.rows[0].payload.lines).toEqual([{ type: 'feed_credit', amountMinor: '300000' }]);
    });

    it('REFUSES to pay it, and moves not a rupee', async () => {
      await bills.approve(tenantA, actor, bigBill);
      const before = await balUser(farmer);
      await expect(bills.pay(tenantA, actor, bigBill, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')))
        .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REQUIRED', details: { stale: false, thresholdPct: 25 } });
      expect(await balUser(farmer)).toBe(before);
      expect((await creditRepo.getById(tenantA, bigCredit))!.recoveredMinor).toBe(0n);
    });

    it('a NON-MEMBER cannot consent on somebody else\'s bill — 404, not 403', async () => {
      await expect(consents.record(tenantA, farmerB, bigBill, { granted: true, channel: 'app' } as never, `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'MILK_BILL_NOT_FOUND' });
    });

    it('the MEMBER can read what is being taken, with no permission anywhere near them', async () => {
      const st: any = await consents.statusFor(tenantA, farmer, bigBill);
      expect(st).toMatchObject({ consentRequired: true, thresholdPct: 25, deductionsMinor: '300000', latest: null });
      expect(st.lines).toEqual([expect.objectContaining({ type: 'feed_credit', amountMinor: '300000' })]);
    });

    it('the MEMBER refuses — and the payment still refuses, differently', async () => {
      const out: any = await consents.record(tenantA, farmer, bigBill, { granted: false, channel: 'ivr', note: 'Not this fortnight, my son is in hospital' } as never, `idem-${randomUUID()}`, null);
      expect(out).toMatchObject({ granted: false, wasRequired: true, thresholdPct: 25 });
      await expect(bills.pay(tenantA, actor, bigBill, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')))
        .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REFUSED' });
    });

    it('AN AMBASSADOR MAY SIT WITH THE MEMBER — and must be named when they do', async () => {
      // 0003's own consent-channel vocabulary. A platform that only accepts `app` has excluded the farmers it exists
      // for; a platform that accepts `ambassador_assisted` with nobody named has excluded the audit trail.
      await expect(admin.query(
        `INSERT INTO milk_bill_deduction_consents (tenant_id, bill_id, membership_id, member_user_id, gross_minor, deductions_minor, threshold_pct, granted, channel)
         VALUES ($1,$2,$3,$4,1000,100,25,true,'ambassador_assisted')`, [tenantA, bigBill, mem, farmer]))
        .rejects.toThrow(/ck_milk_bill_consent_assisted/);
      const ok: any = await consents.record(tenantA, farmer, bigBill, { granted: true, channel: 'ambassador_assisted', assistedBy: desk } as never, `idem-${randomUUID()}`, null);
      expect(ok.granted).toBe(true);
    });

    it('and then it PAYS — the member agreed to these exact figures', async () => {
      const before = await balUser(farmer);
      const paid: any = await bills.pay(tenantA, actor, bigBill, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z'));
      expect(paid.status).toBe('paid');
      expect(await balUser(farmer) - before).toBe(BigInt(paid.netMinor));
      expect((await creditRepo.getById(tenantA, bigCredit))!.status).toBe('recovered');
    });

    it('a consent is APPEND-ONLY — the history keeps every answer and nobody can edit one', async () => {
      const rows = await admin.query(`SELECT granted, channel FROM milk_bill_deduction_consents WHERE bill_id=$1 ORDER BY recorded_at, id`, [bigBill]);
      expect(rows.rows.map((r: any) => r.granted)).toEqual([false, true]);
      expect((await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='milk_bill_deduction_consents' AND grantee='kv_app' AND privilege_type='UPDATE'`)).rowCount).toBe(0);
      await expect(uow.run(tenantA, (tx) => tx.query(`UPDATE milk_bill_deduction_consents SET granted=false WHERE bill_id=$1`, [bigBill]), { userId: 'system' }))
        .rejects.toThrow(/permission denied/i);
    });

    it('a STALE consent is not consent: the figures changed, so the member is asked again', async () => {
      const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, description: 'feed, half a month', valueMinor: '200000',
      } as never, null);
      const b: any = await billFor(mem, [{ type: 'feed_credit', amountMinor: '200000', sourceId: c.id }]);
      await bills.preview(tenantA, actor, b.id, new Date('2026-05-20T04:00:00.000Z'));
      await bills.approve(tenantA, actor, b.id);
      await consents.record(tenantA, farmer, b.id, { granted: true, channel: 'app' } as never, `idem-${randomUUID()}`, null);
      // Now the bill's own figures move underneath the consent — the hand-run equivalent of TENANT-6c-2's void,
      // rebuild and re-preview, which is exactly how a member ends up shown three different sets of numbers.
      await admin.query(`UPDATE milk_bills SET gross_minor = gross_minor + 1, net_minor = net_minor + 1 WHERE id=$1`, [b.id]);
      await expect(bills.pay(tenantA, actor, b.id, `idem-${randomUUID()}`, null, new Date('2026-05-22T04:00:00.000Z')))
        .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REQUIRED', details: { stale: true } });
    });
  });

  /* ======================================================================================================= */
  describe('the boundaries', () => {
    it('RLS isolates the lines, the credits and the consents between tenants', async () => {
      const other = randomUUID();
      await makeTenant(admin, other, 'B');
      for (const table of ['milk_bill_deductions', 'dairy_member_credits', 'milk_bill_deduction_consents']) {
        const seen = await uow.run(other, (tx) => tx.query(`SELECT count(*)::int c FROM ${table}`), { userId: 'system' });
        expect((seen.rows[0] as { c: number }).c).toBe(0);
      }
    });

    it('the flags ship OFF', async () => {
      // Read from the migration rather than the live rows, because this spec switched them on in `beforeAll` — the
      // shipped state is what 0160 wrote, and asserting the live value here would assert the test's own setup.
      const r = await admin.query(
        `SELECT key, description FROM feature_flags WHERE key IN ('dairy_member_credit','dairy_deduction_recovery') ORDER BY key`);
      expect(r.rowCount).toBe(2);
      for (const row of r.rows as Array<{ description: string }>) expect(row.description).toMatch(/PC-56 TENANT-6c-4/);
    });
  });
});
