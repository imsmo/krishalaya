// modules/dairy/__tests__/tenant6c1-cycle.integration.spec.ts · PC-56 TENANT-6c-1 against a LIVE Postgres.
//
// W169's claims are all about a CYCLE: *"Current cycle (01–15 Jul)"*, *"Pays Fri 17 Jul"*, *"cycle closes Wed 15 Jul
// 23:59"*, *"312 bills in draft"*. There was no cycle row, no payday, no close instant, and the job that was supposed
// to build those bills was registered nowhere and could not have run where its own module said it did.
//
// The two facts this suite exists to prove cannot be proven with fakes, because they live in SQL:
//   1. `closes_at` is resolved in the COOPERATIVE's own zone (via `tenants.country_code → countries.timezone`), not
//      the process's — so two tenants in different zones with the same fortnight shut at different instants. The
//      per-country granularity of that resolution is a stated cap, pinned by its own test below.
//   2. `payday` comes from a tenant setting whose DEFAULT lives in `setting_definitions` (Law 6), and a per-tenant
//      override is honoured.
// Everything else runs through the REAL services against the REAL schema: no row is hand-inserted that a writer
// would have written differently.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC. The cycle's dates round-trip through JS Dates, and a UTC-only suite
// blesses exactly the defect that bites in the launch market:
//   DATABASE_ADMIN_URL=... DATABASE_URL=... TZ=Asia/Kolkata npx jest --selectProjects integration --testPathPattern tenant6c1
import { realNoticeVars } from '../../../../test/helpers/notice-vars';
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
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { DairyCycleCloseCadenceJob } from '../jobs/dairy-cycle-close.cadence-job';
import { cycleWindow } from '../domain/dairy-counter';
import { previousCycleWindow } from '../domain/dairy-cycle';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

/** Read a `date` back the way the platform must: local components, never toISOString. */
const pgDay = (v: unknown): string => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10));

run('PC-56 TENANT-6c-1 · the dairy payout cycle (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService;
  let cycles: DairyBillCycleService; let cycleRepo: DairyBillCycleRepository;

  // Two tenants in DIFFERENT timezones, on purpose: the close instant is the one fact a shared-timezone test cannot
  // distinguish from a platform-wide constant.
  const tenantIST = randomUUID();
  const tenantAE = randomUUID();
  const operator = randomUUID();
  const farmerA = randomUUID();
  const farmerB = randomUUID();
  const farmerMonthly = randomUUID();
  // [PC-56 TENANT-6c-3] `canCloseSettlement` is 0144's `settlement.close`, which W169 names on both the preview and
  // the approve. These fixtures drive one operator through the whole desk, so they carry both keys; the wave's own
  // spec is where the refusals live.
  const actor = { userId: operator, canManage: true, canCloseSettlement: true };
  let mccId = ''; let memA = ''; let memB = ''; let memMonthly = '';
  let today = '';

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantIST, 'IST');
    await makeTenant(admin, tenantAE, 'AE');
    // The fixture stamps every tenant 'IN'. The second cooperative is moved to a DIFFERENT seeded country, because a
    // one-timezone test cannot tell a per-tenant resolution from a platform-wide constant.
    await admin.query(`UPDATE tenants SET country_code='AE' WHERE id=$1`, [tenantAE]);
    for (const u of [operator, farmerA, farmerB, farmerMonthly]) await makeUser(admin, u);

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
    const flags = new FlagsService(pools, new InMemoryCacheService());

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags, new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never), realNoticeVars(replica as never));
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
      assembler, realNoticeVars(replica as never));
    cycles = new DairyBillCycleService(uow, outbox, metrics, idem, cycleRepo, collRepo, bills, billRepo, memRepo,
      lineRepo, flags);

    await fundTenant(tenantIST, 100_000_000n);

    today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;

    mccId = (await mccs.create(tenantIST, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-02', defaultName: 'Anand 02' } as never, null)).id;
    await cards.create(tenantIST, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v4', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    memA = (await memberships.create(tenantIST, actor, `idem-${randomUUID()}`, { farmerUserId: farmerA, mccId, memberCode: 'AND2-0087', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;
    memB = (await memberships.create(tenantIST, actor, `idem-${randomUUID()}`, { farmerUserId: farmerB, mccId, memberCode: 'AND2-0088', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;
    // A MONTHLY member at the same centre — the predecessor claim query had no cycle predicate, so this member would
    // have been billed on the fortnightly boundary.
    memMonthly = (await memberships.create(tenantIST, actor, `idem-${randomUUID()}`, { farmerUserId: farmerMonthly, mccId, memberCode: 'AND2-0089', paymentCycle: 'monthly', defaultAnimalType: 'buffalo' } as never)).id;
  }, 90000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('the close instant belongs to the COOPERATIVE, not to the platform', () => {
    it('resolves closes_at in the tenant\'s own timezone — two tenants, one fortnight, two instants', async () => {
      const w = { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const ist = await uow.run(tenantIST, (tx) => cycleRepo.ensure(tx, tenantIST, w), { userId: 'system' });
      const ae = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });

      // 16 Jul 00:00 in Asia/Kolkata (UTC+5:30) is 15 Jul 18:30Z. In Asia/Dubai (UTC+4) it is 15 Jul 20:00Z.
      expect(ist.closesAt.toISOString()).toBe('2026-07-15T18:30:00.000Z');
      expect(ae.closesAt.toISOString()).toBe('2026-07-15T20:00:00.000Z');
      // The whole reason this is SQL: derived in TypeScript it would be one instant for both, and W169's "closes Wed
      // 15 Jul 23:59" would be a lie in one of the two markets from the day the second one signed (Rule Zero).
      expect(ist.closesAt.getTime()).not.toBe(ae.closesAt.getTime());
    });

    it('the resolution is PER COUNTRY — the cap 0157 names out loud', async () => {
      // There is no `tenants.timezone` column on this platform, so the finest granularity available is the tenant's
      // country. Exact for every launch market (India, Bangladesh, Sri Lanka, Nepal, Kenya are each one zone) and
      // wrong for a multi-zone country: 'US' is seeded as America/New_York, so a Californian cooperative's fortnight
      // would shut at 21:00 local. Pinned here so the limitation is a KNOWN behaviour with a test naming it rather
      // than a surprise found in production — the fix is a per-tenant timezone with a console field and a backfill.
      const seeded = (await admin.query(`SELECT timezone FROM countries WHERE code='US'`)).rows[0];
      expect(seeded.timezone).toBe('America/New_York');
      await admin.query(`UPDATE tenants SET country_code='US' WHERE id=$1`, [tenantAE]);
      const w = { from: '2026-06-01', to: '2026-06-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });
      expect(c.closesAt.toISOString()).toBe('2026-06-16T04:00:00.000Z');   // 00:00 EDT on the 16th
      await admin.query(`UPDATE tenants SET country_code='AE' WHERE id=$1`, [tenantAE]);
    });

    it('the close is EXCLUSIVE — the last second of period_end is still inside the cycle', async () => {
      const w = { from: '2026-05-01', to: '2026-05-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantIST, (tx) => cycleRepo.ensure(tx, tenantIST, w), { userId: 'system' });
      // 16 May 00:00 IST = 15 May 18:30Z, so 23:59:59 IST on the 15th (18:29:59Z) is still INSIDE the cycle.
      expect(c.closesAt.toISOString()).toBe('2026-05-15T18:30:00.000Z');
      expect(new Date('2026-05-15T18:29:59.000Z') < c.closesAt).toBe(true);
    });

    it('freezes the close instant — a cooperative whose zone changes does not move a fortnight already billed', async () => {
      const w = { from: '2026-04-01', to: '2026-04-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const before = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });
      await admin.query(`UPDATE tenants SET country_code='GB' WHERE id=$1`, [tenantAE]);
      const after = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });
      // ON CONFLICT DO NOTHING plus a grant that cannot UPDATE the column: the terms a fortnight was billed under are
      // not editable, by anything, ever. A recomputed close would silently re-date bills already in members' hands.
      expect(after.closesAt.toISOString()).toBe(before.closesAt.toISOString());
      await admin.query(`UPDATE tenants SET country_code='AE' WHERE id=$1`, [tenantAE]);
    });

    it('the app role CANNOT edit the window, the close instant or the payday (0157 grant)', async () => {
      const w = { from: '2026-03-01', to: '2026-03-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantIST, (tx) => cycleRepo.ensure(tx, tenantIST, w), { userId: 'system' });
      // THIS TEST CAUGHT A DEFECT IN ITS OWN MIGRATION. `ALTER DEFAULT PRIVILEGES` on this database grants kv_app
      // INSERT+SELECT+UPDATE on every new table at CREATE TABLE time, and a table-level UPDATE supersedes every
      // column-level grant — so 0157's `GRANT UPDATE (status, ...)` changed nothing until the migration REVOKEd the
      // table-level UPDATE first. Asserted both ways: the privilege is gone from the catalogue, and the write fails.
      const tablePriv = await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='dairy_bill_cycles' AND grantee='kv_app' AND privilege_type='UPDATE'`);
      expect(tablePriv.rowCount).toBe(0);
      // These are the terms 312 families were shown. A column-scoped grant means a bug cannot edit them in place and
      // leave no trace — the same least-privilege ruling 0078/0080 made for the dairy money path.
      for (const col of ['period_start', 'period_end', 'closes_at', 'payday', 'payment_cycle']) {
        await expect(uow.run(tenantIST, (tx) => tx.query(`UPDATE dairy_bill_cycles SET ${col}=${col} WHERE id=$1`, [c.id]), { userId: 'system' }))
          .rejects.toThrow(/permission denied/i);
      }
    });
  });

  /* ======================================================================================================= */
  describe('the payday is the tenant\'s own decision (Law 6)', () => {
    it('defaults from setting_definitions — W169\'s "closes Wed 15 Jul → Pays Fri 17 Jul"', async () => {
      const seeded = (await admin.query(`SELECT default_value #>> '{}' AS v FROM setting_definitions WHERE key='dairy.cycle_payday_offset_days'`)).rows[0];
      expect(seeded.v).toBe('2');
      const w = { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantIST, (tx) => cycleRepo.findByWindow(tx, tenantIST, w), { userId: 'system' });
      expect(c!.payday).toBe('2026-07-17');
    });

    it('honours a per-tenant override, and the DEFAULT is not hardcoded anywhere in the query', async () => {
      await admin.query(
        `INSERT INTO tenant_settings (tenant_id, key, value, created_at) VALUES ($1,'dairy.cycle_payday_offset_days','5'::jsonb, now())
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`, [tenantAE]);
      const w = { from: '2026-08-01', to: '2026-08-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });
      expect(c.payday).toBe('2026-08-20');
      // A cooperative that pays on the 5th day is not a bug; "Friday" is this cooperative's habit and not a law of milk.
    });

    it('a jsonb STRING override casts the same as a jsonb number — a console that stringifies cannot crash the cycle', async () => {
      await admin.query(
        `INSERT INTO tenant_settings (tenant_id, key, value, created_at) VALUES ($1,'dairy.cycle_payday_offset_days','"3"'::jsonb, now())
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`, [tenantAE]);
      const w = { from: '2026-09-01', to: '2026-09-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantAE, (tx) => cycleRepo.ensure(tx, tenantAE, w), { userId: 'system' });
      expect(c.payday).toBe('2026-09-18');
      await admin.query(`DELETE FROM tenant_settings WHERE tenant_id=$1 AND key='dairy.cycle_payday_offset_days'`, [tenantAE]);
    });
  });

  /* ======================================================================================================= */
  describe('the cycle closes and its bills get built — the thing that has never happened on this platform', () => {
    let closedCycleId = '';
    let win = { from: '', to: '', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };

    it('records pours into the fortnight that has already ended', async () => {
      const prev = previousCycleWindow(today, 'fortnightly');
      win = { ...win, from: prev.from, to: prev.to };
      // Two members pour on the LAST day of the ended window; a third (monthly) pours the same day.
      for (const m of [memA, memB, memMonthly]) {
        await collections.record(tenantIST, actor, `idem-${randomUUID()}`, {
          membershipId: m, mccId, shift: 'morning', collectedOn: prev.to,
          weightKg: '8.615', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
        } as never);
      }
      const n = (await admin.query(`SELECT count(*)::int c FROM milk_collections WHERE tenant_id=$1 AND collected_on=$2::date`, [tenantIST, prev.to])).rows[0].c;
      expect(n).toBe(3);
    });

    it('ensures both windows, closes the ended one, and leaves the running one OPEN', async () => {
      const ensured = await cycles.ensureCycles(tenantIST);
      expect(ensured).toBeGreaterThanOrEqual(4);      // fortnightly ×2 and monthly ×2

      const closed = await cycles.closeDue(tenantIST, new Date());
      expect(closed).toBeGreaterThanOrEqual(1);

      const cur = await uow.run(tenantIST, (tx) => cycleRepo.findByWindow(tx, tenantIST, { ...cycleWindow(today, 'fortnightly') }), { userId: 'system' });
      expect(cur!.status).toBe('open');               // still collecting milk — billing it would pay for half a fortnight

      const ended = await uow.run(tenantIST, (tx) => cycleRepo.findByWindow(tx, tenantIST, win), { userId: 'system' });
      expect(ended!.status).toBe('closed');
      expect(ended!.toProps().closedAt).not.toBeNull();
      closedCycleId = ended!.id;

      const ev = await admin.query(`SELECT event_type FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY created_at`, [tenantIST, closedCycleId]);
      expect(ev.rows.map((r: { event_type: string }) => r.event_type)).toContain('dairy.cycle_closed');
    });

    it('builds one DRAFT bill per member of THAT cadence — and not the monthly member', async () => {
      const out = await cycles.buildBills(tenantIST);
      expect(out.generated).toBe(2);                  // memA + memB, both fortnightly
      expect(out.failed).toBe(0);

      const rows = await admin.query(
        `SELECT membership_id, status, cycle_id, total_litres::text AS litres FROM milk_bills WHERE tenant_id=$1 AND cycle_id=$2 ORDER BY membership_id`, [tenantIST, closedCycleId]);
      expect(rows.rowCount).toBe(2);
      expect(rows.rows.map((r: { membership_id: string }) => r.membership_id).sort()).toEqual([memA, memB].sort());
      for (const r of rows.rows) expect(r.status).toBe('draft');   // a cycle closing moves NO money

      // The monthly member's milk is still unbilled: their month has not ended yet, and the predecessor claim query —
      // which had no payment_cycle predicate — would have billed them here for half of it.
      const monthly = await admin.query(`SELECT count(*)::int c FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, memMonthly]);
      expect(monthly.rows[0].c).toBe(0);
      const stillUnbilled = await admin.query(`SELECT count(*)::int c FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND milk_bill_id IS NULL`, [tenantIST, memMonthly]);
      expect(stillUnbilled.rows[0].c).toBe(1);
    });

    it('the bill\'s litres equal the sum of the pours it settled — to the third decimal', async () => {
      // 8.615 kg. At `numeric(10,2)` and `Number(x)/1000` this stored 8.62 and read back 8,620 milli-kg: the bill
      // disagreed with its own pours on the first number a member checks.
      const r = await admin.query(`SELECT total_litres::text AS litres FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, memA]);
      expect(r.rows[0].litres).toBe('8.615');
      const poured = await admin.query(
        `SELECT sum(weight_kg)::text AS kg FROM milk_collections c JOIN milk_bills b ON b.id = c.milk_bill_id
          WHERE c.tenant_id=$1 AND b.membership_id=$2`, [tenantIST, memA]);
      expect(Number(poured.rows[0].kg)).toBeCloseTo(8.615, 3);
    });

    it('the period the bill carries is the CYCLE\'s window, read as calendar days', async () => {
      const r = await admin.query(`SELECT period_start, period_end FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, memA]);
      expect(pgDay(r.rows[0].period_start)).toBe(win.from);
      expect(pgDay(r.rows[0].period_end)).toBe(win.to);
      // And through the repository's own mapper, which is where `toISOString().slice(0,10)` used to live.
      const listed = await new MilkBillRepository(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as never)
        .listFor(tenantIST, { cycleId: closedCycleId, limit: 10 });
      expect(listed).toHaveLength(2);
      for (const b of listed) {
        const j = b.toJSON();
        expect(j.periodStart).toBe(win.from);
        expect(j.periodEnd).toBe(win.to);
        expect(j.cycleId).toBe(closedCycleId);
      }
    });

    it('is IDEMPOTENT — a second run claims nobody, because the pours are stamped', async () => {
      // The first line of idempotency is `milk_bill_id IS NULL` in the claim query: a billed pour is not claimed again,
      // so the replay finds no members at all rather than relying on the UNIQUE index to reject two inserts.
      const fresh = (await uow.run(tenantIST, (tx) => cycleRepo.getForUpdate(tx, tenantIST, closedCycleId), { userId: 'system' }))!;
      const again = await cycles.generateFor(tenantIST, fresh);
      expect(again).toMatchObject({ generated: 0, skipped: 0, stranded: 0, failed: 0 });
      const rows = await admin.query(`SELECT count(*)::int c FROM milk_bills WHERE tenant_id=$1 AND cycle_id=$2`, [tenantIST, closedCycleId]);
      expect(rows.rows[0].c).toBe(2);
    });

    it('a pour entered AFTER its cycle was billed is STRANDED — counted and named, not swallowed', async () => {
      // The UNIQUE index is the second line of defence, and hitting it is not a harmless replay: this member HAS
      // unbilled milk and this platform has nowhere to put it (the window's bill exists, a supplementary bill is
      // forbidden, and the next window does not contain this pour's date). The wave that can fix it is the one that
      // owns preview/approve (TENANT-6c-2); what 6c-1 refuses to do is report it as "one member did not pour".
      await collections.record(tenantIST, actor, `idem-${randomUUID()}`, {
        membershipId: memA, mccId, shift: 'evening', collectedOn: win.to,
        weightKg: '3.250', fatPct: '6.50', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      const fresh = (await uow.run(tenantIST, (tx) => cycleRepo.getForUpdate(tx, tenantIST, closedCycleId), { userId: 'system' }))!;
      const out = await cycles.generateFor(tenantIST, fresh);
      // WHEN THIS WAS WRITTEN IT READ `generated: 1`, AND THAT WAS THE FINDING: the idempotency key was per (cycle,
      // membership), so a second pass REPLAYED the first bill's stored response and reported a bill it had not created —
      // no UNIQUE violation, no error code, nothing for an error-code check to catch. TENANT-6c-2 had to make the key
      // carry the ATTEMPT (so a rebuild after a VOID is not swallowed as a replay), and a side effect is that this case
      // now surfaces honestly as a SKIP. The stranded count is what makes it visible either way, which is the point:
      // measuring from the claim query survived a change that would have broken any error-code check.
      expect(out).toMatchObject({ generated: 0, skipped: 1, stranded: 1, failed: 0 });
      const orphan = await admin.query(
        `SELECT count(*)::int c FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND milk_bill_id IS NULL`, [tenantIST, memA]);
      expect(orphan.rows[0].c).toBe(1);              // still unbilled, still owed, and now visible
    });

    it('a closed, generated cycle stops being claimed', async () => {
      const pending = await uow.run(tenantIST, (tx) => cycleRepo.needingBills(tx, tenantIST, 20), { userId: 'system' });
      expect(pending.map((c) => c.id)).not.toContain(closedCycleId);
      const c = await uow.run(tenantIST, (tx) => cycleRepo.getForUpdate(tx, tenantIST, closedCycleId), { userId: 'system' });
      expect(c!.toProps().billsGenerated).toBe(0);    // the LAST run's counts — the stranded pass above
      expect(c!.toProps().billsSkipped).toBe(1);
      expect(c!.needsBills).toBe(false);
    });

    it('bills a DEACTIVATED member\'s last fortnight — the milk was poured and is owed', async () => {
      // The claim query deliberately does not filter on `is_active`. A member the cooperative deactivates mid-cycle
      // still poured on the days before, and filtering on the flag is how that last fortnight becomes money nobody
      // ever pays and nobody ever notices. Proven live because it is the whole point of an omission.
      const prev = previousCycleWindow(today, 'monthly');
      const leaver = randomUUID();
      await makeUser(admin, leaver);
      const mem = (await memberships.create(tenantIST, actor, `idem-${randomUUID()}`,
        { farmerUserId: leaver, mccId, memberCode: `AND2-${randomUUID().slice(0, 6)}`, paymentCycle: 'monthly', defaultAnimalType: 'buffalo' } as never)).id;
      await collections.record(tenantIST, actor, `idem-${randomUUID()}`, {
        membershipId: mem, mccId, shift: 'morning', collectedOn: prev.to,
        weightKg: '6.000', fatPct: '6.00', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      await admin.query(`UPDATE dairy_memberships SET is_active = false WHERE id=$1`, [mem]);

      await cycles.ensureCycles(tenantIST);
      await cycles.closeDue(tenantIST, new Date());
      const monthlyCycle = (await uow.run(tenantIST, (tx) => cycleRepo.findByWindow(tx, tenantIST, prev), { userId: 'system' }))!;
      const out = await cycles.generateFor(tenantIST, monthlyCycle);
      expect(out.generated).toBeGreaterThanOrEqual(1);
      const billed = await admin.query(`SELECT count(*)::int c FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, mem]);
      expect(billed.rows[0].c).toBe(1);
    });

    it('PAYS a cycle bill with no deductions: zero-sum tenant → farmer', async () => {
      const bill = (await admin.query(`SELECT id, net_minor FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, memA])).rows[0];
      await bills.preview(tenantIST, actor, bill.id);
      await bills.approve(tenantIST, actor, bill.id);
      const before = await balUser(farmerA);
      // [PC-56 TENANT-6c-2] previewing now starts the member's 24h window and `pay()` waits for it.
      const paid = await bills.pay(tenantIST, actor, bill.id, `idem-${randomUUID()}`, null, new Date(Date.now() + 25 * 3_600_000));
      expect(paid.status).toBe('paid');
      expect(await balUser(farmerA) - before).toBe(BigInt(bill.net_minor));
    });

    it('a DEDUCTION now has to name the row it pays — the refusal became a destination', async () => {
      // [PC-56 TENANT-6c-4] WHAT THIS TEST USED TO ASSERT: *"REFUSES to pay a bill carrying deductions — nowhere to
      // post them, so nothing moves"*. That was 0157's honest stopgap: `deductions` was a jsonb array of
      // `{type, amount_minor}` with a free-typed label referencing nothing, so `pay()` refused any bill carrying one
      // rather than keep a family's money with no ledger row to find it by.
      //
      // 0160 built the destinations, and the assertion moves to the property that replaced the refusal rather than
      // being deleted: a line must name a TYPE from the `milk_deduction` vocabulary AND the row it settles. The old
      // payload — a type and an amount, and nothing else — is now refused at GENERATION, which is where an operator
      // can still do something about it. What a paid deduction looks like is TENANT-6c-4's own live spec.
      const day2 = win.from;
      await collections.record(tenantIST, actor, `idem-${randomUUID()}`, {
        membershipId: memB, mccId, shift: 'evening', collectedOn: day2,
        weightKg: '5.000', fatPct: '6.00', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      const before = await balUser(farmerB);
      await expect(bills.generate(tenantIST, actor, `idem-${randomUUID()}`,
        { membershipId: memB, periodStart: day2, periodEnd: day2, deductions: [{ type: 'loan_emi', amountMinor: '30000' }] } as never))
        .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
      // NO LINE was created and nothing moved. (Measured on the lines, not on the bills: this member already has a
      // bill for this period from the pour above — asserting "no bill" would have been asserting the wrong fact and
      // would have passed only by accident of test order.)
      expect((await admin.query(`SELECT count(*)::int n FROM milk_bill_deductions WHERE tenant_id=$1 AND membership_id=$2`, [tenantIST, memB])).rows[0].n).toBe(0);
      expect(await balUser(farmerB)).toBe(before);
    });
  });

  /* ======================================================================================================= */
  describe('the cadence job, against the real driver query', () => {
    it('sees only tenants that HAVE active dairy members, and only when the flag is ON', async () => {
      // The runner hands a cadence job its own BYPASSRLS pool (kv_relay), because a cross-tenant driver query cannot
      // run through the request-tier RLS pools — under kv_app with no `app.tenant_id` set this SELECT correctly returns
      // NOTHING AT ALL, which is how the first version of this test passed for the wrong reason. The admin connection
      // stands in for kv_relay here.
      const ticked: string[] = [];
      const jobWith = () => new DairyCycleCloseCadenceJob(3_600_000,
        { tickForTenant: async (t: string) => { ticked.push(t); return { ensured: 0, closed: 0, cyclesBilled: 0, generated: 0, skipped: 0, stranded: 0, failed: 0 }; } } as never,
        // A FRESH flag service each time: the real one caches for 30s, and a test that clears a cache it does not own
        // is testing the cache rather than the flag (TENANT-6b-1's ruling).
        new FlagsService(pools, new InMemoryCacheService()) as never);

      // The flag ships OFF, so a real run must do nothing at all — that is the kill-switch, not an accident.
      await jobWith().run(admin);
      expect(ticked).toHaveLength(0);

      try {
        await admin.query(`UPDATE feature_flags SET is_enabled = true WHERE key='dairy_cycle_close'`);
        await jobWith().run(admin);
        expect(ticked).toContain(tenantIST);          // has active dairy members
        expect(ticked).not.toContain(tenantAE);       // no dairy members at all — never even asked about
      } finally {
        await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key='dairy_cycle_close'`);
      }
    });

    it('the driver query finds NOTHING on a request-tier pool — which is why the runner hands it a BYPASSRLS one', async () => {
      // Pinned as a fact about the wiring rather than left as an accident: `dairy_memberships` is FORCE RLS, so with no
      // `app.tenant_id` set the EXISTS clause is false for every tenant and the sweep returns an empty list. If this
      // job were ever handed a kv_app pool it would run hourly forever and do nothing, and "nothing to do" would be
      // indistinguishable from "no permission to see anything". The first version of this suite passed for exactly
      // that reason.
      const appPool = (pools as unknown as { writer: (n: number) => Pool }).writer(0);
      const r = await appPool.query(
        `SELECT count(*)::int c FROM tenants t
          WHERE t.status IN ('trial','active','grace') AND t.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM dairy_memberships m WHERE m.tenant_id = t.id AND m.is_active = true AND m.deleted_at IS NULL)`);
      expect((r.rows[0] as { c: number }).c).toBe(0);
    });
  });

  /* ======================================================================================================= */
  describe('what 0157 says out loud', () => {
    it('the flag ships OFF — automatic bill generation is a treasury decision', async () => {
      const r = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_cycle_close'`);
      expect(r.rows[0].is_enabled).toBe(false);
    });

    it('the status vocabulary is exactly what the code can reach', async () => {
      // 6c-1 asserted `previewed` was refused; TENANT-6c-2 built the preview and the assertion moved to `approved` and
      // `paid`. TENANT-6c-3 built the second signature, so `approved` is legitimate too and only `paid` is left: it
      // needs a payout batch nothing writes, and a bill carrying a deduction cannot be paid at all (0157). Each wave
      // moves this assertion to its own edge rather than deleting it, which is what keeps the vocabulary honest.
      const w = { from: '2026-02-01', to: '2026-02-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantIST, (tx) => cycleRepo.ensure(tx, tenantIST, w), { userId: 'system' });
      for (const status of ['paid']) {
        // `closed_at` is set in the same statement so the STATUS check is the one that fires — otherwise the close-stamp
        // invariant (open ⇔ no close stamp) refuses first and the assertion would pass for the wrong reason.
        await expect(admin.query(`UPDATE dairy_bill_cycles SET status=$2, closed_at=now() WHERE id=$1`, [c.id, status]))
          .rejects.toThrow(/ck_dairy_bill_cycle_status/);
      }
    });

    it('a closed cycle must carry its instant, and bills cannot precede the close', async () => {
      const w = { from: '2026-01-01', to: '2026-01-15', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };
      const c = await uow.run(tenantIST, (tx) => cycleRepo.ensure(tx, tenantIST, w), { userId: 'system' });
      await expect(admin.query(`UPDATE dairy_bill_cycles SET status='closed' WHERE id=$1`, [c.id]))
        .rejects.toThrow(/ck_dairy_bill_cycle_closed_stamp/);
      await expect(admin.query(`UPDATE dairy_bill_cycles SET bills_generated_at=now(), bills_generated=0, bills_skipped=0, bills_failed=0 WHERE id=$1`, [c.id]))
        .rejects.toThrow(/ck_dairy_bill_cycle_generate_after_close/);
    });

    it('a payday cannot fall before the cycle shuts', async () => {
      const c = (await admin.query(`SELECT id FROM dairy_bill_cycles WHERE tenant_id=$1 LIMIT 1`, [tenantIST])).rows[0];
      await expect(admin.query(`UPDATE dairy_bill_cycles SET payday = period_start - 1 WHERE id=$1`, [c.id]))
        .rejects.toThrow(/ck_dairy_bill_cycle_payday/);
    });

    it('one cycle per (tenant, cadence, window) — two rows would let two closes disagree', async () => {
      const c = (await admin.query(`SELECT tenant_id, payment_cycle, period_start, period_end, closes_at, payday FROM dairy_bill_cycles WHERE tenant_id=$1 LIMIT 1`, [tenantIST])).rows[0];
      await expect(admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday)
         VALUES ($1,$2,$3,$4,$5,$6)`, [c.tenant_id, c.payment_cycle, c.period_start, c.period_end, c.closes_at, c.payday]))
        .rejects.toThrow(/uq_dairy_bill_cycle/);
    });

    it('RLS isolates cycles between tenants', async () => {
      const seen = await uow.run(tenantAE, (tx) => tx.query(`SELECT count(*)::int c FROM dairy_bill_cycles WHERE tenant_id=$1`, [tenantIST]), { userId: 'system' });
      expect((seen.rows[0] as { c: number }).c).toBe(0);
    });
  });
});
