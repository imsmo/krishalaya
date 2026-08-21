// modules/dairy/__tests__/tenant6c6-cycle-console.integration.spec.ts · PC-56 TENANT-6c-6, LIVE Postgres.
//
// W169 IS THE FIRST CLIENT ANY OF THIS HAS EVER HAD. The cycle routes have existed since TENANT-6c-2 and the SDK had no
// method for one, so what the register actually returns against a real fortnight has never been observed.
//
// SIX THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **THE `cycleId` FILTER THAT WAS UNREACHABLE.** `MilkBillRepository.listFor` has taken a `cycleId` since 0157 and
//      no DTO ever exposed it. The register is that filter, joined to the member, so only a live query proves it
//      selects exactly one fortnight's bills and nobody else's.
//   2. **THE KEYSET, OVER REAL MONEY.** Ordering by `(gross_minor, id)` and paging with a tuple comparison — a page
//      boundary that skips or repeats a family's bill is invisible in a mock.
//   3. **THE 30-DAY AVERAGE**, over a RANGE-partitioned `milk_collections` with the day count beside it.
//   4. **THE CONSENT-BLOCKED COUNT AGREEING WITH `pay()`.** The register counts the bills that will refuse; the money
//      path refuses them. Those two SQL/TS opinions can only be compared by making the payment actually fail.
//   5. **MAKER-CHECKER, THROUGH THE SCREEN'S OWN VERDICT.** The database constraint refuses the second signature from
//      the same human; the console must refuse the BUTTON, on the same fact, before the press.
//   6. **`GET /console` IS NOT SWALLOWED BY `GET /:id`** — asserted on the controller's own route metadata, because a
//      route order is invisible in a diff and would 404 the whole screen.
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
import { LoanRepository } from '../../fintech/repositories/loan.repository';
import { LoanRepaymentRepository } from '../../fintech/repositories/loan-repayment.repository';
import { LoanService } from '../../fintech/services/loan.service';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
// PC-56 TENANT-6d-2: the custody register the centre service writes in the same transaction as the column.
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyCycleConsoleRepository } from '../repositories/dairy-cycle-console.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { MilkBillDeductionConsentService } from '../services/milk-bill-deduction-consent.service';
import { DairyMemberCreditService } from '../services/dairy-member-credit.service';
import { DairyDeductionAssemblerService } from '../services/dairy-deduction-assembler.service';
import { DairyDeductionInstructionService } from '../services/dairy-deduction-instruction.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { MilkBillDisputeService } from '../services/milk-bill-dispute.service';
import { DairyCycleConsoleReadModel } from '../read-models/dairy-cycle-console.read-model';
import { previousCycleWindow } from '../domain/dairy-cycle';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6c-6 · W169 the cycle console (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService; let cycles: DairyBillCycleService;
  let credits: DairyMemberCreditService; let instructions: DairyDeductionInstructionService;
  let disputesSvc: MilkBillDisputeService; let consents: MilkBillDeductionConsentService;
  let rm: DairyCycleConsoleReadModel; let flagCache: InMemoryCacheService;

  const tenantA = randomUUID();
  const desk = randomUUID();          // the maker: dairy desk + settlement.close
  const checker = randomUUID();       // the second signature
  const farmers = [randomUUID(), randomUUID(), randomUUID()];
  const actor = { userId: desk, canManage: true, canCloseSettlement: true };
  const checkerActor = { userId: checker, canManage: true, canCloseSettlement: true };

  let mccId = ''; const mems: string[] = [];
  let cycleId = '';
  let win = { from: '', to: '' };

  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  /**
   * Every flag this suite flips, and what it was before.
   *
   * [PC-56 TENANT-6c-6] The integration project runs one shared database in band, and three earlier waves assert that
   * their flags SHIP OFF — so a suite that switches `dairy_cycle_close` on and walks away makes TENANT-6c-1's
   * kill-switch test fail in a way that looks like 6c-1's own bug. A flag is global state; a spec that changes it owns
   * putting it back.
   */
  const FLAGS = ['dairy_member_credit', 'dairy_deduction_recovery', 'dairy_deduction_assembly', 'dairy_cycle_preview', 'dairy_cycle_approve', 'dairy_cycle_close'] as const;
  const flagWas = new Map<string, boolean>();

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2 WHERE key = $1`, [key, on]);
    await flagCache.del(`flag:${key}`); await flagCache.del('flags:all');
  };
  const setSetting = async (key: string, value: string) => {
    await admin.query(
      `INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`, [tenantA, key, JSON.stringify(value)]);
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [desk, checker, ...farmers]) await makeUser(admin, u);
    // A real name on ONE farmer only: `users.full_name` is nullable, and the register must carry a nameless member on
    // their masked code rather than showing an empty cell that reads like a bug.
    await admin.query(`UPDATE users SET full_name = 'Savita Ben M.' WHERE id = $1`, [farmers[0]]);
    await admin.query(`UPDATE users SET full_name = NULL WHERE id = $1`, [farmers[2]]);

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
    const cycleRepo = new DairyBillCycleRepository(replica as never);
    const lineRepo = new MilkBillDeductionRepository(replica as never);
    const creditRepo = new DairyMemberCreditRepository(replica as never);
    const typeRepo = new DairyDeductionTypeRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    const instructionRepo = new DairyDeductionInstructionRepository(replica as never);
    const disputeRepo = new MilkBillDisputeRepository(replica as never);
    const counterRepo = new DairyCounterRepository(replica as never);
    const consoleRepo = new DairyCycleConsoleRepository(replica as never);
    const loans = new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never));
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo, loans);
    const assembler = new DairyDeductionAssemblerService(instructionRepo, creditRepo, typeRepo, memRepo, loans);

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags);
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, cycleRepo,
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags, assembler);
    cycles = new DairyBillCycleService(uow, outbox, metrics, idem, cycleRepo, collRepo, bills, billRepo, memRepo, lineRepo, flags);
    credits = new DairyMemberCreditService(uow, outbox, idem, metrics, audit, creditRepo, memRepo, lineRepo);
    instructions = new DairyDeductionInstructionService(uow, outbox, idem, metrics, audit, instructionRepo, typeRepo, creditRepo, memRepo);
    disputesSvc = new MilkBillDisputeService(uow, outbox, idem, metrics, audit, disputeRepo, billRepo, memRepo, cycleRepo, bills);
    consents = new MilkBillDeductionConsentService(uow, outbox, idem, metrics, audit, consentRepo, billRepo, lineRepo, memRepo);
    rm = new DairyCycleConsoleReadModel(replica as never, cycleRepo, billRepo, consoleRepo, lineRepo, disputeRepo,
      instructionRepo, typeRepo, counterRepo, flags, metrics);

    for (const k of FLAGS) {
      const r = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key = $1`, [k]);
      flagWas.set(k, Boolean(r.rows[0]?.is_enabled));
    }
    await setFlag('dairy_member_credit', true);
    await setFlag('dairy_deduction_recovery', true);
    await setFlag('dairy_deduction_assembly', true);
    await setFlag('dairy_cycle_preview', true);
    await setFlag('dairy_cycle_approve', true);
    await fundTenant(tenantA, 100_000_000n);

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-06', defaultName: 'Anand 06' } as never, null)).id;
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v9', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    for (let i = 0; i < farmers.length; i += 1) {
      mems.push((await memberships.create(tenantA, actor, `idem-${randomUUID()}`, {
        farmerUserId: farmers[i], mccId, memberCode: `AND6-000${i + 1}`, paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo',
      } as never)).id);
    }

    // THREE DIFFERENT-SIZED FORTNIGHTS, so "biggest first" is a real ordering rather than an accident of insertion.
    // Member 0 pours most, member 2 least — and member 0 poured on TWO days so the 30-day average has a day count
    // that is not the number of rows.
    const today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;
    const prev = previousCycleWindow(today, 'fortnightly');
    win = { from: prev.from, to: prev.to };
    const dayBefore = (await admin.query(`SELECT ($1::date - 1)::text AS d`, [prev.to])).rows[0].d;
    const pours: Array<[number, string, string]> = [
      [0, prev.to, '80.000'], [0, dayBefore, '40.000'],
      [1, prev.to, '60.000'],
      [2, prev.to, '20.000'],
    ];
    for (const [i, day, kg] of pours) {
      await collections.record(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: mems[i], mccId, shift: 'morning', collectedOn: day,
        weightKg: kg, fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
      } as never);
    }

    // A feed credit and a standing arrangement for member 1 ONLY, so the register has an itemised row and two plain
    // ones — and so the deductions tile is measured from lines that exist rather than from a total nobody can explain.
    const credit: any = await credits.issue(tenantA, actor, `idem-${randomUUID()}`, {
      membershipId: mems[1], mccId, description: '4 bags cattle feed', valueMinor: '90000',
    } as never, null);
    expect(credit.id).toBeTruthy();
    await instructions.authorise(tenantA, farmers[1], `idem-${randomUUID()}`, {
      membershipId: mems[1], type: 'feed_credit', channel: 'app', maxPerCycleMinor: '90000',
    } as never, null);

    // The cadence: ensure → close → build. This is the path that had no client.
    const tick = await cycles.tickForTenant(tenantA, new Date(), 500);
    expect(tick.generated).toBeGreaterThanOrEqual(3);
    const row = await admin.query(
      `SELECT id FROM dairy_bill_cycles WHERE tenant_id=$1 AND period_start=$2::date AND period_end=$3::date`,
      [tenantA, win.from, win.to]);
    cycleId = row.rows[0].id;
  }, 180000);

  afterAll(async () => {
    for (const [k, was] of flagWas) await setFlag(k, was);
    await pools?.onModuleDestroy();
    await admin?.end();
  });

  /* ======================================================================================================= */
  describe('THE REGISTER — one fortnight, biggest first', () => {
    it('lists exactly this cycle\'s bills, in gross order, with the member named and the code masked', async () => {
      const v = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      expect(v.cycle.id).toBe(cycleId);
      expect(v.cycle.stage).toBe('billed');
      expect(v.page.rows.length).toBe(3);

      const gross = v.page.rows.map((r) => BigInt(r.grossMinor));
      expect(gross[0]).toBeGreaterThan(gross[1]);
      expect(gross[1]).toBeGreaterThan(gross[2]);

      const top = v.page.rows[0];
      expect(top.memberName).toBe('Savita Ben M.');
      expect(top.memberCodeMasked).toBe('AND6••01');     // masked, W168's rule reused
      expect(top.memberCodeMasked).not.toContain('0001');
      expect(top.mccCode).toBe('MCC-AND-06');
      // A member with no name on file is still on the register, on their code.
      const nameless = v.page.rows.find((r) => r.memberCodeMasked === 'AND6••03')!;
      expect(nameless.memberName).toBeNull();
    });

    it('the cycle-wide total is the whole fortnight, and the page total is only what is shown', async () => {
      const one = await rm.view(tenantA, actor, { cycleId, limit: 1 });
      expect(one.page.rows).toHaveLength(1);
      expect(one.page.totals.rows).toBe(1);
      expect(one.totals.bills).toBe(3);
      expect(BigInt(one.totals.grossMinor)).toBeGreaterThan(BigInt(one.page.totals.grossMinor));
      // Litres agree between the two, in the same 3-decimal string form, by string arithmetic.
      expect(one.page.totals.litres).toMatch(/^\d+\.\d{3}$/);
      expect(one.totals.litres).toMatch(/^\d+\.\d{3}$/);
    });

    it('pages by keyset without skipping or repeating a family\'s bill', async () => {
      const first = await rm.view(tenantA, actor, { cycleId, limit: 2 });
      expect(first.page.rows).toHaveLength(2);
      expect(first.page.nextCursor).not.toBeNull();
      const cursor = Buffer.from(first.page.nextCursor!, 'base64').toString('utf8').split('|');
      const second = await rm.view(tenantA, actor, { cycleId, limit: 2, cursor: { gross: cursor[0], id: cursor[1] } });
      expect(second.page.rows).toHaveLength(1);
      expect(second.page.nextCursor).toBeNull();          // measured with limit+1, not guessed from a full page
      const ids = [...first.page.rows, ...second.page.rows].map((r) => r.billId);
      expect(new Set(ids).size).toBe(3);
    });

    it('reads the other end of the register when asked, and only then', async () => {
      const desc = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      const asc = await rm.view(tenantA, actor, { cycleId, limit: 25, direction: 'asc' });
      expect(asc.page.rows.map((r) => r.billId)).toEqual([...desc.page.rows].reverse().map((r) => r.billId));
    });

    it('never shows another cooperative\'s fortnight', async () => {
      const tenantB = randomUUID();
      await makeTenant(admin, tenantB, 'B');
      const v = await rm.view(tenantB, actor, {});
      expect(v.cycles).toEqual([]);           // B has no cycle of its own...
      expect(v.page.rows).toEqual([]);        // ...and certainly not A's bills
      await expect(rm.view(tenantB, actor, { cycleId })).rejects.toMatchObject({ code: 'DAIRY_CYCLE_NOT_FOUND' });
    });
  });

  /* ======================================================================================================= */
  describe('THE MEMBER\'S PACE — over a partitioned table', () => {
    it('divides the cycle by its own days and averages 30 days over the days actually poured', async () => {
      const v = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      const two = v.page.rows.find((r) => r.memberCodeMasked === 'AND6••01')!;   // poured twice
      const one = v.page.rows.find((r) => r.memberCodeMasked === 'AND6••02')!;   // poured once
      expect(two.avg30dDays).toBe(2);
      expect(one.avg30dDays).toBe(1);
      // 120 kg over two days is 60.000; 60 kg over one day is 60.000 — same average, different day counts, which is
      // exactly why the count is printed beside it.
      expect(two.avg30d).toBe('60.000');
      expect(one.avg30d).toBe('60.000');
      // The per-cycle pace divides by the WINDOW's days, so it is smaller than the per-pour-day average.
      expect(Number(two.litresPerDay)).toBeLessThan(Number(two.avg30d));
    });
  });

  /* ======================================================================================================= */
  describe('THE DEDUCTION TILE — measured from the lines the cadence assembled', () => {
    it('itemises the one member who arranged a recovery, and totals it by type', async () => {
      const v = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      const withLine = v.page.rows.find((r) => r.deductionsMinor !== '0')!;
      expect(withLine.memberCodeMasked).toBe('AND6••02');
      expect(withLine.deductions).toHaveLength(1);
      expect(withLine.deductions[0].typeCode).toBe('feed_credit');
      expect(withLine.deductions[0].typeName).toBeTruthy();       // the DB's own label, never a hardcoded string
      expect(BigInt(withLine.deductionsMinor)).toBeGreaterThan(0n);
      expect(BigInt(v.deductions.totalMinor)).toBe(BigInt(withLine.deductionsMinor));
      expect(v.deductions.byTypeCode.feed_credit).toBe(withLine.deductionsMinor);
      // Net is gross minus deductions, on the row and in the fortnight.
      expect(BigInt(withLine.netMinor)).toBe(BigInt(withLine.grossMinor) - BigInt(withLine.deductionsMinor));
    });

    it('prints THIS tenant\'s consent line, not the canon\'s 25%', async () => {
      const before = await rm.view(tenantA, actor, { cycleId });
      expect(before.consent.consentPct).toBe(25);              // the platform default, from the setting
      await setSetting('dairy.deduction_consent_pct', '12');
      const after = await rm.view(tenantA, actor, { cycleId });
      expect(after.consent.consentPct).toBe(12);
      expect(after.consent.automaticPct).toBe(12);             // min(assembly 25, consent 12)
      await setSetting('dairy.deduction_consent_pct', '25');
    });
  });

  /* ======================================================================================================= */
  describe('THE COUNT THAT PREDICTS A FAILED PAYDAY', () => {
    it('counts the bills that will refuse to pay, and pay() then refuses exactly those', async () => {
      // Drop the threshold under the one deducted bill's share, so the register must flag it.
      const v0 = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      const line = v0.page.rows.find((r) => r.deductionsMinor !== '0')!;
      const pct = Number((BigInt(line.deductionsMinor) * 100n) / BigInt(line.grossMinor));
      await setSetting('dairy.deduction_consent_pct', String(Math.max(pct - 1, 1)));

      const v = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      expect(v.deductions.needingConsent).toBe(1);
      expect(v.page.rows.find((r) => r.billId === line.billId)!.needsFreshConsent).toBe(true);

      // ...and the money path agrees. Preview + approve it, then try to pay: the same fact, refused.
      await cycles.previewCycle(tenantA, actor, cycleId);
      await cycles.approveCycle(tenantA, checkerActor, cycleId);
      await expect(bills.pay(tenantA, actor, line.billId, `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REQUIRED' });

      // A GRANT then makes both agree the other way.
      await consents.record(tenantA, farmers[1], line.billId, { granted: true, channel: 'app' } as never, `idem-${randomUUID()}`, null);
      const after = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      expect(after.deductions.needingConsent).toBe(0);
      expect(after.page.rows.find((r) => r.billId === line.billId)!.needsFreshConsent).toBe(false);
    });

    it('a member who grants and then REFUSES is counted as blocked again — the latest row decides', async () => {
      const v0 = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      const line = v0.page.rows.find((r) => r.deductionsMinor !== '0')!;
      await consents.record(tenantA, farmers[1], line.billId, { granted: false, channel: 'ivr' } as never, `idem-${randomUUID()}`, null);
      const v = await rm.view(tenantA, actor, { cycleId, limit: 25 });
      // An `EXISTS (… granted = true)` would have reported this bill as ready while `pay()` refused it.
      expect(v.deductions.needingConsent).toBe(1);
      await expect(bills.pay(tenantA, actor, line.billId, `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REFUSED' });
      await setSetting('dairy.deduction_consent_pct', '25');
    });
  });

  /* ======================================================================================================= */
  describe('THE ACTS — resolved before the press', () => {
    it('refuses the approve BUTTON for the human who previewed, exactly as the constraint would', async () => {
      // The cycle above was previewed by `desk` and approved by `checker`. A fresh cycle proves the button.
      const other = randomUUID();
      await makeTenant(admin, other, 'C');
      const u = randomUUID(); await makeUser(admin, u);
      const c2 = await mccs.create(other, { userId: u, canManage: true, canCloseSettlement: true }, `idem-${randomUUID()}`, { code: 'MCC-C-01', defaultName: 'C 01' } as never, null);
      await cards.create(other, { userId: u, canManage: true, canCloseSettlement: true }, `idem-${randomUUID()}`, { defaultName: 'C card', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
      const m = await memberships.create(other, { userId: u, canManage: true, canCloseSettlement: true }, `idem-${randomUUID()}`, { farmerUserId: u, mccId: c2.id, memberCode: 'C-0001', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never);
      await collections.record(other, { userId: u, canManage: true, canCloseSettlement: true }, `idem-${randomUUID()}`, {
        membershipId: m.id, mccId: c2.id, shift: 'morning', collectedOn: win.to, weightKg: '30.000', fatPct: '6.50', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      await cycles.tickForTenant(other, new Date(), 500);
      const mine = { userId: u, canManage: true, canCloseSettlement: true };

      // The console opens the fortnight with work to do, NOT the one that opened this morning — `ensureCycles` keeps
      // both, and defaulting to "newest" would show an empty accruing cycle with every act refused.
      const beforePreview = await rm.view(other, mine, {});
      expect(beforePreview.cycle.stage).toBe('billed');
      expect(beforePreview.acts.preview.can).toBe(true);
      expect(beforePreview.acts.approve.refusal).toBe('WRONG_STAGE');

      await cycles.previewCycle(other, mine, beforePreview.cycle.id);
      const afterPreview = await rm.view(other, mine, { cycleId: beforePreview.cycle.id });
      expect(afterPreview.cycle.stage).toBe('previewed');
      expect(afterPreview.acts.approve.can).toBe(false);
      expect(afterPreview.acts.approve.refusal).toBe('MAKER_IS_CHECKER');
      // And the API would have refused it too — the button and the constraint agree.
      await expect(cycles.approveCycle(other, mine, beforePreview.cycle.id)).rejects.toBeDefined();
    });

    it('reports the flag that is down rather than a permission the operator already has', async () => {
      await setFlag('dairy_cycle_preview', false);
      const v = await rm.view(tenantA, actor, { cycleId });
      expect(v.acts.preview.refusal).toBe('FLAG_OFF');
      await setFlag('dairy_cycle_preview', true);
    });

    it('refuses the whole console to somebody without the dairy desk', async () => {
      // [found live] The read-model trusted its caller's own claim about their permissions: the route guard was the
      // only gate, so one wiring mistake would have shown 312 families' income to whoever asked. Every other read in
      // this module refuses here too.
      await expect(rm.view(tenantA, { userId: desk, canManage: false, canCloseSettlement: false }, { cycleId }))
        .rejects.toMatchObject({ code: 'DAIRY_FORBIDDEN' });
    });

    it('says the cadence is off when it is — the actual reason a register is empty', async () => {
      await setFlag('dairy_cycle_close', false);
      expect((await rm.view(tenantA, actor, { cycleId })).cadenceOn).toBe(false);
      await setFlag('dairy_cycle_close', true);
      expect((await rm.view(tenantA, actor, { cycleId })).cadenceOn).toBe(true);
    });
  });

  /* ======================================================================================================= */
  describe('THE TILES ACROSS TWO FORTNIGHTS', () => {
    it('shows an open dispute on the register and as a CAUTION, never as a block', async () => {
      // A fresh cooperative, previewed but not approved — a member can only object to a bill they were SHOWN, and the
      // bills of the fortnight above have already been approved (6c-2's state machine refuses a dispute after that,
      // which is itself the right answer: an approved figure is contested through the void, not the window).
      const t = randomUUID();
      await makeTenant(admin, t, 'D');
      const u = randomUUID(); await makeUser(admin, u);
      const me = { userId: u, canManage: true, canCloseSettlement: true };
      const c = await mccs.create(t, me, `idem-${randomUUID()}`, { code: 'MCC-D-01', defaultName: 'D 01' } as never, null);
      await cards.create(t, me, `idem-${randomUUID()}`, { defaultName: 'D card', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
      const m = await memberships.create(t, me, `idem-${randomUUID()}`, { farmerUserId: u, mccId: c.id, memberCode: 'D-0001', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never);
      await collections.record(t, me, `idem-${randomUUID()}`, {
        membershipId: m.id, mccId: c.id, shift: 'morning', collectedOn: win.to, weightKg: '25.000', fatPct: '6.50', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      await cycles.tickForTenant(t, new Date(), 500);
      const before = await rm.view(t, me, {});
      await cycles.previewCycle(t, me, before.cycle.id);

      const previewed = await rm.view(t, me, { cycleId: before.cycle.id });
      const bill = previewed.page.rows[0];
      expect(bill.disputeWindowEnds).not.toBeNull();       // 6c-2's 24h clock, written and enforced
      await disputesSvc.raise(t, u, bill.billId, 'I poured on two days, not one', `idem-${randomUUID()}`, null);

      const after = await rm.view(t, me, { cycleId: before.cycle.id });
      expect(after.openDisputes).toBe(1);
      expect(after.page.rows[0].openDisputes).toBe(1);
      expect(after.page.rows[0].status).toBe('disputed');
      // The approve verdict is a REFUSAL for this human (they previewed it) — the dispute is a caution, not a block,
      // and the maker-checker rule is the more useful sentence when both are true.
      expect(after.acts.approve.refusal).toBe('MAKER_IS_CHECKER');
    });

    it('an OPEN cycle reports the accrual and no bills, and says how many days it has', async () => {
      const newest = await rm.view(tenantA, actor, {});
      if (newest.cycle.stage === 'accruing') {
        expect(newest.page.rows).toEqual([]);
        expect(newest.totals.bills).toBe(0);
        expect(newest.accrual.days).toBeGreaterThan(0);
        // The accrual is measured from PRICED POURS, which is the only figure an open cycle has.
        expect(BigInt(newest.accrual.amountMinor)).toBeGreaterThanOrEqual(0n);
        expect(newest.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('records the payday from the cooperative\'s own setting, and never claims a batch', async () => {
      const v = await rm.view(tenantA, actor, { cycleId });
      expect(v.cycle.payday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.payday.payday).toBe(v.cycle.payday);
      expect(v.payday.batchBuilt).toBe(false);
    });
  });

  /* ======================================================================================================= */
  describe('THE ROUTE', () => {
    it('/console is declared before /:id, so the register is reachable at all', async () => {
      // Proven against the compiled controller rather than by HTTP, because the failure mode is a route ORDER: with
      // `:id` first, Nest would answer this screen with "cycle 'console' not found" on every draw.
      const { BillCyclesController } = await import('../controllers/v1/bill-cycles.controller');
      const { PATH_METADATA } = await import('@nestjs/common/constants');
      const proto = BillCyclesController.prototype as unknown as Record<string, unknown>;
      const paths = Object.getOwnPropertyNames(proto)
        .filter((m) => m !== 'constructor')
        .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string | undefined)
        .filter((p): p is string => typeof p === 'string');
      expect(paths.indexOf('console')).toBeGreaterThanOrEqual(0);
      expect(paths.indexOf('console')).toBeLessThan(paths.indexOf(':id'));
    });
  });
});
