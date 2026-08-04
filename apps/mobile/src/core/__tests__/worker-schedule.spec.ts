// Unit tests for the PURE worker-schedule tab/section logic (screen 32).
import { scheduleTab, filterByTab, tabCounts, daySection, groupUpcoming, isActiveNow, type ScheduledJob } from '../../features/labour/worker-schedule';
import type { LabourAssignment, LabourBooking } from '@krishalaya/sdk-js';

const now = Date.parse('2026-08-15T12:00:00Z');
const asg = (status: string): LabourAssignment => ({ id: status, bookingId: 'b-' + status, workerId: 'w', status, wageMinor: '40000', acceptedAt: null });
const bk = (startDate: string, over: Partial<LabourBooking> = {}): LabourBooking => ({
  id: 'b', bookingNo: 'B', employerUserId: 'emp-123456', demandTypeId: null, taskSkillId: null, workersNeeded: 1,
  startDate, endDate: null, wageKind: 'per_day', wageOfferedMinor: '40000', minWageMinor: '35000', currencyCode: 'INR', womenOnly: false, status: 'confirmed', respondBy: null, ...over,
});
const job = (status: string, startDate?: string, over: Partial<LabourBooking> = {}): ScheduledJob => ({ assignment: asg(status), booking: startDate ? bk(startDate, over) : null });

describe('worker schedule (screen 32)', () => {
  it('scheduleTab maps statuses; offers/applications excluded', () => {
    expect(scheduleTab('accepted')).toBe('upcoming');
    expect(scheduleTab('in_progress')).toBe('upcoming');
    expect(scheduleTab('paid')).toBe('past');
    expect(scheduleTab('completed')).toBe('past');
    expect(scheduleTab('rejected')).toBe('cancelled');
    expect(scheduleTab('expired')).toBe('cancelled');
    expect(scheduleTab('pending_worker')).toBeNull();
    expect(scheduleTab('applied')).toBeNull();
  });
  it('tabCounts + filterByTab', () => {
    const items = [job('accepted', '2026-08-15T07:00:00Z'), job('paid'), job('paid'), job('rejected'), job('pending_worker')];
    expect(tabCounts(items)).toEqual({ upcoming: 1, past: 2, cancelled: 1 });
    expect(filterByTab(items, 'past').length).toBe(2);
  });
  it('daySection buckets by booking start date', () => {
    expect(daySection(bk('2026-08-15T07:00:00Z'), now)).toBe('today');
    expect(daySection(bk('2026-08-16T06:30:00Z'), now)).toBe('tomorrow');
    expect(daySection(bk('2026-08-20T08:00:00Z'), now)).toBe('week');
    expect(daySection(bk('2026-09-30T08:00:00Z'), now)).toBe('later');
    expect(daySection(null, now)).toBe('later');
  });
  it('groupUpcoming orders sections + sorts soonest-first, drops empty', () => {
    const items = [job('accepted', '2026-08-20T08:00:00Z'), job('accepted', '2026-08-15T07:00:00Z'), job('accepted', '2026-08-16T06:30:00Z'), job('paid', '2026-08-15T07:00:00Z')];
    const g = groupUpcoming(items, now);
    expect(g.map((s) => s.key)).toEqual(['today', 'tomorrow', 'week']);
    expect(g[0].items[0].assignment.status).toBe('accepted');
  });
  it('isActiveNow reflects assignment or booking in_progress', () => {
    expect(isActiveNow(job('in_progress'))).toBe(true);
    expect(isActiveNow(job('accepted', '2026-08-15T07:00:00Z', { status: 'in_progress' }))).toBe(true);
    expect(isActiveNow(job('accepted', '2026-08-15T07:00:00Z'))).toBe(false);
  });
});
