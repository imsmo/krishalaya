// modules/dairy/__tests__/tenant6d2-centres.integration.spec.ts · PC-56 TENANT-6d-2, LIVE Postgres.
//
// EIGHT THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE:
//
//   1. **THE TENANCY GATE IS A TRIGGER.** `mcc_centres.operator_user_id` references the PLATFORM-WIDE `users` table
//      (0003), and no composite key to `user_tenant_roles` exists to reference — so the rule lives in plpgsql, and only
//      a live INSERT can show it refusing another cooperative's member.
//   2. **ONE OPEN CUSTODY PER CENTRE** — `uq_mcc_custody_open` is a PARTIAL unique index, so only a live insert shows a
//      second open row being refused while any number of CLOSED ones stay legal.
//   3. **A SHIFT IS BOTH ENDS, IN WHOLE MINUTES** — three CHECK constraints, none of them expressible in TypeScript.
//   4. **THE CUSTODY REGISTER IS APPEND-ONLY FOR `kv_app`** — a column-level grant, which is only real if the
//      application role actually cannot write the other columns.
//   5. **THE RELAY TIER LOST ITS WRITES** on centres and memberships, which is a `has_table_privilege` question.
//   6. **THE BOARD'S SQL** — member counts per centre, an independently counted total, the LATERAL open-custody join
//      and the tenancy-checked users join all have to run.
//   7. **THE TANK'S CONDITION COMES THROUGH `cold_chain_logs`**, written by TENANT-6d-1's own path, so the board and
//      the monitor cannot disagree.
//   8. **THE PREFERENCE MIX READS REAL CYCLES** — `DISTINCT ON (payment_cycle)` over `dairy_bill_cycles`.
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
import { ColdChainLogRepository } from '../../logistics/repositories/cold-chain-log.repository';
import { ColdChainService } from '../../logistics/services/cold-chain.service';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccConsoleRepository } from '../repositories/mcc-console.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { BmcUnitService } from '../services/bmc-unit.service';
import { BmcReadingService } from '../services/bmc-reading.service';
import { DairyCentresReadModel } from '../read-models/dairy-centres.read-model';
import { MccOperatorNotInTenantError } from '../domain/dairy.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-2 · W171 the centres (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let mccs: MccCentreService; let memberships: DairyMembershipService;
  let units: BmcUnitService; let readings: BmcReadingService;
  let rm: DairyCentresReadModel; let custody: MccOperatorAssignmentRepository;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const desk = randomUUID();
  const bhavna = randomUUID();
  const raju = randomUUID();
  const outsider = randomUUID();     // a real user, of tenant B only
  const actor = { userId: desk, canManage: true };

  let c1 = ''; let c2 = '';

  const roleIn = (userId: string, tenantId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantId]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [desk, bhavna, raju, outsider]) await makeUser(admin, u);
    // `makeUser` leaves no role row, and 0163's gate is about exactly that: who belongs to this cooperative.
    await roleIn(desk, tenantA); await roleIn(bhavna, tenantA); await roleIn(raju, tenantA);
    await roleIn(outsider, tenantB);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    const mccRepo = new MccCentreRepository(replica as never);
    const unitRepo = new BmcUnitRepository(replica as never);
    custody = new MccOperatorAssignmentRepository(replica as never);
    const coldChain = new ColdChainService(uow, metrics, new ColdChainLogRepository(replica as never));

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, custody);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, new DairyMembershipRepository(replica as never), mccRepo, new DairyMembershipRouteRepository(replica as never));
    units = new BmcUnitService(uow, outbox, idem, metrics, audit, unitRepo, mccRepo);
    readings = new BmcReadingService(uow, metrics, unitRepo, coldChain);
    rm = new DairyCentresReadModel(replica as never, new MccConsoleRepository(replica as never), unitRepo,
      // [TENANT-6d-3] The board reports the move's flag and how many memberships have used it.
      new DairyMembershipRouteRepository(replica as never), flags, metrics);
  }, 180000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE CENTRE, AND WHO HOLDS IT', () => {
    it('creates a centre with NOBODY holding it — the operator is no longer defaulted to the creator', async () => {
      const m: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, {
        code: 'MCC-D2-01', defaultName: 'Vanthali', capacityLitresShift: '1200', analyzerModel: 'Lactoscan SP', analyzerSerial: 'LS-000412',
      } as never, null);
      c1 = m.id;
      expect(m.operatorUserId).toBeNull();
      const r = await admin.query(`SELECT operator_user_id, created_by FROM mcc_centres WHERE id=$1`, [c1]);
      // `created_by` is the ACTOR. It used to be the operator id — so the audit column named the person who would be
      // holding the milk as the person who created the record.
      expect(r.rows[0]).toEqual({ operator_user_id: null, created_by: desk });
      const open = await admin.query(`SELECT count(*)::int n FROM mcc_operator_assignments WHERE mcc_id=$1`, [c1]);
      expect(open.rows[0].n).toBe(0);
    });

    it('creates a second centre WITH an operator, and writes the custody row in the same transaction', async () => {
      const m: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, {
        code: 'MCC-D2-02', defaultName: 'Bhesan', capacityLitresShift: '1000', operatorUserId: raju,
        operatorReason: 'runs the counter since the centre opened',
      } as never, null);
      c2 = m.id;
      const r = await admin.query(
        `SELECT operator_user_id, assigned_by, ended_at, reason FROM mcc_operator_assignments WHERE mcc_id=$1`, [c2]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ operator_user_id: raju, assigned_by: desk, ended_at: null });
      expect(String(r.rows[0].reason)).toContain('runs the counter');
    });

    it('REFUSES an operator from another cooperative — service first, then the trigger', async () => {
      await expect(mccs.assignOperator(tenantA, actor as never, `idem-${randomUUID()}`, c1, { operatorUserId: outsider }, null))
        .rejects.toBeInstanceOf(MccOperatorNotInTenantError);
      // And the DATABASE refuses it too, for anything that does not come through the service — which is the point of
      // putting the rule in a trigger rather than only in the code in front of it.
      await expect(admin.query(`UPDATE mcc_centres SET operator_user_id=$2 WHERE id=$1`, [c1, outsider]))
        .rejects.toMatchObject({ code: '23514' });
      await expect(admin.query(
        `INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, assigned_by) VALUES ($1,$2,$3,$4)`,
        [tenantA, c1, outsider, desk])).rejects.toMatchObject({ code: '23514' });
      // A centre with NOBODY named stays legal: the gate is about strangers, not about absence.
      await expect(admin.query(`UPDATE mcc_centres SET operator_user_id=NULL WHERE id=$1`, [c1])).resolves.toBeDefined();
    });

    it('hands custody over: one instant, one open row, and the old tenure closed', async () => {
      await mccs.assignOperator(tenantA, actor as never, `idem-${randomUUID()}`, c1, { operatorUserId: bhavna, reason: 'took over the counter' }, null);
      await mccs.assignOperator(tenantA, actor as never, `idem-${randomUUID()}`, c1, { operatorUserId: raju, reason: 'Bhavna Ben moved to Rajkot' }, null);
      const rows = await admin.query(
        `SELECT operator_user_id, assigned_at, ended_at, ended_by, reason FROM mcc_operator_assignments
          WHERE mcc_id=$1 ORDER BY assigned_at`, [c1]);
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]).toMatchObject({ operator_user_id: bhavna, ended_by: desk });
      expect(rows.rows[1]).toMatchObject({ operator_user_id: raju, ended_at: null });
      // ONE INSTANT: the close and the open share it, so the register has no gap in which nobody held the centre.
      expect(new Date(rows.rows[0].ended_at).getTime()).toBe(new Date(rows.rows[1].assigned_at).getTime());
      const col = await admin.query(`SELECT operator_user_id FROM mcc_centres WHERE id=$1`, [c1]);
      expect(col.rows[0].operator_user_id).toBe(raju);
    });

    it('the database refuses a SECOND open custody, and allows any number of closed ones', async () => {
      await expect(admin.query(
        `INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, assigned_by) VALUES ($1,$2,$3,$4)`,
        [tenantA, c1, bhavna, desk])).rejects.toMatchObject({ constraint: 'uq_mcc_custody_open' });
      // Closed rows are the register, and there is no limit on history.
      await expect(admin.query(
        `INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, assigned_by, assigned_at, ended_at, ended_by)
         VALUES ($1,$2,$3,$4, now() - interval '400 days', now() - interval '399 days', $4)`,
        [tenantA, c1, bhavna, desk])).resolves.toBeDefined();
    });

    it('the database refuses a custody that ends before it began, or ends with no author', async () => {
      await expect(admin.query(
        `INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, assigned_at, ended_at, ended_by)
         VALUES ($1,$2,$3, now(), now() - interval '1 day', $4)`, [tenantA, c2, raju, desk]))
        .rejects.toMatchObject({ constraint: 'ck_mcc_custody_window' });
      await expect(admin.query(
        `INSERT INTO mcc_operator_assignments (tenant_id, mcc_id, operator_user_id, ended_at)
         VALUES ($1,$2,$3, now())`, [tenantA, c2, raju]))
        .rejects.toMatchObject({ constraint: 'ck_mcc_custody_ended' });
    });

    it('releases custody — a state, not an absence', async () => {
      await mccs.releaseOperator(tenantA, actor as never, c2, 'centre closed for the monsoon', null);
      const col = await admin.query(`SELECT operator_user_id FROM mcc_centres WHERE id=$1`, [c2]);
      expect(col.rows[0].operator_user_id).toBeNull();
      const open = await admin.query(`SELECT count(*)::int n FROM mcc_operator_assignments WHERE mcc_id=$1 AND ended_at IS NULL`, [c2]);
      expect(open.rows[0].n).toBe(0);
      // …and it is re-assignable afterwards, which the partial index would prevent if the close had not happened.
      await mccs.assignOperator(tenantA, actor as never, `idem-${randomUUID()}`, c2, { operatorUserId: bhavna }, null);
      const back = await admin.query(`SELECT operator_user_id FROM mcc_centres WHERE id=$1`, [c2]);
      expect(back.rows[0].operator_user_id).toBe(bhavna);
    });

    it('the custody register is APPEND-ONLY for the application role', async () => {
      const app = new Pool({ connectionString: APP_URL });
      try {
        // `kv_app` holds UPDATE on the ENDING and nothing else. Who held a centre in June is not editable by the API.
        for (const col of ['operator_user_id', 'assigned_at', 'assigned_by', 'reason']) {
          await expect(app.query(`UPDATE mcc_operator_assignments SET ${col} = ${col} WHERE mcc_id=$1`, [c1]))
            .rejects.toMatchObject({ code: '42501' });
        }
        await expect(app.query(`DELETE FROM mcc_operator_assignments WHERE mcc_id=$1`, [c1])).rejects.toMatchObject({ code: '42501' });
      } finally { await app.end(); }
    });

    it('the BYPASSRLS relay tier can read centres and memberships and write neither', async () => {
      const r = await admin.query(
        `SELECT has_table_privilege('kv_relay','mcc_centres','SELECT') s_c,
                has_table_privilege('kv_relay','mcc_centres','UPDATE') u_c,
                has_table_privilege('kv_relay','dairy_memberships','SELECT') s_m,
                has_table_privilege('kv_relay','dairy_memberships','UPDATE') u_m,
                has_table_privilege('kv_relay','dairy_memberships','DELETE') d_m`);
      expect(r.rows[0]).toEqual({ s_c: true, u_c: false, s_m: true, u_m: false, d_m: false });
    });

    it('a zero-row update is a THROW, not a success', async () => {
      const gone = randomUUID();
      await expect(mccs.setActive(tenantA, actor as never, gone, false, null)).rejects.toBeDefined();
    });
  });

  /* ======================================================================================================= */
  describe('THE HOURS — the thing TENANT-6a refused to invent', () => {
    it('records a window and reads it back as the HH:MM a screen prints', async () => {
      await mccs.setShiftWindow(tenantA, actor as never, c1, 'morning', { opens: '06:00', closes: '09:00' }, null);
      const m: any = await mccs.setShiftWindow(tenantA, actor as never, c1, 'evening', { opens: '17:00', closes: '20:00' }, null);
      expect(m.shiftWindows).toEqual({ morning: { opens: '06:00', closes: '09:00' }, evening: { opens: '17:00', closes: '20:00' } });
      const r = await admin.query(`SELECT morning_opens_at::text a, evening_closes_at::text b FROM mcc_centres WHERE id=$1`, [c1]);
      expect(r.rows[0]).toEqual({ a: '06:00:00', b: '20:00:00' });
    });

    it('the database refuses half a window, an inverted one, and one carrying seconds', async () => {
      await expect(admin.query(`UPDATE mcc_centres SET morning_closes_at=NULL WHERE id=$1`, [c1]))
        .rejects.toMatchObject({ constraint: 'ck_mcc_shift_morning' });
      await expect(admin.query(`UPDATE mcc_centres SET evening_opens_at='21:00', evening_closes_at='20:00' WHERE id=$1`, [c1]))
        .rejects.toMatchObject({ constraint: 'ck_mcc_shift_evening' });
      // A shift boundary is a minute on a village noticeboard. The database refuses the precision it cannot print
      // rather than letting a screen round it away.
      await expect(admin.query(`UPDATE mcc_centres SET evening_opens_at='17:00:30' WHERE id=$1`, [c1]))
        .rejects.toMatchObject({ constraint: 'ck_mcc_shift_evening' });
    });

    it('clears a window and returns the board to the honest refusal', async () => {
      await mccs.setShiftWindow(tenantA, actor as never, c2, 'morning', { opens: '06:30', closes: '09:30' }, null);
      const m: any = await mccs.setShiftWindow(tenantA, actor as never, c2, 'morning', null, null);
      expect(m.shiftWindows.morning).toBeNull();
      const r = await admin.query(`SELECT morning_opens_at, morning_closes_at FROM mcc_centres WHERE id=$1`, [c2]);
      expect(r.rows[0]).toEqual({ morning_opens_at: null, morning_closes_at: null });
    });
  });

  /* ======================================================================================================= */
  describe('THE BOARD', () => {
    it('counts memberships per centre and reconciles them against an independent total', async () => {
      for (let i = 0; i < 3; i += 1) {
        const f = randomUUID(); await makeUser(admin, f); await roleIn(f, tenantA);
        await memberships.create(tenantA, actor as never, `idem-${randomUUID()}`, {
          farmerUserId: f, mccId: c1, memberCode: `C1-${i}`, paymentCycle: 'weekly',
        } as never);
      }
      const f2 = randomUUID(); await makeUser(admin, f2); await roleIn(f2, tenantA);
      await memberships.create(tenantA, actor as never, `idem-${randomUUID()}`, {
        farmerUserId: f2, mccId: c2, memberCode: 'C2-0', paymentCycle: 'daily',
      } as never);

      const v = await rm.view(tenantA, actor as never);
      const byCode = new Map(v.centres.map((c) => [c.code, c]));
      expect(byCode.get('MCC-D2-01')!.members).toBe(3);
      expect(byCode.get('MCC-D2-02')!.members).toBe(1);
      expect(v.reconciliation).toMatchObject({ centres: 2, shown: 4, total: 4, reconciles: true, unaccounted: 0 });
    });

    it('names a member routed to a DEACTIVATED centre as unaccounted, rather than losing them', async () => {
      await mccs.setActive(tenantA, actor as never, c2, false, null);
      const v = await rm.view(tenantA, actor as never);
      // The member is still a member: deactivating a centre moves nobody. The tick is withheld and the shortfall named.
      expect(v.reconciliation).toMatchObject({ shown: 3, total: 4, reconciles: false, unaccounted: 1 });
      const wide = await rm.view(tenantA, actor as never, { includeInactive: true });
      expect(wide.reconciliation.reconciles).toBe(true);
      await mccs.setActive(tenantA, actor as never, c2, true, null);
    });

    it('shows the operator with a MASKED phone, and no name at all for a custody it cannot verify', async () => {
      const v = await rm.view(tenantA, actor as never);
      const one = v.centres.find((c) => c.code === 'MCC-D2-01')!;
      expect(one.custody.state).toBe('held');
      expect(one.custody.operatorName).toBe('Test User');
      expect(one.custody.operatorPhoneMasked).toMatch(/^\+9198\*{4}\d{4}$/);
      expect(one.custody.days).toBeGreaterThanOrEqual(0);
      // …and the analyzer serial is MASKED, because this board is not an equipment inventory.
      expect(one.analyzer).toEqual({ model: 'Lactoscan SP', serialMasked: '…0412' });
    });

    it('reports UNRECORDED for a centre whose column names somebody with no custody row', async () => {
      // The pre-0163 world, reproduced: the column alone, with no register behind it. 0163.3's backfill deliberately
      // skips these when the person is not of the tenant; here the person IS, and the row is still absent.
      const bare: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D2-03', defaultName: 'Keshod' } as never, null);
      await admin.query(`UPDATE mcc_centres SET operator_user_id=$2 WHERE id=$1`, [bare.id, bhavna]);
      const v = await rm.view(tenantA, actor as never);
      const row = v.centres.find((c) => c.code === 'MCC-D2-03')!;
      expect(row.custody.state).toBe('unrecorded');
      expect(row.custody.since).toBeNull();
      expect(v.custodyGaps.unrecorded).toBeGreaterThanOrEqual(1);
    });

    it('refuses to name an operator who belongs to another cooperative, even one already stored', async () => {
      // The pre-0163 leak, reproduced by disabling the trigger for one statement — this is the row shape that existed
      // before the gate, and the board must not print a stranger's name and phone from it.
      const leak: any = await mccs.create(tenantA, actor as never, `idem-${randomUUID()}`, { code: 'MCC-D2-04', defaultName: 'Talala' } as never, null);
      await admin.query(`ALTER TABLE mcc_centres DISABLE TRIGGER trg_mcc_operator_in_tenant`);
      try {
        await admin.query(`UPDATE mcc_centres SET operator_user_id=$2 WHERE id=$1`, [leak.id, outsider]);
      } finally {
        await admin.query(`ALTER TABLE mcc_centres ENABLE TRIGGER trg_mcc_operator_in_tenant`);
      }
      const v = await rm.view(tenantA, actor as never);
      const row = v.centres.find((c) => c.code === 'MCC-D2-04')!;
      expect(row.custody.state).toBe('unrecorded');
      expect(row.custody.operatorName).toBeNull();
      expect(row.custody.operatorPhoneMasked).toBeNull();
    });

    it('carries the tank\'s condition, judged by the reading TENANT-6d-1\'s own path wrote', async () => {
      const u: any = await units.register(tenantA, actor as never, `idem-${randomUUID()}`, { mccId: c1, capacityLitres: '2000', iotDeviceRef: 'DEV-D2-01' });
      const before = await rm.view(tenantA, actor as never);
      expect(before.centres.find((c) => c.code === 'MCC-D2-01')!.tank.condition).toBe('never');

      await readings.record(tenantA, actor as never, { unitId: u.id, tempC: '6.9' });
      const warm = await rm.view(tenantA, actor as never);
      const row = warm.centres.find((c) => c.code === 'MCC-D2-01')!;
      expect(row.tank).toMatchObject({ condition: 'above_band', tempC: '6.9', bandMaxC: '4.5', unitId: u.id });
      expect(warm.tanksNeedingAttention).toBe(1);

      await readings.record(tenantA, actor as never, { unitId: u.id, tempC: '4.5' });
      const cold = await rm.view(tenantA, actor as never);
      // The canon's own boundary — 4.5 in a 4.0/0.5 band is IN range, decided by the same arithmetic the monitor uses.
      expect(cold.centres.find((c) => c.code === 'MCC-D2-01')!.tank.condition).toBe('in_range');
      expect(cold.tanksNeedingAttention).toBe(0);
    });

    it('tells the preference mix from the cycles that actually exist', async () => {
      const pending = await rm.view(tenantA, actor as never);
      expect(pending.preferences.every((p) => p.state === 'pending')).toBe(true);
      expect(pending.honoured.all).toBe(false);
      expect(pending.honoured.pending.sort()).toEqual(['daily', 'weekly']);

      await admin.query(
        `INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status)
         VALUES ($1,'weekly','2026-08-17','2026-08-23', '2026-08-24T00:00:00Z','2026-08-25','open')`, [tenantA]);
      const v = await rm.view(tenantA, actor as never);
      const weekly = v.preferences.find((p) => p.paymentCycle === 'weekly')!;
      expect(weekly.state).toBe('honoured');
      expect(weekly.window).toEqual({ from: '2026-08-17', to: '2026-08-23', payday: '2026-08-25', status: 'open' });
      // The DAILY households are still waiting, and the screen says which — not "their choice, honoured" over all four.
      expect(v.honoured).toEqual({ all: false, pending: ['daily'] });
    });

    it('counts the centres that have recorded no hours, and separates CAN from MAY on the move', async () => {
      const v = await rm.view(tenantA, actor as never);
      expect(v.hoursUnrecorded).toBeGreaterThanOrEqual(2);   // the two centres added bare in this run
      // THE BOARD REPORTS THE FLAG IT READS, rather than a constant — and asserted against the flag row itself,
      // because another suite in this run legitimately switches the move on (the 6c-6 lesson: a spec that pins a
      // global flag's value breaks the moment a later wave needs it flipped).
      const flagRow = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_membership_transfer'`);
      expect(v.transferEnabled).toBe(flagRow.rows[0].is_enabled === true);
      // [UPDATED BY PC-56 TENANT-6d-3] The transfer is BUILT from that wave — with the three reads it would otherwise
      // have broken repaired in the same commit. `transferEnabled` is this cooperative's own switch, and it is off
      // here because 0164 ships the flag off (Law 10).
      expect(v.gaps).toEqual({ transferBuilt: true, shiftWindowHistory: false, reliefOperator: false });
    });

    it('shows one tenant nothing of another', async () => {
      await makeUser(admin, desk);
      const v = await rm.view(tenantB, { userId: desk, canManage: true } as never);
      expect(v.centres).toHaveLength(0);
      expect(v.reconciliation).toMatchObject({ centres: 0, total: 0, reconciles: true });
    });

    it('ships the screen flag OFF (Law 10)', async () => {
      const r = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_centres_console'`);
      expect(r.rows[0]).toEqual({ is_enabled: false });
      expect(await rm.enabled(tenantA)).toBe(false);
    });

    it('keeps a custody history that reads newest first', async () => {
      const rows = await custody.history(tenantA, c1, 10);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].endedAt).toBeNull();
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i - 1].assignedAt.getTime()).toBeGreaterThanOrEqual(rows[i].assignedAt.getTime());
      }
    });
  });
});
