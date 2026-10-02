// modules/labour/__tests__/tenant11b-labour-truth.integration.spec.ts · PC-56 TENANT-11b — LIVE proof against real Postgres + RLS +
// the in-process wallet (no infra mocks). Each block fails on HEAD f6e2d20:
//   A1  clock in → clock out → employer confirm on a row whose created_at has non-zero microseconds (HEAD: 0 rows → "already
//       clocked out");
//   A2  3-day ₹420/day booking, 2 workers: the one who worked 3 confirmed days is paid ₹1,260, the no-show ₹0 with the reason,
//       the days are stamped, and a second run moves 0 (HEAD: ₹420 each, attendance never read);
//   A3  roster confirm escrows Σ workers × days × rate + ₹20 into the employer's Hold / platform Fees, one keyed txn; an
//       unfunded employer is refused by kind with the shortfall and nothing moves (HEAD: no such act; start held nothing);
//   A4  pay comes from the Hold; overtime beyond the escrow tops up first; unfunded OT waits and is paid by a later run;
//       completion returns the remainder; a cancel before start returns the escrow and keeps the fee;
//   A6  the desk posts / confirms FOR an employer only with a recorded consent; a desk-run pay needs labour.wages.approve;
//   A7  women-only enforced (male refused, gender not recorded refused by name); cancel needs a lookup reason;
//   A8  owner checks on the booking, the roster and an assignment; roster rows carry a short name + masked phone;
//   A9  kv_app cannot INSERT minimum_wages;
//   A5  the respond-timeout job runs from a kv_relay pool and expires a due booking with no 42501.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
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
import { WorkerProfileService } from '../services/worker-profile.service';
import { MinimumWageService } from '../services/minimum-wage.service';
import { LabourBookingService } from '../services/labour-booking.service';
import { LabourMoneyService } from '../services/labour-money.service';
import { AttendanceService } from '../services/attendance.service';
import { BookingRespondTimeoutJob } from '../jobs/booking-respond-timeout.job';
import { LabourActor } from '../policies/labour.policies';
import { indiaDay } from '../domain/display';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

const GJ_REGION = '11111111-0000-7000-8000-000000000001';
const FARM = { lat: 22.3, lng: 71.1 };
const key = () => `idem-${randomUUID()}`;
// The seeded minimum wages are effective from the day the seeds ran (db/seeds/rules: CURRENT_DATE), so every booking here
// starts in the future, relative to now — a fixed calendar date would go red the day it passed.
const plus = (days: number) => indiaDay(new Date(Date.now() + days * 86_400_000));
const D1 = plus(30), D2 = plus(31), D3 = plus(32), D4 = plus(40);
const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

run('TENANT-11b · labour truth (integration, real Postgres + RLS + wallet)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let svc: LabourBookingService; let workers: WorkerProfileService; let attendance: AttendanceService; let job: BookingRespondTimeoutJob;
  let bookingRepo: LabourBookingRepository;
  let skillId = '';
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const employer = randomUUID(); const poorEmployer = randomUUID(); const desk = randomUUID(); const stranger = randomUUID();
  const wUsers = { hansa: randomUUID(), jashu: randomUUID(), ramesh: randomUUID(), unknown: randomUUID() };
  const wIds: Record<string, string> = {};
  let hansaPhone = '';
  const emp: LabourActor = { userId: employer, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
  const poor: LabourActor = { userId: poorEmployer, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
  const deskActor: LabourActor = { userId: desk, canBook: false, canDesk: true, canApproveWages: false, canManage: false };
  const strangerActor: LabourActor = { userId: stranger, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
  const asWorker = (u: string): LabourActor => ({ userId: u, canBook: false, canDesk: false, canApproveWages: false, canManage: false });

  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });
  const bal = async (u: string, code: 'main' | 'hold') => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code=$2`, [u, code])).rows[0]?.b ?? '0');
  const legsOf = async (idemKey: string) => (await admin.query(
    `SELECT wa.owner_kind, wa.owner_user_id, wa.account_code, le.amount_minor::text AS amt, lv.code AS txn_type
       FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id JOIN wallet_accounts wa ON wa.id = le.account_id
       JOIN lookup_values lv ON lv.id = lt.txn_type_id
      WHERE lt.idempotency_key = $1 ORDER BY wa.account_code`, [idemKey])).rows as Array<{ owner_kind: string; owner_user_id: string | null; account_code: string; amt: string; txn_type: string }>;
  const auditOf = async (entityId: string, action: string) => (await admin.query(`SELECT * FROM audit_log WHERE entity_id=$1 AND action=$2 ORDER BY created_at`, [entityId, action])).rows;

  const bookingDto = (over: Record<string, unknown> = {}) => ({
    demandTypeCode: 'daily_multi', taskSkillId: skillId, regionId: GJ_REGION, skillLevel: 'unskilled', workersNeeded: 2,
    startDate: D1, endDate: D3, dailyHours: 8, wageKind: 'per_day', wageOfferedMinor: '42000', womenOnly: false,
    farmLat: FARM.lat, farmLng: FARM.lng, transportProvided: false, mealsProvided: false, toiletConfirmed: false, drinkingWater: false, womanSupervisor: false, ...over,
  } as any);
  const rosterOf = async (actor: LabourActor, workerNames: Array<keyof typeof wUsers>) => {
    const b = await svc.create(tenantA, actor, key(), bookingDto({ workersNeeded: workerNames.length }));
    const assignments: string[] = [];
    for (const n of workerNames) {
      const a = await svc.assign(tenantA, actor, b.id, key(), { workerId: wIds[n] });
      await svc.respond(tenantA, wUsers[n], a.id, { decision: 'accept' });
      assignments.push(a.id);
    }
    return { bookingId: b.id, bookingNo: b.bookingNo, assignments };
  };
  /** A clocked-out day inserted as the worker's device + server would have left it, then CONFIRMED through the service. */
  const workedDay = async (assignmentId: string, workDate: string, ot = '0.00') => {
    await admin.query(
      `INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, clock_in_distance_m, clock_out_at, break_minutes, hours_regular, hours_overtime, created_at)
       VALUES ($1,$2,$3,$4::date, now() - interval '9 hours', $5, $6, 0, now(), 60, 8.00, $7::numeric, date_trunc('second', now()) + interval '0.123457 second')`,
      [randomUUID(), tenantA, assignmentId, workDate, FARM.lat, FARM.lng, ot]);
    await attendance.confirmDay(tenantA, { userId: employer, canManage: false }, assignmentId, workDate, key(), '10.0.0.1');
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [employer, poorEmployer, desk, stranger, ...Object.values(wUsers)]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET full_name='Meera Ben Joshi' WHERE id=$1`, [employer]);
    // the employer is a member of tenant A (the desk may act for members only)
    const role = (await admin.query(`SELECT id FROM roles WHERE code='farmer'`)).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [employer, tenantA, role]);
    skillId = (await admin.query(`SELECT id FROM skills WHERE code='general_farm_labour'`)).rows[0].id;
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const workerRepo = new WorkerProfileRepository(replica as any);
    bookingRepo = new LabourBookingRepository(replica as any);
    const assignRepo = new BookingAssignmentRepository(replica as any);
    const attendanceRepo = new AttendanceRepository(replica as any);
    const moneyRepo = new LabourMoneyRepository(replica as any);
    const minWage = new MinimumWageService(new MinimumWageRepository(replica as any));
    const money = new LabourMoneyService(wallet, audit, moneyRepo, attendanceRepo, workerRepo);
    workers = new WorkerProfileService(uow, outbox, idem, metrics, workerRepo);
    svc = new LabourBookingService(uow, outbox, idem, new AllowAllQuota(), metrics, money, audit, bookingRepo, assignRepo, workerRepo, minWage, attendanceRepo, moneyRepo);
    attendance = new AttendanceService(uow, outbox, idem, metrics, assignRepo, workerRepo, bookingRepo, attendanceRepo, audit);
    job = new BookingRespondTimeoutJob(60_000, uow, bookingRepo, svc);
    const genders: Record<string, string | null> = { hansa: 'female', jashu: 'female', ramesh: 'male', unknown: null };
    // unique per run (users.phone is UNIQUE), but with the canon's visible head and tail so the mask reads "+91 90••• ••412"
    const mid = () => String(Math.floor(10000 + Math.random() * 89999));
    const phones: Record<string, string> = { hansa: `+9190${mid()}412`, jashu: `+9194${mid()}318`, ramesh: `+9198${mid()}001`, unknown: `+9197${mid()}002` };
    hansaPhone = phones.hansa;
    const names: Record<string, string> = { hansa: 'Hansa Ben Vaghela', jashu: 'Jashu Ben Patel', ramesh: 'Ramesh Bhai Desai', unknown: 'Unknown Worker' };
    for (const [n, u] of Object.entries(wUsers)) {
      await admin.query(`UPDATE users SET gender=$2, phone=$3, full_name=$4 WHERE id=$1`, [u, genders[n], phones[n], names[n]]);
      const w = await workers.register(tenantA, u, key(), { villageRegionId: GJ_REGION, travelKm: 15 } as any);
      await admin.query(`UPDATE worker_profiles SET age_verified_18=true WHERE id=$1`, [w.id]);
      wIds[n] = w.id;
    }
    await fund(employer, 5_000_000n);
  }, 60_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await app?.end(); await admin?.end();
  });

  it('A1 · clock in → clock out → employer confirm all succeed on a row with non-zero microseconds', async () => {
    const r = await rosterOf(emp, ['hansa']);
    await svc.confirmRoster(tenantA, emp, r.bookingId, key(), {});
    await svc.start(tenantA, emp, r.bookingId);
    const a = r.assignments[0];
    const ci = await attendance.clockIn(tenantA, wUsers.hansa, a, FARM, key());
    // force sub-millisecond digits onto the row key (what Postgres writes most of the time), and backdate the shift 9 h
    await admin.query(`UPDATE attendance_records SET created_at = date_trunc('second', created_at) + interval '0.473406 second', clock_in_at = now() - interval '9 hours' WHERE id=$1`, [ci.id]);
    const us = (await admin.query(`SELECT (extract(microseconds FROM created_at)::bigint % 1000) AS us FROM attendance_records WHERE id=$1`, [ci.id])).rows[0].us;
    expect(Number(us)).not.toBe(0);
    const out = await attendance.clockOut(tenantA, wUsers.hansa, a, { breakMinutes: 60 }, key());
    expect(out).toMatchObject({ status: 'clocked_out', hoursRegular: 8, hoursOvertime: 0 });
    const conf = await attendance.confirmDay(tenantA, { userId: employer, canManage: false }, a, ci.workDate, key(), '10.0.0.1');
    expect(conf.status).toBe('confirmed');
    expect(ci.workDate).toBe(indiaDay(new Date()));
    const row = (await admin.query(`SELECT clock_out_at, confirmed_by_employer, hours_regular::text FROM attendance_records WHERE id=$1`, [ci.id])).rows[0];
    expect(row.clock_out_at).toBeTruthy(); expect(row.confirmed_by_employer).toBe(true); expect(row.hours_regular).toBe('8.00');
    const aud = await auditOf(ci.id, 'labour.attendance_confirmed');
    expect(aud).toHaveLength(1); expect(aud[0].old_value).toEqual({ status: 'clocked_out' }); expect(aud[0].ip).toBe('10.0.0.1');
  });

  it('A3 + A2 + A4 · escrow at roster confirm; 3 confirmed days paid ₹1,260, a no-show ₹0; a second run moves 0; completion returns the rest', async () => {
    const r = await rosterOf(emp, ['hansa', 'jashu']);
    expect(r.bookingNo).toMatch(/^JOB-\d{4}-\d{2}$/);
    const mainBefore = await bal(employer, 'main'); const holdBefore = await bal(employer, 'hold');
    await expect(svc.start(tenantA, emp, r.bookingId)).rejects.toMatchObject({ code: 'ROSTER_NOT_CONFIRMED' });
    const confirmKey = key();
    const c = await svc.confirmRoster(tenantA, emp, r.bookingId, confirmKey, { reason: 'roster agreed with the crew' }, '10.0.0.2');
    expect(c).toMatchObject({ status: 'accepted', escrowedMinor: '252000', platformFeeMinor: '2000', employerTotalMinor: '254000' });
    expect(await svc.confirmRoster(tenantA, emp, r.bookingId, confirmKey, {})).toEqual(JSON.parse(JSON.stringify(c)));   // same key → the same (stored) answer, nothing new
    expect(mainBefore - await bal(employer, 'main')).toBe(254000n);
    expect(await bal(employer, 'hold') - holdBefore).toBe(252000n);
    const legs = await legsOf(`labour-escrow:${r.bookingId}`);
    expect(legs.map((l) => [l.owner_kind, l.account_code, l.amt])).toEqual([['platform', 'fees', '2000'], ['user', 'hold', '252000'], ['user', 'main', '-254000']]);
    expect(legs[0].txn_type).toBe('labour_escrow');
    const esc = (await admin.query(`SELECT expected_minor::text, fee_minor::text, status FROM labour_escrows WHERE booking_id=$1`, [r.bookingId])).rows[0];
    expect(esc).toEqual({ expected_minor: '252000', fee_minor: '2000', status: 'held' });
    const ra = await auditOf(r.bookingId, 'labour.roster.confirmed');
    expect(ra[0]).toMatchObject({ actor_user_id: employer, reason: 'roster agreed with the crew', ip: '10.0.0.2' });
    expect(ra[0].new_value).toMatchObject({ wagesMinor: '252000', feeMinor: '2000', days: 3, workers: 2 });
    const evt = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='labour.roster_confirmed'`, [r.bookingId])).rows[0].payload;
    expect(evt.recipientUserIds.sort()).toEqual([wUsers.hansa, wUsers.jashu].sort()); expect(evt.jobNo).toBe(r.bookingNo); expect(evt.startDate).toBe(ddmmyyyy(D1));
    // the worker's read says "money already set aside"
    const mine = await svc.listAssignments(tenantA, asWorker(wUsers.hansa), { box: 'mine', limit: 50 });
    expect((mine.items as any[]).find((x) => x.bookingId === r.bookingId)?.escrowedMinor).toBe('252000');

    await svc.start(tenantA, emp, r.bookingId);
    const [hansaA, jashuA] = r.assignments;
    for (const d of [D1, D2, D3]) await workedDay(hansaA, d);
    const hansaBefore = await bal(wUsers.hansa, 'main'); const jashuBefore = await bal(wUsers.jashu, 'main');
    const pay1 = await svc.payWages(tenantA, emp, r.bookingId, key(), '10.0.0.3', 'week one');
    expect(pay1.movedMinor).toBe('126000');
    expect(await bal(wUsers.hansa, 'main') - hansaBefore).toBe(126000n);           // ₹1,260 = 3 × ₹420
    expect(await bal(wUsers.jashu, 'main') - jashuBefore).toBe(0n);                // the no-show: ₹0
    const jLine = pay1.lines.find((l) => l.assignmentId === jashuA)!;
    expect(jLine).toMatchObject({ status: 'zero', zeroReason: 'no_confirmed_attendance', paidThisRunMinor: '0' });
    const stamped = (await admin.query(`SELECT count(*)::int n FROM attendance_records WHERE assignment_id=$1 AND wage_payout_id IS NOT NULL`, [hansaA])).rows[0].n;
    expect(stamped).toBe(3);
    const payoutRow = (await admin.query(`SELECT run_key, base_minor::text, days_confirmed, source, status FROM labour_wage_payouts WHERE assignment_id=$1 AND status <> 'zero'`, [hansaA])).rows[0];
    expect(payoutRow).toMatchObject({ base_minor: '126000', days_confirmed: 3, source: 'escrow', status: 'paid' });
    const wLegs = await legsOf(`wage:${hansaA}:${String(payoutRow.run_key).trim()}`);
    expect(wLegs.map((l) => [l.owner_user_id, l.account_code, l.amt])).toEqual([[employer, 'hold', '-126000'], [wUsers.hansa, 'main', '126000']]);
    const pa = (await admin.query(`SELECT * FROM audit_log WHERE action='labour.wages.paid' AND new_value->>'bookingId' = $1`, [r.bookingId])).rows;
    expect(pa).toHaveLength(2); expect(pa.every((x: any) => x.actor_user_id === employer && x.reason === 'week one' && x.ip === '10.0.0.3')).toBe(true);
    // a second run over the same days moves NOTHING
    const pay2 = await svc.payWages(tenantA, emp, r.bookingId, key());
    expect(pay2.movedMinor).toBe('0');
    expect(await bal(wUsers.hansa, 'main') - hansaBefore).toBe(126000n);
    // completion: the run releases the remainder (₹1,260 for the no-show's seat) and the booking is paid; the fee stays
    await svc.complete(tenantA, emp, r.bookingId);
    const mainBeforeRelease = await bal(employer, 'main');
    const pay3 = await svc.payWages(tenantA, emp, r.bookingId, key());
    expect(pay3).toMatchObject({ status: 'paid', movedMinor: '0', releasedMinor: '126000', markedPaid: true });
    expect(await bal(employer, 'main') - mainBeforeRelease).toBe(126000n);
    expect(await bal(employer, 'hold')).toBe(holdBefore);
    expect((await legsOf(`labour-escrow-release:${r.bookingId}`)).map((l) => [l.account_code, l.amt])).toEqual([['hold', '-126000'], ['main', '126000']]);
    expect((await admin.query(`SELECT status, release_reason, paid_minor::text, released_minor::text FROM labour_escrows WHERE booking_id=$1`, [r.bookingId])).rows[0])
      .toEqual({ status: 'released', release_reason: 'completed', paid_minor: '126000', released_minor: '126000' });
    // and a run on a paid booking moves 0
    expect((await svc.payWages(tenantA, emp, r.bookingId, key())).movedMinor).toBe('0');
  });

  it('QA · a day clocked out but NOT confirmed by the employer is worth ₹0 to the pay run (nothing paid, nothing stamped)', async () => {
    // [QA, TENANT-11b] the mutant that drops `confirmed_by_employer` from the pay-run SELECT survived the build's suite; this pins it.
    const r = await rosterOf(emp, ['hansa']);
    await svc.confirmRoster(tenantA, emp, r.bookingId, key(), {});
    await svc.start(tenantA, emp, r.bookingId);
    const [hansaA] = r.assignments;
    await admin.query(
      `INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, clock_in_distance_m, clock_out_at, break_minutes, hours_regular, hours_overtime, created_at)
       VALUES ($1,$2,$3,$4::date, now() - interval '9 hours', $5, $6, 0, now(), 60, 8.00, 0, date_trunc('second', now()) + interval '0.000321 second')`,
      [randomUUID(), tenantA, hansaA, D1, FARM.lat, FARM.lng]);
    const before = await bal(wUsers.hansa, 'main');
    const pay = await svc.payWages(tenantA, emp, r.bookingId, key());
    expect(pay.movedMinor).toBe('0');
    expect(await bal(wUsers.hansa, 'main') - before).toBe(0n);
    expect((await admin.query(`SELECT count(*)::int n FROM attendance_records WHERE assignment_id=$1 AND wage_payout_id IS NOT NULL`, [hansaA])).rows[0].n).toBe(0);
  });

  it('A3 · an employer who cannot fund the escrow is refused by kind with the shortfall — nothing moves', async () => {
    await fund(poorEmployer, 50_000n);
    const b = await svc.create(tenantA, poor, key(), bookingDto({ workersNeeded: 1 }));
    const a = await svc.assign(tenantA, poor, b.id, key(), { workerId: wIds.hansa });
    await svc.respond(tenantA, wUsers.hansa, a.id, { decision: 'accept' });
    const before = await bal(poorEmployer, 'main');
    await expect(svc.confirmRoster(tenantA, poor, b.id, key(), {})).rejects.toMatchObject({ code: 'EMPLOYER_FUNDS_UNAVAILABLE', details: { neededMinor: '128000', availableMinor: '50000', shortMinor: '78000' } });
    expect(await bal(poorEmployer, 'main')).toBe(before);
    expect((await admin.query(`SELECT count(*)::int n FROM labour_escrows WHERE booking_id=$1`, [b.id])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT status FROM labour_bookings WHERE id=$1`, [b.id])).rows[0].status).toBe('open');
    expect(await legsOf(`labour-escrow:${b.id}`)).toEqual([]);
  });

  it('A4 · overtime beyond the escrow tops up first; unfunded OT waits (base still paid) and a later run pays it', async () => {
    const lean = randomUUID(); await makeUser(admin, lean);
    const leanActor: LabourActor = { userId: lean, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
    await fund(lean, 44_000n);                                  // exactly ₹420 escrow + ₹20 fee
    const b = await svc.create(tenantA, leanActor, key(), bookingDto({ workersNeeded: 1, startDate: D4, endDate: D4 }));
    const a = await svc.assign(tenantA, leanActor, b.id, key(), { workerId: wIds.jashu });
    await svc.respond(tenantA, wUsers.jashu, a.id, { decision: 'accept' });
    await svc.confirmRoster(tenantA, leanActor, b.id, key(), {});
    expect(await bal(lean, 'main')).toBe(0n);
    await svc.start(tenantA, leanActor, b.id);
    await admin.query(
      `INSERT INTO attendance_records (id, tenant_id, assignment_id, work_date, clock_in_at, clock_out_at, break_minutes, hours_regular, hours_overtime)
       VALUES ($1,$2,$3,$4::date, now() - interval '11 hours', now(), 60, 8.00, 2.00)`, [randomUUID(), tenantA, a.id, D4]);
    await attendance.confirmDay(tenantA, { userId: lean, canManage: false }, a.id, D4, key(), null);
    const jBefore = await bal(wUsers.jashu, 'main');
    const p1 = await svc.payWages(tenantA, leanActor, b.id, key());
    expect(p1.movedMinor).toBe('42000');                         // the base from escrow
    expect(p1.lines[0]).toMatchObject({ status: 'partial', otStatus: 'awaiting_topup', otMinor: '15750' });
    expect(p1.outstanding).toBe(1);
    // completing does not release while OT is owed
    await svc.complete(tenantA, leanActor, b.id);
    const p2 = await svc.payWages(tenantA, leanActor, b.id, key());
    expect(p2).toMatchObject({ status: 'completed', movedMinor: '0', outstanding: 1 });
    // the employer adds money; the next run tops up and pays the OT, then settles
    await fund(lean, 20_000n);
    const p3 = await svc.payWages(tenantA, leanActor, b.id, key());
    expect(p3).toMatchObject({ movedMinor: '15750', toppedUpMinor: '15750', status: 'paid', releasedMinor: '0' });
    expect(await bal(wUsers.jashu, 'main') - jBefore).toBe(57750n);
    expect((await legsOf(`labour-escrow-topup:${b.id}:1`)).map((l) => [l.account_code, l.amt])).toEqual([['hold', '15750'], ['main', '-15750']]);
    expect(await bal(lean, 'main')).toBe(4250n);
  });

  it('A4 + A7 · cancel before start returns the whole escrow, keeps the fee, records the reason and tells the workers', async () => {
    const r = await rosterOf(emp, ['hansa']);
    await svc.confirmRoster(tenantA, emp, r.bookingId, key(), {});
    await expect(svc.cancel(tenantA, emp, r.bookingId, { reasonCode: 'other' })).rejects.toMatchObject({ code: 'CANCEL_REASON_TEXT_REQUIRED' });
    await expect(svc.cancel(tenantA, emp, r.bookingId, { reasonCode: 'hailstorm' })).rejects.toMatchObject({ code: 'CANCEL_REASON_UNKNOWN' });
    const mainBefore = await bal(employer, 'main');
    const c = await svc.cancel(tenantA, emp, r.bookingId, { reasonCode: 'rain_reschedule' }, '10.0.0.4');
    expect(c).toMatchObject({ status: 'cancelled', releasedMinor: '126000', feeKeptMinor: '2000', workersNotified: 1 });
    expect(await bal(employer, 'main') - mainBefore).toBe(126000n);
    const row = (await admin.query(`SELECT lb.cancel_reason_text, lv.code FROM labour_bookings lb JOIN lookup_values lv ON lv.id = lb.cancel_reason_id WHERE lb.id=$1`, [r.bookingId])).rows[0];
    expect(row).toEqual({ cancel_reason_text: null, code: 'rain_reschedule' });
    const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='labour.booking_cancelled'`, [r.bookingId])).rows[0].payload;
    expect(ev).toMatchObject({ reason: 'Rain forecast — rescheduling', recipientUserIds: [wUsers.hansa], jobNo: r.bookingNo });
    const au = await auditOf(r.bookingId, 'labour.booking.cancelled');
    expect(au[0]).toMatchObject({ reason: 'Rain forecast — rescheduling', ip: '10.0.0.4' }); expect(au[0].old_value).toEqual({ status: 'accepted' });
    expect(au[0].new_value).toMatchObject({ releasedMinor: '126000', feeKeptMinor: '2000' });
  });

  it('A7 · women-only: a man is refused, a worker with no gender recorded is refused by name, a woman is assigned', async () => {
    const b = await svc.create(tenantA, emp, key(), bookingDto({ womenOnly: true, workersNeeded: 3 }));
    await expect(svc.assign(tenantA, emp, b.id, key(), { workerId: wIds.ramesh })).rejects.toMatchObject({ code: 'WOMEN_ONLY_BOOKING' });
    await expect(svc.assign(tenantA, emp, b.id, key(), { workerId: wIds.unknown })).rejects.toMatchObject({ code: 'WORKER_GENDER_NOT_RECORDED' });
    await expect(svc.applyAsWorker(tenantA, wUsers.ramesh, b.id, key())).rejects.toMatchObject({ code: 'WOMEN_ONLY_BOOKING' });
    expect((await svc.assign(tenantA, emp, b.id, key(), { workerId: wIds.hansa })).status).toBe('pending_worker');
  });

  it('A6 · the desk posts and confirms FOR an employer only with a recorded consent; a desk-run pay needs labour.wages.approve', async () => {
    const consent = { channel: 'otp' as const, note: 'OTP read back on the call' };
    await expect(svc.create(tenantA, { ...deskActor, canDesk: false }, key(), bookingDto({ onBehalf: { employerUserId: employer, consent } }))).rejects.toMatchObject({ code: 'LABOUR_FORBIDDEN' });
    const b = await svc.create(tenantA, deskActor, key(), bookingDto({ workersNeeded: 1, onBehalf: { employerUserId: employer, consent } }), '10.0.0.5');
    expect(b).toMatchObject({ employerUserId: employer, onBehalf: true });
    const consents = (await admin.query(`SELECT act, channel, recorded_by FROM labour_consents WHERE booking_id=$1 ORDER BY recorded_at`, [b.id])).rows;
    expect(consents).toEqual([{ act: 'post', channel: 'otp', recorded_by: desk }]);
    // filling a seat needs a consent for `fill` (recorded once, reused)
    await expect(svc.assign(tenantA, deskActor, b.id, key(), { workerId: wIds.hansa })).rejects.toMatchObject({ code: 'EMPLOYER_CONSENT_REQUIRED' });
    const a = await svc.assign(tenantA, deskActor, b.id, key(), { workerId: wIds.hansa, consent });
    await svc.respond(tenantA, wUsers.hansa, a.id, { decision: 'accept' });
    await expect(svc.confirmRoster(tenantA, deskActor, b.id, key(), {})).rejects.toMatchObject({ code: 'EMPLOYER_CONSENT_REQUIRED' });
    await expect(svc.confirmRoster(tenantA, deskActor, b.id, key(), { consent: { channel: 'voice' } as any })).rejects.toMatchObject({ code: 'EMPLOYER_CONSENT_EVIDENCE_REQUIRED' });
    const c = await svc.confirmRoster(tenantA, deskActor, b.id, key(), { consent });
    expect(c.status).toBe('accepted');
    expect((await admin.query(`SELECT on_behalf, consent_id IS NOT NULL AS has FROM labour_escrows WHERE booking_id=$1`, [b.id])).rows[0]).toEqual({ on_behalf: true, has: true });
    await svc.start(tenantA, deskActor, b.id);
    await expect(svc.payWages(tenantA, deskActor, b.id, key())).rejects.toMatchObject({ code: 'LABOUR_FORBIDDEN' });
    const approved = await svc.payWages(tenantA, { ...deskActor, canApproveWages: true }, b.id, key());
    expect(approved.movedMinor).toBe('0');                       // nobody worked yet — nothing to move, and nothing faked
    await expect(svc.payWages(tenantA, { ...strangerActor, canApproveWages: true }, (await svc.create(tenantA, emp, key(), bookingDto())).id, key())).rejects.toMatchObject({ code: 'LABOUR_FORBIDDEN' });
  });

  it('A8 · owner checks: booking detail, roster and assignment reads are the parties\' and the desk\'s only', async () => {
    const r = await rosterOf(emp, ['hansa', 'jashu']);
    await svc.confirmRoster(tenantA, emp, r.bookingId, key(), {});
    // a stranger: the confirmed booking does not exist for them; nor the roster; nor an assignment
    await expect(svc.getBooking(tenantA, strangerActor, r.bookingId)).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await expect(svc.listAssignments(tenantA, strangerActor, { box: 'booking', bookingId: r.bookingId, limit: 50 })).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    await expect(svc.getAssignment(tenantA, strangerActor, r.assignments[0])).rejects.toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND' });
    // an OPEN booking is the marketplace card for a stranger: no farm location, no escrow
    const open = await svc.create(tenantA, emp, key(), bookingDto());
    const card = await svc.getBooking(tenantA, strangerActor, open.id) as Record<string, unknown>;
    expect(card.farmLat).toBeUndefined(); expect(card.escrowedMinor).toBeNull();
    // an assigned worker: the booking (with the location they clock in at) and their OWN roster row only
    const wb = await svc.getBooking(tenantA, asWorker(wUsers.hansa), r.bookingId) as Record<string, unknown>;
    expect(wb.farmLat).toBe(FARM.lat); expect(wb.escrowedMinor).toBe('252000'); expect(wb.viewerCan).toBeNull();
    const own = await svc.listAssignments(tenantA, asWorker(wUsers.hansa), { box: 'booking', bookingId: r.bookingId, limit: 50 });
    expect(own.items).toHaveLength(1); expect(own.items[0].id).toBe(r.assignments[0]);
    // the employer: the roster with a short name and a masked phone, never a raw phone
    const roster = await svc.listAssignments(tenantA, emp, { box: 'booking', bookingId: r.bookingId, limit: 50 });
    const hansaRow = roster.items.find((x: any) => x.id === r.assignments[0]) as any;
    expect(hansaRow).toMatchObject({ workerShortName: 'Hansa V.', workerPhoneMasked: '+91 90••• ••412', plannedMinor: '126000' });
    expect(JSON.stringify(roster)).not.toContain(hansaPhone.slice(3));
    // the desk (no booking.manage) oversees
    expect((await svc.listAssignments(tenantA, deskActor, { box: 'booking', bookingId: r.bookingId, limit: 50 })).items).toHaveLength(2);
    const detail = await svc.getBooking(tenantA, emp, r.bookingId) as any;
    expect(detail.costPreview).toMatchObject({ workers: 2, days: 3, wagesMinor: '252000', platformFeeMinor: '2000', employerTotalMinor: '254000' });
    expect(detail.costPreview.feeRule.capMinor).toBeNull();
    expect(detail.viewerCan).toMatchObject({ start: true, confirmRoster: false, pay: false });
  });

  it('A9 · kv_app cannot write the dignity floor (minimum_wages INSERT refused; SELECT stays)', async () => {
    const isSuper = (await app.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
    expect((await app.query(`SELECT count(*)::int n FROM minimum_wages`)).rows[0].n).toBeGreaterThan(0);
    if (isSuper) return;
    await expect(app.query(`INSERT INTO minimum_wages (region_id, skill_level, daily_wage_minor, effective_from) VALUES ($1,'unskilled',1,'2030-01-01')`, [GJ_REGION]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(app.query(`UPDATE minimum_wages SET daily_wage_minor = 1 WHERE false`)).rejects.toMatchObject({ code: '42501' });
  });

  it('A5 · the respond-timeout job runs from a kv_relay pool and expires a due booking (no 42501, no relay grant)', async () => {
    const b = await svc.create(tenantA, emp, key(), bookingDto({ respondByHours: 1 }));
    const a = await svc.assign(tenantA, emp, b.id, key(), { workerId: wIds.hansa });
    await admin.query(`UPDATE labour_bookings SET respond_by = now() - interval '1 minute' WHERE id=$1`, [b.id]);
    const relay = {
      query: async (sql: string, params?: unknown[]) => {
        const c: PoolClient = await admin.connect();
        try { await c.query('SET SESSION AUTHORIZATION kv_relay'); return await c.query(sql, params as unknown[]); }
        finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
      },
    } as unknown as Pool;
    const res = await job.sweep(relay, new Date());
    expect(res.failed).toBe(0); expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`SELECT status FROM labour_bookings WHERE id=$1`, [b.id])).rows[0].status).toBe('expired');
    expect((await admin.query(`SELECT status FROM booking_assignments WHERE id=$1`, [a.id])).rows[0].status).toBe('expired');
    expect(await auditOf(b.id, 'labour.booking.expired')).toHaveLength(1);
    // kv_relay still holds no grant on labour_bookings
    expect((await admin.query(`SELECT has_table_privilege('kv_relay','labour_bookings','SELECT') AS s`)).rows[0].s).toBe(false);
  });

  it('A10 · every act is audited with actor, before / after; the list cursor is µs and sorts by start', async () => {
    const r = await rosterOf(emp, ['jashu']);
    expect(await auditOf(r.bookingId, 'labour.booking.created')).toHaveLength(1);
    expect(await auditOf(r.bookingId, 'labour.worker.assigned')).toHaveLength(1);
    expect(await auditOf(r.bookingId, 'labour.assignment.accepted')).toHaveLength(1);
    const page1 = await svc.listBookings(tenantA, emp, { box: 'mine', limit: 2, counts: true });
    expect(page1.items).toHaveLength(2); expect(page1.nextCursor).toBeTruthy(); expect(page1.counts?.open).toBeGreaterThan(0);
    const { decodeCursor } = await import('../domain/cursor');
    expect(decodeCursor(page1.nextCursor!)?.c).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    const page2 = await svc.listBookings(tenantA, emp, { box: 'mine', limit: 2, cursor: decodeCursor(page1.nextCursor!) });
    expect(page2.items.map((x) => x.id)).not.toContain(page1.items[0].id);
    const byStart = await svc.listBookings(tenantA, emp, { box: 'mine', sort: 'starts', limit: 50 });
    const starts = byStart.items.map((x) => x.startDate);
    expect([...starts].sort()).toEqual(starts);
    const sum = await svc.summary(tenantA, deskActor);
    expect(sum.openJobs).toBeGreaterThan(0); expect(sum.fill30d.seatsNeeded).toBeGreaterThan(0);
    await expect(svc.summary(tenantA, emp)).rejects.toMatchObject({ code: 'LABOUR_FORBIDDEN' });
  });
});
