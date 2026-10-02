// apps/web-tenant/src/features/labour/employer.test.ts · pure unit tests for the labour employer helpers.
import {
  validateBookingForm, validateAssignWage, bookingActions, canConfirmAttendance, previewPayrollMinor,
} from './employer';

const U = '00000000-0000-0000-0000-000000000001';
const ok = { demandTypeCode: 'harvest', taskSkillId: U, regionId: U, skillLevel: 'unskilled', workersNeeded: 2, startDate: '2026-07-01', endDate: '2026-07-03', wageKind: 'per_day', wageOfferedMinor: '50000', farmLat: 22.3, farmLng: 70.8 };

describe('labour/employer — booking form validation', () => {
  it('accepts a well-formed booking', () => { expect(validateBookingForm(ok)).toBeNull(); });
  it('rejects bad demand code / skill / region', () => {
    expect(validateBookingForm({ ...ok, demandTypeCode: 'Bad Code' })).toBe('demandType');
    expect(validateBookingForm({ ...ok, taskSkillId: 'x' })).toBe('skill');
    expect(validateBookingForm({ ...ok, regionId: 'x' })).toBe('region');
  });
  it('rejects bad skill level / workers / dates', () => {
    expect(validateBookingForm({ ...ok, skillLevel: 'wizard' })).toBe('skillLevel');
    expect(validateBookingForm({ ...ok, workersNeeded: 0 })).toBe('workers');
    expect(validateBookingForm({ ...ok, endDate: 'bad' })).toBe('dates');
    expect(validateBookingForm({ ...ok, startDate: '2026-07-05', endDate: '2026-07-03' })).toBe('dateOrder');
  });
  it('rejects a non-positive-integer wage (server owns the min-wage floor)', () => {
    expect(validateBookingForm({ ...ok, wageOfferedMinor: '0' })).toBe('wage');
    expect(validateBookingForm({ ...ok, wageOfferedMinor: '12.5' })).toBe('wage');
    expect(validateBookingForm({ ...ok, wageOfferedMinor: '50000' })).toBeNull();
  });
  it('rejects out-of-range coordinates + hours', () => {
    expect(validateBookingForm({ ...ok, farmLat: 99 })).toBe('lat');
    expect(validateBookingForm({ ...ok, farmLng: 999 })).toBe('lng');
    expect(validateBookingForm({ ...ok, dailyHours: 30 })).toBe('hours');
    expect(validateBookingForm({ ...ok, respondByHours: 0 })).toBe('respondBy');
  });
});

describe('labour/employer — assign + state machine + payroll preview', () => {
  it('assign wage is optional but must be a positive integer when present', () => {
    expect(validateAssignWage(undefined)).toBeNull();
    expect(validateAssignWage('')).toBeNull();
    expect(validateAssignWage('0')).toBe('wage');
    expect(validateAssignWage('6.5')).toBe('wage');
    expect(validateAssignWage('60000')).toBeNull();
  });
  it('bookingActions follows the lifecycle', () => {
    // PC-56 TENANT-11b: open → confirm roster (escrow) → start; pay runs while in progress too (confirmed days).
    expect(bookingActions('open')).toEqual(['assign', 'confirmRoster', 'cancel']);
    expect(bookingActions('accepted')).toEqual(['start', 'cancel']);
    expect(bookingActions('in_progress')).toEqual(['complete', 'pay', 'cancel']);
    expect(bookingActions('completed')).toEqual(['pay']);
    expect(bookingActions('paid')).toEqual([]);
    expect(bookingActions('cancelled')).toEqual([]);
  });
  it('canConfirmAttendance only for a clocked-out, unconfirmed day', () => {
    expect(canConfirmAttendance({ status: 'clocked_out', confirmedByEmployer: false })).toBe(true);
    expect(canConfirmAttendance({ status: 'clocked_in' })).toBe(false);
    expect(canConfirmAttendance({ status: 'clocked_out', confirmedByEmployer: true })).toBe(false);
    expect(canConfirmAttendance({ status: 'confirmed' })).toBe(false);
  });
  it('previewPayrollMinor sums only accepted assignments (float-free)', () => {
    expect(previewPayrollMinor([
      { status: 'accepted', wageMinor: '50000' },
      { status: 'accepted', wageMinor: '60000' },
      { status: 'pending_worker', wageMinor: '99999' },
      { status: 'rejected', wageMinor: '99999' },
    ])).toBe('110000');
    expect(previewPayrollMinor([])).toBe('0');
    // three planned days × ₹420 per accepted worker (the canon's arithmetic), not one unit
    expect(previewPayrollMinor([{ status: 'accepted', wageMinor: '42000' }, { status: 'accepted', wageMinor: '42000' }], 300)).toBe('252000');
  });
});
