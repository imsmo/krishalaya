// modules/dairy/__tests__/tenant6c3-second-signature.integration.spec.ts · PC-56 TENANT-6c-3, LIVE Postgres.
//
// W169: *"Preview/approve needs dairy-desk + `settlement.close` + checker — this is 312 families' milk money."*
//
// Four things here can only be proven against the real database:
//
//   1. **THE GRANT IS GONE FROM AN INSTALL THAT ALREADY RAN THE SEED.** The unit spec asserts the seed's text and the
//      migration's DELETE; only a live query can prove that after migrations AND seeds have both run — in that order,
//      which is the order that created the notification-template defect in 6c-2 — no `dairy_farmer` row carries
//      `dairy.manage`. A seed edit alone would leave every existing cooperative with farmers holding the pay verb.
//
//   2. **THE CHECKER RULE IS TRUE OF THE ROW.** The aggregate refuses it; `ck_dairy_bill_cycle_maker_ne_checker` makes
//      it true no matter what wrote it — a hand-run UPDATE during an incident, a future job, a bug.
//
//   3. **THE STATUS VOCABULARY MOVED.** 6c-2's spec proved `approved` was unreachable, because it was. It is reachable
//      now and `paid` still is not, and the difference between those two facts is the honest edge of this wave.
//
//   4. **THE ORDERING W169 DESCRIBES.** A bill is approved on Thursday evening while the member's window runs to Friday
//      morning. Approval is the cooperative agreeing its own figures; the PAYMENT is what waits for the member. Only a
//      live run can show the approval landing and the payment still refusing, on the same row, at the same instant.
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

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
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
import { MilkBillDisputeService } from '../services/milk-bill-dispute.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { previousCycleWindow } from '../domain/dairy-cycle';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6c-3 · the second signature (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService;
  let cycles: DairyBillCycleService; let cycleRepo: DairyBillCycleRepository;
  let disputes: MilkBillDisputeService;

  const tenantA = randomUUID();
  const desk = randomUUID();       // the dairy desk: dairy.manage + settlement.close (the MAKER, who previews)
  const admin2 = randomUUID();     // the tenant admin: both keys too (the CHECKER, who approves)
  const farmerA = randomUUID();
  const farmerB = randomUUID();

  /** Both keys. The desk previews with this; `checker` approves with it. */
  const maker = { userId: desk, canManage: true, canCloseSettlement: true };
  const checker = { userId: admin2, canManage: true, canCloseSettlement: true };
  /** The dairy desk WITHOUT 0144's key — the shape TENANT-6c-2 shipped. */
  const deskOnly = { userId: desk, canManage: true };

  let mccId = ''; let memA = ''; let memB = ''; let cycleId = ''; let billA = ''; let billB = '';
  let win = { from: '', to: '', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [desk, admin2, farmerA, farmerB]) await makeUser(admin, u);

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

    const mccRepo = new MccCentreRepository(replica as never);
    const memRepo = new DairyMembershipRepository(replica as never);
    const cardRepo = new MilkRateCardRepository(replica as never);
    const collRepo = new MilkCollectionRepository(replica as never);
    const billRepo = new MilkBillRepository(replica as never);
    const reviewRepo = new MilkQualityReviewRepository(replica as never);
    cycleRepo = new DairyBillCycleRepository(replica as never);
    const disputeRepo = new MilkBillDisputeRepository(replica as never);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags);
    const lineRepo = new MilkBillDeductionRepository(replica as never);
    const typeRepo = new DairyDeductionTypeRepository(replica as never);
    const creditRepo = new DairyMemberCreditRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    const instructionRepo = new DairyDeductionInstructionRepository(replica as never);
    const assembler = new DairyDeductionAssemblerService(instructionRepo, creditRepo, typeRepo, memRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, cycleRepo,
      // [PC-56 TENANT-6c-4] the deduction's destination: the lines, the vocabulary, the credits, the consent, the
      // applier that posts each line to what it pays, and the recovery kill-switch.
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags,
      // [PC-56 TENANT-6c-5] the REAL assembler — this is a live spec, so a mock here would be a spec that proves the
      // wiring of a fake.
      assembler);
    cycles = new DairyBillCycleService(uow, outbox, metrics, idem, cycleRepo, collRepo, bills, billRepo, memRepo,
      lineRepo, flags);
    disputes = new MilkBillDisputeService(uow, outbox, idem, metrics, audit, disputeRepo, billRepo, memRepo, cycleRepo, bills);

    await fundTenant(tenantA, 100_000_000n);

    const today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;
    const prev = previousCycleWindow(today, 'fortnightly');
    win = { ...win, from: prev.from, to: prev.to };

    mccId = (await mccs.create(tenantA, maker, `idem-${randomUUID()}`, { code: 'MCC-AND-03', defaultName: 'Anand 03' } as never, null)).id;
    await cards.create(tenantA, maker, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v5', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    memA = (await memberships.create(tenantA, maker, `idem-${randomUUID()}`, { farmerUserId: farmerA, mccId, memberCode: 'AND3-0001', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;
    memB = (await memberships.create(tenantA, maker, `idem-${randomUUID()}`, { farmerUserId: farmerB, mccId, memberCode: 'AND3-0002', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;

    // TWO members, because the cycle-level facts this wave adds — "how many did the pass sign", "how many were held
    // out because somebody objected" — are invisible with one.
    for (const m of [memA, memB]) {
      await collections.record(tenantA, maker, `idem-${randomUUID()}`, {
        membershipId: m, mccId, shift: 'morning', collectedOn: prev.to,
        weightKg: '8.615', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
      } as never);
    }

    await cycles.ensureCycles(tenantA);
    await cycles.closeDue(tenantA, new Date());
    await cycles.buildBills(tenantA);
    cycleId = (await uow.run(tenantA, (tx) => cycleRepo.findByWindow(tx, tenantA, win), { userId: 'system' }))!.id;
    const rows = await admin.query(`SELECT id, membership_id FROM milk_bills WHERE tenant_id=$1 ORDER BY created_at, id`, [tenantA]);
    billA = rows.rows.find((r: any) => r.membership_id === memA).id;
    billB = rows.rows.find((r: any) => r.membership_id === memB).id;
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE GRANT A FARMER SHOULD NEVER HAVE HAD', () => {
    it('is gone from the LIVE grant matrix — migrations and seeds have both run', async () => {
      // The wave's worst finding: `dairy_farmer` held `dairy.manage`, whose own description is "Manage dairy MCC +
      // collections + milk bills". Any user carrying the farmer role could set the rate card that decides what every
      // member is paid, record collections, generate bills, approve them, and PAY them out of the cooperative's wallet.
      const r = await admin.query(
        `SELECT count(*)::int AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE r.code = 'dairy_farmer' AND rp.permission_code = 'dairy.manage'`);
      expect(r.rows[0].n).toBe(0);
    });

    it('and the OPERATOR still has it — the fix is a narrowing, not a removal', async () => {
      const r = await admin.query(
        `SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_code = 'dairy.manage' ORDER BY r.code`);
      const codes = r.rows.map((x: { code: string }) => x.code);
      expect(codes).toContain('tenant_admin');
      expect(codes).not.toContain('dairy_farmer');
    });

    it('`settlement.close` sits with the tenant admin, which is WHY the second signature is a second person', async () => {
      // 0144 granted it to `tenant_admin` only. That is not an accident this wave works around — it is the shape that
      // makes "dairy-desk + settlement.close + checker" mean two humans rather than one person with two keys.
      const r = await admin.query(
        `SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_code = 'settlement.close' ORDER BY r.code`);
      const codes = r.rows.map((x: { code: string }) => x.code);
      expect(codes).toContain('tenant_admin');
      expect(codes).not.toContain('dairy_farmer');
      expect(r.rowCount).toBeGreaterThan(0);   // and it is granted SOMEWHERE — 0144 seeded it with no grant at all
    });

  });

  /* ======================================================================================================= */
  describe('THE SECOND KEY, on both acts', () => {
    it('the dairy desk ALONE can no longer preview a cycle — the shape 6c-2 shipped', async () => {
      await expect(cycles.previewCycle(tenantA, deskOnly as never, cycleId))
        .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
      expect((await admin.query(`SELECT status FROM dairy_bill_cycles WHERE id=$1`, [cycleId])).rows[0].status).toBe('closed');
    });

    it('an actor with NO settlement key at all is refused too — absent means false, never assumed', async () => {
      // `canCloseSettlement` is OPTIONAL on `DairyActor` so every existing caller compiles; an omitted field must
      // therefore FAIL CLOSED rather than read as permissive.
      await expect(cycles.approveCycle(tenantA, { userId: desk, canManage: true } as never, cycleId))
        .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    });

    it('with both keys the desk previews, and the cycle records WHO', async () => {
      const out = await cycles.previewCycle(tenantA, maker, cycleId);
      expect(out).toMatchObject({ previewed: 2, failed: 0, remaining: 0 });
      const c = (await admin.query(`SELECT status, previewed_by, previewed_at, bills_previewed FROM dairy_bill_cycles WHERE id=$1`, [cycleId])).rows[0];
      expect(c).toMatchObject({ status: 'previewed', previewed_by: desk, bills_previewed: 2 });
      expect(c.previewed_at).not.toBeNull();
    });

    it('and a MEMBER then objects with no dairy permission anywhere near them', async () => {
      // The claim 0159 makes out loud, and the reason taking `dairy.manage` off the farmer role breaks nothing:
      // raising a dispute is the member-facing WRITE and it authorises by OWNERSHIP. `farmerB` holds no dairy
      // permission at all, the role no longer carries one, and the objection still lands.
      //
      // ORDER MATTERS AND IT IS W169'S ORDER: a member can only object to a bill they have been SHOWN, so this cannot
      // be asserted before the preview — 6c-2's `dispute()` refuses a bill with no open window
      // (`DisputeWindowClosedError`, "not been shown to its member yet"). It also sets up the next section: one of the
      // two bills is now held out of the approval pass.
      const d = await disputes.raise(tenantA, farmerB, billB, 'my litres look short this fortnight', `idem-${randomUUID()}`, null);
      expect(d.status).toBe('open');
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [billB])).rows[0].status).toBe('disputed');
      // "disputed pauses one bill, never the cycle."
      expect((await admin.query(`SELECT status FROM dairy_bill_cycles WHERE id=$1`, [cycleId])).rows[0].status).toBe('previewed');
    });
  });

  /* ======================================================================================================= */
  describe('THE CHECKER RULE', () => {
    it('REFUSES the person who previewed it, and moves not one bill', async () => {
      const before = (await admin.query(`SELECT count(*)::int AS n FROM milk_bills WHERE tenant_id=$1 AND status='approved'`, [tenantA])).rows[0].n;
      await expect(cycles.approveCycle(tenantA, maker, cycleId))
        // The refusal carries the REASON as its code, so a console can say which rule stopped it rather than
        // "approval refused": `DAIRY_CYCLE_CHECKER_IS_PREVIEWER` vs `DAIRY_CYCLE_NOT_PREVIEWED`.
        .rejects.toMatchObject({ code: 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER' });
      const c = (await admin.query(`SELECT status, approved_by, approved_at FROM dairy_bill_cycles WHERE id=$1`, [cycleId])).rows[0];
      expect(c).toMatchObject({ status: 'previewed', approved_by: null, approved_at: null });
      expect((await admin.query(`SELECT count(*)::int AS n FROM milk_bills WHERE tenant_id=$1 AND status='approved'`, [tenantA])).rows[0].n).toBe(before);
    });

    it('is a DATABASE constraint as well — true of the row whatever wrote it', async () => {
      // A hand-run UPDATE during an incident is exactly the path a domain check cannot see. 0143 put the same
      // constraint on `payout_batches` for the same reason.
      await expect(admin.query(`UPDATE dairy_bill_cycles SET approved_at=now(), approved_by=previewed_by WHERE id=$1`, [cycleId]))
        .rejects.toThrow(/ck_dairy_bill_cycle_maker_ne_checker/);
    });

    it('and an approval STAMP cannot be half-written, nor exist without the preview it followed', async () => {
      await expect(admin.query(`UPDATE dairy_bill_cycles SET approved_at=now() WHERE id=$1`, [cycleId]))
        .rejects.toThrow(/ck_dairy_bill_cycle_approve_stamp/);
      await expect(admin.query(`UPDATE dairy_bill_cycles SET approved_by=$2 WHERE id=$1`, [cycleId, admin2]))
        .rejects.toThrow(/ck_dairy_bill_cycle_approve_stamp/);
      // A cycle no member was ever shown cannot be approved: 6c-1's `closed` cycle has no preview stamp.
      const other = (await uow.run(tenantA, (tx) => cycleRepo.ensure(tx, tenantA, { ...win, ...previousCycleWindow(win.from, 'fortnightly') }), { userId: 'system' }));
      await expect(admin.query(
        `UPDATE dairy_bill_cycles SET status='approved', approved_at=now(), approved_by=$2, closed_at=now() WHERE id=$1`, [other.id, admin2]))
        .rejects.toThrow(/ck_dairy_bill_cycle_approved_after_preview|ck_dairy_bill_cycle_closed_stamp/);
    });
  });

  /* ======================================================================================================= */
  describe('THE VOCABULARY MOVED — and stopped where this wave stops', () => {
    it('`approved` is REACHABLE now; 6c-2\'s spec proved it was not, because it was not', async () => {
      const out = await cycles.approveCycle(tenantA, checker, cycleId);
      // One bill signed; one held out because its member objected. "disputed pauses one bill, never the cycle."
      expect(out).toMatchObject({ approved: 1, failed: 0, remaining: 0, skippedDisputed: 1 });
      const c = (await admin.query(`SELECT status, approved_by, previewed_by, approved_at, bills_approved FROM dairy_bill_cycles WHERE id=$1`, [cycleId])).rows[0];
      expect(c).toMatchObject({ status: 'approved', approved_by: admin2, previewed_by: desk, bills_approved: 1 });
      expect(c.approved_at).not.toBeNull();
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [billA])).rows[0].status).toBe('approved');
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [billB])).rows[0].status).toBe('disputed');
    });

    it('publishes the cycle-level signature ONCE, naming BOTH humans', async () => {
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='dairy.cycle_approved'`, [tenantA, cycleId]);
      expect(ev.rowCount).toBe(1);
      expect(ev.rows[0].payload).toMatchObject({ previewedBy: desk, approvedBy: admin2 });
      // Deliberately NO `userId`: this is a governance record, not a notice to a member. A payload carrying `userId`
      // would be picked up by NOTIFICATION_EVENT_MAP's recipient resolution the moment somebody mapped the event, and
      // 312 families would be texted that their cooperative agreed its own figures.
      expect(ev.rows[0].payload.userId).toBeUndefined();
    });

    it('a RE-PRESS finishes the pass without a second signature and without a second event', async () => {
      const out = await cycles.approveCycle(tenantA, checker, cycleId);
      expect(out).toMatchObject({ approved: 0, remaining: 0, skippedDisputed: 1 });
      const ev = await admin.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='dairy.cycle_approved'`, [tenantA, cycleId]);
      expect(ev.rows[0].n).toBe(1);
    });

    it('`paid` is still NOT a cycle status — the deduction has no destination and the payout batch does not exist', async () => {
      // 6c-2's spec asserted `approved` was refused here. It is admitted now and this is its replacement: the honest
      // edge of the wave. TENANT-6c-4 is the deduction's destination; the batch behind "one bank trip" is later still.
      await expect(admin.query(`UPDATE dairy_bill_cycles SET status='paid' WHERE id=$1`, [cycleId]))
        .rejects.toThrow(/ck_dairy_bill_cycle_status/);
    });

    it('the flag gating approval ships OFF, and is a SEPARATE flag from the preview\'s', async () => {
      const r = await admin.query(`SELECT key, is_enabled FROM feature_flags WHERE key IN ('dairy_cycle_approve','dairy_cycle_preview') ORDER BY key`);
      expect(r.rowCount).toBe(2);
      for (const row of r.rows as Array<{ is_enabled: boolean }>) expect(row.is_enabled).toBe(false);
    });

    it('the approver\'s claim has an index, so "which cycles await a signature" is not a scan', async () => {
      const r = await admin.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename='dairy_bill_cycles' AND indexname='idx_dairy_cycle_awaiting_approval'`);
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].indexdef).toMatch(/tenant_id/);
      expect(r.rows[0].indexdef).toMatch(/'previewed'/);
      expect(r.rows[0].indexdef).toMatch(/deleted_at IS NULL/);
    });
  });

  /* ======================================================================================================= */
  describe('THE ORDERING W169 ACTUALLY DESCRIBES', () => {
    it('the bill is APPROVED while its member\'s window is still OPEN', async () => {
      const r = (await admin.query(`SELECT status, dispute_window_ends FROM milk_bills WHERE id=$1`, [billA])).rows[0];
      expect(r.status).toBe('approved');
      expect(new Date(r.dispute_window_ends).getTime()).toBeGreaterThan(Date.now());
    });

    it('and the PAYMENT still refuses, and moves not a rupee', async () => {
      const before = await balUser(farmerA);
      await expect(bills.pay(tenantA, checker, billA, `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'DISPUTE_WINDOW_OPEN' });
      expect(await balUser(farmerA)).toBe(before);
    });

    it('once the window shuts, the money moves — approval was the cooperative\'s act, not the member\'s', async () => {
      const ends = (await admin.query(`SELECT dispute_window_ends FROM milk_bills WHERE id=$1`, [billA])).rows[0].dispute_window_ends;
      const before = await balUser(farmerA);
      const paid = await bills.pay(tenantA, checker, billA, `idem-${randomUUID()}`, null, new Date(new Date(ends).getTime() + 1000));
      expect(paid.status).toBe('paid');
      expect(await balUser(farmerA) - before).toBe(BigInt(paid.netMinor));
    });

    it('a single bill cannot be approved with the dairy desk key alone either', async () => {
      // The per-bill route carries both permissions too, and the service enforces them — otherwise the cycle gate
      // would be a front door beside an open window.
      await expect(bills.approve(tenantA, deskOnly as never, billB))
        .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    });
  });

  /* ======================================================================================================= */
  describe('the boundaries', () => {
    it('the app role can write the approval stamps and NOTHING ELSE it did not already have', async () => {
      const r = await admin.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name='dairy_bill_cycles' AND grantee='kv_app' AND privilege_type='UPDATE' ORDER BY column_name`);
      const cols = r.rows.map((x: { column_name: string }) => x.column_name);
      for (const c of ['approved_at', 'approved_by', 'bills_approved']) expect(cols).toContain(c);
      // 0157's lesson, re-checked because ALTER DEFAULT PRIVILEGES on this database grants kv_app table-level UPDATE at
      // CREATE TABLE time and a table grant supersedes every column grant — a narrowing migration must REVOKE first.
      const tablePriv = await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='dairy_bill_cycles' AND grantee='kv_app' AND privilege_type='UPDATE'`);
      expect(tablePriv.rowCount).toBe(0);
      // The WINDOW stays out of reach: a cooperative's app role must not be able to move its own close instant or its
      // payday. `previewed_by`/`approved_by` ARE writable — they are what the two acts record.
      for (const c of ['period_start', 'period_end', 'closes_at', 'payday', 'payment_cycle']) expect(cols).not.toContain(c);
    });

    it('RLS isolates cycles between tenants', async () => {
      const other = randomUUID();
      await makeTenant(admin, other, 'B');
      const seen = await uow.run(other, (tx) => tx.query(`SELECT count(*)::int c FROM dairy_bill_cycles`), { userId: 'system' });
      expect((seen.rows[0] as { c: number }).c).toBe(0);
    });
  });
});
