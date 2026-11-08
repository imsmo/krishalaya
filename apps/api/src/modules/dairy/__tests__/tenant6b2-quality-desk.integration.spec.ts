// modules/dairy/__tests__/tenant6b2-quality-desk.integration.spec.ts · PC-56 TENANT-6b-2, against a LIVE Postgres.
//
// The unit suite proves the verdicts and the SQL's shape. This one proves the shape is legal against the real schema and
// that the figures come out of real pours — including the finding this wave opened with, which no unit test could have
// established: **two rate cards can be in force for one animal type at the same time**, because nothing on this platform
// closes a superseded card's `effective_to`, and the pricing path silently takes whichever starts later.
//
// Pours go in through the REAL MilkCollectionService, priced by a real card, so the numbers the desk reports are the
// numbers a farmer was paid.
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
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
// [PC-56 HOTFIX-12 · named update] founder Q1-A: a card prices nothing until a SECOND person approves it and cannot start before
// today, so every card this spec prices with is created AND approved through the real service (helpers/hotfix12-approved-card.ts).
import { approvedCardForTest, tenantTodayForTest } from './helpers/hotfix12-approved-card';
import { MilkCollectionService } from '../services/milk-collection.service';
import { DairyQualityReadModel } from '../read-models/dairy-quality.read-model';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

run('PC-56 TENANT-6b-2 · W168 quality desk (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService;
  /** A record path with a FRESH flag cache — the flag service caches for 30s by design, so a service built in
   *  `beforeAll` keeps answering "off" for half a minute after the flag is switched on. */
  let freshCollections: () => MilkCollectionService;
  let desk: DairyQualityReadModel; let qrepo: DairyQualityRepository;
  let makeDesk: (flagOn: boolean) => DairyQualityReadModel;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const operator = randomUUID();
  const farmers = [randomUUID(), randomUUID(), randomUUID()];
  const actor = { userId: operator, canManage: true };
  let mccId = ''; const members: string[] = [];
  let day = ''; let cardV4 = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, operator);
    for (const f of farmers) await makeUser(admin, f);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);

    const mccRepo = new MccCentreRepository(replica as any);
    const memRepo = new DairyMembershipRepository(replica as any);
    const cardRepo = new MilkRateCardRepository(replica as any);
    const collRepo = new MilkCollectionRepository(replica as any);
    const reviewRepo = new MilkQualityReviewRepository(replica as any);
    qrepo = new DairyQualityRepository(replica as any);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo, audit)   // [PC-56 HOTFIX-12 · named update] + the create/approve audit rows;
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo,
      new FlagsService(pools, new InMemoryCacheService()), new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never), realNoticeVars(replica as never));
    freshCollections = () => new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo,
      new FlagsService(pools, new InMemoryCacheService()), new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never), realNoticeVars(replica as never));
    // A fresh flag cache per desk, for the same reason TENANT-6b-1's suite needs one: the flag service caches for 30s by
    // design ("fast kill-switch propagation"), so a desk built once cannot see the flag flip mid-suite.
    makeDesk = () => new DairyQualityReadModel(qrepo, reviewRepo, new FlagsService(pools, new InMemoryCacheService()), metrics);
    desk = makeDesk(false);

    day = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-02', defaultName: 'Anand 02' } as any, null)).id;
    // W168's own card, with its own slab.
    cardV4 = (await approvedCardForTest(cards, admin, tenantA, actor, {
      defaultName: 'Buffalo two_axis v4', animalType: 'buffalo', pricingModel: 'two_axis',
      ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: addDays(day, -40),
      bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }],
    } as any)).id;

    for (let i = 0; i < 3; i++) {
      members.push((await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmers[i], mccId, memberCode: `AND2-008${i + 7}`, paymentCycle: 'monthly', defaultAnimalType: 'buffalo' } as any)).id);
    }

    // Three days of pours inside the month, with fat deliberately drifting so the stability claim has something to
    // measure — and one member well above the 6.5 slab, one below it.
    const d1 = addDays(day, -2), d2 = addDays(day, -1), d3 = day;
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[0], shift: 'morning', collectedOn: d1, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] } as any);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[1], shift: 'morning', collectedOn: d1, weightKg: '5.000', fatPct: '6.00', snfPct: '8.80', waterFlag: false, adulterationFlags: [] } as any);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[0], shift: 'morning', collectedOn: d2, weightKg: '6.000', fatPct: '6.70', snfPct: '9.00', waterFlag: false, adulterationFlags: [] } as any);
    // …and a FLAGGED pour, so the flag panel and the withheld money are real.
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[2], shift: 'morning', collectedOn: d3, weightKg: '6.200', fatPct: '6.20', snfPct: '8.40', density: '1.024', waterFlag: true, adulterationFlags: [] } as any);
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ----------------------------------------------------------------------------------------------------- */
  it('reports the cycle\'s litre-weighted averages from real pours', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.window.cycle).toBe('monthly');
    // (7.1×6.80 + 5.0×6.00 + 6.0×6.70 + 6.2×6.20)/(24.3) — weighted, not a mean of the four pours.
    expect(v.cycle.fatPct).toBe('6.46');
    expect(v.cycle.litres).toBe('24.3');
    expect(v.cycle.days).toBe(3);
  });

  it('MEASURES the stability claim across the days that carried milk', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.cycle.stability.kind).toBe('measured');
    if (v.cycle.stability.kind !== 'measured') return;
    expect(v.cycle.stability.days).toBe(3);
    // Day 1 weighted fat = (7.1×6.8 + 5.0×6.0)/12.1 = 6.47; day 2 = 6.70; day 3 = 6.20 → spread 0.50, well over ±0.1.
    expect(v.cycle.stability.withinTolerance).toBe(false);
    expect(Number(v.cycle.stability.fatSpreadCentiPct)).toBeGreaterThan(10);
  });

  it('names the herd the cycle\'s milk actually came from', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.animalMix).toEqual([{ animalType: 'buffalo', pours: 4 }]);
  });

  it('counts the flags and what is STILL held, from the reviews TENANT-6b-1 writes', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.flags.total).toBe(1);
    expect(v.flags.byReason.water_flag).toBe(1);
    expect(v.flags.openCount).toBe(1);
    expect(v.flags.allResolvedOrInReview).toBe(false);        // it is sitting untouched, and the desk says so
    expect(BigInt(v.flags.withheldMinor)).toBeGreaterThan(0n);
  });

  it('shows the flagged pour with the member MASKED and its evidence intact', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.openFlags).toHaveLength(1);
    const f = v.openFlags[0];
    expect(f.mccCode).toBe('MCC-AND-02');
    expect(f.memberCodeMasked).toBe('AND2••89');              // AND2-0089 masked
    expect(f.memberCodeMasked).not.toContain('0089');         // the whole code never leaves the API
    expect(f.holdState).toBe('held');
    expect(Number(f.densityAtFlag)).toBeCloseTo(1.024, 3);    // the column that was dead before 6b-1
    expect(f.waterFlag).toBe(true);
    expect(f.status).toBe('open');
  });

  it('reports the premium band as WOULD QUALIFY while the slabs are switched off', async () => {
    const v = await makeDesk(false).view(tenantA, { day, cycle: 'monthly' });
    expect(v.slabsApplied).toBe(false);
    expect(v.premiumBand.kind).toBe('measured');
    if (v.premiumBand.kind !== 'measured') return;
    expect(v.premiumBand.basis).toBe('would_qualify');
    expect(v.premiumBand.qualifying).toBe(1);                 // only member 0 poured above 6.5
    expect(v.premiumBand.pourers).toBe(3);
  });

  it('switches to EARNED — counted from money that moved — once the tenant turns the slabs on', async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='dairy_bonus_slabs'`);
    try {
      const d = addDays(day, -3);
      await freshCollections().record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[0], shift: 'evening', collectedOn: d, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] } as any);
      const paid = (await admin.query(`SELECT bonus_minor FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, members[0], d])).rows[0];
      expect(BigInt(paid.bonus_minor)).toBe(355n);

      const v = await makeDesk(true).view(tenantA, { day, cycle: 'monthly' });
      expect(v.slabsApplied).toBe(true);
      expect(v.premiumBand.kind === 'measured' && v.premiumBand.basis).toBe('earned');
      expect(v.premiumBand.kind === 'measured' && v.premiumBand.qualifying).toBe(1);
    } finally {
      await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='dairy_bonus_slabs'`);
    }
  });

  it('works the example from the BIGGEST real pour on the card, to the paisa', async () => {
    const v = await desk.view(tenantA, { day, cycle: 'monthly' });
    expect(v.example).not.toBeNull();
    expect(v.example!.fromRealPour).toBe(true);
    expect(v.example!.cardId).toBe(cardV4);
    expect(v.example!.litres).toBe('7.1');                    // the 7.1 L pour, which happens to match the canon's
    expect(v.example!.fatKg).toBe('0.483');                   // …and the canon's own 0.483 kg
    expect(v.example!.fatMinor).toBe(34_762n);
    expect(v.example!.snfMinor).toBe(21_967n);
  });

  /* ----------------------------------------------------------------------------------------------------- */
  /* THE FINDING: TWO CARDS IN FORCE AT ONCE                                                               */
  /* ----------------------------------------------------------------------------------------------------- */

  /**
   * [PC-56 HOTFIX-12 · NAMED UPDATE — inverted, not relaxed] These two tests pinned the DEFECT: a "v5" created by one person
   * through the real service put TWO cards in force with no approval anywhere. Founder Q1-A (2026-11-08) closed it, so they now
   * pin the rule through the same real service: a past start is refused; a new card prices nothing until a second person
   * approves it; that approval closes v4 the day before v5 starts; exactly ONE card is in force; the desk and the pricing path
   * agree on it; and the approval is recorded. Every assertion is at least as strong as the one it replaces.
   */
  it('finds ONE card in force on every day after a second person approves v5 (tomorrow) — v4 is closed on today, no day split', async () => {
    // The tenant's own today (IST), not the database session's `current_date`: the rule is the tenant's calendar.
    const today = await tenantTodayForTest(admin, tenantA);
    // A start in the past — and, since the founder's follow-up (2026-11-08), TODAY — is refused by name, and writes nothing.
    for (const from of [addDays(today, -1), today]) {
      await expect(cards.create(tenantA, actor, `idem-${randomUUID()}`, {
        defaultName: 'Buffalo two_axis v5', animalType: 'buffalo', pricingModel: 'two_axis',
        ratePerKgFatMinor: '75000', ratePerKgSnfMinor: '35000', effectiveFrom: from,
      } as any)).rejects.toMatchObject({ code: 'RATE_CARD_BACKDATED' });
    }
    const tomorrow = addDays(today, 1);
    const v5 = (await cards.create(tenantA, actor, `idem-${randomUUID()}`, {
      defaultName: 'Buffalo two_axis v5', animalType: 'buffalo', pricingModel: 'two_axis',
      ratePerKgFatMinor: '75000', ratePerKgSnfMinor: '35000', effectiveFrom: tomorrow,
    } as any)).id;

    // Awaiting a second person: v4 is the only card in force today AND tomorrow, and it prices.
    expect((await qrepo.cardsInForce(tenantA, today)).map((c) => c.id)).toEqual([cardV4]);
    expect((await qrepo.cardsInForce(tenantA, tomorrow)).map((c) => c.id)).toEqual([cardV4]);
    const before = await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[0], shift: 'evening', collectedOn: today, weightKg: '4.000', fatPct: '6.00', snfPct: '8.50', waterFlag: false, adulterationFlags: [] } as any);
    expect(before.rateCardId).toBe(cardV4);

    // The creator cannot approve; a second person can.
    await expect(cards.approve(tenantA, actor, `idem-${randomUUID()}`, v5)).rejects.toMatchObject({ code: 'RATE_CARD_SECOND_PERSON_REQUIRED' });
    const checker = randomUUID(); await makeUser(admin, checker);
    await cards.approve(tenantA, { userId: checker, canManage: true }, `idem-${randomUUID()}`, v5);

    // v4 is closed ON TODAY (the day before v5 starts): today is v4's alone, tomorrow is v5's alone — no day split.
    const v4row = (await admin.query(`SELECT effective_to::text AS t FROM milk_rate_cards WHERE id=$1`, [cardV4])).rows[0];
    expect(v4row.t).toBe(today);
    expect((await qrepo.cardsInForce(tenantA, today)).map((c) => c.id)).toEqual([cardV4]);
    expect((await qrepo.cardsInForce(tenantA, tomorrow)).map((c) => c.id)).toEqual([v5]);

    const vToday = await makeDesk(false).view(tenantA, { day: today, cycle: 'monthly' });
    const vTomorrow = await makeDesk(false).view(tenantA, { day: tomorrow, cycle: 'monthly' });
    for (const [vv, id] of [[vToday, cardV4], [vTomorrow, v5]] as const) {
      const g = vv.rateCards.byAnimal.find((x) => x.animalType === 'buffalo')!;
      expect([g.ambiguous, g.effectiveId, g.cards.map((c) => c.id)]).toEqual([false, id, [id]]);
      expect(vv.rateCards.ambiguousAnimalTypes).toEqual([]);
    }

    // …and the PRICING path agrees: a pour recorded today, AFTER the approval, is still priced by v4.
    const priced = await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[1], shift: 'evening', collectedOn: today, weightKg: '4.000', fatPct: '6.00', snfPct: '8.50', waterFlag: false, adulterationFlags: [] } as any);
    expect(priced.rateCardId).toBe(cardV4);

    const v = vToday;
    expect(v.rateCards.supersedeRecorded).toBe(true);
    expect(v.rateCards.checkerRequired).toBe(true);
  });

  it('has a maker-checker gate on the rate card — the approval above is recorded, by a person other than the creator', async () => {
    const approvals = await admin.query(
      `SELECT actor_user_id FROM audit_log WHERE tenant_id=$1 AND action = 'dairy.rate_card.approved' AND new_value->>'animalType' = $2`, [tenantA, 'buffalo']);
    expect(approvals.rows.length).toBe(2);                     // v4 (the fixture's second person) and v5 (the test's)
    for (const r of approvals.rows) expect(r.actor_user_id).not.toBe(operator);   // never the creator
    // The pattern TENANT-4b's 0143 put on payout batches now exists on the card, as columns the database checks.
    const gate = await admin.query(
      `SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='payout_batches'::regclass AND attname IN ('checker_threshold_minor','approved_by_admin_id')`);
    expect(gate.rows[0].n).toBe(2);
    const cardGate = await admin.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='milk_rate_cards'::regclass AND attnum > 0 AND NOT attisdropped
          AND (attname LIKE '%approv%' OR attname LIKE '%check%') ORDER BY attname`);
    expect(cardGate.rows.map((r: { attname: string }) => r.attname)).toEqual(['approved_at', 'approved_before_rule', 'approved_by']);
  });

  /* ----------------------------------------------------------------------------------------------------- */
  it('shows tenant B nothing of tenant A\'s cycle', async () => {
    const v = await makeDesk(false).view(tenantB, { day, cycle: 'monthly' });
    expect(v.cycle.fatPct).toBeNull();
    expect(v.cycle.litres).toBe('0.0');
    expect(v.flags.total).toBe(0);
    expect(v.openFlags).toEqual([]);
    expect(v.rateCards.byAnimal).toEqual([]);
    expect(v.example).toBeNull();
    expect(v.premiumBand.kind).toBe('no_slabs');
  });

  it('PRUNES: the cycle read reaches only the cycle\'s partitions', async () => {
    const plan = (await admin.query(
      `EXPLAIN (COSTS OFF) SELECT collected_on, sum(weight_kg) FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date GROUP BY collected_on`,
      [tenantA, addDays(day, -2), day])).rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
    const scanned = plan.split('\n').filter((l) => /milk_collections_/.test(l)).length;
    expect(scanned).toBeLessThanOrEqual(2);                    // the window can straddle at most two monthly partitions
  });

  it('the desk\'s flag ships OFF, while the HOLD it displays does not depend on it', async () => {
    const { rows } = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_quality_desk'`);
    expect(rows[0].is_enabled).toBe(false);
    // The hold is on the pour regardless — proven here rather than argued: the flagged pour above is held with the desk
    // switched off, because a farmer's money must not depend on whether a screen is enabled.
    const held = await admin.query(
      `SELECT hold_state FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`,
      [tenantA, members[2], day]);
    expect(held.rows[0].hold_state).toBe('held');
  });
});
