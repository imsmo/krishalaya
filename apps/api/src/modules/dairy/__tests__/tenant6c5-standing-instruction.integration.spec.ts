// modules/dairy/__tests__/tenant6c5-standing-instruction.integration.spec.ts · PC-56 TENANT-6c-5, LIVE Postgres.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
//
// FIVE THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **THE CYCLE ACTUALLY ASSEMBLES.** The cadence path — `ensureCycles → closeDue → buildBills` — producing bills
//      that carry deduction lines nobody typed, from arrangements a member authorised. That is the sentence TENANT-6c-4
//      could not finish: its own live spec had to hand-enter every line.
//   2. **W169's HEADER TILE.** *"Deductions this cycle ₹1,84,300 — feed credit + loan EMI"* — measured across real
//      bills, and reported by the pass that created them.
//   3. **THE TWO PARTIAL UNIQUE INDEXES.** A NULL `source_id` is not covered by an ordinary unique constraint (6c-4's
//      139-duplicate finding), so only a live insert can prove a second blanket arrangement is refused.
//   4. **THE CROSS-MODULE READ.** `loan_products.repayment_style = 'milk_bill_deduction'` — a value nothing had ever
//      selected on — actually selecting the right loan and ignoring an `emi` one.
//   5. **THE CAP AGAINST REAL SETTINGS**, including a tenant override that tightens it.
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
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { DairyMemberCreditService } from '../services/dairy-member-credit.service';
import { DairyDeductionAssemblerService } from '../services/dairy-deduction-assembler.service';
import { DairyDeductionInstructionService } from '../services/dairy-deduction-instruction.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { previousCycleWindow } from '../domain/dairy-cycle';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6c-5 · the standing instruction (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService; let cycles: DairyBillCycleService;
  let credits: DairyMemberCreditService; let instructions: DairyDeductionInstructionService;
  let creditRepo: DairyMemberCreditRepository; let cycleRepo: DairyBillCycleRepository;
  let templates: NotificationTemplateRepository; let flagCache: InMemoryCacheService;

  const tenantA = randomUUID();
  const desk = randomUUID();
  const farmer = randomUUID();
  const farmerB = randomUUID();
  const actor = { userId: desk, canManage: true, canCloseSettlement: true };

  let mccId = ''; let mem = ''; let memB = '';
  let deductibleLoan = ''; let emiLoan = ''; let feedCredit = '';
  let win = { from: '', to: '', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };

  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  /** Flip a flag and drop the cached copy — `FlagsService` caches for 30s (6c-4's lesson). */
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2 WHERE key = $1`, [key, on]);
    await flagCache.del(`flag:${key}`); await flagCache.del('flags:all');
  };
  const setSetting = async (key: string, value: string) => {
    await admin.query(
      `INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`, [tenantA, key, JSON.stringify(value)]);
  };

  /** A loan for this member, through the FK chain, with the given product repayment style. */
  const makeLoan = async (borrower: string, style: string, principal: string, disbursedAt: string) => {
    const partnerId = randomUUID();
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, sla) VALUES ($1,$2,'Test Bank','bank','{}')`, [partnerId, `bank_${partnerId.slice(0, 8)}`]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='loan_kind' AND code='dairy' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0];
    const productId = randomUUID();
    await admin.query(
      `INSERT INTO loan_products (id, partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       VALUES ($1,$2,$3,$4,1,100000000,700,$5)`, [productId, partnerId, kind.id, `Dairy loan (${style})`, style]);
    const appId = randomUUID();
    await admin.query(
      `INSERT INTO loan_applications (id, tenant_id, applicant_user_id, product_id, amount_requested_minor, status)
       VALUES ($1,$2,$3,$4,$5,'disbursed')`, [appId, tenantA, borrower, productId, principal]);
    const loanId = randomUUID();
    await admin.query(
      `INSERT INTO loans (id, application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
       VALUES ($1,$2,$3,$4,$5,$6,700,$7::date,'active',$6)`, [loanId, appId, tenantA, borrower, partnerId, principal, disbursedAt]);
    return loanId;
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
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);

    const mccRepo = new MccCentreRepository(replica as never);
    const memRepo = new DairyMembershipRepository(replica as never);
    const cardRepo = new MilkRateCardRepository(replica as never);
    const collRepo = new MilkCollectionRepository(replica as never);
    const billRepo = new MilkBillRepository(replica as never);
    const reviewRepo = new MilkQualityReviewRepository(replica as never);
    cycleRepo = new DairyBillCycleRepository(replica as never);
    const lineRepo = new MilkBillDeductionRepository(replica as never);
    creditRepo = new DairyMemberCreditRepository(replica as never);
    const typeRepo = new DairyDeductionTypeRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    const instructionRepo = new DairyDeductionInstructionRepository(replica as never);
    templates = new NotificationTemplateRepository(replica as never);
    const loans = new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never));
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo, loans);
    const assembler = new DairyDeductionAssemblerService(instructionRepo, creditRepo, typeRepo, memRepo, loans);

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags);
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, cycleRepo,
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags, assembler);
    cycles = new DairyBillCycleService(uow, outbox, metrics, idem, cycleRepo, collRepo, bills, billRepo, memRepo, lineRepo, flags);
    credits = new DairyMemberCreditService(uow, outbox, idem, metrics, audit, creditRepo, memRepo, lineRepo);
    instructions = new DairyDeductionInstructionService(uow, outbox, idem, metrics, audit, instructionRepo, typeRepo, creditRepo, memRepo);

    await setFlag('dairy_member_credit', true);
    await setFlag('dairy_deduction_recovery', true);
    await fundTenant(tenantA, 100_000_000n);

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-05', defaultName: 'Anand 05' } as never, null)).id;
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v7', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    mem = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmer, mccId, memberCode: 'AND5-0001', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;
    memB = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmerB, mccId, memberCode: 'AND5-0002', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;

    // TWO loans for the same member: one the family agreed comes out of the milk cheque, one an ordinary EMI loan.
    // The second is the control — a reader that could not tell them apart would recover a bank loan nobody arranged.
    deductibleLoan = await makeLoan(farmer, 'milk_bill_deduction', '2000000', '2026-04-01');
    emiLoan = await makeLoan(farmer, 'emi', '2000000', '2026-03-01');

    const c: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
      membershipId: mem, mccId, description: '3 bags cattle feed', valueMinor: '60000',
    } as never, null);
    feedCredit = c.id;

    // One fortnight's pours for both members, so the cadence has something to bill.
    const today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;
    const prev = previousCycleWindow(today, 'fortnightly');
    win = { ...win, from: prev.from, to: prev.to };
    for (const m of [mem, memB]) {
      await collections.record(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: m, mccId, shift: 'morning', collectedOn: prev.to,
        weightKg: '60.000', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
      } as never);
    }
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE ARRANGEMENT — the member\'s own act', () => {
    it('a MEMBER authorises recovery from their own bill, with no permission anywhere near them', async () => {
      const out: any = await instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'feed_credit', channel: 'app',
      } as never, null);
      expect(out).toMatchObject({ typeCode: 'feed_credit', sourceId: null, isActive: true, authorisedBy: farmer, channel: 'app' });
      // And the member is TOLD, in their own language, through the real send-time gate.
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.deduction_instruction_authorised'`, [tenantA]);
      expect(ev.rowCount).toBe(1);
      expect(ev.rows[0].payload.userId).toBe(farmer);
      const gu = await templates.resolve(tenantA, 'dairy.deduction_instruction_authorised', 'inapp', 'gu');
      expect(gu).not.toBeNull();
      const rendered = gu!.render({ what: 'Feed / input credit', how_much: 'Rs 200 per cycle' }).body;
      expect(rendered).toMatch(/[઀-૿]/);
      expect(rendered).not.toContain('{{');
    });

    it('a SECOND blanket arrangement for the same type is refused — by the partial unique index', async () => {
      // `UNIQUE (membership_id, type_id, source_id)` would NOT have caught this: `source_id` is NULL and Postgres
      // treats NULLs as distinct in a unique index. 6c-4 found that costing the platform 139 duplicated lookup
      // values; here it would have meant two live arrangements disagreeing about one family's instalment.
      await expect(instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'feed_credit', channel: 'app', maxPerCycleMinor: '10000',
      } as never, null)).rejects.toMatchObject({ code: 'DAIRY_DEDUCTION_INSTRUCTION_INVALID' });
    });

    it('but a SOURCE-SPECIFIC one alongside it is allowed, and wins for that source', async () => {
      const out: any = await instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'feed_credit', sourceId: feedCredit, channel: 'ivr', maxPerCycleMinor: '20000',
      } as never, null);
      expect(out).toMatchObject({ sourceId: feedCredit, maxPerCycleMinor: '20000', channel: 'ivr' });
    });

    it('ANOTHER member cannot arrange a deduction on this membership — 404, not 403', async () => {
      await expect(instructions.authorise(tenantA, farmerB, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'feed_credit', channel: 'app',
      } as never, null)).rejects.toMatchObject({ code: 'DAIRY_MEMBERSHIP_NOT_FOUND' });
    });

    it('an arrangement for a type with NO destination is refused with the vocabulary\'s reason', async () => {
      for (const [type, matcher] of [['insurance', /gateway intent/], ['share', /certificate/]] as const) {
        await expect(instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
          membershipId: mem, type, channel: 'app',
        } as never, null)).rejects.toMatchObject({ code: 'DEDUCTION_TYPE_UNSUPPORTED', details: { reason: matcher } });
      }
    });

    it('an arrangement on ANOTHER member\'s credit is refused', async () => {
      const other: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: memB, mccId, description: 'feed for B', valueMinor: '10000',
      } as never, null);
      await expect(instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'feed_credit', sourceId: other.id, channel: 'app',
      } as never, null)).rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
    });

    it('the app role cannot rewrite what the member agreed to', async () => {
      const priv = await admin.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_name='dairy_deduction_instructions' AND grantee='kv_app' AND privilege_type='UPDATE' ORDER BY column_name`);
      const cols = priv.rows.map((r: any) => r.column_name);
      expect(cols).toEqual(expect.arrayContaining(['is_active', 'revoked_at', 'revoked_by']));
      for (const c of ['max_per_cycle_minor', 'type_id', 'source_id', 'authorised_by', 'channel']) expect(cols).not.toContain(c);
      expect((await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='dairy_deduction_instructions' AND grantee='kv_app' AND privilege_type='UPDATE'`)).rowCount).toBe(0);
      await expect(uow.run(tenantA, (tx) => tx.query(`UPDATE dairy_deduction_instructions SET max_per_cycle_minor = 1 WHERE membership_id=$1`, [mem]), { userId: 'system' }))
        .rejects.toThrow(/permission denied/i);
    });

    it('an assisted arrangement must name the ambassador — the DATABASE says so too', async () => {
      await expect(admin.query(
        `INSERT INTO dairy_deduction_instructions (tenant_id, membership_id, type_id, authorised_by, channel, recorded_by)
         SELECT $1,$2,lv.id,$3,'ambassador_assisted',$3 FROM lookup_values lv
          WHERE lv.type_code='milk_deduction' AND lv.code='loan_emi' AND lv.tenant_id IS NULL`, [tenantA, memB, farmerB]))
        .rejects.toThrow(/ck_dairy_ded_instruction_assisted/);
    });
  });

  /* ======================================================================================================= */
  describe('THE CADENCE — the line that used to be `deductions: []`', () => {
    let cycleId = '';

    it('with assembly OFF the cycle builds bills with NO deductions — where TENANT-6c-4 left it', async () => {
      await setFlag('dairy_deduction_assembly', false);
      await cycles.ensureCycles(tenantA);
      await cycles.closeDue(tenantA, new Date());
      const built = await cycles.buildBills(tenantA);
      expect(built.generated).toBe(2);
      expect(built.deductedMinor).toBe('0');
      cycleId = (await uow.run(tenantA, (tx) => cycleRepo.findByWindow(tx, tenantA, win), { userId: 'system' }))!.id;
      expect((await admin.query(`SELECT count(*)::int n FROM milk_bill_deductions WHERE tenant_id=$1`, [tenantA])).rows[0].n).toBe(0);
    });

    it('with assembly ON a REBUILT bill carries the member\'s arrangements, and nobody typed a line', async () => {
      // The bills above are voided so the fortnight can be rebuilt — 6c-2's void is what makes this testable at all.
      await setFlag('dairy_deduction_assembly', true);
      for (const row of (await admin.query(`SELECT id FROM milk_bills WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantA])).rows as any[]) {
        await bills.voidBill(tenantA, actor, row.id, 'rebuilding the fortnight with the member arrangements in place', null);
      }
      const fresh = (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' }))!;
      const out = await cycles.generateFor(tenantA, fresh);
      expect(out.generated).toBe(2);

      const lines = await admin.query(
        `SELECT lv.code, d.amount_minor, d.source_type, d.source_id, d.membership_id
           FROM milk_bill_deductions d JOIN lookup_values lv ON lv.id = d.type_id
           JOIN milk_bills b ON b.id = d.bill_id AND b.deleted_at IS NULL
          WHERE d.tenant_id=$1 ORDER BY lv.code`, [tenantA]);
      // ONE line: this member's feed credit, at the ₹200 instalment they arranged — not the whole ₹600 outstanding.
      expect(lines.rows).toMatchObject([
        { code: 'feed_credit', amount_minor: '20000', source_type: 'dairy_member_credit', source_id: feedCredit, membership_id: mem },
      ]);
      // And the OTHER member, who arranged nothing, is billed in full: their whole cheque is theirs.
      expect(lines.rows.every((r: any) => r.membership_id !== memB)).toBe(true);
    });

    it('reports W169\'s TILE — measured from the lines, and published once', async () => {
      const out = await cycles.generateFor(tenantA, (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' }))!);
      expect(out.deductedMinor).toBe('20000');
      const listed: any = await cycles.list(tenantA, actor, 10);
      // BY ID, not `[0]`: `ensureCycles` keeps the previous AND the current window alive, so the newest row is the
      // fortnight still collecting milk and has no bills at all. Asserting on the first row would have been asserting
      // the wrong cycle and passing only by accident of ordering.
      const thisCycle = listed.find((c: any) => c.id === cycleId);
      expect(thisCycle.deductions).toMatchObject({ totalMinor: '20000', byType: { feed_credit: '20000' } });
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.cycle_deductions_assembled' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(ev.rows[0].payload).toMatchObject({ totalMinor: '20000' });
    });

    it('a LOAN the family agreed to comes out too — and an ordinary EMI loan does NOT', async () => {
      // `repayment_style = 'milk_bill_deduction'` has existed since the fintech module was written and nothing had
      // ever selected on it. The `emi` loan is the control: a reader that could not tell them apart would recover a
      // bank loan nobody arranged from a family's milk cheque.
      await instructions.authorise(tenantA, farmer, `idem-${randomUUID()}`, {
        membershipId: mem, type: 'loan_emi', channel: 'ambassador_assisted', assistedBy: desk,
      } as never, null);
      for (const row of (await admin.query(`SELECT id FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2 AND deleted_at IS NULL`, [tenantA, mem])).rows as any[]) {
        await bills.voidBill(tenantA, actor, row.id, 'rebuilding after the member arranged the loan recovery too', null);
      }
      await cycles.generateFor(tenantA, (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' }))!);
      const lines = await admin.query(
        `SELECT lv.code, d.amount_minor, d.source_id FROM milk_bill_deductions d
           JOIN lookup_values lv ON lv.id = d.type_id
           JOIN milk_bills b ON b.id = d.bill_id AND b.deleted_at IS NULL
          WHERE d.tenant_id=$1 AND d.membership_id=$2 ORDER BY lv.code`, [tenantA, mem]);
      const byCode = Object.fromEntries(lines.rows.map((r: any) => [r.code, r]));
      expect(byCode.loan_emi.source_id).toBe(deductibleLoan);
      expect(byCode.loan_emi.source_id).not.toBe(emiLoan);
      // OLDEST FIRST, AND THIS IS WHAT IT LOOKS LIKE. The loan was disbursed on 1 April; the feed credit was issued
      // today. The gross is 479,400 and the cap is 25% of it — 119,850 — so the loan takes the WHOLE cap and the feed
      // credit is deferred to the next fortnight. A cooperative might prefer its own feed shop first; W169 does not
      // say so, and 0161 refuses to decide that silently.
      expect(byCode.loan_emi.amount_minor).toBe('119850');
      expect(byCode.feed_credit).toBeUndefined();
      expect(BigInt(byCode.loan_emi.amount_minor)).toBe((479_400n * 25n) / 100n);
    });

    it('NEVER assembles past the cap, and a tenant that tightens the setting is obeyed', async () => {
      await setSetting('dairy.deduction_assembly_max_pct', '5');
      for (const row of (await admin.query(`SELECT id FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2 AND deleted_at IS NULL`, [tenantA, mem])).rows as any[]) {
        await bills.voidBill(tenantA, actor, row.id, 'rebuilding to prove the tenant cap is obeyed', null);
      }
      await cycles.generateFor(tenantA, (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' }))!);
      const r = await admin.query(
        `SELECT COALESCE(SUM(d.amount_minor),0)::text AS total, b.gross_minor FROM milk_bills b
           LEFT JOIN milk_bill_deductions d ON d.bill_id = b.id
          WHERE b.tenant_id=$1 AND b.membership_id=$2 AND b.deleted_at IS NULL GROUP BY b.gross_minor`, [tenantA, mem]);
      const total = BigInt(r.rows[0].total);
      const gross = BigInt(r.rows[0].gross_minor);
      expect(total).toBeLessThanOrEqual((gross * 5n) / 100n);
      expect(total).toBeGreaterThan(0n);
      // AND THE BILL NEEDS NO CONSENT, which is the whole point of capping at min(assembly, consent): the automatic
      // path can never build a bill that needs a member's fresh answer before payday.
      expect(total * 100n <= gross * 25n).toBe(true);
      await setSetting('dairy.deduction_assembly_max_pct', '25');
    });

    it('a REVOKED arrangement stops the next cycle taking anything', async () => {
      const live = await admin.query(`SELECT id FROM dairy_deduction_instructions WHERE membership_id=$1 AND is_active`, [mem]);
      for (const row of live.rows as any[]) await instructions.revoke(tenantA, { userId: farmer, canManage: false }, row.id, null);
      for (const row of (await admin.query(`SELECT id FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2 AND deleted_at IS NULL`, [tenantA, mem])).rows as any[]) {
        await bills.voidBill(tenantA, actor, row.id, 'rebuilding after the member stopped every arrangement', null);
      }
      await cycles.generateFor(tenantA, (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' }))!);
      const n = await admin.query(
        `SELECT count(*)::int AS n FROM milk_bill_deductions d JOIN milk_bills b ON b.id=d.bill_id AND b.deleted_at IS NULL
          WHERE d.tenant_id=$1 AND d.membership_id=$2`, [tenantA, mem]);
      expect(n.rows[0].n).toBe(0);
      // The member is told it ended, too — a "you can stop this" nobody can verify is not a promise.
      const ev = await admin.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.deduction_instruction_revoked'`, [tenantA]);
      expect(ev.rows[0].n).toBeGreaterThan(0);
    });

    it('and the DEBT survives the revocation — stopping a deduction is not forgiving a loan', async () => {
      expect((await creditRepo.getById(tenantA, feedCredit))!.outstandingMinor).toBeGreaterThan(0n);
      const loan = await admin.query(`SELECT outstanding_minor FROM loans WHERE id=$1`, [deductibleLoan]);
      expect(BigInt(loan.rows[0].outstanding_minor)).toBeGreaterThan(0n);
    });
  });

  /* ======================================================================================================= */
  describe('the boundaries', () => {
    it('RLS isolates the arrangements between tenants', async () => {
      const other = randomUUID();
      await makeTenant(admin, other, 'B');
      const seen = await uow.run(other, (tx) => tx.query(`SELECT count(*)::int c FROM dairy_deduction_instructions`), { userId: 'system' });
      expect((seen.rows[0] as { c: number }).c).toBe(0);
    });

    it('the cap setting and the flag are both seeded, and the flag ships OFF', async () => {
      const s = await admin.query(`SELECT default_value #>> '{}' AS v, risk_class FROM setting_definitions WHERE key='dairy.deduction_assembly_max_pct'`);
      expect(s.rows[0]).toMatchObject({ v: '25', risk_class: 'money_path' });
      const f = await admin.query(`SELECT description FROM feature_flags WHERE key='dairy_deduction_assembly'`);
      expect(f.rows[0].description).toMatch(/PC-56 TENANT-6c-5/);
    });
  });
});
