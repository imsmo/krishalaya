// modules/labour/__tests__/tenant11b-labour-domain.spec.ts · PC-56 TENANT-11b — the pure rules the live spec proves end to end:
// the wage (A2), the escrow estimate + fee (A3), the idempotency keys (A2/A4), the µs row match (A1), the India work day,
// the roster mask (A8), the per-tenant job claim (A5) and the state machine's 7 reachable statuses.
import { computeWage, divRoundHalfUp, escrowEstimate, escrowKey, escrowLegs, feeFor, heldMinor, hundredths, plannedDays, releaseKey, runKeyOf, topupKey, wageKey, wageOtKey } from '../domain/labour-money';
import { indiaDay, maskPhone, shortName, cleanReason } from '../domain/display';
import { BOOKING_STATUSES, UNREACHABLE_BOOKING_STATUSES, acceptsPayRun, canTransition } from '../domain/labour-booking.state';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { BookingRespondTimeoutJob } from '../jobs/booking-respond-timeout.job';
import { CreateBookingSchema } from '../dto/create-labour-booking.dto';
import { CancelBookingSchema, EmployerConsentSchema, OptionalBookingActSchema } from '../dto/labour-act.dto';

const fakeReplica = () => { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; };

describe('A2 · THE WAGE — confirmed attendance × rate', () => {
  const day = (id: string, reg = '8.00', ot = '0.00') => ({ id, hoursRegular: reg, hoursOvertime: ot });
  it('per_day: 3 confirmed days × ₹420 = ₹1,260; a no-show is ₹0 and says why', () => {
    const w = computeWage({ kind: 'per_day', rateMinor: 42000n, dailyHours: 8, overtimeMultiplier: 1.5, days: [day('a'), day('b'), day('c')], bookingCompleted: false, taskPaidBefore: false });
    expect(w.baseMinor).toBe(126000n); expect(w.otMinor).toBe(0n); expect(w.daysConfirmed).toBe(3);
    const none = computeWage({ kind: 'per_day', rateMinor: 42000n, dailyHours: 8, overtimeMultiplier: 1.5, days: [], bookingCompleted: false, taskPaidBefore: false });
    expect(none.baseMinor).toBe(0n); expect(none.zeroReason).toBe('no_confirmed_attendance');
  });
  it('per_day overtime = OT hours × (rate ÷ daily hours) × multiplier — 2h on ₹420 / 8h × 1.5 = ₹157.50', () => {
    const w = computeWage({ kind: 'per_day', rateMinor: 42000n, dailyHours: 8, overtimeMultiplier: '1.50', days: [day('a', '8.00', '2.00')], bookingCompleted: false, taskPaidBefore: false });
    expect(w.baseMinor).toBe(42000n); expect(w.otMinor).toBe(15750n); expect(w.otStatus).toBe('due');
  });
  it('per_hour: regular hours × rate + OT hours × rate × multiplier', () => {
    const w = computeWage({ kind: 'per_hour', rateMinor: 5000n, dailyHours: 8, overtimeMultiplier: 1.5, days: [day('a', '7.50', '1.25')], bookingCompleted: false, taskPaidBefore: false });
    expect(w.baseMinor).toBe(37500n); expect(w.otMinor).toBe(9375n);
  });
  it('per_task: the rate ONCE on completion; deferred before; never twice; OT not priced (said)', () => {
    const args = { kind: 'per_task' as const, rateMinor: 484000n, dailyHours: 8, overtimeMultiplier: 1.5, days: [day('a', '8.00', '1.00')] };
    expect(computeWage({ ...args, bookingCompleted: false, taskPaidBefore: false }).deferred).toBe(true);
    const once = computeWage({ ...args, bookingCompleted: true, taskPaidBefore: false });
    expect(once.baseMinor).toBe(484000n); expect(once.otStatus).toBe('not_priced');
    const twice = computeWage({ ...args, bookingCompleted: true, taskPaidBefore: true });
    expect(twice.baseMinor).toBe(0n); expect(twice.zeroReason).toBe('task_paid_once');
  });
  it('money is integer: hours as hundredths, half-up once per amount', () => {
    expect(hundredths('8.00')).toBe(800n); expect(hundredths('1.5')).toBe(150n); expect(hundredths(7.25)).toBe(725n); expect(hundredths(null)).toBe(0n);
    expect(divRoundHalfUp(5n, 2n)).toBe(3n); expect(divRoundHalfUp(4n, 2n)).toBe(2n);
  });
});

describe('A3 · THE ESCROW — workers × days × rate + the ₹20 fee', () => {
  const fee = { id: 'f', kind: 'flat_per_booking' as const, amountMinor: 2000n, capMinor: null, capRuleNote: 'not set' };
  it('canon W164: 12 workers × 3 days × ₹420 = ₹15,120 + ₹20 = ₹15,140', () => {
    const e = escrowEstimate({ kind: 'per_day', startDate: '2026-07-14', endDate: '2026-07-16', dailyHours: 8, rates: Array(12).fill(42000n), fee });
    expect(e.days).toBe(3); expect(e.wagesMinor).toBe(1512000n); expect(e.feeMinor).toBe(2000n); expect(e.totalMinor).toBe(1514000n);
  });
  it('per_hour plans days × daily hours; per_task plans one unit', () => {
    expect(escrowEstimate({ kind: 'per_hour', startDate: '2026-07-14', endDate: '2026-07-15', dailyHours: 7.5, rates: [5000n], fee: null }).wagesMinor).toBe(75000n);
    expect(escrowEstimate({ kind: 'per_task', startDate: '2026-07-14', endDate: '2026-07-20', dailyHours: 8, rates: [484000n], fee: null }).wagesMinor).toBe(484000n);
  });
  it('the cap is NOT SET today (null) — a cap, when set, bounds the fee', () => {
    expect(feeFor(fee)).toBe(2000n); expect(feeFor({ ...fee, capMinor: 1000n })).toBe(1000n); expect(feeFor(null)).toBe(0n);
  });
  it('legs balance: Main −(w+fee) → Hold +w, Fees +fee', () => {
    const legs = escrowLegs('emp', 126000n, 2000n);
    expect(legs.reduce((s, l) => s + l.amountMinor, 0n)).toBe(0n);
    expect(legs.map((l) => l.account.accountCode)).toEqual(['main', 'hold', 'fees']);
  });
  it('planned days are inclusive and time-zone free', () => { expect(plannedDays('2026-07-14', '2026-07-14')).toBe(1); expect(plannedDays('2026-02-27', '2026-03-01')).toBe(3); });
  it('held = expected + topped up − paid − released', () => { expect(heldMinor({ expectedMinor: 100n, toppedUpMinor: 20n, paidMinor: 90n, releasedMinor: 0n })).toBe(30n); });
});

describe('A2 / A4 · THE KEYS', () => {
  it('the run key covers exactly the days it pays (order-free); a later day is a new key', () => {
    expect(runKeyOf(['b', 'a'])).toBe(runKeyOf(['a', 'b']));
    expect(runKeyOf(['a', 'b'])).not.toBe(runKeyOf(['a', 'b', 'c']));
    expect(runKeyOf(['a'])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the brief\'s key shapes', () => {
    expect(escrowKey('B')).toBe('labour-escrow:B'); expect(topupKey('B', 2)).toBe('labour-escrow-topup:B:2'); expect(releaseKey('B')).toBe('labour-escrow-release:B');
    expect(wageKey('A', 'k')).toBe('wage:A:k'); expect(wageOtKey('A', 'k')).toBe('wage-ot:A:k');
  });
});

describe('A1 · THE ATTENDANCE ROW IS MATCHED ON ITS µs TEXT', () => {
  it('clock-out and confirm bind created_at as text → ::timestamptz, never a JS Date', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const repo = new AttendanceRepository(fakeReplica().provider);
    await repo.updateClockOut(tx as any, { id: 'r', createdAtRaw: '2026-10-02 10:55:22.473406+00', tenantId: 't', clockOutAt: new Date(), breakMinutes: 0, hoursRegular: 8, hoursOvertime: 0 });
    await repo.updateConfirm(tx as any, { id: 'r', createdAtRaw: '2026-10-02 10:55:22.473406+00', tenantId: 't' });
    for (const [sql, params] of tx.query.mock.calls) { expect(sql).toMatch(/created_at=\$2::timestamptz/); expect(params[1]).toBe('2026-10-02 10:55:22.473406+00'); }
  });
  it('the day read selects created_at::text', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AttendanceRepository(fakeReplica().provider).getDay(tx as any, 't', 'a', '2026-10-02');
    expect(tx.query.mock.calls[0][0]).toMatch(/created_at::text AS created_at_raw/);
  });
  it('the work date is the India day: 05:00 IST on 13 Jul is 13 Jul, not 12 Jul', () => {
    expect(indiaDay(new Date('2026-07-12T23:30:00Z'))).toBe('2026-07-13');
    expect(indiaDay(new Date('2026-07-13T18:29:00Z'))).toBe('2026-07-13');
  });
});

describe('A8 · THE ROSTER NAMES A WORKER SHORTLY AND MASKS THE PHONE', () => {
  it('short name + 1b mask', () => {
    expect(shortName('Hansa Ben Vaghela')).toBe('Hansa V.'); expect(shortName('  ')).toBeNull();
    expect(maskPhone('+919012345412')).toBe('+91 90••• ••412');
  });
  it('reasons are 3–300 characters', () => { expect(cleanReason('ok')).toBeNull(); expect(cleanReason('rain forecast')).toBe('rain forecast'); });
});

describe('A5 · THE RESPOND-TIMEOUT JOB CLAIMS PER TENANT AS kv_app', () => {
  it('reads only `tenants` with the kv_relay pool; claims and acts inside the unit of work', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 't1' }, { id: 't2' }] }) };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: any) => Promise<unknown>) => fn({ query: jest.fn().mockResolvedValue({ rows: [{ id: 'b1' }] }) })) };
    const repo = new LabourBookingRepository(fakeReplica().provider);
    const svc = { expireBooking: jest.fn().mockResolvedValue(true) };
    const job = new BookingRespondTimeoutJob(60_000, uow as any, repo, svc as any);
    const r = await job.sweep(pool as any, new Date());
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/FROM tenants/); expect(pool.query.mock.calls[0][0]).not.toMatch(/labour_bookings/);
    expect(uow.run).toHaveBeenCalledTimes(2); expect(svc.expireBooking).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ tenants: 2, claimed: 2, expired: 2, failed: 0 });
    expect(job.name).toBe('labour-booking-respond-timeout');
  });
});

describe('the state machine — 7 of 12 reachable', () => {
  it('names the reachable and the unreachable statuses', () => {
    expect([...BOOKING_STATUSES]).toEqual(['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled', 'expired']);
    expect([...UNREACHABLE_BOOKING_STATUSES]).toEqual(['draft', 'pending_worker', 'rejected', 'disputed', 'no_show']);
    expect(canTransition('open', 'in_progress')).toBe(false); expect(acceptsPayRun('open')).toBe(false); expect(acceptsPayRun('in_progress')).toBe(true);
  });
});

describe('DTOs', () => {
  const base = { demandTypeCode: 'daily_multi', taskSkillId: '0190a000-0000-7000-8000-000000000001', regionId: '11111111-0000-7000-8000-000000000001', skillLevel: 'unskilled',
    workersNeeded: 2, startDate: '2026-07-14', endDate: '2026-07-16', wageOfferedMinor: '42000', farmLat: 22.3, farmLng: 71.1 };
  it('declarations are writable; a pickup time needs a point; a point needs transport', () => {
    expect(CreateBookingSchema.safeParse({ ...base, transportProvided: true, transportPickupPoint: 'Vanthali chowk', transportPickupTime: '06:30', toiletConfirmed: true, drinkingWater: true, womanSupervisor: true }).success).toBe(true);
    expect(CreateBookingSchema.safeParse({ ...base, transportProvided: true, transportPickupTime: '06:30' }).success).toBe(false);
    expect(CreateBookingSchema.safeParse({ ...base, transportPickupPoint: 'Vanthali chowk' }).success).toBe(false);
  });
  it('a voice / written consent needs its evidence; otp does not', () => {
    expect(EmployerConsentSchema.safeParse({ channel: 'otp' }).success).toBe(true);
    expect(EmployerConsentSchema.safeParse({ channel: 'voice' }).success).toBe(false);
  });
  it('cancel takes a reason code; an absent act body is the empty act', () => {
    expect(CancelBookingSchema.safeParse({ reasonCode: 'rain_reschedule' }).success).toBe(true);
    expect(CancelBookingSchema.safeParse({}).success).toBe(false);
    expect(OptionalBookingActSchema.safeParse(undefined).success).toBe(true);
  });
});
