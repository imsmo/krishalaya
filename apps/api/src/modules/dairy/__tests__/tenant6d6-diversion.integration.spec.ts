// modules/dairy/__tests__/tenant6d6-diversion.integration.spec.ts · PC-56 TENANT-6d-6, LIVE Postgres.
//
// SEVEN THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **A DIVERTED POUR IS RECORDED AT THE CENTRE THAT TOOK IT.** The whole wave. A membership routed to Vanthali
//      pours at Bhesan under a signed diversion, and `milk_collections.mcc_id` says BHESAN — where before this wave
//      every such row said Vanthali and TENANT-6d-3's repair then attributed the fortnight to the wrong village.
//   2. **A BACKDATED POUR USES THE ROUTE OF ITS OWN DAY.** The narrower half of the same finding, and it needs a real
//      route history with a real move in it.
//   3. **A POUR AT ANOTHER CENTRE WITH NO DIVERSION IS REFUSED**, and nothing is written.
//   4. **MAKER ≠ CHECKER IS A CONSTRAINT**, not only a service rule: only a live UPDATE can show
//      `ck_dairy_diversion_maker_ne_checker` refusing a self-signature.
//   5. **ONE LIVE DIVERSION PER CENTRE-SHIFT-DAY** — a partial unique index, so a second live row is refused while any
//      number of cancelled ones stay legal.
//   6. **THE TRIGGER CANNOT BE WALKED PAST.** `assert_collection_diversion()` refuses a pour citing a diversion for
//      another day, another shift, another centre, or one that is unsigned or cancelled.
//   7. **THE APPEND-ONLY GRANT IS REAL** — a column-level GRANT is only true if `kv_app` actually cannot rewrite the
//      reason or the centres, and only a live UPDATE as that role can show it.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
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
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { DairyDiversionService } from '../services/dairy-diversion.service';
import { DiversionRefusedError, PourNotAtThisCentreError } from '../domain/dairy.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-6 · the diversion (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let memberships: DairyMembershipService;
  let pours: MilkCollectionService; let diversions: DairyDiversionService;

  const tenantA = randomUUID();
  const operator = randomUUID();
  const lead = randomUUID();
  const farmer = randomUUID();
  const opActor = { userId: operator, canManage: true, canOverride: false };
  const leadActor = { userId: lead, canManage: true, canOverride: true };

  let vanthali = ''; let bhesan = ''; let membershipId = '';
  let today = '';
  // Hoisted: one live test signs a diversion through the service and then calls the REPOSITORY directly, which is how
  // the append-only guard on its two endings is reachable at all.
  let uow!: PgUnitOfWork;
  let divRepo!: DairyDiversionRepository;

  const roleIn = (userId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantA]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [operator, lead, farmer]) await makeUser(admin, u);
    for (const u of [operator, lead, farmer]) await roleIn(u);
    today = String((await admin.query(`SELECT current_date::text AS d`)).rows[0].d);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    const mccRepo = new MccCentreRepository(replica as never);
    const routeRepo = new DairyMembershipRouteRepository(replica as never);
    divRepo = new DairyDiversionRepository(replica as never);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, new DairyMembershipRepository(replica as never), mccRepo, routeRepo);
    pours = new MilkCollectionService(uow, outbox, idem, metrics, new MilkCollectionRepository(replica as never),
      new MilkRateCardRepository(replica as never), new DairyMembershipRepository(replica as never),
      new MilkQualityReviewRepository(replica as never), flags, routeRepo, divRepo, realNoticeVars(replica as never));
    diversions = new DairyDiversionService(uow, outbox, idem, metrics, audit, divRepo, mccRepo);

    const v: any = await mccs.create(tenantA, opActor as never, `idem-${randomUUID()}`, { code: 'MCC-D6-VNT', defaultName: 'Vanthali' } as never, null);
    vanthali = v.id;
    const b: any = await mccs.create(tenantA, opActor as never, `idem-${randomUUID()}`, { code: 'MCC-D6-BHE', defaultName: 'Bhesan' } as never, null);
    bhesan = b.id;
    const m: any = await memberships.create(tenantA, opActor as never, `idem-${randomUUID()}`, {
      farmerUserId: farmer, mccId: vanthali, memberCode: 'D6-001', defaultAnimalType: 'buffalo',
      paymentCycle: 'fortnightly',
    } as never);
    membershipId = m.id;
    // A rate card, because `milk_collections.rate_card_id` is NOT NULL. Inserted directly, as TENANT-6d-3's spec does:
    // this wave is not about pricing and the card's own act has its own suite.
    await admin.query(
      `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, effective_from, is_active, created_by)
       VALUES ($1,'D6 card','buffalo','two_axis',70000,30000, CURRENT_DATE - 400, true, $2)`, [tenantA, operator]);
    // The membership enrols with a route opening TODAY (TENANT-6d-3's enrolment fix), and this spec backdates a pour by
    // one day — so the first route has to reach back far enough to answer for it.
    await admin.query(`UPDATE dairy_membership_routes SET valid_from = CURRENT_DATE - 60 WHERE membership_id = $1`, [membershipId]);
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE RULE: WHERE MAY THIS POUR BE RECORDED', () => {
    it('records an ordinary pour at the member\'s own centre, citing no diversion', async () => {
      const r: any = await pours.record(tenantA, opActor as never, `idem-${randomUUID()}`, {
        membershipId, shift: 'morning', collectedOn: today, weightKg: '10.000', fatPct: '6.40', snfPct: '8.90',
        waterFlag: false, adulterationFlags: [],
      } as never);
      const row = await admin.query(`SELECT mcc_id, diversion_id FROM milk_collections WHERE id=$1`, [r.id]);
      expect(row.rows[0]).toEqual({ mcc_id: vanthali, diversion_id: null });
    });

    it('REFUSES a pour at another centre with no diversion, and writes nothing', async () => {
      const before = await admin.query(`SELECT count(*)::int n FROM milk_collections WHERE tenant_id=$1`, [tenantA]);
      await expect(pours.record(tenantA, opActor as never, `idem-${randomUUID()}`, {
        membershipId, mccId: bhesan, shift: 'evening', collectedOn: today, weightKg: '9.000', fatPct: '6.10', snfPct: '8.70',
        waterFlag: false, adulterationFlags: [],
      } as never)).rejects.toBeInstanceOf(PourNotAtThisCentreError);
      const after = await admin.query(`SELECT count(*)::int n FROM milk_collections WHERE tenant_id=$1`, [tenantA]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it('records a DIVERTED pour at the centre that took it, carrying the authority', async () => {
      // Request, then sign with a DIFFERENT person — the milk does not move on one signature.
      const req: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: vanthali, toMccId: bhesan, divertedOn: today, shift: 'evening',
        reason: 'power cut, DG will not hold the evening',
      }, null);
      expect(req.state).toBe('requested');
      // W170's *"87 pourers"* — one member in this fixture, counted from the ROUTE HISTORY as of that day.
      expect(req.affectedMembers).toBe(1);
      expect(req.membersNotified).toBe(false);

      const signed: any = await diversions.approve(tenantA, leadActor as never, `idem-${randomUUID()}`, req.id, null);
      expect(signed.state).toBe('live');
      expect(signed.approvedBy).toBe(lead);

      const p: any = await pours.record(tenantA, opActor as never, `idem-${randomUUID()}`, {
        membershipId, mccId: bhesan, shift: 'evening', collectedOn: today, weightKg: '9.000', fatPct: '6.10', snfPct: '8.70',
        waterFlag: false, adulterationFlags: [],
      } as never);
      const row = await admin.query(`SELECT mcc_id, diversion_id FROM milk_collections WHERE id=$1`, [p.id]);
      // THE WAVE, IN ONE ASSERTION. Before this the row said VANTHALI — the village that never saw the milk.
      expect(row.rows[0]).toEqual({ mcc_id: bhesan, diversion_id: req.id });

      // And the membership is UNTOUCHED: a diversion is not a transfer.
      const route = await admin.query(
        `SELECT count(*)::int n FROM dairy_membership_routes WHERE tenant_id=$1 AND membership_id=$2`,
        [tenantA, membershipId]);
      expect(route.rows[0].n).toBe(1);
      const still = await admin.query(`SELECT mcc_id FROM dairy_memberships WHERE id=$1`, [membershipId]);
      expect(still.rows[0].mcc_id).toBe(vanthali);
    });

    it('shows BOTH SIDES of the diversion on the counter board\'s own numbers', async () => {
      const repo = new DairyDiversionRepository(new PgReadReplicaProvider(pools, new ShardRouter(
        new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as never);
      const sides = await repo.sidesFor(tenantA, today, 'evening');
      // Bhesan RECEIVED one pour from another centre's roll; Vanthali's evening went elsewhere.
      expect(sides.get(bhesan)).toEqual({ divertedIn: 1, divertedOut: 0 });
      expect(sides.get(vanthali)).toEqual({ divertedIn: 0, divertedOut: 1 });
      // A shift with no diversion has no sides at all — the ordinary evening stays quiet.
      expect((await repo.sidesFor(tenantA, today, 'morning')).size).toBe(0);
    });
  });

  /* ======================================================================================================= */
  describe('THE TWO SIGNATURES', () => {
    let pending = '';

    it('refuses to sign its own request — in the service AND in the database', async () => {
      const r: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: bhesan, toMccId: vanthali, divertedOn: today, shift: 'morning', reason: 'analyzer down at Bhesan',
      }, null);
      pending = r.id;
      await expect(diversions.approve(tenantA, { userId: operator, canManage: true, canOverride: true } as never, `idem-${randomUUID()}`, pending, null))
        .rejects.toBeInstanceOf(DiversionRefusedError);
      // And the CHECK refuses it for anything that does not come through the service — the point of putting the rule in
      // a constraint as well as in the code in front of it (0159's ruling, applied again).
      await expect(admin.query(
        `UPDATE dairy_shift_diversions SET approved_by=$2, approved_at=now() WHERE id=$1`, [pending, operator]))
        .rejects.toMatchObject({ code: '23514' });
    });

    it('refuses to sign without the override verb', async () => {
      await expect(diversions.approve(tenantA, opActor as never, `idem-${randomUUID()}`, pending, null))
        .rejects.toBeInstanceOf(DiversionRefusedError);
      const row = await admin.query(`SELECT approved_at FROM dairy_shift_diversions WHERE id=$1`, [pending]);
      expect(row.rows[0].approved_at).toBeNull();
    });

    it('keeps ONE live diversion per centre-shift-day, and any number of cancelled ones', async () => {
      // The service refuses a second one first...
      await expect(diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: bhesan, toMccId: vanthali, divertedOn: today, shift: 'morning', reason: 'again',
      }, null)).rejects.toBeInstanceOf(DiversionRefusedError);
      // ...and the PARTIAL UNIQUE INDEX refuses it for anything that does not.
      await expect(admin.query(
        `INSERT INTO dairy_shift_diversions (tenant_id, from_mcc_id, to_mcc_id, diverted_on, shift, reason, requested_by, created_by)
         VALUES ($1,$2,$3,$4::date,'morning','sneaked in',$5,$5)`,
        [tenantA, bhesan, vanthali, today, operator])).rejects.toMatchObject({ code: '23505' });

      // Cancel it, and the slot is free again — history stays.
      await diversions.cancel(tenantA, opActor as never, `idem-${randomUUID()}`, pending, 'DG held after all', null);
      const again: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: bhesan, toMccId: vanthali, divertedOn: today, shift: 'morning', reason: 'second attempt, analyzer still down',
      }, null);
      expect(again.state).toBe('requested');
      const rows = await admin.query(
        `SELECT count(*)::int n FROM dairy_shift_diversions WHERE tenant_id=$1 AND from_mcc_id=$2 AND shift='morning'`,
        [tenantA, bhesan]);
      expect(rows.rows[0].n).toBe(2);
    });

    it('cannot be signed or called off TWICE, even by something that skips the service', async () => {
      // The service refuses a second signature from its verdict; this asserts the WRITE refuses it too. The predicate
      // (`approved_at IS NULL`) and the fail-closed throw are one rule: without the predicate the update touches the
      // row again and quietly rewrites who signed it, and without the throw a caller is told a write happened that did
      // not. Reachable only by calling the repository directly — which is exactly what the next module to want a
      // diversion will do.
      const day = String((await admin.query(`SELECT (current_date + 2)::text AS d`)).rows[0].d);
      const r: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: vanthali, toMccId: bhesan, divertedOn: day, shift: 'morning', reason: 'chiller service booked',
      }, null);
      await diversions.approve(tenantA, leadActor as never, `idem-${randomUUID()}`, r.id, null);
      await expect(uow.run(tenantA, (tx) => divRepo.approve(tx, tenantA, r.id, lead, new Date())))
        .rejects.toThrow(/was not approved/);
      const who = await admin.query(`SELECT approved_by FROM dairy_shift_diversions WHERE id=$1`, [r.id]);
      expect(who.rows[0].approved_by).toBe(lead);

      await diversions.cancel(tenantA, opActor as never, `idem-${randomUUID()}`, r.id, 'service moved to Thursday', null);
      await expect(uow.run(tenantA, (tx) => divRepo.cancel(tx, tenantA, r.id, operator, new Date(), 'again')))
        .rejects.toThrow(/was not cancelled/);
      const reason = await admin.query(`SELECT cancel_reason FROM dairy_shift_diversions WHERE id=$1`, [r.id]);
      expect(reason.rows[0].cancel_reason).toBe('service moved to Thursday');
    });

    it('refuses to divert a centre to ITSELF, in the database too', async () => {
      await expect(admin.query(
        `INSERT INTO dairy_shift_diversions (tenant_id, from_mcc_id, to_mcc_id, diverted_on, shift, reason, requested_by, created_by)
         VALUES ($1,$2,$2,$3::date,'evening','same centre',$4,$4)`,
        [tenantA, vanthali, today, operator])).rejects.toMatchObject({ code: '23514' });
    });
  });

  /* ======================================================================================================= */
  describe('THE TRIGGER, AND THE GRANT', () => {
    let live = ''; let otherDay = '';

    beforeAll(async () => {
      otherDay = String((await admin.query(`SELECT (current_date + 1)::text AS d`)).rows[0].d);
      const r: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: vanthali, toMccId: bhesan, divertedOn: otherDay, shift: 'evening', reason: 'planned maintenance',
      }, null);
      live = r.id;
      await diversions.approve(tenantA, leadActor as never, `idem-${randomUUID()}`, live, null);
    });

    it('REFUSES a pour whose cited diversion covers another day, shift or centre', async () => {
      const base = [tenantA, vanthali, membershipId, 'buffalo'];
      void base;
      const insert = (mccId: string, on: string, shift: string, divId: string | null) => admin.query(
        `INSERT INTO milk_collections (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, entered_by, diversion_id)
         SELECT $1,$2,$3,$4,$5::date,5.0,6.0,8.5, (SELECT id FROM milk_rate_cards WHERE tenant_id=$1 LIMIT 1), 100, $6, $7`,
        [tenantA, mccId, membershipId, shift, on, operator, divId]);

      // Right diversion, WRONG DAY.
      await expect(insert(bhesan, today, 'evening', live)).rejects.toMatchObject({ code: '23514' });
      // Right diversion, WRONG SHIFT.
      await expect(insert(bhesan, otherDay, 'morning', live)).rejects.toMatchObject({ code: '23514' });
      // Right diversion, WRONG CENTRE — the milk did not go where the decision said.
      await expect(insert(vanthali, otherDay, 'evening', live)).rejects.toMatchObject({ code: '23514' });
      // And the matching one is accepted, which is what makes the three refusals meaningful.
      await expect(insert(bhesan, otherDay, 'evening', live)).resolves.toBeTruthy();
    });

    it('REFUSES a pour citing an UNSIGNED or CANCELLED diversion', async () => {
      const req: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
        fromMccId: bhesan, toMccId: vanthali, divertedOn: otherDay, shift: 'morning', reason: 'unsigned on purpose',
      }, null);
      const insert = (divId: string) => admin.query(
        `INSERT INTO milk_collections (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, entered_by, diversion_id)
         SELECT $1,$2,$3,'morning',$4::date,5.0,6.0,8.5, (SELECT id FROM milk_rate_cards WHERE tenant_id=$1 LIMIT 1), 100, $5, $6`,
        [tenantA, vanthali, membershipId, otherDay, operator, divId]);
      // A request moves no milk.
      await expect(insert(req.id)).rejects.toMatchObject({ code: '23514' });
      await diversions.approve(tenantA, leadActor as never, `idem-${randomUUID()}`, req.id, null);
      await diversions.cancel(tenantA, leadActor as never, `idem-${randomUUID()}`, req.id, 'called off', null);
      // And a cancelled one moves none either.
      await expect(insert(req.id)).rejects.toMatchObject({ code: '23514' });
    });

    it('will not let the APPLICATION ROLE rewrite what was asked for', async () => {
      // A column-level GRANT is only real if the role actually cannot write the other columns. `kv_app` is the role the
      // API runs as, so this is the guarantee an auditor is relying on.
      const app = new Pool({ connectionString: APP_URL });
      try {
        await app.query(`SET app.tenant_id = '${tenantA}'`);
        for (const sql of [
          `UPDATE dairy_shift_diversions SET reason='rewritten' WHERE id=$1`,
          `UPDATE dairy_shift_diversions SET to_mcc_id=$2 WHERE id=$1`,
          `UPDATE dairy_shift_diversions SET diverted_on=current_date WHERE id=$1`,
          `UPDATE dairy_shift_diversions SET requested_by=$2 WHERE id=$1`,
        ]) {
          await expect(app.query(sql, sql.includes('$2') ? [live, sql.includes('to_mcc_id') ? vanthali : lead] : [live]))
            .rejects.toMatchObject({ code: '42501' });
        }
        // The two endings ARE grantable — that is what makes the table usable at all.
        await expect(app.query(
          `UPDATE dairy_shift_diversions SET cancelled_by=$2, cancelled_at=now(), cancel_reason='by the app role' WHERE id=$1`,
          [live, lead])).resolves.toBeTruthy();
      } finally { await app.end(); }
    });
  });

  /* ======================================================================================================= */
  describe('THE BACKDATED POUR — the narrower half of the finding', () => {
    it('uses the route of the POUR\'S OWN DAY, not today\'s', async () => {
      // A member who moved yesterday. Before this wave, a pour entered today for the day before carried the NEW centre
      // — TENANT-6d-3 repaired three reads to answer as-of and left this write reading the current value.
      const mover = randomUUID();
      await makeUser(admin, mover); await roleIn(mover);
      const m: any = await memberships.create(tenantA, opActor as never, `idem-${randomUUID()}`, {
        farmerUserId: mover, mccId: vanthali, memberCode: 'D6-002', defaultAnimalType: 'buffalo',
        paymentCycle: 'fortnightly',
      } as never);
      const yesterday = String((await admin.query(`SELECT (current_date - 1)::text AS d`)).rows[0].d);
      // Rewrite the route history by hand: yesterday at Vanthali, from today at Bhesan. (The MOVE act is 6d-3's and is
      // behind its own flag; what matters here is that the WRITE reads the history at all.)
      await admin.query(
        `UPDATE dairy_membership_routes SET valid_from=$3::date, valid_to=$3::date
          WHERE tenant_id=$1 AND membership_id=$2`, [tenantA, m.id, yesterday]);
      await admin.query(
        `INSERT INTO dairy_membership_routes (tenant_id, membership_id, mcc_id, member_code, valid_from, moved_by, reason, created_by)
         VALUES ($1,$2,$3,'D6-002',current_date,$4,'moved house',$4)`, [tenantA, m.id, bhesan, operator]);
      await admin.query(`UPDATE dairy_memberships SET mcc_id=$2 WHERE id=$1`, [m.id, bhesan]);

      const p: any = await pours.record(tenantA, opActor as never, `idem-${randomUUID()}`, {
        membershipId: m.id, shift: 'morning', collectedOn: yesterday, weightKg: '8.000', fatPct: '6.00', snfPct: '8.60',
        waterFlag: false, adulterationFlags: [],
      } as never);
      const row = await admin.query(`SELECT mcc_id FROM milk_collections WHERE id=$1`, [p.id]);
      // VANTHALI — where the member actually was yesterday. The membership's current centre is Bhesan.
      expect(row.rows[0].mcc_id).toBe(vanthali);

      // And today's pour goes to the new centre, from the same history.
      const p2: any = await pours.record(tenantA, opActor as never, `idem-${randomUUID()}`, {
        membershipId: m.id, shift: 'morning', collectedOn: today, weightKg: '8.000', fatPct: '6.00', snfPct: '8.60',
        waterFlag: false, adulterationFlags: [],
      } as never);
      const row2 = await admin.query(`SELECT mcc_id FROM milk_collections WHERE id=$1`, [p2.id]);
      expect(row2.rows[0].mcc_id).toBe(bhesan);
    });
  });

  /* ======================================================================================================= */
  describe('THE PERMISSION AND THE EVENT', () => {
    it('catalogued dairy\'s second verb and granted it to the co-op admin only', async () => {
      const p = await admin.query(`SELECT default_name, module_code FROM permissions WHERE code='dairy.override'`);
      expect(p.rows).toHaveLength(1);
      expect(String(p.rows[0].default_name)).toMatch(/override/i);
      const grants = await admin.query(
        `SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_code='dairy.override' ORDER BY r.code`);
      expect(grants.rows.map((r: any) => r.code)).toEqual(['tenant_admin']);
    });

    it('catalogued the member notice, unmutable, with the voice channel first', async () => {
      const e = await admin.query(
        `SELECT priority, default_channels, user_can_opt_out FROM notification_events WHERE code='dairy.shift_diverted'`);
      expect(e.rows).toHaveLength(1);
      expect(e.rows[0].priority).toBe('critical');
      expect(e.rows[0].user_can_opt_out).toBe(false);
      expect(e.rows[0].default_channels).toEqual(['ivr', 'sms', 'push']);
      // AND ITS COPY IS NOT SEEDED YET — the notice is TENANT-6d-7, and this asserts the honest half-built state rather
      // than letting a future wave discover it.
      const t = await admin.query(
        `SELECT count(*)::int n FROM notification_templates WHERE event_code='dairy.shift_diverted'`);
      expect(t.rows[0].n).toBe(0);
    });
  });
});
