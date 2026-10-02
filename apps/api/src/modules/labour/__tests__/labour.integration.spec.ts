// modules/labour/__tests__/labour.integration.spec.ts
// REAL end-to-end proof of the labour spine against a live Postgres:
//   1. a worker self-registers; an admin age-verifies them (the HARD 18+ gate);
//   2. an employer POSTS a booking — an offer BELOW the statutory minimum (minimum_wages, seeded) is
//      REJECTED (the dignity floor); an offer at/above the floor is accepted (open);
//   3. assign worker → worker ACCEPTS → CONFIRM ROSTER (wages escrowed, PC-56 TENANT-11b) → start → two days worked and
//      confirmed → complete → PAY WAGES: 2 days × rate moved employer HOLD → worker main (zero-sum, txnType wage_payout),
//      the unused remainder returned, and the booking goes paid;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's booking.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { QuotaService } from '../../../core/quota/quota.service';

import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { MinimumWageRepository } from '../repositories/minimum-wage.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { LabourMoneyRepository } from '../repositories/labour-money.repository';
import { LabourMoneyService } from '../services/labour-money.service';
import { AttendanceService } from '../services/attendance.service';
import { WorkerProfileService } from '../services/worker-profile.service';
import { MinimumWageService } from '../services/minimum-wage.service';
import { LabourBookingService } from '../services/labour-booking.service';
import { WageBelowMinimumError } from '../domain/labour.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

// QuotaService is unconfigured for these tenants → allow (no plan limit). The tenancy spec proves the
// enforced path; here labour bookings are not plan-limited.
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

const GJ_REGION = '11111111-0000-7000-8000-000000000001';   // seeded admin_regions (Gujarat)
// PC-56 TENANT-11b: the seeded minimum wages are effective from the day the seeds ran (db/seeds/rules: CURRENT_DATE), so a
// fixed July-2026 start date found NO floor once that day passed (this spec was red before the wave for that reason alone).
// Dates are now relative to now.
const plusDays = (n: number) => { const d = new Date(Date.now() + n * 86_400_000 + 330 * 60_000); return d.toISOString().slice(0, 10); };
const DAY1 = plusDays(30), DAY2 = plusDays(31);
const GJ_UNSKILLED_FLOOR = 38000n;                          // seeded minimum_wages (db/seeds/rules/0206)

run('labour spine (integration, real Postgres + RLS + wallet wage payout)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let workers: WorkerProfileService; let svc: LabourBookingService; let wallet: InProcessWalletClient; let uow: PgUnitOfWork;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const employer = randomUUID();
  const workerUser = randomUUID();
  let skillId = ''; let workerId = ''; let bookingId = ''; let assignmentId = '';
  const empActor = { userId: employer, canBook: true, canDesk: false, canApproveWages: false, canManage: true };
  let attendance: AttendanceService;

  const bal = async (userId: string) =>
    BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [userId])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, employer); await makeUser(admin, workerUser);
    skillId = (await admin.query(`SELECT id FROM skills WHERE code='general_farm_labour'`)).rows[0].id;

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
    const workerRepo = new WorkerProfileRepository(replica as any);
    const bookingRepo = new LabourBookingRepository(replica as any);
    const assignRepo = new BookingAssignmentRepository(replica as any);
    const minWage = new MinimumWageService(new MinimumWageRepository(replica as any));
    workers = new WorkerProfileService(uow, outbox, idem, metrics, workerRepo);
    const attendanceRepo = new AttendanceRepository(replica as any);
    const moneyRepo = new LabourMoneyRepository(replica as any);
    const money = new LabourMoneyService(wallet, audit, moneyRepo, attendanceRepo, workerRepo);
    svc = new LabourBookingService(uow, outbox, idem, new AllowAllQuota(), metrics, money, audit, bookingRepo, assignRepo, workerRepo, minWage, attendanceRepo, moneyRepo);
    attendance = new AttendanceService(uow, outbox, idem, metrics, assignRepo, workerRepo, bookingRepo, attendanceRepo, audit);

    await fund(employer, 1_000_000n);   // employer holds enough to pay wages
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('worker self-registers (unverified) and is age-verified out-of-band', async () => {
    const w = await workers.register(tenantA, workerUser, `idem-${randomUUID()}`, { villageRegionId: GJ_REGION, travelKm: 15 } as any);
    workerId = w.id; expect(w.ageVerified18).toBe(false);
    await admin.query(`UPDATE worker_profiles SET age_verified_18=true WHERE id=$1`, [workerId]);
  });

  it('rejects a booking offered BELOW the statutory minimum (the dignity floor)', async () => {
    await expect(svc.create(tenantA, empActor, `idem-${randomUUID()}`, {
      demandTypeCode: 'daily_single', taskSkillId: skillId, regionId: GJ_REGION, skillLevel: 'unskilled',
      workersNeeded: 1, startDate: DAY1, endDate: DAY2, dailyHours: 8, wageKind: 'per_day',
      wageOfferedMinor: (GJ_UNSKILLED_FLOOR - 1n).toString(), womenOnly: false, farmLat: 22.3, farmLng: 71.1,
    } as any)).rejects.toBeInstanceOf(WageBelowMinimumError);
  });

  it('posts a booking at/above the floor (open), snapshotting min_wage', async () => {
    const b = await svc.create(tenantA, empActor, `idem-${randomUUID()}`, {
      demandTypeCode: 'daily_single', taskSkillId: skillId, regionId: GJ_REGION, skillLevel: 'unskilled',
      workersNeeded: 1, startDate: DAY1, endDate: DAY2, dailyHours: 8, wageKind: 'per_day',
      wageOfferedMinor: '50000', womenOnly: false, farmLat: 22.3, farmLng: 71.1,
    } as any);
    bookingId = b.id; expect(b.status).toBe('open'); expect(b.minWageMinor).toBe(GJ_UNSKILLED_FLOOR.toString());
  });

  it('assigns the (verified) worker; worker accepts; employer confirms the roster, starts, two days are worked + confirmed, completes', async () => {
    const a = await svc.assign(tenantA, empActor, bookingId, `idem-${randomUUID()}`, { workerId });
    assignmentId = a.id; expect(a.status).toBe('pending_worker'); expect(a.wageMinor).toBe('50000');
    const accepted = await svc.respond(tenantA, workerUser, assignmentId, { decision: 'accept' });
    expect(accepted.status).toBe('accepted');
    await expect(svc.start(tenantA, empActor, bookingId)).rejects.toMatchObject({ code: 'ROSTER_NOT_CONFIRMED' });
    const before = await bal(employer);
    const c = await svc.confirmRoster(tenantA, empActor, bookingId, `idem-${randomUUID()}`, {});
    expect(c.escrowedMinor).toBe('100000');                          // 1 worker × 2 days × ₹500
    expect(before - await bal(employer)).toBe(102000n);              // + the ₹20 platform fee
    expect((await svc.start(tenantA, empActor, bookingId)).status).toBe('in_progress');
    for (const d of [DAY1, DAY2]) {
      await admin.query(`INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, clock_in_at, clock_out_at, break_minutes, hours_regular, hours_overtime)
                         VALUES ($1,$2,$3,$4::date, now() - interval '9 hours', now(), 60, 8, 0)`, [randomUUID(), tenantA, assignmentId, d]);
      await attendance.confirmDay(tenantA, { userId: employer, canManage: false }, assignmentId, d, `idem-${randomUUID()}`, null);
    }
    expect((await svc.complete(tenantA, empActor, bookingId)).status).toBe('completed');
  });

  it('PAYS WAGES: 2 confirmed days × ₹500 move employer HOLD → worker (zero-sum), booking → paid', async () => {
    const wkrBefore = await bal(workerUser);
    const res = await svc.payWages(tenantA, empActor, bookingId, `idem-${randomUUID()}`);
    expect(res.status).toBe('paid'); expect(res.totalPaidMinor).toBe('100000'); expect(res.workersPaid).toBe(1);
    expect(await bal(workerUser) - wkrBefore).toBe(100000n);     // credited from the escrow
  });

  it('a second pay run on a paid booking moves nothing (idempotent state guard)', async () => {
    const wkrBefore = await bal(workerUser);
    expect((await svc.payWages(tenantA, empActor, bookingId, `idem-${randomUUID()}`)).movedMinor).toBe('0');
    expect(await bal(workerUser)).toBe(wkrBefore);
  });

  it('RLS: tenant B cannot see tenant A\'s booking', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const r = await inspect.query(`SELECT id FROM labour_bookings WHERE id=$1`, [bookingId]);
    expect(r.rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const r2 = await inspect.query(`SELECT id FROM labour_bookings WHERE id=$1`, [bookingId]);
    expect(r2.rows.length).toBe(1);
  });
});
