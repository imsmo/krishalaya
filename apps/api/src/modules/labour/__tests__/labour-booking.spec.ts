// modules/labour/__tests__/labour-booking.spec.ts · pure-domain unit tests: the booking + assignment state
// machines (Law 5), THE DIGNITY FLOOR invariant in the LabourBooking aggregate, the minimum-wage value
// object, and the wage-settlement transition (completed → paid). No infra — UoW/outbox/wallet/authz are
// covered by the integration spec; here we pin the dignity + lifecycle invariants.
import { canTransition as bCan, assertTransition as bAssert, isTerminal, acceptsAssignments, BOOKING_STATUSES, BookingStatus, IllegalBookingTransitionError } from '../domain/labour-booking.state';
import { canTransition as aCan, ASSIGNMENT_STATUSES, AssignmentStatus, IllegalAssignmentTransitionError } from '../domain/booking-assignment.state';
import { LabourBooking } from '../domain/labour-booking.entity';
import { BookingAssignment } from '../domain/booking-assignment.entity';
import { WorkerProfile } from '../domain/worker-profile.entity';
import { MinimumWage } from '../domain/minimum-wage.entity';
import { LabourEventType } from '../domain/labour.events';
import { WageBelowMinimumError, WorkerNotAgeVerifiedError, BookingNotPayableError } from '../domain/labour.errors';

const post = (over: any = {}) => LabourBooking.post({
  id: 'b1', tenantId: 't1', bookingNo: 'LB-X', employerUserId: 'emp1', demandTypeId: 'd1', taskSkillId: 's1',
  workersNeeded: 2, startDate: '2026-07-01', endDate: '2026-07-03', dailyHours: 8, wageKind: 'per_day',
  wageOfferedMinor: 50000n, minWageMinor: 38000n, currencyCode: 'INR', overtimeRateMultiplier: 1.5,
  womenOnly: false, farmLat: 22.3, farmLng: 71.1, respondBy: null, ...over,
});

describe('booking.state machine', () => {
  it('allows documented transitions, forbids illegal ones', () => {
    // PC-56 TENANT-11b: a job starts only once the roster is confirmed and the wages are escrowed (open → accepted → in_progress).
    expect(bCan('open', 'in_progress')).toBe(false);
    expect(bCan('open', 'accepted')).toBe(true);
    expect(bCan('accepted', 'in_progress')).toBe(true);
    expect(bCan('accepted', 'cancelled')).toBe(true);
    expect(bCan('in_progress', 'completed')).toBe(true);
    expect(bCan('completed', 'paid')).toBe(true);
    expect(bCan('open', 'paid')).toBe(false);
    expect(bCan('paid', 'completed')).toBe(false);
    expect(acceptsAssignments('open')).toBe(true); expect(acceptsAssignments('in_progress')).toBe(false);
    expect(isTerminal('paid')).toBe(true); expect(isTerminal('cancelled')).toBe(true); expect(isTerminal('open')).toBe(false);
  });
  it('covers every status without throwing', () => { for (const s of BOOKING_STATUSES) expect(() => bCan(s, 'cancelled' as BookingStatus)).not.toThrow(); });
  it('assertTransition throws a typed 409 on an illegal move', () => {
    expect(() => bAssert('paid', 'open')).toThrow(IllegalBookingTransitionError);
    expect(new IllegalBookingTransitionError('paid', 'open').code).toBe('BOOKING_ILLEGAL_TRANSITION');
  });
});

describe('assignment.state machine', () => {
  it('pending → accepted/rejected/expired; accepted → paid only', () => {
    expect(aCan('pending_worker', 'accepted')).toBe(true);
    expect(aCan('pending_worker', 'rejected')).toBe(true);
    expect(aCan('accepted', 'paid')).toBe(true);
    expect(aCan('rejected', 'accepted')).toBe(false);
    expect(aCan('pending_worker', 'paid')).toBe(false);
  });
  it('covers every status', () => { for (const s of ASSIGNMENT_STATUSES) expect(() => aCan(s, 'expired' as AssignmentStatus)).not.toThrow(); });
});

describe('LabourBooking.post — THE DIGNITY FLOOR', () => {
  it('rejects an offer below the statutory minimum (422)', () => {
    expect(() => post({ wageOfferedMinor: 37999n, minWageMinor: 38000n })).toThrow(WageBelowMinimumError);
  });
  it('rejects a zero/negative offer', () => { expect(() => post({ wageOfferedMinor: 0n })).toThrow(WageBelowMinimumError); });
  it('accepts an offer AT the floor and emits booking_posted', () => {
    const b = post({ wageOfferedMinor: 38000n, minWageMinor: 38000n });
    expect(b.status).toBe('open');
    expect(b.pullEvents().map((e) => e.type)).toContain(LabourEventType.BookingPosted);
  });
});

describe('booking lifecycle + wage settlement', () => {
  it('open → accepted (roster confirmed) → in_progress → completed → paid, emitting the right events', () => {
    const b = post(); b.pullEvents();
    expect(() => b.start()).toThrow();
    b.confirmRoster(new Date(), 'emp1', { escrowedMinor: '300000' }); expect(b.status).toBe('accepted');
    expect(b.toProps().rosterConfirmedBy).toBe('emp1');
    b.start(); expect(b.status).toBe('in_progress');
    b.complete(); expect(b.status).toBe('completed');
    b.markPaid(100000n, 2); expect(b.status).toBe('paid');
    expect(b.pullEvents().map((e) => e.type)).toEqual([LabourEventType.RosterConfirmed, LabourEventType.BookingStarted, LabourEventType.BookingCompleted, LabourEventType.WagesPaid]);
  });
  it('refuses to pay a booking that is not completed', () => {
    const b = post(); expect(() => b.markPaid(1n, 1)).toThrow(BookingNotPayableError);
  });
  it('bumps no money concept — wage is bigint minor units throughout', () => {
    const b = post({ wageOfferedMinor: 42000n, minWageMinor: 38000n });
    expect(typeof b.wageOfferedMinor).toBe('bigint'); expect(b.wageOfferedMinor).toBe(42000n);
  });
});

describe('BookingAssignment', () => {
  it('accept records consent + timestamp; only accepted → paid', () => {
    const a = BookingAssignment.create({ id: 'a1', bookingId: 'b1', tenantId: 't1', workerId: 'w1', wageMinor: 50000n });
    a.pullEvents();
    a.accept(new Date('2026-06-20T00:00:00Z'), 'media1');
    expect(a.status).toBe('accepted'); expect(a.toProps().acceptedAt).toBeInstanceOf(Date); expect(a.toProps().voiceConsentMediaId).toBe('media1');
    a.markPaid(); expect(a.status).toBe('paid');
  });
  it('reject is terminal (cannot then accept)', () => {
    const a = BookingAssignment.create({ id: 'a1', bookingId: 'b1', tenantId: 't1', workerId: 'w1', wageMinor: 50000n });
    a.reject(); expect(() => a.accept(new Date())).toThrow(IllegalAssignmentTransitionError);
  });
});

describe('WorkerProfile age gate', () => {
  it('assertAssignable throws until age-verified (HARD rule)', () => {
    const w = WorkerProfile.register({ id: 'w1', userId: 'u1', tenantId: 't1', onboardedBy: 'u1' });
    expect(() => w.assertAssignable()).toThrow(WorkerNotAgeVerifiedError);
    const verified = WorkerProfile.rehydrate({ ...w.toProps(), ageVerified18: true });
    expect(() => verified.assertAssignable()).not.toThrow();
  });
});

describe('MinimumWage value object', () => {
  it('floorFor uses hourly for per_hour, daily otherwise', () => {
    const mw = MinimumWage.rehydrate({ id: 'm1', regionId: 'r1', skillLevel: 'unskilled', dailyWageMinor: 38000n, hourlyWageMinor: 4750n, overtimeMultiplier: 1.5, effectiveFrom: new Date() });
    expect(mw.floorFor('per_day')).toBe(38000n);
    expect(mw.floorFor('per_task')).toBe(38000n);
    expect(mw.floorFor('per_hour')).toBe(4750n);
  });
  it('falls back to the daily floor when no hourly rate is set', () => {
    const mw = MinimumWage.rehydrate({ id: 'm1', regionId: 'r1', skillLevel: 'unskilled', dailyWageMinor: 38000n, hourlyWageMinor: null, overtimeMultiplier: 1.5, effectiveFrom: new Date() });
    expect(mw.floorFor('per_hour')).toBe(38000n);
  });
});
