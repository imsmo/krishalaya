// apps/api/src/__tests__/tenant-swb-wages-ambassador-schemes.integration.spec.ts · PC-56 TENANT-SW-b — LIVE proof (real Postgres + RLS as
// kv_app, the in-process wallet, the 0198 triggers, the jobs on a pool that LOGS IN as kv_relay). No infra mocks.
//   A  ambassador pay from the TENANT wallet under maker-checker: the Thursday job prepares a run with a REAL funding read; the preparer's
//      confirm is refused BY THE DATABASE; a second tenant_admin confirms → tenant Main → ambassador Main legs, zero-sum, earnings stamped,
//      the stipend recorded once per month, platform Fees untouched; an unfunded tenant → nothing moves, lines `unfunded`; a re-run pays
//      the pending lines only; the W160 message act.
//   B  attendance recorded and reviewed: an out-of-fence clock-in is recorded needs_review and cannot be confirmed without a vouch; the
//      worker can never confirm (or vouch for) their own day — the desk path included; confirm-all-clean; paper backfill needs a reason and
//      a vouch by someone other than its recorder; µs paging.
//   C  the daily 18:00 IST wage run pays confirmed days from the escrow; a failed line retries at 16:00 the next day (and is named failed
//      after the ladder); an advance ≤ 50 % of the expected wage, approver ≠ requester, recovered ≤ 25 % of a payout with zero-sum legs.
//   D  schemes: kv_app cannot write the registry; the sweep writes a call list and NO application; summary figures are read; the pipeline's
//      blocker + translated fix; the per-field reveal is audited; µs paging.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { AppConfig } from '../core/config/app-config';
import { PgPoolProvider } from '../core/database/pg-pool.provider';
import { ShardRouter } from '../core/sharding/shard-router';
import { PgUnitOfWork } from '../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../core/database/read-replica.pg';
import { PgOutboxWriter } from '../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../core/observability/metrics.prom';
import { AuditWriter } from '../core/audit/audit.writer';
import { LedgerRepository } from '../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../core/wallet/account-codes';
import { QuotaService } from '../core/quota/quota.service';
// ambassadors
import { AmbassadorProfileRepository } from '../modules/ambassadors/repositories/ambassador-profile.repository';
import { AmbassadorEarningRepository } from '../modules/ambassadors/repositories/ambassador-earning.repository';
import { PayoutRunRepository } from '../modules/ambassadors/repositories/payout-run.repository';
import { PayoutRunService } from '../modules/ambassadors/services/payout-run.service';
import { AmbassadorMessageService } from '../modules/ambassadors/services/ambassador-message.service';
import { AmbassadorPayoutRunJob } from '../modules/ambassadors/jobs/payout-run.job';
import { stipendMonthFor, weeklyPeriodEnd } from '../modules/ambassadors/domain/payout-run';
// labour
import { WorkerProfileRepository } from '../modules/labour/repositories/worker-profile.repository';
import { LabourBookingRepository } from '../modules/labour/repositories/labour-booking.repository';
import { BookingAssignmentRepository } from '../modules/labour/repositories/booking-assignment.repository';
import { MinimumWageRepository } from '../modules/labour/repositories/minimum-wage.repository';
import { AttendanceRepository } from '../modules/labour/repositories/attendance.repository';
import { LabourMoneyRepository } from '../modules/labour/repositories/labour-money.repository';
import { WageRunRepository } from '../modules/labour/repositories/wage-run.repository';
import { WorkerProfileService } from '../modules/labour/services/worker-profile.service';
import { MinimumWageService } from '../modules/labour/services/minimum-wage.service';
import { LabourBookingService } from '../modules/labour/services/labour-booking.service';
import { LabourMoneyService } from '../modules/labour/services/labour-money.service';
import { AttendanceService } from '../modules/labour/services/attendance.service';
import { WageRunService } from '../modules/labour/services/wage-run.service';
import { WorkerAdvanceService } from '../modules/labour/services/worker-advance.service';
import { WageRunJob } from '../modules/labour/jobs/wage-run.job';
import { LabourActor } from '../modules/labour/policies/labour.policies';
import { indiaDay } from '../modules/labour/domain/display';
import { addIstDays, istAt } from '../modules/labour/domain/wage-run';
// schemes
import { SchemeRepository } from '../modules/schemes/repositories/scheme.repository';
import { SchemeDeskRepository } from '../modules/schemes/repositories/scheme-desk.repository';
import { SchemeDeskService } from '../modules/schemes/services/scheme-desk.service';
import { EligibilitySweepJob } from '../modules/schemes/jobs/eligibility-sweep.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

const GJ_REGION = '11111111-0000-7000-8000-000000000001';
const FARM = { lat: 22.3, lng: 71.1 };
const key = () => `idem-${randomUUID()}`;
const plus = (days: number) => indiaDay(new Date(Date.now() + days * 86_400_000));
const D1 = plus(30), D2 = plus(31), D3 = plus(32);
const isoUtc = (ymd: string, hh: number, mm: number) => new Date(istAt(ymd, hh).getTime() + mm * 60_000);

run('PC-56 TENANT-SW-b · wages, ambassador pay, schemes (integration, real Postgres + RLS + wallet + 0198 triggers)', () => {
  let pools: PgPoolProvider; let admin: Pool; let relayPool: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let runs: PayoutRunService; let runJob: AmbassadorPayoutRunJob; let messages: AmbassadorMessageService;
  let workers: WorkerProfileService; let svc: LabourBookingService; let attendance: AttendanceService; let wages: WageRunService; let advances: WorkerAdvanceService; let wageJob: WageRunJob;
  let desk: SchemeDeskService; let sweepJob: EligibilitySweepJob;
  let skillId = '';

  // ── helpers ──
  const sqlState = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');
  async function asKvApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]); const out = await fn(c); await c.query('ROLLBACK'); return out; }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const fundUser = (tenantId: string, u: string, amount: bigint) => uow.run(tenantId, (tx) => wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });
  const fundTenant = (tenantId: string, amount: bigint) => uow.run(tenantId, (tx) => wallet.post(tx, { tenantId, txnType: 'order_payment', idempotencyKey: `fund-t:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId, accountCode: 'main' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });
  const balUser = async (u: string, code = 'main') => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code=$2`, [u, code])).rows[0]?.b ?? '0');
  const balTenant = async (t: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='tenant' AND owner_tenant_id=$1 AND account_code='main'`, [t])).rows[0]?.b ?? '0');
  const balFees = async () => BigInt((await admin.query(`SELECT COALESCE(sum(cached_balance_minor),0)::text b FROM wallet_accounts WHERE owner_kind='platform' AND account_code='fees'`)).rows[0].b);
  const legsOf = async (idemKey: string) => (await admin.query(
    `SELECT wa.owner_kind, wa.owner_user_id, wa.owner_tenant_id, wa.account_code, le.amount_minor::text AS amt, lv.code AS txn_type
       FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id JOIN wallet_accounts wa ON wa.id = le.account_id JOIN lookup_values lv ON lv.id = lt.txn_type_id
      WHERE lt.idempotency_key = $1 ORDER BY le.amount_minor`, [idemKey])).rows as Array<{ owner_kind: string; owner_user_id: string | null; owner_tenant_id: string | null; account_code: string; amt: string; txn_type: string }>;
  const role = async (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, t, code]);
  const earn = async (t: string, ambId: string, amount: number) => admin.query(
    `INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor)
     SELECT $1, $2, p.id, 'farmer_onboarded', 'referral', gen_random_uuid(), $3 FROM commission_plans_ambassador p WHERE p.tenant_id IS NULL AND p.event_code='farmer_onboarded' AND p.deleted_at IS NULL LIMIT 1`, [t, ambId, amount]);
  const ambassador = async (t: string, opts: { stipend?: number; enrolledDaysAgo?: number } = {}) => {
    const u = await makeUser(admin); await role(u, t, 'farmer');
    await admin.query(`UPDATE users SET full_name='Dinesh Bhai Makwana' WHERE id=$1`, [u]);
    const id = (await admin.query(`INSERT INTO ambassador_profiles (user_id, tenant_id, monthly_stipend_minor, created_at) VALUES ($1,$2,$3, now() - make_interval(days => $4)) RETURNING id`,
      [u, t, opts.stipend ?? 0, opts.enrolledDaysAgo ?? 0])).rows[0].id as string;
    return { id, userId: u };
  };

  /** A labour world in its own tenant: an employer (member, funded), a desk user, workers with profiles (named, phones). */
  async function labourWorld(tenantId: ReturnType<typeof randomUUID>, workerNames: string[], deskIsWorker = false) {
    await makeTenant(admin, tenantId, 'L');
    const employer = await makeUser(admin); const deskUser = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name='Meera Ben Joshi' WHERE id=$1`, [employer]);
    await role(employer, tenantId, 'farmer'); await role(deskUser, tenantId, 'fpo_coordinator');
    const w: Record<string, { user: string; id: string }> = {};
    const names = deskIsWorker ? [...workerNames, '__desk'] : workerNames;
    for (const n of names) {
      const u = n === '__desk' ? deskUser : await makeUser(admin);
      const mid = String(Math.floor(10000 + Math.random() * 89999));
      await admin.query(`UPDATE users SET gender='female', phone=$2, full_name=$3 WHERE id=$1`, [u, `+9190${mid}412`, n === '__desk' ? 'Desk Ben Shah' : `${n} Ben Vaghela`]);
      const prof = await workers.register(tenantId, u, key(), { villageRegionId: GJ_REGION, travelKm: 15 } as any);
      await admin.query(`UPDATE worker_profiles SET age_verified_18=true WHERE id=$1`, [prof.id]);
      w[n] = { user: u, id: prof.id };
    }
    await fundUser(tenantId, employer, 5_000_000n);
    const emp: LabourActor = { userId: employer, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
    const deskActor: LabourActor = { userId: deskUser, canBook: false, canDesk: true, canApproveWages: false, canManage: false, canApproveAdvance: true };
    return { tenantId, employer, deskUser, w, emp, deskActor };
  }
  const bookingDto = (over: Record<string, unknown> = {}) => ({
    demandTypeCode: 'daily_multi', taskSkillId: skillId, regionId: GJ_REGION, skillLevel: 'unskilled', workersNeeded: 2, startDate: D1, endDate: D3, dailyHours: 8,
    wageKind: 'per_day', wageOfferedMinor: '42000', womenOnly: false, farmLat: FARM.lat, farmLng: FARM.lng, transportProvided: false, mealsProvided: false,
    toiletConfirmed: false, drinkingWater: false, womanSupervisor: false, ...over } as any);
  /** A started (escrowed) booking with these workers accepted. */
  async function startedBooking(lw: Awaited<ReturnType<typeof labourWorld>>, names: string[]) {
    const b = await svc.create(lw.tenantId, lw.emp, key(), bookingDto({ workersNeeded: names.length }));
    const a: Record<string, string> = {};
    for (const n of names) {
      const x = await svc.assign(lw.tenantId, lw.emp, b.id, key(), { workerId: lw.w[n].id });
      await svc.respond(lw.tenantId, lw.w[n].user, x.id, { decision: 'accept' });
      a[n] = x.id;
    }
    await svc.confirmRoster(lw.tenantId, lw.emp, b.id, key(), {});
    await svc.start(lw.tenantId, lw.emp, b.id);
    return { bookingId: b.id as string, a };
  }
  /** A clocked-out IN-FENCE self day, as the device + server leave it (the trigger checks it as kv's insert would). */
  const clockedOutDay = async (tenantId: string, assignmentId: string, workDate: string, createdAtSql = `now()`) => (await admin.query(
    `INSERT INTO attendance_records (tenant_id, assignment_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, clock_in_distance_m, clock_out_at, break_minutes, hours_regular, hours_overtime, created_at)
     VALUES ($1,$2,$3::date, now() - interval '9 hours', $4, $5, 12, now() - interval '30 hours', 60, 8.00, 0, ${createdAtSql}) RETURNING id, created_at::text AS raw`,
    [tenantId, assignmentId, workDate, FARM.lat, FARM.lng])).rows[0] as { id: string; raw: string };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    // the jobs' pool LOGS IN as kv_relay (the runner's role in production) — the 11b / SW-a / HOTFIX-2 shape
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) { await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`); const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev'; relayUrl = u.toString(); }
    relayPool = new Pool({ connectionString: relayUrl, max: 2 });
    expect((await relayPool.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');
    skillId = (await admin.query(`SELECT id FROM skills WHERE code='general_farm_labour'`)).rows[0].id;
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards) as any;
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    // A
    const pRepo = new AmbassadorProfileRepository(replica); const eRepo = new AmbassadorEarningRepository(replica);
    runs = new PayoutRunService(uow, outbox, idem, metrics, wallet, audit, new PayoutRunRepository(replica), eRepo, pRepo);
    runJob = new AmbassadorPayoutRunJob(60_000, runs, async () => true);
    messages = new AmbassadorMessageService(uow, outbox, idem, audit, pRepo);
    // B / C
    const workerRepo = new WorkerProfileRepository(replica); const bookingRepo = new LabourBookingRepository(replica); const assignRepo = new BookingAssignmentRepository(replica);
    const attendanceRepo = new AttendanceRepository(replica); const moneyRepo = new LabourMoneyRepository(replica);
    const minWage = new MinimumWageService(new MinimumWageRepository(replica));
    const money = new LabourMoneyService(wallet, audit, moneyRepo, attendanceRepo, workerRepo);
    workers = new WorkerProfileService(uow, outbox, idem, metrics, workerRepo);
    svc = new LabourBookingService(uow, outbox, idem, new AllowAllQuota(), metrics, money, audit, bookingRepo, assignRepo, workerRepo, minWage, attendanceRepo, moneyRepo);
    attendance = new AttendanceService(uow, outbox, idem, metrics, assignRepo, workerRepo, bookingRepo, attendanceRepo, audit);
    wages = new WageRunService(uow, metrics, new WageRunRepository(replica), bookingRepo, moneyRepo, svc);
    advances = new WorkerAdvanceService(uow, idem, audit, assignRepo, bookingRepo, workerRepo, moneyRepo, money);
    wageJob = new WageRunJob(60_000, wages, async () => true);
    // D
    desk = new SchemeDeskService(uow, idem, audit, new SchemeRepository(replica), new SchemeDeskRepository(replica));
    sweepJob = new EligibilitySweepJob(60_000, desk, async () => true);
  }, 90_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND aggregate_type IN ('ambassador_payout','ambassador_profile','attendance_record','labour_booking','booking_assignment')
                          AND created_at >= now() - interval '1 hour'`).catch(() => undefined);
    await pools?.onModuleDestroy(); await relayPool?.end(); await admin?.end();
  });

  /* ═════════════════════════════════════════ A · AMBASSADOR PAY ═════════════════════════════════════════ */
  describe('A · ambassador pay from the tenant wallet under maker-checker', () => {
    const T = randomUUID(); let admin1 = ''; let admin2 = '';
    let amb1: { id: string; userId: string }; let amb2: { id: string; userId: string };
    beforeAll(async () => {
      await makeTenant(admin, T, 'Amb');
      admin1 = await makeUser(admin); admin2 = await makeUser(admin);
      await role(admin1, T, 'tenant_admin'); await role(admin2, T, 'tenant_admin');
      amb1 = await ambassador(T, { stipend: 200000, enrolledDaysAgo: 70 });   // a whole month behind them → the stipend is due
      amb2 = await ambassador(T, { stipend: 150000, enrolledDaysAgo: 0 });    // enrolled today → NO stipend (pro-rata refused: first full month)
      await earn(T, amb1.id, 2500); await earn(T, amb1.id, 5000); await earn(T, amb2.id, 1000);
      await fundTenant(T, 1_000_000n);
    });

    it('A1 · the Thursday 23:00 IST job (on a kv_relay pool) prepares the run: lines = unpaid earnings + the whole-month stipend; the FUNDING line is a REAL read of the tenant Main', async () => {
      const now = new Date(); const thu = new Date(now.getTime() + ((4 - now.getUTCDay() + 7) % 7 + 7) * 86_400_000); thu.setUTCHours(17, 40, 0, 0);   // Thu 23:10 IST, next week
      const out = await runJob.sweep(relayPool, thu, [T]);
      expect(out).toMatchObject({ inWindow: true, prepared: 1, failed: 0 });
      const r = (await admin.query(`SELECT * FROM ambassador_payout_runs WHERE tenant_id=$1`, [T])).rows;
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ kind: 'weekly', status: 'prepared', prepared_by: null, line_count: 2 });
      expect(new Date(r[0].period_end).toISOString()).toBe(weeklyPeriodEnd(thu).toISOString());
      expect(String(r[0].total_commission_minor)).toBe('8500');
      expect(String(r[0].total_stipend_minor)).toBe('200000');                     // amb1's stipend only — amb2 has no whole month yet
      // THE FUNDING READ: the balance the job read IS the tenant's Main balance (no figure invented)
      expect(r[0].funding_check).toMatchObject({ mainBalanceMinor: (await balTenant(T)).toString(), totalMinor: '208500', covers: true, shortfallMinor: '0' });
      const lines = (await admin.query(`SELECT ambassador_id, commission_minor::text c, stipend_minor::text s, stipend_month::text m, status FROM ambassador_payout_run_lines WHERE run_id=$1 ORDER BY commission_minor DESC`, [r[0].id])).rows;
      expect(lines).toEqual([
        { ambassador_id: amb1.id, c: '7500', s: '200000', m: stipendMonthFor(weeklyPeriodEnd(thu)), status: 'pending' },
        { ambassador_id: amb2.id, c: '1000', s: '0', m: null, status: 'pending' }]);
      // a run opened → a second one is refused by the TRIGGER (one open run per tenant)
      await expect(runs.prepareByPerson(T, { userId: admin1 }, { kind: 'weekly', reason: 'second run' }, key())).rejects.toMatchObject({ code: 'AMB_RUN_ALREADY_OPEN' });
      // the job's run is refused by a person (nothing moves; its earnings roll forward)
      expect(await runs.refuse(T, { userId: admin1 }, r[0].id, 'testing the maker-checker path')).toEqual({ runId: r[0].id, status: 'refused' });
    }, 60_000);

    it('A2 · the PREPARER cannot confirm (refused by trg_apr_moves, not TypeScript); a second tenant_admin confirms → tenant Main → ambassador Main, zero-sum, earnings stamped, stipend once, platform Fees untouched', async () => {
      const prepared: any = await runs.prepareByPerson(T, { userId: admin1 }, { kind: 'weekly', reason: 'weekly run on demand' }, key());
      expect(prepared).toMatchObject({ status: 'prepared', lineCount: 2, totalCommissionMinor: '8500', totalStipendMinor: '200000' });
      const mainBefore = await balTenant(T); const feesBefore = await balFees();
      const a1Before = await balUser(amb1.userId); const a2Before = await balUser(amb2.userId);
      await expect(runs.confirm(T, { userId: admin1 }, prepared.id, 'my own run', key())).rejects.toMatchObject({ code: 'AMB_RUN_CHECKER_IS_MAKER' });
      expect((await admin.query(`SELECT status, confirmed_by FROM ambassador_payout_runs WHERE id=$1`, [prepared.id])).rows[0]).toEqual({ status: 'prepared', confirmed_by: null });
      expect(await balTenant(T)).toBe(mainBefore);                                   // nothing moved
      const out: any = await runs.confirm(T, { userId: admin2 }, prepared.id, 'lines checked against the ledger', key());
      expect(out).toMatchObject({ paid: 2, unfunded: 0, failed: 0, status: 'paid', paidMinor: '208500' });
      // the legs: per ambassador ONE txn, tenant Main − → ambassador Main +, zero-sum, txn type ambassador_run — and the platform Fees untouched
      for (const [amb, total] of [[amb1, 207500n], [amb2, 1000n]] as const) {
        const legs = await legsOf(`ambrun:${prepared.id}:${amb.id}`);
        expect(legs.map((l) => [l.owner_kind, l.owner_tenant_id ?? l.owner_user_id, l.account_code, l.amt])).toEqual([['tenant', T, 'main', (-total).toString()], ['user', amb.userId, 'main', total.toString()]]);
        expect(legs.reduce((s, l) => s + BigInt(l.amt), 0n)).toBe(0n);
        expect(legs[0].txn_type).toBe('ambassador_run');
      }
      expect(mainBefore - await balTenant(T)).toBe(208500n);
      expect(await balUser(amb1.userId) - a1Before).toBe(207500n);
      expect(await balUser(amb2.userId) - a2Before).toBe(1000n);
      expect(await balFees()).toBe(feesBefore);                                      // the 10a platform(Fees) leg is REPLACED
      // earnings stamped with the line id (10a markPaid), the stipend recorded ONCE for (ambassador, month)
      const lines = (await admin.query(`SELECT id, ambassador_id, status, txn_id FROM ambassador_payout_run_lines WHERE run_id=$1`, [prepared.id])).rows;
      for (const l of lines) {
        expect(l.status).toBe('paid');
        const e = (await admin.query(`SELECT payout_id FROM ambassador_earnings WHERE ambassador_id=$1`, [l.ambassador_id])).rows;
        expect(e.length).toBeGreaterThan(0); expect(e.every((x) => x.payout_id === l.id)).toBe(true);
      }
      const sp = (await admin.query(`SELECT ambassador_id, month::text m, amount_minor::text a FROM ambassador_stipend_payments WHERE tenant_id=$1`, [T])).rows;
      expect(sp).toEqual([{ ambassador_id: amb1.id, m: stipendMonthFor(new Date()), a: '200000' }]);
      // stipend once per month: nothing owed now (earnings stamped, July's stipend paid) — and the UNIQUE is the wall even for a forged row
      await expect(runs.prepareByPerson(T, { userId: admin1 }, { kind: 'weekly', reason: 'again' }, key())).rejects.toMatchObject({ code: 'AMB_RUN_NOTHING_OWED' });
      expect(await sqlState(admin.query(`INSERT INTO ambassador_stipend_payments (tenant_id, ambassador_id, month, amount_minor, run_id, line_id, txn_id) SELECT tenant_id, ambassador_id, month, amount_minor, run_id, line_id, txn_id FROM ambassador_stipend_payments WHERE tenant_id=$1`, [T]))).toBe('23505');
      // audits with reason: prepared · confirmed · per-line payout · paid
      const acts = (await admin.query(`SELECT action, actor_user_id, reason FROM audit_log WHERE entity_id=$1 ORDER BY created_at, id`, [prepared.id])).rows;
      expect(acts.map((x) => x.action)).toEqual(['ambassador.payout_run.prepared', 'ambassador.payout_run.confirmed', 'ambassador.payout_run.paid']);
      expect(acts[1]).toMatchObject({ actor_user_id: admin2, reason: 'lines checked against the ledger' });
    }, 60_000);

    it('A3 · an UNFUNDED tenant: every line `unfunded` with its shortfall, nothing moves, the run is `unfunded`; funded later, a re-run pays the pending lines only (idempotent)', async () => {
      const P = randomUUID(); await makeTenant(admin, P, 'Poor');
      const p1 = await makeUser(admin); const p2 = await makeUser(admin);
      await role(p1, P, 'tenant_admin'); await role(p2, P, 'tenant_admin');
      const x = await ambassador(P); const y = await ambassador(P);
      await earn(P, x.id, 6000); await earn(P, y.id, 3000);
      await fundTenant(P, 100n);
      const prepared: any = await runs.prepareByPerson(P, { userId: p1 }, { kind: 'weekly', reason: 'weekly run' }, key());
      expect(prepared.fundingCheck).toMatchObject({ mainBalanceMinor: '100', totalMinor: '9000', covers: false, shortfallMinor: '8900' });
      const out: any = await runs.confirm(P, { userId: p2 }, prepared.id, 'confirming anyway', key());
      expect(out).toMatchObject({ paid: 0, unfunded: 2, status: 'unfunded', paidMinor: '0' });
      const lines = (await admin.query(`SELECT ambassador_id, status, shortfall_minor::text s FROM ambassador_payout_run_lines WHERE run_id=$1 ORDER BY commission_minor DESC`, [prepared.id])).rows;
      expect(lines).toEqual([{ ambassador_id: x.id, status: 'unfunded', s: '5900' }, { ambassador_id: y.id, status: 'unfunded', s: '2900' }]);
      expect(await balTenant(P)).toBe(100n);
      expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key LIKE $1`, [`ambrun:${prepared.id}:%`])).rows[0].n).toBe(0);
      // fund ONE line's worth: the re-run pays what it can (partially_paid), the other stays unfunded with its new shortfall
      await fundTenant(P, 6000n);
      const r2: any = await runs.payAgain(P, { userId: p2 }, prepared.id, 'tenant funded', key());
      expect(r2).toMatchObject({ paid: 1, unfunded: 1, status: 'partially_paid', paidMinor: '6000' });
      // the preparer may not run it either
      await expect(runs.payAgain(P, { userId: p1 }, prepared.id, 'me again', key())).rejects.toMatchObject({ code: 'AMB_RUN_CHECKER_IS_MAKER' });
      await fundTenant(P, 3000n);
      const r3: any = await runs.payAgain(P, { userId: p2 }, prepared.id, 'tenant funded again', key());
      expect(r3).toMatchObject({ paid: 1, unfunded: 0, status: 'paid', paidMinor: '3000' });   // ONLY the pending line was paid
      expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [`ambrun:${prepared.id}:${x.id}`])).rows[0].n).toBe(1);
      await expect(runs.payAgain(P, { userId: p2 }, prepared.id, 'once more', key())).rejects.toMatchObject({ code: 'AMB_RUN_CLOSED' });
      expect(await balTenant(P)).toBe(100n);
    }, 60_000);

    it('A4 · W160 "Message (Gujarati)": one notification event for that ambassador through communication + an audit row with the reason', async () => {
      const r: any = await messages.send(T, { userId: admin1 }, amb1.id, { message: 'Kal 10 baje Bhesan camp par aavjo', reason: 'camp reminder' }, key(), '10.0.0.9');
      expect(r).toEqual({ ambassadorId: amb1.id, queued: true });
      const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='ambassadors.message'`, [amb1.id])).rows;
      expect(ev).toHaveLength(1); expect(ev[0].payload).toMatchObject({ recipientUserIds: [amb1.userId], message: 'Kal 10 baje Bhesan camp par aavjo' });
      const a = (await admin.query(`SELECT actor_user_id, reason, ip::text FROM audit_log WHERE action='ambassador.messaged' AND entity_id=$1`, [amb1.id])).rows;
      expect(a[0]).toMatchObject({ actor_user_id: admin1, reason: 'camp reminder' });
      expect((await admin.query(`SELECT count(*)::int n FROM notification_events WHERE code='ambassador.message'`)).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int n FROM notification_templates WHERE event_code='ambassador.message'`)).rows[0].n).toBe(6);   // push + in-app × en/hi/gu
    });
  });

  /* ═════════════════════════════════════════ B · ATTENDANCE ═════════════════════════════════════════ */
  describe('B · attendance recorded and reviewed; the dual-confirm law in the database', () => {
    let lw: Awaited<ReturnType<typeof labourWorld>>; let bk: Awaited<ReturnType<typeof startedBooking>>;
    beforeAll(async () => { lw = await labourWorld(randomUUID(), ['Hansa', 'Jashu'], true); bk = await startedBooking(lw, ['Hansa', 'Jashu', '__desk']); }, 60_000);

    it('B1 · an OUT-OF-FENCE clock-in is RECORDED needs_review (not refused); it cannot be confirmed without a vouch; the worker cannot vouch for it; a vouch by the employer lets it be confirmed', async () => {
      const far = { lat: FARM.lat + 0.0045, lng: FARM.lng };                       // ≈ 500 m north of the farm
      const ci: any = await attendance.clockIn(lw.tenantId, lw.w.Hansa.user, bk.a.Hansa, far, key());
      expect(ci).toMatchObject({ outOfFence: true, reviewStatus: 'needs_review', fenceM: 100 });
      expect(ci.distanceM).toBeGreaterThan(400);
      const row = (await admin.query(`SELECT review_status, fence_distance_m, clock_in_distance_m, clock_in_method FROM attendance_records WHERE id=$1`, [ci.id])).rows[0];
      expect(row).toMatchObject({ review_status: 'needs_review', clock_in_method: 'self' });
      expect(row.fence_distance_m).toBe(row.clock_in_distance_m);                    // the canon's name, generated over the server's fact
      await admin.query(`UPDATE attendance_records SET clock_in_at = now() - interval '9 hours' WHERE id=$1`, [ci.id]);
      await attendance.clockOut(lw.tenantId, lw.w.Hansa.user, bk.a.Hansa, { breakMinutes: 60 }, key());
      await expect(attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.Hansa, ci.workDate, key(), null)).rejects.toMatchObject({ code: 'ATTENDANCE_NEEDS_VOUCH' });
      await expect(attendance.review(lw.tenantId, { userId: lw.w.Hansa.user, canManage: false, canDesk: true }, ci.id, 'vouched', 'I was there at the plot edge', null)).rejects.toMatchObject({ code: 'ATTENDANCE_SELF_VOUCH' });
      await expect(attendance.review(lw.tenantId, { userId: lw.employer, canManage: false }, ci.id, 'vouched', 'short', null)).rejects.toMatchObject({ code: 'ATTENDANCE_REASON_REQUIRED' });
      expect(await attendance.review(lw.tenantId, { userId: lw.employer, canManage: false }, ci.id, 'vouched', 'plot edge — the supervisor saw her at 07:00', '10.1.1.1'))
        .toMatchObject({ reviewStatus: 'vouched' });
      const c = await attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.Hansa, ci.workDate, key(), null);
      expect(c.status).toBe('confirmed');
      expect((await admin.query(`SELECT confirmed_by, review_status, vouched_by FROM attendance_records WHERE id=$1`, [ci.id])).rows[0]).toEqual({ confirmed_by: lw.employer, review_status: 'vouched', vouched_by: lw.employer });
      // a direct write cannot skip the vouch either — the wall is the trigger
      const d2 = await clockedOutDay(lw.tenantId, bk.a.Jashu, D2);
      await admin.query(`UPDATE attendance_records SET review_status='needs_review' WHERE id=$1`, [d2.id]).catch(() => undefined);   // (refused: a review moves only from needs_review)
      const nr = (await admin.query(`INSERT INTO attendance_records (tenant_id, assignment_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, clock_in_distance_m, clock_out_at, hours_regular, review_status)
         VALUES ($1,$2,$3::date, now() - interval '9 hours', 22.3, 71.1, 300, now(), 8, 'needs_review') RETURNING id`, [lw.tenantId, bk.a.Jashu, D3])).rows[0].id;
      expect(await sqlState(admin.query(`UPDATE attendance_records SET confirmed_by_employer=true, confirmed_by=$2, confirmed_at=now() WHERE id=$1`, [nr, lw.employer]))).toBe('23514');
      // and an out-of-fence row can never be written as clean
      expect(await sqlState(admin.query(`INSERT INTO attendance_records (tenant_id, assignment_id, work_date, clock_in_at, clock_in_distance_m) VALUES ($1,$2,$3::date, now(), 250)`, [lw.tenantId, bk.a.Jashu, plus(40)]))).toBe('23514');
    }, 60_000);

    it('B2 · the WORKER can never confirm their own day — the labour-desk path included (the database compares confirmer with the assigned worker)', async () => {
      const d = await clockedOutDay(lw.tenantId, bk.a.__desk, D1);
      await expect(attendance.confirmDay(lw.tenantId, { userId: lw.deskUser, canManage: false, canDesk: true }, bk.a.__desk, D1, key(), null)).rejects.toMatchObject({ code: 'ATTENDANCE_SELF_CONFIRM' });
      expect(await sqlState(admin.query(`UPDATE attendance_records SET confirmed_by_employer=true, confirmed_by=$2, confirmed_at=now() WHERE id=$1`, [d.id, lw.deskUser]))).toBe('23514');
      expect((await admin.query(`SELECT confirmed_by_employer FROM attendance_records WHERE id=$1`, [d.id])).rows[0].confirmed_by_employer).toBe(false);
      // someone else (the employer) confirms it fine
      expect((await attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.__desk, D1, key(), null)).status).toBe('confirmed');
    });

    it('B3 · "Confirm all clean records": ONE keyed act — each clean day confirmed individually in one tx; review rows untouched; the actor\'s own days skipped and counted', async () => {
      const own = await clockedOutDay(lw.tenantId, bk.a.__desk, plus(33));
      const c1 = await clockedOutDay(lw.tenantId, bk.a.Hansa, plus(34)); const c2 = await clockedOutDay(lw.tenantId, bk.a.Jashu, plus(35));
      const tiles = await attendance.reviewSummary(lw.tenantId, { userId: lw.deskUser, canManage: false, canDesk: true });
      expect(tiles.clean).toBeGreaterThanOrEqual(3); expect(tiles.needsReview).toBeGreaterThanOrEqual(1); expect(tiles.unconfirmed24h).toBeGreaterThanOrEqual(3);
      expect(tiles.offlineDeviceStore).toEqual({ built: false, reason: 'mobile_offline_clock_store_not_built' });
      const k = key();
      const out: any = await attendance.confirmAllClean(lw.tenantId, { userId: lw.deskUser, canManage: false, canDesk: true }, 'evening sweep', k, '10.2.2.2');
      expect(out.skippedOwn).toBe(1);
      expect(out.ids).toEqual(expect.arrayContaining([c1.id, c2.id])); expect(out.ids).not.toContain(own.id);
      expect(out.confirmed).toBe(out.ids.length);
      expect(await attendance.confirmAllClean(lw.tenantId, { userId: lw.deskUser, canManage: false, canDesk: true }, 'evening sweep', k, '10.2.2.2')).toEqual(out);   // keyed
      const rows = (await admin.query(`SELECT id, confirmed_by_employer, confirmed_by FROM attendance_records WHERE id = ANY($1::uuid[])`, [[own.id, c1.id, c2.id]])).rows;
      expect(rows.find((r) => r.id === own.id).confirmed_by_employer).toBe(false);
      expect(rows.filter((r) => r.id !== own.id).every((r) => r.confirmed_by === lw.deskUser)).toBe(true);
      expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE action='labour.attendance_confirmed' AND entity_id = ANY($1::uuid[]) AND (new_value->>'bulk')::boolean`, [[c1.id, c2.id]])).rows[0].n).toBe(2);
      expect((await admin.query(`SELECT count(*)::int n FROM attendance_records WHERE tenant_id=$1 AND review_status='needs_review' AND confirmed_by_employer`, [lw.tenantId])).rows[0].n).toBe(0);
    });

    it('B4 · paper backfill: the desk records a day from a signed sheet — a reason is required; it is needs_review; its RECORDER cannot vouch; the employer vouches and confirms', async () => {
      const media = randomUUID(); const dsk = { userId: lw.deskUser, canManage: false, canDesk: true };
      await expect(attendance.backfill(lw.tenantId, dsk, { assignmentId: bk.a.Hansa, workDate: D2, hoursRegular: 8, hoursOvertime: 0, mediaId: media, reason: 'paper' }, key(), null))
        .rejects.toMatchObject({ code: 'ATTENDANCE_REASON_REQUIRED' });
      const b: any = await attendance.backfill(lw.tenantId, dsk, { assignmentId: bk.a.Hansa, workDate: indiaDay(new Date()), hoursRegular: 8, hoursOvertime: 0, mediaId: media, reason: 'no signal at the plot; supervisor sheet photographed' }, key(), null)
        .catch((e) => e);
      // the job's dates are in the future (seed floor), so a TODAY paper day falls outside them — refused by name; use a job day
      expect(b.code).toBe('ATTENDANCE_BACKFILL_DATE');
      // a job day still in the future is refused too (a paper day is a past or today's date): move the booking's dates for this proof
      await admin.query(`UPDATE labour_bookings SET start_date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 3 WHERE id=$1`, [bk.bookingId]);
      const day = indiaDay(new Date(Date.now() - 2 * 86_400_000));
      const ok: any = await attendance.backfill(lw.tenantId, dsk, { assignmentId: bk.a.Hansa, workDate: day, hoursRegular: 8, hoursOvertime: 0, mediaId: media, reason: 'no signal at the plot; supervisor sheet photographed' }, key(), null);
      expect(ok).toMatchObject({ method: 'paper_backfill', reviewStatus: 'needs_review' });
      expect((await admin.query(`SELECT recorded_by, backfill_media_id, clock_in_at FROM attendance_records WHERE id=$1`, [ok.id])).rows[0]).toEqual({ recorded_by: lw.deskUser, backfill_media_id: media, clock_in_at: null });
      await expect(attendance.confirmById(lw.tenantId, { userId: lw.employer, canManage: false }, ok.id, null, key(), null)).rejects.toMatchObject({ code: 'ATTENDANCE_NEEDS_VOUCH' });
      await expect(attendance.review(lw.tenantId, dsk, ok.id, 'vouched', 'I recorded it and I vouch for it', null)).rejects.toMatchObject({ code: 'ATTENDANCE_BACKFILL_VOUCH_IS_RECORDER' });
      await attendance.review(lw.tenantId, { userId: lw.employer, canManage: false }, ok.id, 'vouched', 'the signed sheet matches my muster book', null);
      expect((await attendance.confirmById(lw.tenantId, { userId: lw.employer, canManage: false }, ok.id, 'paper day confirmed', key(), null)).status).toBe('confirmed');
      expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action IN ('labour.attendance_backfilled','labour.attendance_vouched','labour.attendance_confirmed')`, [ok.id])).rows[0].n).toBe(3);
    }, 60_000);

    it('B5 · the tenant-wide list: workers masked; µs keyset — two rows in the SAME millisecond, page size 1, page two is the second row', async () => {
      const ms = new Date(Date.now() + 60_000).toISOString();   // one fixed millisecond (a minute ahead → the newest rows)
      const x = await clockedOutDay(lw.tenantId, bk.a.Jashu, plus(41), `'${ms}'::timestamptz + interval '777 microseconds'`);
      const y = await clockedOutDay(lw.tenantId, bk.a.Hansa, plus(41), `'${ms}'::timestamptz + interval '333 microseconds'`);
      expect(x.raw.slice(0, 23)).toBe(y.raw.slice(0, 23));
      const dsk = { userId: lw.deskUser, canManage: false, canDesk: true };
      const p1 = await attendance.reviewList(lw.tenantId, dsk, { status: 'all', limit: 1, cursor: undefined });
      expect(p1.items[0].id).toBe(x.id);
      expect(p1.items[0].workerPhoneMasked).toMatch(/^\+91 \d{2}••• ••\d{3}$/);
      expect(JSON.stringify(p1)).not.toMatch(/\+9190\d{8}/);
      const { decodeCursor } = await import('../modules/labour/domain/cursor');
      const p2 = await attendance.reviewList(lw.tenantId, dsk, { status: 'all', limit: 1, cursor: decodeCursor(p1.nextCursor) });
      expect(p2.items[0].id).toBe(y.id);
      await expect(attendance.reviewList(lw.tenantId, { userId: lw.employer, canManage: false }, { status: 'all', limit: 5 })).rejects.toMatchObject({ code: 'LABOUR_FORBIDDEN' });
    });
  });

  /* ═════════════════════════════════════════ C · WAGE RUNS + ADVANCES ═════════════════════════════════════════ */
  describe('C · the daily 18:00 IST wage run, the retry ladder, advances recovered ≤ 25 %', () => {
    let lw: Awaited<ReturnType<typeof labourWorld>>; let bk: Awaited<ReturnType<typeof startedBooking>>;
    const DAY0 = plus(60);
    beforeAll(async () => { lw = await labourWorld(randomUUID(), ['Hansa', 'Jashu']); bk = await startedBooking(lw, ['Hansa', 'Jashu']); }, 60_000);

    it('C1 · the 18:00 run (job, kv_relay pool) pays every confirmed-but-unpaid day from the escrow — escrow Hold → worker Main, wage:<assignment>:<sha>; before 18:00 nothing; once a day', async () => {
      for (const d of [D1, D2]) { await clockedOutDay(lw.tenantId, bk.a.Hansa, d); await attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.Hansa, d, key(), null); }
      expect(await wageJob.sweep(relayPool, isoUtc(DAY0, 17, 50), [lw.tenantId])).toMatchObject({ runs: 0, failed: 0 });    // 17:50 IST — not yet
      const holdBefore = await balUser(lw.employer, 'hold'); const hBefore = await balUser(lw.w.Hansa.user);
      expect(await wageJob.sweep(relayPool, isoUtc(DAY0, 18, 5), [lw.tenantId])).toMatchObject({ runs: 1, failed: 0 });
      expect(await wageJob.sweep(relayPool, isoUtc(DAY0, 18, 25), [lw.tenantId])).toMatchObject({ runs: 0 });               // once per IST day
      const r = (await admin.query(`SELECT id, status, prepared_by, gross_minor::text g, advance_recovery_minor::text rec, net_minor::text n, line_count FROM labour_wage_runs WHERE tenant_id=$1 AND run_date=$2::date`, [lw.tenantId, DAY0])).rows[0];
      expect(r).toMatchObject({ status: 'paid', prepared_by: null, g: '84000', rec: '0', n: '84000', line_count: 1 });
      const line = (await admin.query(`SELECT assignment_id, gross_minor::text g, net_minor::text n, status, payout_id FROM labour_wage_run_lines WHERE run_id=$1`, [r.id])).rows[0];
      expect(line).toMatchObject({ assignment_id: bk.a.Hansa, g: '84000', n: '84000', status: 'paid' });
      const p = (await admin.query(`SELECT run_key, wage_run_id, paid_by FROM labour_wage_payouts WHERE id=$1`, [line.payout_id])).rows[0];
      expect(p).toMatchObject({ wage_run_id: r.id, paid_by: null });
      const legs = await legsOf(`wage:${bk.a.Hansa}:${String(p.run_key).trim()}`);
      expect(legs.map((l) => [l.owner_user_id, l.account_code, l.amt])).toEqual([[lw.employer, 'hold', '-84000'], [lw.w.Hansa.user, 'main', '84000']]);
      expect(holdBefore - await balUser(lw.employer, 'hold')).toBe(84000n);
      expect(await balUser(lw.w.Hansa.user) - hBefore).toBe(84000n);
      const today = await wages.today(lw.tenantId, lw.deskActor, isoUtc(DAY0, 19, 0));
      expect(today.run?.id).toBe(r.id); expect(today.lines).toHaveLength(1);
    }, 60_000);

    it('C2 · advances: ≤ 50 % of the expected wage (the DATABASE\'s cap); approver ≠ requester (the DATABASE\'s wall); disbursed from the escrow; recovered ≤ 25 % of the next payout with zero-sum legs', async () => {
      // Jashu: 3 days × ₹420 = ₹1,260 expected → cap ₹630
      await expect(advances.request(lw.tenantId, { userId: lw.w.Jashu.user, canBook: false, canDesk: false, canApproveWages: false, canManage: false }, { assignmentId: bk.a.Jashu, amountMinor: '70000', reason: 'school fees' }, key(), null))
        .rejects.toMatchObject({ code: 'ADVANCE_OVER_CAP' });
      const req: any = await advances.request(lw.tenantId, { userId: lw.w.Jashu.user, canBook: false, canDesk: false, canApproveWages: false, canManage: false }, { assignmentId: bk.a.Jashu, amountMinor: '40000', reason: 'school fees' }, key(), null);
      expect(req).toMatchObject({ status: 'requested', amountMinor: '40000' });
      expect((await admin.query(`SELECT expected_wage_minor::text e FROM worker_advances WHERE id=$1`, [req.id])).rows[0].e).toBe('126000');   // computed in SQL, not supplied
      // the desk path: the desk requests and the desk cannot approve its own request (even with the employer's consent)
      const dreq: any = await advances.request(lw.tenantId, lw.deskActor, { assignmentId: bk.a.Hansa, amountMinor: '10000', reason: 'bus fare home' }, key(), null);
      await expect(advances.approve(lw.tenantId, lw.deskActor, dreq.id, { reason: 'ok by me', consent: { channel: 'otp' } }, key(), null)).rejects.toMatchObject({ code: 'ADVANCE_APPROVER_IS_REQUESTER' });
      // the worker never approves (here the worker is also the requester — the requester check fires first)
      await expect(advances.approve(lw.tenantId, { ...lw.deskActor, userId: lw.w.Jashu.user }, req.id, { reason: 'mine', consent: { channel: 'otp' } }, key(), null)).rejects.toMatchObject({ code: 'ADVANCE_APPROVER_IS_REQUESTER' });
      const holdBefore = await balUser(lw.employer, 'hold'); const jBefore = await balUser(lw.w.Jashu.user);
      const ap: any = await advances.approve(lw.tenantId, lw.emp, req.id, { reason: 'approved for school fees' }, key(), null);
      expect(ap).toMatchObject({ status: 'disbursed', amountMinor: '40000' });
      const aLegs = await legsOf(`wage-advance:${req.id}`);
      expect(aLegs.map((l) => [l.owner_user_id, l.account_code, l.amt, l.txn_type])).toEqual([[lw.employer, 'hold', '-40000', 'wage_advance'], [lw.w.Jashu.user, 'main', '40000', 'wage_advance']]);
      expect(holdBefore - await balUser(lw.employer, 'hold')).toBe(40000n);
      expect(await balUser(lw.w.Jashu.user) - jBefore).toBe(40000n);
      expect((await admin.query(`SELECT advanced_minor::text a FROM labour_escrows WHERE booking_id=$1`, [bk.bookingId])).rows[0].a).toBe('40000');
      // write-off is refused by name — the database refuses it whoever asks
      expect(await sqlState(admin.query(`UPDATE worker_advances SET status='written_off' WHERE id=$1`, [req.id]))).toBe('23514');

      // Jashu works one confirmed day (₹420); the next day's 18:00 run pays gross 42000, recovers min(40000, 25 % × 42000 = 10500)
      await clockedOutDay(lw.tenantId, bk.a.Jashu, D1); await attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.Jashu, D1, key(), null);
      const DAY1 = addIstDays(DAY0, 1);
      const hold2 = await balUser(lw.employer, 'hold'); const j2 = await balUser(lw.w.Jashu.user);
      expect(await wageJob.sweep(relayPool, isoUtc(DAY1, 18, 5), [lw.tenantId])).toMatchObject({ runs: 1, failed: 0 });
      const run1 = (await admin.query(`SELECT id, gross_minor::text g, advance_recovery_minor::text rec, net_minor::text n FROM labour_wage_runs WHERE tenant_id=$1 AND run_date=$2::date`, [lw.tenantId, DAY1])).rows[0];
      expect(run1).toMatchObject({ g: '42000', rec: '10500', n: '31500' });
      const ln = (await admin.query(`SELECT gross_minor::text g, advance_recovery_minor::text rec, net_minor::text n, payout_id FROM labour_wage_run_lines WHERE run_id=$1`, [run1.id])).rows[0];
      expect(ln).toMatchObject({ g: '42000', rec: '10500', n: '31500' });
      expect(BigInt(ln.rec) * 4n).toBeLessThanOrEqual(BigInt(ln.g));                // ≤ 25 %
      const po = (await admin.query(`SELECT base_minor::text b, advance_recovery_minor::text r, run_key FROM labour_wage_payouts WHERE id=$1`, [ln.payout_id])).rows[0];
      expect(po).toMatchObject({ b: '42000', r: '10500' });
      const wLegs = await legsOf(`wage:${bk.a.Jashu}:${String(po.run_key).trim()}`);
      expect(wLegs.map((l) => [l.owner_user_id, l.account_code, l.amt])).toEqual([[lw.employer, 'hold', '-31500'], [lw.w.Jashu.user, 'main', '31500']]);
      expect(wLegs.reduce((s, l) => s + BigInt(l.amt), 0n)).toBe(0n);                // zero-sum
      expect(hold2 - await balUser(lw.employer, 'hold')).toBe(31500n);              // the Hold releases only gross − recovery
      expect(await balUser(lw.w.Jashu.user) - j2).toBe(31500n);
      expect((await admin.query(`SELECT status, recovered_minor::text r FROM worker_advances WHERE id=$1`, [req.id])).rows[0]).toEqual({ status: 'recovering', r: '10500' });
      expect((await admin.query(`SELECT amount_minor::text a FROM worker_advance_recoveries WHERE advance_id=$1 AND payout_id=$2`, [req.id, ln.payout_id])).rows[0].a).toBe('10500');
      // the booking's escrow, as the leg table says: held = expected − paid − advanced (no top-up yet)
      const esc = (await admin.query(`SELECT expected_minor::text e, paid_minor::text p, advanced_minor::text a, topped_up_minor::text t FROM labour_escrows WHERE booking_id=$1`, [bk.bookingId])).rows[0];
      expect(esc).toEqual({ e: '252000', p: String(84000 + 31500), a: '40000', t: '0' });
      // a payout can never record more than 25 % recovered — the CHECK
      expect(await sqlState(admin.query(`UPDATE labour_wage_payouts SET advance_recovery_minor = base_minor WHERE id=$1`, [ln.payout_id]))).not.toBe('ok');
      const list: any = await advances.list(lw.tenantId, lw.deskActor, { status: 'outstanding', limit: 10 });
      expect(list.totals).toMatchObject({ outstandingMinor: '29500', workers: 1, advances: 1 });
    }, 60_000);

    it('C3 · a failed line RETRIES at 16:00 IST the next day and is paid; a line that keeps failing is named `failed` after the ladder (1 retry/day × 3)', async () => {
      const lw2 = await labourWorld(randomUUID(), ['Rekha', 'Gita']);
      const okB = await startedBooking(lw2, ['Rekha']);
      // a SECOND employer whose Hold we freeze to make its booking's pay transaction fail
      const lw3emp = await makeUser(admin); await role(lw3emp, lw2.tenantId, 'farmer'); await fundUser(lw2.tenantId, lw3emp, 5_000_000n);
      const emp3: LabourActor = { userId: lw3emp, canBook: true, canDesk: false, canApproveWages: false, canManage: false };
      const b3 = await svc.create(lw2.tenantId, emp3, key(), bookingDto({ workersNeeded: 1 }));
      const a3 = await svc.assign(lw2.tenantId, emp3, b3.id, key(), { workerId: lw2.w.Gita.id }); await svc.respond(lw2.tenantId, lw2.w.Gita.user, a3.id, { decision: 'accept' });
      await svc.confirmRoster(lw2.tenantId, emp3, b3.id, key(), {}); await svc.start(lw2.tenantId, emp3, b3.id);
      await clockedOutDay(lw2.tenantId, okB.a.Rekha, D1); await attendance.confirmDay(lw2.tenantId, { userId: lw2.employer, canManage: false }, okB.a.Rekha, D1, key(), null);
      await clockedOutDay(lw2.tenantId, a3.id, D1); await attendance.confirmDay(lw2.tenantId, { userId: lw3emp, canManage: false }, a3.id, D1, key(), null);
      await admin.query(`UPDATE wallet_accounts SET is_frozen=true WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [lw3emp]);
      const R0 = plus(70);
      expect(await wageJob.sweep(relayPool, isoUtc(R0, 18, 5), [lw2.tenantId])).toMatchObject({ runs: 1, failed: 0 });
      const run0 = (await admin.query(`SELECT id, status FROM labour_wage_runs WHERE tenant_id=$1 AND run_date=$2::date`, [lw2.tenantId, R0])).rows[0];
      expect(run0.status).toBe('partially_paid');                                    // Rekha paid; Gita's booking failed
      const gl = (await admin.query(`SELECT id, status, attempts, next_retry_at, last_error FROM labour_wage_run_lines WHERE run_id=$1 AND assignment_id=$2`, [run0.id, a3.id])).rows[0];
      expect(gl).toMatchObject({ status: 'retrying', attempts: 1, last_error: 'WALLET_FROZEN' });
      expect(new Date(gl.next_retry_at).toISOString()).toBe(istAt(addIstDays(R0, 1), 16).toISOString());   // 16:00 IST the next day
      expect((await admin.query(`SELECT status FROM labour_wage_run_lines WHERE run_id=$1 AND assignment_id=$2`, [run0.id, okB.a.Rekha])).rows[0].status).toBe('paid');
      // the next day's 18:00 run does NOT re-run the laddered booking; before 16:00 the retry does not fire
      expect((await wages.retryDue(lw2.tenantId, isoUtc(addIstDays(R0, 1), 15, 30))).retried).toBe(0);
      // day 2 at 16:05 IST, still frozen: retry 1 fails (attempt 2) → retrying, next day
      expect(await wages.retryDue(lw2.tenantId, isoUtc(addIstDays(R0, 1), 16, 5))).toMatchObject({ retried: 1, paid: 0, stillRetrying: 1 });
      // unfrozen: day 3 at 16:05 IST the retry pays
      await admin.query(`UPDATE wallet_accounts SET is_frozen=false WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [lw3emp]);
      const gBefore = await balUser(lw2.w.Gita.user);
      expect(await wages.retryDue(lw2.tenantId, isoUtc(addIstDays(R0, 2), 16, 5))).toMatchObject({ retried: 1, paid: 1 });
      expect(await balUser(lw2.w.Gita.user) - gBefore).toBe(42000n);
      expect((await admin.query(`SELECT status, attempts, next_retry_at FROM labour_wage_run_lines WHERE id=$1`, [gl.id])).rows[0]).toEqual({ status: 'paid', attempts: 3, next_retry_at: null });
      expect((await admin.query(`SELECT status FROM labour_wage_runs WHERE id=$1`, [run0.id])).rows[0].status).toBe('paid');

      // the ladder: a booking that keeps failing is named failed after the 3rd retry (4 attempts)
      await clockedOutDay(lw2.tenantId, a3.id, D2); await attendance.confirmDay(lw2.tenantId, { userId: lw3emp, canManage: false }, a3.id, D2, key(), null);
      await admin.query(`UPDATE wallet_accounts SET is_frozen=true WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [lw3emp]);
      const R1 = plus(80);
      await wageJob.sweep(relayPool, isoUtc(R1, 18, 5), [lw2.tenantId]);
      const run1 = (await admin.query(`SELECT id FROM labour_wage_runs WHERE tenant_id=$1 AND run_date=$2::date`, [lw2.tenantId, R1])).rows[0];
      for (let d = 1; d <= 3; d++) await wages.retryDue(lw2.tenantId, isoUtc(addIstDays(R1, d), 16, 5));
      const failed = (await admin.query(`SELECT status, attempts, last_error, next_retry_at FROM labour_wage_run_lines WHERE run_id=$1 AND assignment_id=$2`, [run1.id, a3.id])).rows[0];
      expect(failed).toMatchObject({ status: 'failed', attempts: 4, next_retry_at: null });
      expect(failed.last_error).toMatch(/^RETRY_LADDER_EXHAUSTED:WALLET_FROZEN/);
      expect((await admin.query(`SELECT status FROM labour_wage_runs WHERE id=$1`, [run1.id])).rows[0].status).toBe('failed');
      await admin.query(`UPDATE wallet_accounts SET is_frozen=false WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='hold'`, [lw3emp]);
    }, 120_000);

    it('C4 · the manual 11b pay act stays an exception and is listed as "manual" (wage_run_id NULL, paid_by the person)', async () => {
      await clockedOutDay(lw.tenantId, bk.a.Hansa, D3); await attendance.confirmDay(lw.tenantId, { userId: lw.employer, canManage: false }, bk.a.Hansa, D3, key(), null);
      const pay: any = await svc.payWages(lw.tenantId, lw.emp, bk.bookingId, key(), null, 'paid at the farm gate');
      expect(pay.movedMinor).toBe('42000');
      const today = await wages.today(lw.tenantId, lw.deskActor);
      const m = today.manual.find((x) => x.bookingId === bk.bookingId);
      expect(m).toMatchObject({ grossMinor: '42000', netMinor: '42000', paidBy: lw.employer });
      expect((await admin.query(`SELECT count(*)::int n FROM labour_wage_payouts WHERE id=$1 AND wage_run_id IS NULL`, [m!.id])).rows[0].n).toBe(1);
    });
  });

  /* ═════════════════════════════════════════ D · SCHEMES ═════════════════════════════════════════ */
  describe('D · schemes: the registry is admin-api\'s; the sweep is a call list; the desk reads its figures', () => {
    const T = randomUUID(); let deskUser = ''; let schemeId = ''; let code = '';
    const m: Record<string, string> = {};
    beforeAll(async () => {
      await makeTenant(admin, T, 'Schemes');
      deskUser = await makeUser(admin); await role(deskUser, T, 'fpo_coordinator');
      const authorityId = randomUUID();
      await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1,'Test Dept','state')`, [authorityId]);
      const cat = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='scheme_category' AND tenant_id IS NULL LIMIT 1`)).rows[0]?.id
        ?? (await admin.query(`INSERT INTO lookup_values (type_code, code, default_name) VALUES ('scheme_category','swb_test','SWB') RETURNING id`)).rows[0].id;
      schemeId = randomUUID(); code = `swb_${schemeId.slice(0, 8)}`;
      await admin.query(`INSERT INTO schemes (id, code, default_name, authority_id, category_id, benefit_summary, eligibility_rules) VALUES ($1,$2,'SWB Test Scheme',$3,$4,'{"type":"dbt_annual"}','{"roles":["farmer"],"landholding_max_acres":5}')`,
        [schemeId, code, authorityId, cat]);
      for (const [n, r, acres, unit] of [['small', 'farmer', '3', 'acre'], ['big', 'farmer', '10', 'acre'], ['applied', 'farmer', '1', 'hectare'], ['buyer', 'customer', null, null]] as const) {
        const u = await makeUser(admin); m[n] = u; await role(u, T, r);
        await admin.query(`UPDATE users SET full_name=$2 WHERE id=$1`, [u, `${n} Bhai Patel`]);
        if (acres) await admin.query(`INSERT INTO land_parcels (tenant_id, owner_user_id, area_value, area_unit) VALUES ($1,$2,$3,$4)`, [T, u, acres, unit]);
      }
      await admin.query(`INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, form_data, rejection_reason_code, decided_at, updated_at)
        VALUES ($1,$2,1,$3,'rejected','{"aadhaar_last4":"4471","bank_ifsc":"SBIN0001234"}','aadhaar_seeding_mismatch', now(), now() - interval '9 days')`, [T, schemeId, m.applied]);
    });

    it('D1 · F-8: kv_app (and kv_relay) cannot INSERT or UPDATE `schemes` / `scheme_versions` / `scheme_authorities`; SELECT still works', async () => {
      expect(await asKvApp(T, (c) => sqlState(c.query(`INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules) SELECT 'x'||gen_random_uuid(), 'x', authority_id, category_id, '{}', '{}' FROM schemes LIMIT 1`)))).toBe('42501');
      expect(await asKvApp(T, (c) => sqlState(c.query(`UPDATE schemes SET processing_fee_minor = 0 WHERE id=$1`, [schemeId])))).toBe('42501');
      expect(await asKvApp(T, (c) => sqlState(c.query(`INSERT INTO scheme_authorities (default_name, level) VALUES ('x','state')`)))).toBe('42501');
      expect(await asKvApp(T, async (c) => (await c.query(`SELECT count(*)::int n FROM schemes WHERE id=$1`, [schemeId])).rows[0].n)).toBe(1);
      for (const [t, p] of [['schemes', 'INSERT'], ['schemes', 'UPDATE'], ['scheme_versions', 'INSERT'], ['scheme_authorities', 'UPDATE']]) {
        for (const r of ['kv_app', 'kv_relay']) expect(`${r}:${t}:${p}:${(await admin.query(`SELECT has_table_privilege($1,$2,$3) v`, [r, t, p])).rows[0].v}`).toBe(`${r}:${t}:${p}:false`);
      }
    });

    it('D2 · "Run eligibility sweep": a keyed act, once per scheme per day; the job (kv_relay pool) evaluates every member through the per-person evaluator → a CALL LIST — and NO application', async () => {
      const dsk = { userId: deskUser, canDesk: true };
      const appsBefore = (await admin.query(`SELECT count(*)::int n FROM scheme_applications WHERE tenant_id=$1`, [T])).rows[0].n;
      const q: any = await desk.requestSweep(T, dsk, { schemeCode: code, reason: 'camp call list' }, key(), null);
      expect(q).toMatchObject({ status: 'queued', schemeId });
      await expect(desk.requestSweep(T, dsk, { schemeCode: code, reason: 'again today' }, key(), null)).rejects.toMatchObject({ code: 'SWEEP_ALREADY_RUN_TODAY' });
      expect(await sweepJob.sweep(relayPool, new Date(), [T])).toMatchObject({ sweeps: 1, failed: 0 });
      const sw = (await admin.query(`SELECT status, members_evaluated, eligible_count, eligible_not_applied FROM scheme_eligibility_sweeps WHERE id=$1`, [q.id])).rows[0];
      expect(sw).toEqual({ status: 'done', members_evaluated: 5, eligible_count: 2, eligible_not_applied: 1 });   // 4 members + the desk user (fpo_coordinator)
      const view: any = await desk.sweepView(T, dsk, q.id, { limit: 50 });
      expect(view.output).toBe('call_list_only'); expect(view.autoApply).toEqual({ built: false, reason: 'canon_human_asks_first' });
      expect(view.items.map((x: any) => x.userId)).toEqual([m.small]);              // eligible AND not applied — the call list
      expect(view.items[0].phoneMasked).toMatch(/^\+91 \d{2}••• ••\d{3}$/);
      const all: any = await desk.sweepView(T, dsk, q.id, { limit: 50, all: true });
      const big = all.items.find((x: any) => x.userId === m.big);
      expect(big).toMatchObject({ eligible: false }); expect(big.reasons.join(' ')).toMatch(/landholding 10 exceeds max 5/);
      expect(all.items.find((x: any) => x.userId === m.applied)).toMatchObject({ eligible: true, alreadyApplied: true });   // 1 ha = 2.47 acres
      expect((await admin.query(`SELECT count(*)::int n FROM scheme_applications WHERE tenant_id=$1`, [T])).rows[0].n).toBe(appsBefore);   // NO application created
      const s: any = await desk.summary(T, dsk);
      expect(s.eligibleNotApplied).toMatchObject({ count: 1 });
      // µs paging over the call list (all rows, page size 1)
      const p1: any = await desk.sweepView(T, dsk, q.id, { limit: 1, all: true });
      const p2: any = await desk.sweepView(T, dsk, q.id, { limit: 1, all: true, cursor: p1.nextCursor });
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
    }, 60_000);

    it('D3 · the desk\'s figures are READ: benefits landed (FY) = credited transfers minus open bounces, with its method; "no transfers recorded" before any; the rejection rate', async () => {
      const dsk = { userId: deskUser, canDesk: true };
      const before: any = await desk.summary(T, dsk);
      expect(before.benefitsLandedFy).toMatchObject({ minor: null, reason: 'no_transfers_recorded' });
      expect(before.rejectionRateFy).toMatchObject({ rejected: 1, decided: 1, ratePct: 100 });
      const app2 = (await admin.query(`INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, decided_at) VALUES ($1,$2,1,$3,'disbursed', now()) RETURNING id`, [T, schemeId, m.small])).rows[0].id;
      const t1 = (await admin.query(`INSERT INTO dbt_transfers (tenant_id, application_id, user_id, scheme_id, amount_minor, credited_on) VALUES ($1,$2,$3,$4,600000,(now() AT TIME ZONE 'Asia/Kolkata')::date) RETURNING id, created_at::text AS created_at`, [T, app2, m.small, schemeId])).rows[0];
      const t2 = (await admin.query(`INSERT INTO dbt_transfers (tenant_id, application_id, user_id, scheme_id, amount_minor, credited_on) VALUES ($1,$2,$3,$4,100000,(now() AT TIME ZONE 'Asia/Kolkata')::date) RETURNING id, created_at::text AS created_at`, [T, app2, m.small, schemeId])).rows[0];
      await admin.query(`INSERT INTO dbt_bounces (tenant_id, transfer_id, transfer_created_at, application_id, scheme_id, user_id, amount_minor, reason_code, bounced_on) VALUES ($1,$2,$3,$4,$5,$6,100000,'aadhaar_not_seeded',(now() AT TIME ZONE 'Asia/Kolkata')::date)`,
        [T, t2.id, t2.created_at, app2, schemeId, m.small]);
      void t1;
      const after: any = await desk.summary(T, dsk);
      expect(after.benefitsLandedFy).toMatchObject({ minor: '600000', transfers: 2, members: 1 });
      expect(after.benefitsLandedFy.method).toMatch(/dbt_transfers/);
      expect(after.rejectionRateFy).toMatchObject({ rejected: 1, decided: 2, ratePct: 50 });
      expect(after.campWorklist).toEqual({ built: false, reason: 'no_camp_object' });
    });

    it('D4 · the pipeline: real tab counts; masked applicant; the derived blocker; the rejection paired with its translated FIX; the form is masked until a per-field reveal (reason ≥ 20, audited)', async () => {
      const dsk = { userId: deskUser, canDesk: true };
      const p: any = await desk.pipeline(T, dsk, code, { group: 'rejected_appealed', limit: 50 });
      expect(p.counts).toMatchObject({ rejected_appealed: 1, approved_disbursed_fy: 1, under_verification: 0 });
      const row = p.items[0];
      expect(row).toMatchObject({ status: 'rejected', blocker: { code: 'rejected', reasonCode: 'aadhaar_seeding_mismatch' }, selfFiled: true, formFields: ['aadhaar_last4', 'bank_ifsc'] });
      expect(row.waitingDays).toBeGreaterThanOrEqual(9);
      expect(row.rejection.fix).toMatchObject({ en: expect.stringMatching(/Aadhaar seeding/), hi: expect.any(String), gu: expect.any(String) });
      expect(JSON.stringify(p)).not.toContain('SBIN0001234');                         // the form's values never cross unrevealed
      expect(p.tabsAreFilters.canonDefect).toBe('F-22');
      await expect(desk.reveal(T, dsk, row.id, { field: 'bank_ifsc', reason: 'too short' }, null)).rejects.toMatchObject({ code: 'REVEAL_REASON_REQUIRED' });
      const v: any = await desk.reveal(T, dsk, row.id, { field: 'bank_ifsc', reason: 'member asked us to fix the bank seeding at the branch' }, '10.3.3.3');
      expect(v).toEqual({ applicationId: row.id, field: 'bank_ifsc', value: 'SBIN0001234' });
      const a = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action='schemes.form_data.revealed' AND entity_id=$1`, [row.id])).rows;
      expect(a).toHaveLength(1); expect(a[0].new_value).toEqual({ field: 'bank_ifsc' });   // the FIELD is recorded, never the value
      await expect(desk.pipeline(T, { userId: deskUser, canDesk: false }, code, { group: 'draft', limit: 5 })).rejects.toMatchObject({ code: 'SCHEMES_FORBIDDEN' });
    });
  });
});
