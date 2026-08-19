// modules/dairy/__tests__/tenant6a-counter.integration.spec.ts · PC-56 TENANT-6a, against a LIVE Postgres.
//
// The unit suite proves the arithmetic and the SQL's SHAPE. This one proves the shape is legal against the real
// schema — which is where every earlier wave found its actual defects (a column that does not exist, a partition that
// hides a row, an index the planner ignores). W167 is the first read of a DAY's collections this platform has ever
// had, so nothing about this query has ever run against real DDL before.
//
// Written the same way as dairy.integration.spec.ts: pours are recorded through the REAL MilkCollectionService (priced
// by a real rate card, into the real partitioned table), then read back through the real read model. No hand-inserted
// milk_collections rows — a fixture that bypasses the writer proves nothing about what the writer stores.
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

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyCounterReadModel } from '../read-models/dairy-counter.read-model';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6a · W167 counter board (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService;
  let board: DairyCounterReadModel; let repo: DairyCounterRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const operator = randomUUID();
  const farmers = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const actor = { userId: operator, canManage: true };

  // The day is read from the DATABASE, not from the test process: the board's own `today()` uses PG's clock, and a
  // container an hour off UTC must not make this suite look at a different day than the query does.
  let today = '';
  let busyMcc = ''; let quietMcc = '';
  const members: string[] = [];

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
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo);

    repo = new DairyCounterRepository(replica as any);
    board = new DairyCounterReadModel(repo, metrics);
    inspect = new Pool({ connectionString: APP_URL });

    today = await repo.today(tenantA);

    // Two centres — one busy, one that will collect NOTHING, because "Keshod is empty at 09:00" is the row an
    // operator most needs to see and the one a plain aggregate would silently drop.
    busyMcc = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-VNT', defaultName: 'Vanthali' } as any, null)).id;
    quietMcc = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-KSD', defaultName: 'Keshod' } as any, null)).id;

    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Cow two-axis', animalType: 'cow', pricingModel: 'two_axis', ratePerKgFatMinor: '50000', ratePerKgSnfMinor: '30000', effectiveFrom: '2026-01-01' } as any);

    // Three on the busy centre's roll (two will pour → coverage 2/3), one on the quiet centre's.
    for (let i = 0; i < 3; i++) {
      members.push((await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmers[i], mccId: busyMcc, memberCode: `C-00${i + 1}`, paymentCycle: 'fortnightly', defaultAnimalType: 'cow' } as any)).id);
    }
    members.push((await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmers[3], mccId: quietMcc, memberCode: 'K-001', paymentCycle: 'fortnightly', defaultAnimalType: 'cow' } as any)).id);

    // Two morning pours on the busy centre, DIFFERENT weights and qualities so a litre-weighted average is
    // distinguishable from a mean of means — the whole point of doing it in SQL.
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[0], shift: 'morning', collectedOn: today, weightKg: '30.000', fatPct: '7.00', snfPct: '9.00', waterFlag: false, adulterationFlags: [] } as any);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[1], shift: 'morning', collectedOn: today, weightKg: '10.000', fatPct: '3.00', snfPct: '8.00', waterFlag: true, adulterationFlags: ['urea'] } as any);
    // An EVENING pour, so the shift filter has something to exclude.
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: members[2], shift: 'evening', collectedOn: today, weightKg: '5.000', fatPct: '4.00', snfPct: '8.00', waterFlag: false, adulterationFlags: [] } as any);
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  /* ----------------------------------------------------------------------------------------------------- */
  it('reads a DAY at a centre — the query this platform did not have', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    expect(b.day).toBe(today);
    expect(b.shift).toBe('morning');
    const busy = b.centres.find((c) => c.mccId === busyMcc)!;
    expect(busy.code).toBe('MCC-VNT');
    expect(busy.pours).toBe(2);
    expect(busy.pourers).toBe(2);
    expect(busy.membershipsEnrolled).toBe(3);
    expect(busy.litres).toBe('40.0');            // 30kg + 10kg, milli-kg → litres, one decimal
  });

  it('weights fat and SNF BY LITRES inside the database, not as a mean of the pours', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    const busy = b.centres.find((c) => c.mccId === busyMcc)!;
    // Mean of means would be (7.00+3.00)/2 = 5.0. Weighted: (30×7 + 10×3)/40 = 6.0.
    expect(busy.fatPct).toBe('6.0');
    expect(busy.snfPct).toBe('8.8');             // (30×9 + 10×8)/40 = 8.75 → 8.8 (half up)
    expect(b.totals.fatPct).toBe('6.0');         // one centre poured, so the tenant total matches it
  });

  it('keeps the centre that collected NOTHING on the board, marked as such', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    const quiet = b.centres.find((c) => c.mccId === quietMcc);
    expect(quiet).toBeDefined();
    expect(quiet!.pours).toBe(0);
    expect(quiet!.litres).toBe('0.0');
    expect(quiet!.fatPct).toBeNull();            // no pours means NO quality, not 0.0 fat
    expect(quiet!.snfPct).toBeNull();
    expect(quiet!.membershipsEnrolled).toBe(1);  // its roll is still real
  });

  it('excludes the other shift entirely — the evening pour is not on the morning board', async () => {
    const morning = await board.board(tenantA, { day: today, shift: 'morning' });
    const evening = await board.board(tenantA, { day: today, shift: 'evening' });
    expect(morning.totals.pours).toBe(2);
    expect(evening.totals.pours).toBe(1);
    expect(evening.centres.find((c) => c.mccId === busyMcc)!.litres).toBe('5.0');
  });

  it('foots: the centre rows sum to the header total, in the database\'s own numbers', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    const tenths = (s: string) => { const [i, f = '0'] = s.split('.'); return BigInt(i) * 10n + BigInt((f + '0').slice(0, 1)); };
    expect(b.centres.reduce((a, c) => a + tenths(c.litres), 0n)).toBe(tenths(b.totals.litres));
    expect(b.centres.reduce((a, c) => a + BigInt(c.amountMinor), 0n)).toBe(BigInt(b.totals.amountMinor));
  });

  it('gives W167\'s "n of m pourers" against the real membership roll', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    expect(b.coverage.kind).toBe('measured');
    if (b.coverage.kind !== 'measured') return;
    expect(b.coverage.poured).toBe(2);
    expect(b.coverage.enrolled).toBe(4);         // 3 busy + 1 quiet
    expect(b.coverage.shareBps).toBe(5000);
  });

  /**
   * [THE FINDING THIS SUITE WAS WRITTEN FOR] The doubly-flagged pour (water AND urea) printed 2 in the tile above a
   * table row that said 1 — the tile summed flag MARKERS while the SQL column counts flagged POURS — and the tile
   * spanned the whole day while the table spanned one shift. Two mechanisms over one fact, disagreeing, on the number
   * that decides how many retained samples get re-tested. Both are now the same quantity over the same window, and
   * this test is the one that holds them together.
   */
  it('counts flagged POURS for the SHIFT, and the tile agrees with the table\'s own flag column', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    expect(b.flagSummary.total).toBe(1);                    // ONE pour to chase, though it carries two markers
    expect(b.flagSummary.water).toBe(1);
    expect(b.flagSummary.other).toBe(1);
    expect(b.flagSummary.kinds).toContain('urea');
    expect(b.flagSummary.kinds).toContain('water_flag');
    expect(b.flagSummary.workflow).toBe('not_built');
    expect(b.totals.flags).toBe(b.flagSummary.total);
    expect(b.centres.reduce((a, c) => a + c.flags, 0)).toBe(b.flagSummary.total);
  });

  it('does not count the OTHER shift\'s flags into this shift\'s tile', async () => {
    // The evening pour carries no flag, so an evening board must report a clean shift even though the day is not.
    const evening = await board.board(tenantA, { day: today, shift: 'evening' });
    expect(evening.flagSummary.total).toBe(0);
    expect(evening.flagSummary.kinds).toEqual([]);
    expect(evening.totals.flags).toBe(0);
  });

  it('accrues the window\'s money in bigint and reports NO bills, because nothing generates them on a clock', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning', cycle: 'monthly' });
    // 30kg @ 7.00/9.00 → 2.1kg fat × 500 + 2.7kg SNF × 300 = 1050 + 810 = 1860.00
    // 10kg @ 3.00/8.00 → 0.3 × 500 + 0.8 × 300 = 150 + 240 = 390.00
    //  5kg @ 4.00/8.00 → 0.2 × 500 + 0.4 × 300 = 100 + 120 = 220.00   (evening — still in the WINDOW)
    expect(BigInt(b.accrual.amountMinor)).toBe(247000n);
    expect(b.accrual.kind).toBe('accrued');
    expect(b.accrual.membersWithPours).toBe(3);
    expect(b.accrual.billsExisting).toBe(0);
    expect(b.accrual.window.basis).toBe('derived_from_membership_preference');
  });

  it('defaults the window to the members\' OWN most common payment_cycle — a column nothing read before', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    expect(b.window.cycle).toBe('fortnightly');          // all four members are enrolled fortnightly
    expect(b.cycleMix).toEqual([{ paymentCycle: 'fortnightly', members: 4 }]);
    // The canon's own "01–15" / "16–EOM" halves, derived from the real day.
    const dom = Number(today.slice(8, 10));
    expect(b.window.from.slice(8, 10)).toBe(dom <= 15 ? '01' : '16');
  });

  it('reports the tenant\'s own currency rather than assuming rupees', async () => {
    expect(await repo.currencyCode(tenantA)).toMatch(/^[A-Z]{3}$/);
  });

  it('says no_unit for every centre, because bmc_units has had no code since 0007', async () => {
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    for (const c of b.centres) expect(c.bmc.kind).toBe('no_unit');
  });

  it('reads a real BMC reading through cold_chain_logs once a unit and a log exist', async () => {
    // `bmc_units` has no `code` column and no application code at all — TENANT-6a is the first reader of the table,
    // and TENANT-6d builds its writer. `cold_chain_logs` is RANGE-partitioned on recorded_at, so the reading is
    // written at now() to land in a live partition.
    const unitId = (await admin.query(
      `INSERT INTO bmc_units (tenant_id, mcc_id, capacity_litres, target_temp_c)
       VALUES ($1, $2, 2000, 4.0) RETURNING id`,
      [tenantA, busyMcc],
    )).rows[0].id;
    await admin.query(
      `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, is_breach)
       VALUES ($1, 'bmc_unit', $2, 6.9, now(), true)`,
      [tenantA, unitId],
    );
    const b = await board.board(tenantA, { day: today, shift: 'morning' });
    const busy = b.centres.find((c) => c.mccId === busyMcc)!;
    expect(busy.bmc.kind).toBe('reading');
    if (busy.bmc.kind !== 'reading') return;
    expect(Number(busy.bmc.tempC)).toBeCloseTo(6.9, 1);
    expect(busy.bmc.overTarget).toBe(true);                                  // 6.9 > 4.0 target
    expect(b.centres.find((c) => c.mccId === quietMcc)!.bmc.kind).toBe('no_unit');
  });

  it('refuses a second pour for the same member, day and shift at the CONSTRAINT, not just in code', async () => {
    await expect(admin.query(
      `INSERT INTO milk_collections (tenant_id, membership_id, mcc_id, collected_on, shift, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor)
       SELECT $1, $2, $3, $4::date, 'morning', 1.000, 4.00, 8.00, rate_card_id, 100
          FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 LIMIT 1`,
      [tenantA, members[0], busyMcc, today],
    )).rejects.toThrow(/duplicate key|unique/i);
  });

  it('shows tenant B nothing of tenant A\'s day', async () => {
    const b = await board.board(tenantB, { day: today, shift: 'morning' });
    expect(b.centres).toEqual([]);
    expect(b.totals.pours).toBe(0);
    expect(b.totals.litres).toBe('0.0');
    expect(b.coverage.kind).toBe('no_memberships');
    expect(BigInt(b.accrual.amountMinor)).toBe(0n);
  });

  it('RLS: the app role cannot see another tenant\'s collections at all', async () => {
    await inspect.query('SET ROLE kv_app');
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM milk_collections WHERE tenant_id=$1`, [tenantA])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT count(*)::int n FROM milk_collections WHERE collected_on=$1`, [today])).rows[0].n).toBe(3);
    await inspect.query('RESET ROLE');
  });

  it('PRUNES: the board\'s day bound reaches ONE partition, not the whole table', async () => {
    const plan = (await admin.query(
      `EXPLAIN (COSTS OFF) SELECT count(*) FROM milk_collections WHERE tenant_id=$1 AND collected_on=$2 AND shift='morning'`,
      [tenantA, today],
    )).rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
    const scanned = plan.split('\n').filter((l) => /milk_collections_/.test(l)).length;
    expect(scanned).toBeLessThanOrEqual(1);
  });

  it('the migration\'s index exists and is the one the planner has available for this shape', async () => {
    const { rows } = await admin.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_milkcoll_tenant_day_shift'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/tenant_id, collected_on, shift/);
  });

  it('the flag ships OFF, so turning the board on is a tenant\'s decision', async () => {
    const { rows } = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_counter_board'`);
    expect(rows.length).toBe(1);
    expect(rows[0].is_enabled).toBe(false);
  });
});
