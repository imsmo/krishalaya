// modules/dairy/__tests__/tenant6e1-insights.integration.spec.ts · PC-56 TENANT-6e-1, LIVE Postgres.
//
// **W172 AGAINST A REAL DATABASE, WITH TWO WINDOWS OF REAL POURS.** Four families, one cooperative, ninety days of
// collection and ninety before that — and then the page's own questions asked of the real SQL.
//
// SEVEN THINGS HERE CANNOT BE PROVEN ANY OTHER WAY:
//
//   1. **THE AGGREGATE IS EXACT.** `weight_kg` is `numeric(8,3)` and the repository reads it as `sum(weight_kg*1000)`.
//      Only a real numeric column proves that ×1000 is an integer and the bigint cast truncates nothing.
//   2. **THE WINDOWS DO NOT LEAK INTO ONE ANOTHER.** A pour on the seam belongs to exactly one of them, and only real
//      `date` comparisons at a real boundary prove which.
//   3. **THE COHORT SQL.** Newcomer, win-back and continuing are three date predicates over one LEFT JOIN. Every
//      version of that statement I wrote before the right one type-checked perfectly.
//   4. **THE CYCLE FACTS.** `NOT EXISTS (... status NOT IN ('approved','paid'))` — including the case that matters
//      most, a cycle with ONE disputed bill, which must not count as "every bill approved".
//   5. **THE MONEY SHAPE REFUSES RATHER THAN GUESSING** — a real `countries`→`currencies` join with a real missing
//      `minor_units`.
//   6. **TENANT ISOLATION.** A second cooperative's pours in the same partitions must not appear in the first one's
//      averages. This is the whole reason 0155 created a tenant-leading index.
//   7. **THE FLAG'S KILL-SWITCH**, read through the real flag store and its cache.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC — every date here is a calendar day resolved by the DATABASE's own
// `current_date`, never by the Node process's clock.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { DairyInsightsRepository } from '../repositories/dairy-insights.repository';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyInsightsReadModel, INSIGHTS_FLAG } from '../read-models/dairy-insights.read-model';
import { insightRanges, POURER_LOOKBACK_DAYS } from '../domain/dairy-insights';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6e-1 · the insights (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let repo: DairyInsightsRepository; let quality: DairyQualityRepository;
  let rm: DairyInsightsReadModel; let flagCache: InMemoryCacheService;
  let memberships: DairyMembershipService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();          // the neighbour, sharing every partition
  const desk = randomUUID();
  /** The READ MODEL's actor: the drill-down verb only, resolved by the controller from `member.view360`. */
  const actor = { userId: desk, canDrillDown: false };
  /** The FIXTURE services' actor. A different shape on purpose — conflating the two is how a spec ends up asserting
   *  that a page a reader may not open was built by somebody who could not have built it. */
  const deskActor = { userId: desk, canManage: true, canOverride: true };

  // FOUR FAMILIES WITH FOUR DIFFERENT HISTORIES — the cohorts are only testable if the four differ:
  //   steady   · poured in both windows                       -> continuing
  //   newcomer · first pour inside this window                -> newcomer
  //   winBack  · poured a year ago, nothing since, back now    -> win-back
  //   lapsed   · poured in the previous window only            -> in neither cohort, and NOT active
  const steady = randomUUID(); const newcomer = randomUUID(); const winBack = randomUUID(); const lapsed = randomUUID();
  const neighbour = randomUUID();

  let vanthali = ''; let bhesanB = ''; let rateCardId = ''; let rateCardB = '';
  const ms: Record<string, string> = {};
  let today = '';

  const roleIn = (userId: string, tenantId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantId]);

  /**
   * A pour, written straight in. This spec is about the READS: the counter's own write path is TENANT-6a's and is
   * proven by its own live suite. The column list is the real one, so a future NOT NULL would break this too.
   *
   * `kg` and `minor` are passed per call and every caller uses a DIFFERENT pair, so a repository that summed the wrong
   * column, or divided by the wrong one, cannot pass by coincidence.
   */
  const pour = (opts: {
    tenantId?: string; mccId?: string; membershipId: string; on: string;
    shift?: 'morning' | 'evening'; kg: string; minor: number; fat?: string; bonus?: number; cardId?: string;
  }) => admin.query(
    `INSERT INTO milk_collections
       (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor,
        bonus_minor, bonus_applied, entered_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,$7,9.00,$8,$9,$10,$11,$12)`,
    [opts.tenantId ?? tenantA, opts.mccId ?? vanthali, opts.membershipId, opts.shift ?? 'morning', opts.on,
     opts.kg, opts.fat ?? '6.80', opts.cardId ?? rateCardId, opts.minor,
     opts.bonus ?? 0, (opts.bonus ?? 0) > 0, desk]);

  const day = async (offset: number): Promise<string> => String(
    (await admin.query(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [offset])).rows[0].d);

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(
      `INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier)
       VALUES ($1,'itest',$2,100,'experiment')
       ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, rollout_pct = 100`, [key, on]);
    // Per-process cache with a TTL: a suite that flips a flag must invalidate it, or it reads the previous answer.
    await flagCache.del(`flag:${key}`); await flagCache.del('flags:all');
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeTenant(admin, tenantB, 'B');
    for (const u of [desk, steady, newcomer, winBack, lapsed]) await makeUser(admin, u);
    await makeUser(admin, neighbour);
    for (const u of [desk, steady, newcomer, winBack, lapsed]) await roleIn(u, tenantA);
    await roleIn(neighbour, tenantB);
    today = await day(0);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);

    const mccRepo = new MccCentreRepository(replica as never);
    const memberRepo = new DairyMembershipRepository(replica as never);
    repo = new DairyInsightsRepository(replica as never);
    quality = new DairyQualityRepository(replica as never);
    rm = new DairyInsightsReadModel(repo, quality, flags, metrics);

    const mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memberRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));

    vanthali = (await mccs.create(tenantA, deskActor as never, `idem-${randomUUID()}`, { code: 'MCC-E1-01', defaultName: 'Vanthali' } as never, null) as never as { id: string }).id;
    bhesanB = (await mccs.create(tenantB, deskActor as never, `idem-${randomUUID()}`, { code: 'MCC-E1-B1', defaultName: 'Neighbour' } as never, null) as never as { id: string }).id;

    let n = 0;
    for (const [name, user] of [['steady', steady], ['newcomer', newcomer], ['winBack', winBack], ['lapsed', lapsed]] as const) {
      n += 1;
      ms[name] = (await memberships.create(tenantA, deskActor as never, `idem-${randomUUID()}`, {
        farmerUserId: user, mccId: vanthali, memberCode: `E1-${String(n).padStart(4, '0')}`, paymentCycle: 'fortnightly',
      } as never) as never as { id: string }).id;
    }
    ms.neighbour = (await memberships.create(tenantB, deskActor as never, `idem-${randomUUID()}`, {
      farmerUserId: neighbour, mccId: bhesanB, memberCode: 'E1-B001', paymentCycle: 'weekly',
    } as never) as never as { id: string }).id;

    // Two rate cards, one per tenant. The fat slab is 6.20 and NOT 6.50, deliberately: the canon's own screen says
    // 6.5, and a spec that used the canon's number could not tell a card read from a literal.
    const card = async (tenantId: string, name: string) => (await admin.query(
      `INSERT INTO milk_rate_cards
         (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor,
          bonus_rules, effective_from, is_active, created_by)
       VALUES ($1,$2,'buffalo','two_axis',70000,30000,
               '[{"metric":"fat","minCentiPct":620,"bonusMinorPerLitre":50}]'::jsonb,
               CURRENT_DATE - 500, true, $3) RETURNING id`, [tenantId, name, desk])).rows[0].id as string;
    rateCardId = await card(tenantA, 'E1 card');
    rateCardB = await card(tenantB, 'E1 neighbour card');
  }, 240000);

  afterAll(async () => {
    // RESTORE THE FLAGS. 6c-6 learned this the hard way: a suite that leaves a global flag ON breaks every other
    // suite's kill-switch assertion, and the failure then looks like a defect in whichever wave reads it next.
    await admin?.query(`UPDATE feature_flags SET is_enabled=false WHERE key=$1`, [INSIGHTS_FLAG]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  /* ============================================================================================================= */
  describe('THE TWO WINDOWS, OVER REAL POURS', () => {
    it('sums an exact numeric(8,3) into milli-litres, and keeps the two windows apart', async () => {
      const r = insightRanges(today, 90);
      // CURRENT window: THREE pours on TWO days — the morning and evening of the same day, plus one other day.
      // The counts must not coincide: with two pours on two days, `count(*)` and `count(DISTINCT collected_on)` are
      // both 2 and a repository reading the wrong one passes. The mutation pass found exactly that.
      await pour({ membershipId: ms.steady, on: await day(-10), kg: '12.345', minor: 61_725 });
      await pour({ membershipId: ms.steady, on: await day(-10), kg: '4.000', minor: 20_000, shift: 'evening' });
      await pour({ membershipId: ms.steady, on: await day(-20), kg: '7.500', minor: 37_500, shift: 'evening' });
      // ON THE SEAM: the last day of the PREVIOUS window. It must land there and not here.
      await pour({ membershipId: ms.steady, on: r.previous.to, kg: '100.001', minor: 500_005 });
      // Inside the previous window, well clear of the seam.
      await pour({ membershipId: ms.steady, on: await day(-120), kg: '3.250', minor: 16_250 });

      const cur = await repo.windowTotals(tenantA, r.current.from, r.current.to);
      const prev = await repo.windowTotals(tenantA, r.previous.from, r.previous.to);

      // 12.345 + 4.000 + 7.500 = 23.845 kg -> 23,845 milli. Exact: a float sum of these would be 23.844999999999999.
      expect(cur.milli).toBe(23_845n);
      expect(cur.amountMinor).toBe(119_225n);
      // THREE distinct numbers, so no read of the wrong column can pass: 2 days, 3 pours, 1 pourer.
      expect(cur.daysWithPours).toBe(2);
      expect(cur.pours).toBe(3);
      expect(cur.pourers).toBe(1);
      // The seam pour is in the PREVIOUS window's total and nowhere else.
      expect(prev.milli).toBe(103_251n);
      expect(prev.pours).toBe(2);
      // ...and the two windows do not double-count it.
      expect(cur.milli + prev.milli).toBe(127_096n);
    });

    it('does not see the neighbouring cooperative sharing its partitions', async () => {
      const r = insightRanges(today, 90);
      // A very large pour for tenant B on a day inside tenant A's window. If the predicate lost `tenant_id`, A's
      // average would jump by a factor of fifty — which is exactly what 0155's tenant-leading index exists to prevent.
      await pour({ tenantId: tenantB, mccId: bhesanB, membershipId: ms.neighbour, on: await day(-10), kg: '999.999', minor: 4_999_995, cardId: rateCardB });
      const cur = await repo.windowTotals(tenantA, r.current.from, r.current.to);
      expect(cur.milli).toBe(23_845n);
      expect(cur.pourers).toBe(1);
      const b = await repo.windowTotals(tenantB, r.current.from, r.current.to);
      expect(b.milli).toBe(999_999n);
    });

    it('splits the day by shift for the chart, with the real enum value', async () => {
      const r = insightRanges(today, 90);
      const rows = await repo.dailyByShift(tenantA, r.current.from, r.current.to);
      // One row per (day, shift) — so the day with both shifts yields TWO rows, which is what the stacked chart needs.
      expect(rows).toEqual([
        { collectedOn: await day(-20), shift: 'evening', milli: 7_500n },
        { collectedOn: await day(-10), shift: 'evening', milli: 4_000n },
        { collectedOn: await day(-10), shift: 'morning', milli: 12_345n },
      ]);
    });

    it('bounds the first-pour search at the floor it is given', async () => {
      const r = insightRanges(today, 90);
      // The oldest pour so far is 120 days back, which is inside the year floor and so is a real measurement.
      expect(await repo.firstPourSince(tenantA, r.lookbackFrom)).toBe(await day(-120));
      // Asked for a floor AFTER that pour, it answers with what is inside the floor — never with the older row. That is
      // the whole point: the query never reaches back further than it was told to.
      expect(await repo.firstPourSince(tenantA, await day(-30))).toBe(await day(-20));
      expect(await repo.firstPourSince(tenantA, await day(1))).toBeNull();
      expect(POURER_LOOKBACK_DAYS).toBe(365);
    });
  });

  /* ============================================================================================================= */
  describe('THE COHORTS — three date predicates that only a real calendar can prove', () => {
    it('separates a newcomer, a win-back and a continuing pourer', async () => {
      const r = insightRanges(today, 90);
      // NEWCOMER: nothing at all before this window.
      await pour({ membershipId: ms.newcomer, on: await day(-5), kg: '5.000', minor: 25_000 });
      // WIN-BACK: poured 300 days ago (inside the year floor, before the previous window), silent since, back now.
      await pour({ membershipId: ms.winBack, on: await day(-300), kg: '4.000', minor: 20_000 });
      await pour({ membershipId: ms.winBack, on: await day(-3), kg: '6.000', minor: 30_000 });
      // LAPSED: poured only in the previous window. Not active, and in neither cohort.
      await pour({ membershipId: ms.lapsed, on: await day(-100), kg: '2.000', minor: 10_000 });

      const c = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      // steady + newcomer + winBack are active; lapsed is not.
      expect(c.active).toBe(3);
      expect(c.newcomers).toBe(1);
      expect(c.winBacks).toBe(1);
      // ...so exactly one is continuing, which is the subtraction the domain performs.
      expect(c.active - c.newcomers - c.winBacks).toBe(1);
    });

    it('stops counting a pourer as NEW once they have a pour inside the lookback', async () => {
      const r = insightRanges(today, 90);
      // Give the newcomer a pour 200 days ago: inside the year floor, outside the previous window. They stop being new
      // and become a win-back in the same statement — the two filters must move together.
      await pour({ membershipId: ms.newcomer, on: await day(-200), kg: '1.000', minor: 5_000 });
      const c = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      expect(c.active).toBe(3);
      expect(c.newcomers).toBe(0);
      expect(c.winBacks).toBe(2);
    });

    it('does not call somebody a win-back who poured inside the previous window', async () => {
      const r = insightRanges(today, 90);
      // The steady pourer HAS a pour in the previous window (the seam row), so they are continuing, never a win-back.
      // A `<=` instead of `<` on the previous-window bound would flip this, and nothing else in the suite would notice.
      const c = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      expect(c.winBacks).toBe(2);           // newcomer and winBack, not steady
      expect(c.active - c.newcomers - c.winBacks).toBe(1);
    });

    it('does NOT call somebody a win-back whose last pour was the previous window\'s FIRST day', async () => {
      const r = insightRanges(today, 90);
      // THE BOUNDARY, exactly. `p.last_on < previous.from` is right; `<=` would count this member as having been
      // silent for a whole window when in fact they poured on its opening day. Nothing else in this suite puts a pour
      // on that date, which is why the mutation pass walked straight through the `<=` version.
      const boundary = randomUUID();
      await makeUser(admin, boundary); await roleIn(boundary, tenantA);
      const bm = (await memberships.create(tenantA, deskActor as never, `idem-${randomUUID()}`, {
        farmerUserId: boundary, mccId: vanthali, memberCode: 'E1-0009', paymentCycle: 'fortnightly',
      } as never) as never as { id: string }).id;

      const before = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      // Poured on the previous window's opening day, and again inside the current window.
      await pour({ membershipId: bm, on: r.previous.from, kg: '1.500', minor: 7_500 });
      await pour({ membershipId: bm, on: await day(-4), kg: '1.750', minor: 8_750 });

      const after = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      expect(after.active).toBe(before.active + 1);      // they ARE active
      expect(after.newcomers).toBe(before.newcomers);    // and not new — they poured before this window
      expect(after.winBacks).toBe(before.winBacks);      // and NOT a win-back: they never went a whole window silent
    });

    it('ignores a pour older than the floor entirely', async () => {
      const r = insightRanges(today, 90);
      // Asserted as a DELTA rather than against an absolute count: the tests in this block each add a member, and an
      // absolute expectation here couples this assertion to the order the ones above it ran in. (It did, once.)
      const before = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      // A pour 450 days back is outside the year floor. It must not turn the lapsed member into anything, and it must
      // not move anybody already counted between cohorts.
      await pour({ membershipId: ms.lapsed, on: await day(-450), kg: '1.000', minor: 5_000 });
      const after = await repo.cohortCounts(tenantA, r.current.from, r.current.to, r.lookbackFrom, r.previous.from);
      expect(after).toEqual(before);
    });
  });

  /* ============================================================================================================= */
  describe('THE CYCLE FACTS THAT STAND WHERE THE STREAK IS REFUSED', () => {
    it('counts a closed cycle, and only counts "all bills approved" when every bill is', async () => {
      const r = insightRanges(today, 90);
      const mk = async (fromOff: number, toOff: number, status: 'open' | 'closed') => (await admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at)
         VALUES ($1,'fortnightly', CURRENT_DATE + $2::int, CURRENT_DATE + $3::int, now(), CURRENT_DATE + $3::int + 2, $4::varchar,
                 CASE WHEN $4::varchar='closed' THEN now() END) RETURNING id`,
        [tenantA, fromOff, toOff, status])).rows[0].id as string;

      const bill = (cycleId: string, membershipId: string, fromOff: number, toOff: number, status: string) => admin.query(
        `INSERT INTO milk_bills (tenant_id, membership_id, period_start, period_end, total_litres, gross_minor,
                                 deductions_minor, net_minor, status, cycle_id, created_by)
         VALUES ($1,$2, CURRENT_DATE + $3::int, CURRENT_DATE + $4::int, 30.000, 150000, 0, 150000, $5, $6, $7)`,
        [tenantA, membershipId, fromOff, toOff, status, cycleId, desk]);

      // CLOSED, every bill approved -> counts in both figures.
      const clean = await mk(-45, -31, 'closed');
      await bill(clean, ms.steady, -45, -31, 'approved');
      await bill(clean, ms.newcomer, -45, -31, 'paid');       // `paid` counts as settled-enough for the approval test
      await admin.query(`UPDATE dairy_bill_cycles SET bills_generated=2, bills_skipped=0, bills_failed=0, bills_generated_at=now() WHERE id=$1`, [clean]);

      // CLOSED, one bill DISPUTED -> counts as closed, NOT as all-approved. The member in dispute is precisely the
      // person an "on-time" claim would be made to.
      const disputed = await mk(-30, -16, 'closed');
      await bill(disputed, ms.steady, -30, -16, 'approved');
      await bill(disputed, ms.winBack, -30, -16, 'disputed');
      await admin.query(`UPDATE dairy_bill_cycles SET bills_generated=2, bills_skipped=0, bills_failed=0, bills_generated_at=now() WHERE id=$1`, [disputed]);

      // OPEN -> counted by neither. A cycle left open past its close is a finding of its own; counting it here would
      // let a stalled platform look punctual.
      await mk(-15, -1, 'open');

      const f = await repo.cycleFacts(tenantA, r.current.from, r.current.to);
      expect(f.closed).toBe(2);
      expect(f.allBillsApproved).toBe(1);
    });

    it('does not count a closed cycle that generated no bills as having approved everything', async () => {
      const r = insightRanges(today, 90);
      const before = await repo.cycleFacts(tenantA, r.current.from, r.current.to);
      // `NOT EXISTS` over an empty set is TRUE, so without the `gen > 0` guard a cycle that produced nothing would
      // count as a cycle where every bill was approved. It approved nothing.
      await admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at)
         VALUES ($1,'fortnightly', CURRENT_DATE - 60, CURRENT_DATE - 46, now(), CURRENT_DATE - 44, 'closed', now())`,
        [tenantA]);
      const after = await repo.cycleFacts(tenantA, r.current.from, r.current.to);
      expect(after.closed).toBe(before.closed + 1);
      expect(after.allBillsApproved).toBe(before.allBillsApproved);
    });
  });

  /* ============================================================================================================= */
  describe('THE MONEY SHAPE', () => {
    it('reads the currency AND its scale from the tenant’s country', async () => {
      expect(await repo.moneyShape(tenantA)).toEqual({ currencyCode: 'INR', minorUnits: 2 });
    });

    /**
     * **THIS IS THE TEST THAT FOUND A LIVE DEFECT.** `currencies.minor_units` is NOT NULL with a default of 2, so the
     * refusal cannot be reached by nulling it. The reachable path is the one that was actually broken:
     * `countries.currency_code` is NOT NULL and has **no foreign key** to `currencies.code`, so a country may name a
     * currency that does not exist — and five of the seven seeded countries did (AE/AED, GB/GBP, SA/SAR, DE/EUR,
     * JP/JPY). Every money figure for a tenant in Dubai, London, Riyadh, Berlin or Tokyo had no scale to render with.
     *
     * The five rows are now in `db/seeds/core/0003_currencies_units.sql` — JPY at ZERO minor units, which is the case
     * every assumed "two decimals" gets wrong by a factor of a hundred. Both halves are asserted: the seed closed the
     * hole, and the refusal still works for a country the seed does not know about.
     */
    it('has a currency scale for every seeded country — the hole this wave found', async () => {
      const orphans = await admin.query<{ code: string; currency_code: string }>(
        `SELECT c.code, c.currency_code FROM countries c
           LEFT JOIN currencies u ON u.code = c.currency_code
          WHERE u.code IS NULL ORDER BY c.code`);
      expect(orphans.rows).toEqual([]);
      // And the yen has NO minor unit. This single row is the reason a Japanese tenant's money can be rendered at all.
      const jpy = await admin.query<{ minor_units: number }>(`SELECT minor_units FROM currencies WHERE code='JPY'`);
      expect(jpy.rows[0]?.minor_units).toBe(0);
    });

    it('returns NULL rather than guessing for a country whose currency is not on file', async () => {
      // No FK protects this, so it stays reachable: a country onboarded with a currency code this platform does not
      // hold. Guessing two decimals is wrong by a factor of a hundred for a zero-decimal currency — 6d-7's ruling on
      // the notice path, and Rule Zero.
      await admin.query(
        `INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active)
         VALUES ('XT','Testland','XTS','+999','Asia/Kolkata',false)
         ON CONFLICT (code) DO UPDATE SET currency_code='XTS'`);
      expect((await admin.query(`SELECT 1 FROM currencies WHERE code='XTS'`)).rowCount).toBe(0);

      const odd = randomUUID();
      await makeTenant(admin, odd, 'X');
      await admin.query(`UPDATE tenants SET country_code='XT' WHERE id=$1`, [odd]);
      expect(await repo.moneyShape(odd)).toBeNull();
    });

    it('says so by name on the page rather than drawing a rate it cannot render', async () => {
      // The tenant needs real pours, or the page stops at `no_data` before it ever asks about money — which would make
      // this assertion pass for the wrong reason.
      await setFlag(INSIGHTS_FLAG, true);
      const odd = randomUUID();
      const f = randomUUID();
      await makeTenant(admin, odd, 'X2');
      await makeUser(admin, f); await roleIn(f, odd);
      await admin.query(
        `INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active)
         VALUES ('XU','Testland 2','XUS','+998','Asia/Kolkata',false) ON CONFLICT (code) DO NOTHING`);
      await admin.query(`UPDATE tenants SET country_code='XU' WHERE id=$1`, [odd]);

      const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
      const p3 = new PgPoolProvider(config);
      const sh = new ShardRouter(config);
      const rep3 = new PgReadReplicaProvider(p3, sh);
      const mccRepo3 = new MccCentreRepository(rep3 as never);
      const mccs3 = new MccCentreService(new PgUnitOfWork(p3, sh), new PgOutboxWriter(), new PgIdempotencyService(p3),
        new PromMetrics(), new AuditWriter(p3), mccRepo3, new MccOperatorAssignmentRepository(rep3 as never));
      const mem3 = new DairyMembershipService(new PgUnitOfWork(p3, sh), new PgOutboxWriter(), new PgIdempotencyService(p3),
        new PromMetrics(), new DairyMembershipRepository(rep3 as never), mccRepo3, new DairyMembershipRouteRepository(rep3 as never));

      const mcc = (await mccs3.create(odd, deskActor as never, `idem-${randomUUID()}`, { code: 'MCC-E1-X1', defaultName: 'Odd' } as never, null) as never as { id: string }).id;
      const m = (await mem3.create(odd, deskActor as never, `idem-${randomUUID()}`, {
        farmerUserId: f, mccId: mcc, memberCode: 'E1-X001', paymentCycle: 'daily',
      } as never) as never as { id: string }).id;
      const cardX = (await admin.query(
        `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor,
                                      rate_per_kg_snf_minor, effective_from, is_active, created_by)
         VALUES ($1,'X card','cow','two_axis',70000,30000, CURRENT_DATE - 30, true, $2) RETURNING id`, [odd, desk])).rows[0].id;
      // A DAILY cycle needs two days of history, so this tenant clears the gate and reaches the money question.
      await pour({ tenantId: odd, mccId: mcc, membershipId: m, on: await day(-5), kg: '2.000', minor: 10_000, cardId: cardX });
      await pour({ tenantId: odd, mccId: mcc, membershipId: m, on: await day(-1), kg: '2.500', minor: 12_500, cardId: cardX });

      const v = await rm.view(odd, actor);
      expect(v.kind).toBe('unavailable');
      if (v.kind !== 'unavailable') throw new Error('unreachable');
      // The missing reference row is NAMED, so whoever reads the page can go and look it up.
      expect(v.missing.join(' ')).toContain('currencies.minor_units');
      await p3.onModuleDestroy();
    });
  });

  /* ============================================================================================================= */
  describe('THE PAGE, THROUGH THE REAL FLAG STORE', () => {
    it('says NOT SWITCHED ON while the flag is off — never a page of zeroes', async () => {
      await setFlag(INSIGHTS_FLAG, false);
      expect(await rm.view(tenantA, actor)).toEqual({ kind: 'not_enabled', flag: INSIGHTS_FLAG });
    });

    it('assembles the whole page from the real rows once the flag is on', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      const v = await rm.view(tenantA, actor);
      expect(v.kind).toBe('ready');
      if (v.kind !== 'ready') throw new Error('unreachable');

      expect(v.currencyCode).toBe('INR');
      expect(v.minorUnits).toBe(2);
      // 90 calendar days, so the average is the window total over 90 — not over the days that had milk.
      expect(v.ranges.current.days).toBe(90);
      expect(v.volume.basis).toBe('per_calendar_day');
      expect(v.volume.daysWithPours).toBeGreaterThan(0);
      expect(Number(v.volume.daysWithPours)).toBeLessThan(90);

      // The rate is the counter rate and says so.
      if (v.ratePerLitre.kind !== 'measured') throw new Error('expected a measured rate');
      expect(v.ratePerLitre.basis).toBe('gross_at_counter');

      // The cohorts partition, over real pours.
      if (v.pourers.kind !== 'measured') throw new Error('expected measured cohorts');
      expect(v.pourers.newcomers + v.pourers.winBacks + v.pourers.continuing).toBe(v.pourers.active);
      expect(v.pourers.lookbackDays).toBe(POURER_LOOKBACK_DAYS);

      // The refusals survive the round trip intact.
      expect(v.payoutStreak.kind).toBe('not_recorded');
      expect([...v.payoutStreak.missing]).toContain('payouts.settled_at');
      expect(v.payoutStreak.cyclesClosed).toBeGreaterThan(0);
      expect(v.spoilage.kind).toBe('not_measurable');

      // Thirteen weekly buckets, oldest partial, newest complete and ending today.
      expect(v.byShift.buckets.length).toBe(13);
      expect(v.byShift.buckets[12].to).toBe(today);
      expect(v.byShift.firstBucketDays).toBe(6);
    });

    it('reads the premium slab from the CARD — 6.20, which is not the number on the canon’s screen', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      await setFlag('dairy_bonus_slabs', false);
      const v = await rm.view(tenantA, actor);
      if (v.kind !== 'ready') throw new Error('unreachable');
      if (v.premium.current.kind !== 'measured') throw new Error('expected a measured premium band');

      // The threshold on the wire is the card's own, and it is 620 — a spec that used the canon's 650 could not tell a
      // card read from a literal.
      expect(v.premium.current.slabs.map((s) => s.minCentiPct)).toContain(620);
      expect(v.premium.current.slabs.map((s) => s.minCentiPct)).not.toContain(650);
      // With the slab flag OFF nobody was paid, so the count is a forecast and the word is "would".
      expect(v.premium.current.basis).toBe('would_qualify');
      expect(v.bonusMinor).toBe('0');
      // Every pour above was written at fat 6.80, which clears 6.20 — so the forecast is not vacuously zero.
      expect(v.premium.current.qualifying).toBeGreaterThan(0);
    });

    it('names the card and the date it took effect, and no version number', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      const v = await rm.view(tenantA, actor);
      if (v.kind !== 'ready') throw new Error('unreachable');
      const cards = v.rateCards.byAnimal.flatMap((g) => g.cards);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0].defaultName).toBe('E1 card');
      expect(cards[0].effectiveFrom).toBe(await day(-500));
      // `milk_rate_cards` has no version column, so nothing on the wire can carry one.
      expect(JSON.stringify(v.rateCards)).not.toMatch(/"version"/);
      expect(v.rateCards.supersedeRecorded).toBe(false);
      expect(v.rateCards.checkerRequired).toBe(false);
    });

    it('holds the page for a cooperative with only a few days of history', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      const young = randomUUID();
      const farmer = randomUUID();
      await makeTenant(admin, young, 'Y');
      await makeUser(admin, farmer); await roleIn(farmer, young);
      await roleIn(desk, young);

      const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
      const p2 = new PgPoolProvider(config);
      const replica2 = new PgReadReplicaProvider(p2, new ShardRouter(config));
      const uow2 = new PgUnitOfWork(p2, new ShardRouter(config));
      const mccRepo2 = new MccCentreRepository(replica2 as never);
      const mccs2 = new MccCentreService(uow2, new PgOutboxWriter(), new PgIdempotencyService(p2), new PromMetrics(),
        new AuditWriter(p2), mccRepo2, new MccOperatorAssignmentRepository(replica2 as never));
      const memberships2 = new DairyMembershipService(uow2, new PgOutboxWriter(), new PgIdempotencyService(p2),
        new PromMetrics(), new DairyMembershipRepository(replica2 as never), mccRepo2,
        new DairyMembershipRouteRepository(replica2 as never));

      const mcc = (await mccs2.create(young, deskActor as never, `idem-${randomUUID()}`, { code: 'MCC-E1-Y1', defaultName: 'Young' } as never, null) as never as { id: string }).id;
      const m = (await memberships2.create(young, deskActor as never, `idem-${randomUUID()}`, {
        farmerUserId: farmer, mccId: mcc, memberCode: 'E1-Y001', paymentCycle: 'monthly',
      } as never) as never as { id: string }).id;
      const cardY = (await admin.query(
        `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor,
                                      rate_per_kg_snf_minor, effective_from, is_active, created_by)
         VALUES ($1,'Y card','cow','two_axis',70000,30000, CURRENT_DATE - 10, true, $2) RETURNING id`, [young, desk])).rows[0].id;

      // Ten days of history on a MONTHLY cycle: one third of one cycle, where two are needed.
      await pour({ tenantId: young, mccId: mcc, membershipId: m, on: await day(-9), kg: '8.000', minor: 40_000, cardId: cardY });
      await pour({ tenantId: young, mccId: mcc, membershipId: m, on: await day(-1), kg: '8.500', minor: 42_500, cardId: cardY });

      const v = await rm.view(young, actor);
      expect(v.kind).toBe('not_enough_history');
      if (v.kind !== 'not_enough_history') throw new Error('unreachable');
      // The page still says something true rather than nothing: one member has poured.
      expect(v.pourersSoFar).toBe(1);
      if (v.history.kind !== 'not_enough_history') throw new Error('unreachable');
      expect(v.history.cycle).toBe('monthly');
      expect(v.history.needDays).toBe(60);
      expect(v.history.haveCycles).toBe(0);
      await p2.onModuleDestroy();
    });

    it('says NO DATA for a cooperative that has never recorded a pour', async () => {
      await setFlag(INSIGHTS_FLAG, true);
      const empty = randomUUID();
      await makeTenant(admin, empty, 'E');
      const v = await rm.view(empty, actor);
      expect(v.kind).toBe('no_data');
    });
  });
});
