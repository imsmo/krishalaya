// modules/dairy/__tests__/tenant6b2-quality-desk.integration.spec.ts · PC-56 TENANT-6b-2, against a LIVE Postgres.
//
// The unit suite proves the verdicts and the SQL's shape. This one proves the shape is legal against the real schema and
// that the figures come out of real pours — including the finding this wave opened with, which no unit test could have
// established: **two rate cards can be in force for one animal type at the same time**, because nothing on this platform
// closes a superseded card's `effective_to`, and the pricing path silently takes whichever starts later.
//
// Pours go in through the REAL MilkCollectionService, priced by a real card, so the numbers the desk reports are the
// numbers a farmer was paid.
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
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo,
      new FlagsService(pools, new InMemoryCacheService()), new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never));
    freshCollections = () => new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo,
      new FlagsService(pools, new InMemoryCacheService()), new DairyMembershipRouteRepository(replica as never), new DairyDiversionRepository(replica as never));
    // A fresh flag cache per desk, for the same reason TENANT-6b-1's suite needs one: the flag service caches for 30s by
    // design ("fast kill-switch propagation"), so a desk built once cannot see the flag flip mid-suite.
    makeDesk = () => new DairyQualityReadModel(qrepo, reviewRepo, new FlagsService(pools, new InMemoryCacheService()), metrics);
    desk = makeDesk(false);

    day = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-02', defaultName: 'Anand 02' } as any, null)).id;
    // W168's own card, with its own slab.
    cardV4 = (await cards.create(tenantA, actor, `idem-${randomUUID()}`, {
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
   * `MilkRateCardService` is CREATE-ONLY — no deactivate, no supersede — and nothing closes the previous card's
   * `effective_to`. So a cooperative that adds "v5" has TWO cards satisfying `resolveActive`'s predicate, and the
   * `ORDER BY effective_from DESC LIMIT 1` picks one silently. This test creates that state through the real service, so
   * it is a statement about the product rather than about a fixture.
   */
  it('finds TWO cards in force for one animal type, and names which one is pricing', async () => {
    const v5 = (await cards.create(tenantA, actor, `idem-${randomUUID()}`, {
      defaultName: 'Buffalo two_axis v5', animalType: 'buffalo', pricingModel: 'two_axis',
      ratePerKgFatMinor: '75000', ratePerKgSnfMinor: '35000', effectiveFrom: addDays(day, -1),
    } as any)).id;

    const inForce = await qrepo.cardsInForce(tenantA, day);
    expect(inForce.length).toBeGreaterThanOrEqual(2);          // the old card was never closed

    const v = await makeDesk(false).view(tenantA, { day, cycle: 'monthly' });
    const buffalo = v.rateCards.byAnimal.find((g) => g.animalType === 'buffalo')!;
    expect(buffalo.ambiguous).toBe(true);
    expect(v.rateCards.ambiguousAnimalTypes).toContain('buffalo');
    expect(buffalo.effectiveId).toBe(v5);                      // the later start wins, silently, in the pricing path
    expect(buffalo.cards.map((c) => c.id)).toEqual([v5, cardV4]);

    // …and the desk agrees with the PRICING path about which card that is.
    const priced = await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[1], shift: 'evening', collectedOn: day, weightKg: '4.000', fatPct: '6.00', snfPct: '8.50', waterFlag: false, adulterationFlags: [] } as any);
    expect(priced.rateCardId).toBe(v5);

    expect(v.rateCards.supersedeRecorded).toBe(false);
    expect(v.rateCards.checkerRequired).toBe(false);
  });

  it('has no maker-checker gate on the rate card at all — one scope holder changed the rate above, alone', async () => {
    // The card created in the previous test needed exactly one actor with `dairy.manage` and no approval row anywhere.
    const approvals = await admin.query(
      `SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action LIKE '%rate_card%' AND action LIKE '%approv%'`, [tenantA]);
    expect(approvals.rows[0].n).toBe(0);
    // …and the platform DOES have the pattern elsewhere, which is why this is a gap rather than a limitation: TENANT-4b's
    // migration 0143 put a maker-checker gate on payout batches ("MONEY NEVER MOVES WITHOUT TWO HUMANS", W146). The
    // dairy rate card — which decides what every member is paid — has no equivalent column anywhere.
    const gate = await admin.query(
      `SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='payout_batches'::regclass AND attname IN ('checker_threshold_minor','approved_by_admin_id')`);
    expect(gate.rows[0].n).toBe(2);
    const cardGate = await admin.query(
      `SELECT count(*)::int n FROM pg_attribute
        WHERE attrelid='milk_rate_cards'::regclass AND attnum > 0 AND NOT attisdropped
          AND (attname LIKE '%approv%' OR attname LIKE '%check%')`);
    expect(cardGate.rows[0].n).toBe(0);   // no approver, no checker, nothing
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
