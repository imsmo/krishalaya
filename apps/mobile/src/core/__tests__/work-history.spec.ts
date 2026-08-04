// Unit tests for the PURE Work-History logic (features/labour/work-history) behind screen 138. Verifies hours sum,
// the status precedence, honest filters + this-year count — all off the REAL attendance contract, no fabrication.
import { attendanceTotalHours, attendanceStatusKey, matchesHistoryFilter, thisYearCount, HISTORY_FILTERS } from '../../features/labour/work-history';
import type { LabourAttendance } from '@krishalaya/sdk-js';

const A = (over: Partial<LabourAttendance>): LabourAttendance => ({ id: 'a', assignmentId: 'as', bookingId: 'b', workDate: '2026-08-22', ...over });

describe('attendanceTotalHours', () => {
  it('sums regular + overtime; null when unstamped', () => {
    expect(attendanceTotalHours({ hoursRegular: 8, hoursOvertime: 2 })).toBe(10);
    expect(attendanceTotalHours({ hoursRegular: 6, hoursOvertime: 0 })).toBe(6);
    expect(attendanceTotalHours({ hoursRegular: null, hoursOvertime: 0 })).toBeNull();
    expect(attendanceTotalHours({ hoursRegular: null, hoursOvertime: 3 })).toBe(3);
  });
});

describe('attendanceStatusKey', () => {
  it('applies paid > confirmed > clocked_out > clocked_in > pending', () => {
    expect(attendanceStatusKey({ paid: true, confirmedByEmployer: true, status: 'confirmed' })).toBe('paid');
    expect(attendanceStatusKey({ paid: false, confirmedByEmployer: true, status: 'clocked_out' })).toBe('confirmed');
    expect(attendanceStatusKey({ status: 'clocked_out' })).toBe('clocked_out');
    expect(attendanceStatusKey({ status: 'clocked_in' })).toBe('clocked_in');
    expect(attendanceStatusKey({})).toBe('pending');
  });
});

describe('matchesHistoryFilter / thisYearCount', () => {
  const now = Date.UTC(2026, 5, 1); // 2026
  it('all matches everything; this_year matches only the current year', () => {
    expect(matchesHistoryFilter(A({ workDate: '2025-12-31' }), 'all', now)).toBe(true);
    expect(matchesHistoryFilter(A({ workDate: '2026-08-22' }), 'this_year', now)).toBe(true);
    expect(matchesHistoryFilter(A({ workDate: '2025-08-22' }), 'this_year', now)).toBe(false);
    expect(matchesHistoryFilter(A({ workDate: 'bad' }), 'this_year', now)).toBe(false);
  });
  it('counts this-year days', () => {
    expect(thisYearCount([A({ workDate: '2026-01-01' }), A({ workDate: '2025-01-01' }), A({ workDate: '2026-12-31' })], now)).toBe(2);
    expect(HISTORY_FILTERS).toEqual(['all', 'this_year']);
  });
});
