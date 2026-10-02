// modules/labour/__tests__/attendance-cycle.integration.spec.ts
// REAL end-to-end proof of the P0-9 attendance lifecycle against a live Postgres (no infra mocks):
//   register+verify worker → post booking → assign → worker accepts →
//   1. WORKER clock-in (within the farm fence) → attendance row 'clocked_in';
//   2. WORKER clock-out → SERVER computes hours/overtime → 'clocked_out' (float-free, hours persisted);
//   3. EMPLOYER dual-confirm → 'confirmed' + an append-only audit row;
//   4. anti-IDOR: a DIFFERENT worker cannot clock out the assignment; a NON-employer cannot confirm (404);
//   5. state guards: cannot confirm before clock-out; cannot clock out twice (idempotent);
//   6. RLS: tenant B cannot see tenant A's attendance row.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
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
import { QuotaService } from '../../../core/quota/quota.service';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { LabourMoneyRepository } from '../repositories/labour-money.repository';
import { LabourMoneyService } from '../services/labour-money.service';
import { indiaDay } from '../domain/display';

import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { MinimumWageRepository } from '../repositories/minimum-wage.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { WorkerProfileService } from '../services/worker-profile.service';
import { MinimumWageService } from '../services/minimum-wage.service';
import { LabourBookingService } from '../services/labour-booking.service';
import { AttendanceService } from '../services/attendance.service';
import { NotClockedOutError, AlreadyClockedOutError, AssignmentNotFoundError, LabourForbiddenError } from '../domain/labour.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

const GJ_REGION = '11111111-0000-7000-8000-000000000001';   // seeded admin_regions (Gujarat)
// PC-56 TENANT-11b: the seeded minimum wages are effective from the day the seeds ran (db/seeds/rules: CURRENT_DATE), so a
// fixed July-2026 start date found NO floor once that day passed (this spec was red before the wave for that reason alone).
// Dates are now relative to now.
const plusDays = (n: number) => { const d = new Date(Date.now() + n * 86_400_000 + 330 * 60_000); return d.toISOString().slice(0, 10); };
const DAY1 = plusDays(30), DAY2 = plusDays(31);
const FARM_LAT = 22.3, FARM_LNG = 71.1;
// PC-56 TENANT-11b: the work date is the INDIA calendar day (the UTC day put a 05:00 IST clock-in on yesterday).
const today = () => indiaDay(new Date());

run('labour attendance lifecycle (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let svc: LabourBookingService; let workers: WorkerProfileService; let attendance: AttendanceService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const employer = randomUUID(); const workerUser = randomUUID(); const otherWorkerUser = randomUUID();
  const empActor = { userId: employer, canBook: true, canDesk: false, canApproveWages: false, canManage: true };
  let workerId = ''; let bookingId = ''; let assignmentId = ''; let attendanceId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, employer); await makeUser(admin, workerUser); await makeUser(admin, otherWorkerUser);
    const skillId = (await admin.query(`SELECT id FROM skills WHERE code='general_farm_labour'`)).rows[0].id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const workerRepo = new WorkerProfileRepository(replica as any);
    const bookingRepo = new LabourBookingRepository(replica as any);
    const assignRepo = new BookingAssignmentRepository(replica as any);
    const attendanceRepo = new AttendanceRepository(replica as any);
    const minWage = new MinimumWageService(new MinimumWageRepository(replica as any));
    workers = new WorkerProfileService(uow, outbox, idem, metrics, workerRepo);
    const wallet = new InProcessWalletClient(new LedgerRepository());
    const moneyRepo = new LabourMoneyRepository(replica as any);
    const money = new LabourMoneyService(wallet, audit, moneyRepo, attendanceRepo, workerRepo);
    svc = new LabourBookingService(uow, outbox, idem, new AllowAllQuota(), metrics, money, audit, bookingRepo, assignRepo, workerRepo, minWage, attendanceRepo, moneyRepo);
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: userMain(employer), amountMinor: 1_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -1_000_000n }] }), { userId: 'system' });
    attendance = new AttendanceService(uow, outbox, idem, metrics, assignRepo, workerRepo, bookingRepo, attendanceRepo, audit);

    // worker registered + age-verified; a SECOND worker for the anti-IDOR check
    const w = await workers.register(tenantA, workerUser, `idem-${randomUUID()}`, { villageRegionId: GJ_REGION, travelKm: 15 } as any);
    workerId = w.id;
    await admin.query(`UPDATE worker_profiles SET age_verified_18=true WHERE id=$1`, [workerId]);
    await workers.register(tenantA, otherWorkerUser, `idem-${randomUUID()}`, { villageRegionId: GJ_REGION, travelKm: 15 } as any);

    const b = await svc.create(tenantA, empActor, `idem-${randomUUID()}`, {
      demandTypeCode: 'daily_single', taskSkillId: skillId, regionId: GJ_REGION, skillLevel: 'unskilled',
      workersNeeded: 1, startDate: DAY1, endDate: DAY2, dailyHours: 8, wageKind: 'per_day',
      wageOfferedMinor: '50000', womenOnly: false, farmLat: FARM_LAT, farmLng: FARM_LNG,
    } as any);
    bookingId = b.id;
    const a = await svc.assign(tenantA, empActor, bookingId, `idem-${randomUUID()}`, { workerId });
    assignmentId = a.id;
    await svc.respond(tenantA, workerUser, assignmentId, { decision: 'accept' });
    // PC-56 TENANT-11b: a day is worked on a STARTED job — the roster confirmed and the wages escrowed first.
    await svc.confirmRoster(tenantA, empActor, bookingId, `idem-${randomUUID()}`, {});
    await svc.start(tenantA, empActor, bookingId);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('1. WORKER clocks in within the farm fence → clocked_in', async () => {
    const res = await attendance.clockIn(tenantA, workerUser, assignmentId, { lat: FARM_LAT, lng: FARM_LNG }, `idem-${randomUUID()}`);
    attendanceId = res.id;
    expect(res.distanceM).toBe(0);
    const row = await admin.query(`SELECT clock_in_at, clock_out_at, confirmed_by_employer FROM attendance_records WHERE id=$1`, [attendanceId]);
    expect(row.rows[0].clock_in_at).toBeTruthy();
    expect(row.rows[0].clock_out_at).toBeNull();
  });

  it('2a. a DIFFERENT worker cannot clock out this assignment (anti-IDOR)', async () => {
    await expect(attendance.clockOut(tenantA, otherWorkerUser, assignmentId, { breakMinutes: 0 }, `idem-${randomUUID()}`))
      .rejects.toBeInstanceOf(LabourForbiddenError);
  });

  it('2b. employer cannot confirm a day that is not yet clocked out', async () => {
    await expect(attendance.confirmDay(tenantA, { userId: employer, canManage: true }, assignmentId, today(), `idem-${randomUUID()}`, null))
      .rejects.toBeInstanceOf(NotClockedOutError);
  });

  it('2c. WORKER clocks out → SERVER computes hours/overtime (float-free, persisted)', async () => {
    // backdate clock-in 9h so a 60-min break yields exactly 8h regular + 0 overtime
    await admin.query(`UPDATE attendance_records SET clock_in_at = now() - interval '9 hours' WHERE id=$1`, [attendanceId]);
    const res = await attendance.clockOut(tenantA, workerUser, assignmentId, { breakMinutes: 60 }, `idem-${randomUUID()}`);
    expect(res.status).toBe('clocked_out');
    expect(res.hoursRegular).toBe(8);
    expect(res.hoursOvertime).toBe(0);
    const row = await admin.query(`SELECT clock_out_at, break_minutes, hours_regular, hours_overtime FROM attendance_records WHERE id=$1`, [attendanceId]);
    expect(row.rows[0].clock_out_at).toBeTruthy();
    expect(Number(row.rows[0].hours_regular)).toBe(8);
    expect(Number(row.rows[0].break_minutes)).toBe(60);
  });

  it('2d. a second clock-out is rejected (idempotent guard)', async () => {
    await expect(attendance.clockOut(tenantA, workerUser, assignmentId, { breakMinutes: 0 }, `idem-${randomUUID()}`))
      .rejects.toBeInstanceOf(AlreadyClockedOutError);
  });

  it('3a. a NON-employer (no booking.manage) cannot confirm → 404 (no enumeration)', async () => {
    await expect(attendance.confirmDay(tenantA, { userId: otherWorkerUser, canManage: false }, assignmentId, today(), `idem-${randomUUID()}`, null))
      .rejects.toBeInstanceOf(AssignmentNotFoundError);
  });

  it('3b. EMPLOYER dual-confirms the clocked-out day → confirmed + audit row', async () => {
    const res = await attendance.confirmDay(tenantA, { userId: employer, canManage: true }, assignmentId, today(), `idem-${randomUUID()}`, '127.0.0.1');
    expect(res.status).toBe('confirmed');
    const row = await admin.query(`SELECT confirmed_by_employer FROM attendance_records WHERE id=$1`, [attendanceId]);
    expect(row.rows[0].confirmed_by_employer).toBe(true);
    const aud = await admin.query(`SELECT 1 FROM audit_log WHERE entity_type='attendance_record' AND entity_id=$1 AND action='labour.attendance_confirmed'`, [attendanceId]);
    expect(aud.rowCount).toBe(1);
  });

  it('4. work-history shows the confirmed day for the worker (keyset read-model)', async () => {
    const hist = await attendance.workHistory(tenantA, workerUser, { limit: 20 });
    const mine = hist.items.find((x) => x.id === attendanceId);
    expect(mine?.status).toBe('confirmed');
    expect(mine?.hoursRegular).toBe(8);
  });

  it('5. RLS: tenant B cannot see tenant A\'s attendance row', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM attendance_records WHERE id=$1`, [attendanceId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    const isSuper = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
    expect(await countAs(tenantA)).toBe(1);
    if (!isSuper) expect(await countAs(tenantB)).toBe(0);
  });
});
