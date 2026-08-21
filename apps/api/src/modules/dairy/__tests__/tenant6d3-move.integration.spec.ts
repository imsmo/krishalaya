// modules/dairy/__tests__/tenant6d3-move.integration.spec.ts · PC-56 TENANT-6d-3, LIVE Postgres.
//
// THE WHOLE POINT OF THIS FILE is the sentence W171 makes: *"the membership moves centres without losing history."*
// That is a claim about what the database can still answer AFTER a move, and only a real move against a real schema
// can test it:
//
//   1. **A CLOSED FORTNIGHT STILL READS AGAINST THE CENTRE IT WAS POURED AT.** The register is queried BEFORE and
//      AFTER the move and must give the same answer — this is the defect TENANT-6d-2 refused to ship the move without.
//   2. **A BILL SPANNING THE MOVE NAMES BOTH VILLAGES**, counted from its own pours.
//   3. **THE CARD IS RESOLVED AS OF THE DAY** — the register's masked code and the quality desk's both.
//   4. **THE COUNTER BOARD's ROLL** lands at the right centre for a past day.
//   5. **NO TWO ROUTES CLAIM ONE DAY** — an exclusion constraint, unexpressible in TypeScript.
//   6. **ONE CARD AT ONE COUNTER, IN HISTORY** — the second exclusion constraint.
//   7. **THE ROUTE HISTORY IS APPEND-ONLY FOR `kv_app`** — a column-level grant is only real if the app role cannot
//      write the rest.
//   8. **THE BACKFILL** gave every pre-existing membership exactly one open route.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { DairyCycleConsoleRepository } from '../repositories/dairy-cycle-console.repository';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyMembershipMoveService } from '../services/dairy-membership-move.service';
import { MembershipMoveRefusedError } from '../domain/dairy.errors';
import { billCentres, billSpansCentres } from '../domain/dairy-membership-move';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-3 · W171 the move (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let moves: DairyMembershipMoveService;
  let routes: DairyMembershipRouteRepository; let register: DairyCycleConsoleRepository;
  let counter: DairyCounterRepository; let quality: DairyQualityRepository;
  let replica: PgReadReplicaProvider;

  const tenantA = randomUUID();
  const desk = randomUUID();
  const farmer = randomUUID();
  const actor = { userId: desk, canManage: true };

  let vanthali = ''; let bhesan = ''; let keshod = '';
  let membershipId = ''; let cycleId = ''; let billId = ''; let rateCardId = '';

  const roleIn = (userId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantA]);

  /** A pour, written straight in: this spec is about ATTRIBUTION, not about the counter's own path. */
  const pour = (mccId: string, on: string, shift: 'morning' | 'evening', kg = '10.000') => admin.query(
    `INSERT INTO milk_collections (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, entered_by)
     VALUES ($1,$2,$3,$4,$5::date,$6,6.50,9.00,$7,50000,$8)`,
    [tenantA, mccId, membershipId, shift, on, kg, rateCardId, desk]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, desk); await makeUser(admin, farmer);
    await roleIn(desk); await roleIn(farmer);
    await admin.query(
      `INSERT INTO feature_flags (key, is_enabled, rollout_pct, rules) VALUES ('dairy_membership_transfer', true, 100, '{}'::jsonb)
       ON CONFLICT (key) DO UPDATE SET is_enabled=true, rollout_pct=100`);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    const mccRepo = new MccCentreRepository(replica as never);
    const memberRepo = new DairyMembershipRepository(replica as never);
    routes = new DairyMembershipRouteRepository(replica as never);
    register = new DairyCycleConsoleRepository(replica as never);
    counter = new DairyCounterRepository(replica as never);
    quality = new DairyQualityRepository(replica as never);

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memberRepo, mccRepo, new DairyMembershipRouteRepository(replica as never));
    moves = new DairyMembershipMoveService(uow, outbox, idem, metrics, audit, flags, memberRepo, routes, mccRepo,
      new MilkCollectionRepository(replica as never), new DairyBillCycleRepository(replica as never),
      new DairyDeductionInstructionRepository(replica as never));

    vanthali = (await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D3-01', defaultName: 'Vanthali' } as never, null) as any).id;
    bhesan = (await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D3-02', defaultName: 'Bhesan' } as never, null) as any).id;
    keshod = (await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D3-03', defaultName: 'Keshod' } as never, null) as any).id;

    membershipId = (await memberships.create(tenantA, actor as never, `idem-${randomUUID()}`, {
      farmerUserId: farmer, mccId: vanthali, memberCode: 'AND1-0019', paymentCycle: 'fortnightly',
    } as never) as any).id;

    // A rate card, because `milk_collections.rate_card_id` is NOT NULL.
    const rc = await admin.query(
      `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, effective_from, is_active, created_by)
       VALUES ($1,'D3 card','buffalo','two_axis',70000,30000, CURRENT_DATE - 400, true, $2) RETURNING id`, [tenantA, desk]);
    rateCardId = rc.rows[0].id;

    // The membership was enrolled TODAY (the backfill/enrolment route opens at `created_at::date`), so every date in
    // this spec is anchored to that day rather than to a hardcoded calendar.
    await admin.query(`UPDATE dairy_membership_routes SET valid_from = CURRENT_DATE - 60 WHERE membership_id = $1`, [membershipId]);
  }, 180000);

  afterAll(async () => {
    // RESTORE THE FLAG. TENANT-6c-6 learned this the hard way: a suite that leaves a global flag ON breaks every
    // other suite's kill-switch assertion, and the failure looks like a defect in the wave that reads it.
    await admin?.query(`UPDATE feature_flags SET is_enabled=false WHERE key='dairy_membership_transfer'`).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  const day = async (offset: number): Promise<string> => {
    const r = await admin.query(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [offset]);
    return String(r.rows[0].d);
  };

  /* ======================================================================================================= */
  describe('THE BACKFILL AND THE RECORD', () => {
    it('gave the membership exactly one OPEN route, from its own enrolment', async () => {
      const r = await admin.query(
        `SELECT mcc_id, member_code, valid_to, reason FROM dairy_membership_routes WHERE membership_id=$1`, [membershipId]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ mcc_id: vanthali, member_code: 'AND1-0019', valid_to: null });
    });

    it('answers the as-of question through the database function', async () => {
      const x = replica.forTenant(tenantA);
      const today = await day(0);
      expect(await routes.asOf(x as never, tenantA, membershipId, today)).toMatchObject({ mccId: vanthali, memberCode: 'AND1-0019' });
      // Before the record begins there is NO answer — not the earliest route.
      expect(await routes.asOf(x as never, tenantA, membershipId, await day(-90))).toBeNull();
    });
  });

  /* ======================================================================================================= */
  describe('A CLOSED FORTNIGHT, BEFORE AND AFTER THE MOVE', () => {
    it('builds a closed cycle whose bill was poured at Vanthali', async () => {
      const from = await day(-40); const to = await day(-26);
      await pour(vanthali, await day(-38), 'morning');
      await pour(vanthali, await day(-37), 'morning');
      await pour(vanthali, await day(-30), 'evening');

      const c = await admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at)
         VALUES ($1,'fortnightly',$2::date,$3::date, now(), $3::date + 2, 'closed', now()) RETURNING id`, [tenantA, from, to]);
      cycleId = c.rows[0].id;
      const b = await admin.query(
        `INSERT INTO milk_bills (tenant_id, membership_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status, cycle_id, created_by)
         VALUES ($1,$2,$3::date,$4::date, 30.000, 150000, 0, 150000, 'draft', $5, $6) RETURNING id`,
        [tenantA, membershipId, from, to, cycleId, desk]);
      billId = b.rows[0].id;
      await admin.query(
        `UPDATE milk_collections SET milk_bill_id=$1 WHERE tenant_id=$2 AND membership_id=$3 AND collected_on BETWEEN $4::date AND $5::date`,
        [billId, tenantA, membershipId, from, to]);

      const page = await register.bills(tenantA, cycleId, { limit: 10 });
      expect(page.rows[0].pouredCentres).toEqual([{ mccId: vanthali, code: 'MCC-D3-01', pours: 3 }]);
      expect(page.rows[0].memberCode).toBe('AND1-0019');
      expect(page.rows[0].memberCodeIsCurrent).toBe(false);
    });

    it('MOVES the membership — and the closed fortnight still reads Vanthali', async () => {
      const effective = await day(-20);
      const r: any = await moves.move(tenantA, actor as never, `idem-${randomUUID()}`, membershipId, {
        toMccId: bhesan, newMemberCode: 'AND2-0104', effectiveFrom: effective, reason: 'moved house to Bhesan',
      }, null);
      expect(r).toMatchObject({ mccId: bhesan, memberCode: 'AND2-0104', effectiveFrom: effective });

      // THE ASSERTION THIS WHOLE WAVE EXISTS FOR. Before TENANT-6d-3 the register read the centre and the card from the
      // membership's CURRENT route, so this same query would now say Bhesan and AND2-0104 for a fortnight poured at
      // Vanthali under card AND1-0019.
      const page = await register.bills(tenantA, cycleId, { limit: 10 });
      expect(page.rows[0].pouredCentres).toEqual([{ mccId: vanthali, code: 'MCC-D3-01', pours: 3 }]);
      expect(page.rows[0].memberCode).toBe('AND1-0019');
      // `spansCentres` is the READ-MODEL's projection of this list; at the repository the list itself is the fact.
      expect(billSpansCentres(billCentres(page.rows[0].pouredCentres))).toBe(false);

      // …and the membership's own row moved, with the two periods meeting exactly.
      const rows = await admin.query(
        `SELECT mcc_id, member_code, valid_from::text f, valid_to::text t FROM dairy_membership_routes
          WHERE membership_id=$1 ORDER BY valid_from`, [membershipId]);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toMatchObject({ mcc_id: vanthali, member_code: 'AND1-0019', t: await day(-21) });
      expect(rows.rows[1]).toMatchObject({ mcc_id: bhesan, member_code: 'AND2-0104', f: effective, t: null });
    });

    it('publishes the move with BOTH centres, BOTH cards and the day', async () => {
      const r = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.membership_moved' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(r.rows[0].payload).toMatchObject({
        membershipId, farmerUserId: farmer, fromMccId: vanthali, toMccId: bhesan,
        fromMemberCode: 'AND1-0019', toMemberCode: 'AND2-0104',
      });
    });

    it('names BOTH villages on a bill whose fortnight spans the move', async () => {
      const from = await day(-24); const to = await day(-10);
      await pour(vanthali, await day(-23), 'morning');
      await pour(vanthali, await day(-22), 'morning');
      await pour(bhesan, await day(-15), 'morning');
      const c = await admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at)
         VALUES ($1,'fortnightly',$2::date,$3::date, now(), $3::date + 2, 'closed', now()) RETURNING id`, [tenantA, from, to]);
      const b = await admin.query(
        `INSERT INTO milk_bills (tenant_id, membership_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status, cycle_id, created_by)
         VALUES ($1,$2,$3::date,$4::date, 30.000, 150000, 0, 150000, 'draft', $5, $6) RETURNING id`,
        [tenantA, membershipId, from, to, c.rows[0].id, desk]);
      await admin.query(
        `UPDATE milk_collections SET milk_bill_id=$1 WHERE tenant_id=$2 AND membership_id=$3 AND collected_on BETWEEN $4::date AND $5::date`,
        [b.rows[0].id, tenantA, membershipId, from, to]);

      const page = await register.bills(tenantA, c.rows[0].id, { limit: 10 });
      // Biggest first, and both — which is why no single stored `mcc_id` on `milk_bills` would ever have been right.
      expect(page.rows[0].pouredCentres).toEqual([
        { mccId: vanthali, code: 'MCC-D3-01', pours: 2 },
        { mccId: bhesan, code: 'MCC-D3-02', pours: 1 },
      ]);
      // The card as of the day this fortnight CLOSED — by then she was at Bhesan.
      expect(page.rows[0].memberCode).toBe('AND2-0104');
    });
  });

  /* ======================================================================================================= */
  describe('THE OTHER TWO REPAIRED READS', () => {
    it('the QUALITY DESK prints the card that was carried on the day of the pour', async () => {
      const before = await quality.reviewContext(tenantA, membershipId, vanthali, await day(-38));
      expect(before).toMatchObject({ memberCode: 'AND1-0019', mccCode: 'MCC-D3-01', codeIsCurrent: false });
      const after = await quality.reviewContext(tenantA, membershipId, bhesan, await day(-5));
      expect(after).toMatchObject({ memberCode: 'AND2-0104', codeIsCurrent: false });
      // A day before the record begins: the current card, FLAGGED as current.
      const older = await quality.reviewContext(tenantA, membershipId, vanthali, await day(-200));
      expect(older).toMatchObject({ memberCode: 'AND2-0104', codeIsCurrent: true });
    });

    it('the COUNTER BOARD counts the roll at the centre the member was routed to THAT day', async () => {
      const beforeMove = await counter.centreShiftRows(tenantA, await day(-30), 'morning');
      const byCode = (rows: typeof beforeMove) => new Map(rows.map((r) => [r.code, r.membershipsEnrolled]));
      expect(byCode(beforeMove).get('MCC-D3-01')).toBe(1);
      expect(byCode(beforeMove).get('MCC-D3-02')).toBe(0);

      const afterMove = await counter.centreShiftRows(tenantA, await day(-5), 'morning');
      // The SAME member, on a later day, counted at the OTHER village. Before this wave both boards said Bhesan.
      expect(byCode(afterMove).get('MCC-D3-01')).toBe(0);
      expect(byCode(afterMove).get('MCC-D3-02')).toBe(1);
    });
  });

  /* ======================================================================================================= */
  describe('WHAT THE DATABASE AND THE SERVICE REFUSE', () => {
    it('refuses a move whose date a printed slip contradicts, and names the earliest one', async () => {
      // She poured at Bhesan five days ago; a move effective then would put the route at Keshod on that day.
      const contested = await day(-15);
      await expect(moves.move(tenantA, actor as never, `idem-${randomUUID()}`, membershipId, {
        toMccId: keshod, newMemberCode: 'AND3-0001', effectiveFrom: contested,
      }, null)).rejects.toBeInstanceOf(MembershipMoveRefusedError);

      const v = await moves.preview(tenantA, actor as never, membershipId, {
        toMccId: keshod, newMemberCode: 'AND3-0001', effectiveFrom: contested,
      });
      expect(v.refusal).toBe('BEFORE_LAST_POUR');
      expect(v.earliestFrom).toBe(await day(-14));
    });

    it('refuses a card another member already carries at the destination', async () => {
      const other = randomUUID(); await makeUser(admin, other); await roleIn(other);
      await memberships.create(tenantA, actor as never, `idem-${randomUUID()}`, {
        farmerUserId: other, mccId: keshod, memberCode: 'AND3-0777', paymentCycle: 'weekly',
      } as never);
      const v = await moves.preview(tenantA, actor as never, membershipId, { toMccId: keshod, newMemberCode: 'AND3-0777' });
      expect(v.refusal).toBe('CODE_TAKEN');
    });

    it('the DATABASE refuses two routes claiming one day, and one card at one counter twice', async () => {
      // A second OPEN route is caught by the partial unique index — the common corruption, and the one that would let
      // a read pick either answer depending on the sort.
      await expect(admin.query(
        `INSERT INTO dairy_membership_routes (tenant_id, membership_id, mcc_id, member_code, valid_from)
         VALUES ($1,$2,$3,'AND9-0001', CURRENT_DATE - 5)`, [tenantA, membershipId, keshod]))
        .rejects.toMatchObject({ constraint: 'uq_dairy_route_current' });

      // The SUBTLER one, and the reason an exclusion constraint exists as well: a CLOSED row overlapping a closed
      // period. Nothing about it is visible in a "one current route" check, and it is what would make
      // "where was this member on 14 June" a question with two answers.
      await expect(admin.query(
        `INSERT INTO dairy_membership_routes (tenant_id, membership_id, mcc_id, member_code, valid_from, valid_to)
         VALUES ($1,$2,$3,'AND9-0002', CURRENT_DATE - 30, CURRENT_DATE - 25)`, [tenantA, membershipId, keshod]))
        .rejects.toMatchObject({ constraint: 'ex_dairy_route_no_overlap' });

      // A DIFFERENT membership taking a card that is already held at that centre over an overlapping period.
      const other = randomUUID(); await makeUser(admin, other); await roleIn(other);
      const m2: any = await memberships.create(tenantA, actor as never, `idem-${randomUUID()}`, {
        farmerUserId: other, mccId: vanthali, memberCode: 'AND1-0555', paymentCycle: 'weekly',
      } as never);
      await expect(admin.query(
        `INSERT INTO dairy_membership_routes (tenant_id, membership_id, mcc_id, member_code, valid_from, valid_to)
         VALUES ($1,$2,$3,'AND2-0104', CURRENT_DATE - 10, CURRENT_DATE - 1)`, [tenantA, m2.id, bhesan]))
        .rejects.toMatchObject({ constraint: 'ex_dairy_route_card_once' });
    });

    it('the route history is APPEND-ONLY for the application role, except its closing date', async () => {
      const app = new Pool({ connectionString: APP_URL });
      try {
        for (const col of ['mcc_id', 'member_code', 'valid_from', 'moved_by', 'reason']) {
          await expect(app.query(`UPDATE dairy_membership_routes SET ${col} = ${col} WHERE membership_id=$1`, [membershipId]))
            .rejects.toMatchObject({ code: '42501' });
        }
        await expect(app.query(`DELETE FROM dairy_membership_routes WHERE membership_id=$1`, [membershipId]))
          .rejects.toMatchObject({ code: '42501' });
      } finally { await app.end(); }
    });

    it('refuses a move to the same centre, and one whose destination is closed', async () => {
      expect((await moves.preview(tenantA, actor as never, membershipId, { toMccId: bhesan, newMemberCode: 'X-1' })).refusal).toBe('SAME_CENTRE');
      await mccs.setActive(tenantA, actor as never, keshod, false, null);
      expect((await moves.preview(tenantA, actor as never, membershipId, { toMccId: keshod, newMemberCode: 'AND3-0002' })).refusal).toBe('CENTRE_INACTIVE');
      await mccs.setActive(tenantA, actor as never, keshod, true, null);
    });

    it('is IDEMPOTENT — the same key does not split one tenure into two', async () => {
      const key = `idem-${randomUUID()}`;
      const to = await day(1);
      const first: any = await moves.move(tenantA, actor as never, key, membershipId, { toMccId: keshod, newMemberCode: 'AND3-0009', effectiveFrom: to }, null);
      const again: any = await moves.move(tenantA, actor as never, key, membershipId, { toMccId: keshod, newMemberCode: 'AND3-0009', effectiveFrom: to }, null);
      expect(again.memberCode).toBe(first.memberCode);
      const rows = await admin.query(`SELECT count(*)::int n FROM dairy_membership_routes WHERE membership_id=$1`, [membershipId]);
      expect(rows.rows[0].n).toBe(3);      // Vanthali, Bhesan, Keshod — and no phantom fourth.
    });

    it('keeps the trail readable oldest-first, and the person unchanged throughout', async () => {
      const trail = await moves.trail(tenantA, actor as never, membershipId, 10);
      expect(trail.map((r) => r.memberCode)).toEqual(['AND1-0019', 'AND2-0104', 'AND3-0009']);
      const m = await admin.query(`SELECT farmer_user_id, payment_cycle FROM dairy_memberships WHERE id=$1`, [membershipId]);
      // *"The person's record never resets"* — same person, same payment preference, after two moves.
      expect(m.rows[0]).toEqual({ farmer_user_id: farmer, payment_cycle: 'fortnightly' });
    });
  });
});
