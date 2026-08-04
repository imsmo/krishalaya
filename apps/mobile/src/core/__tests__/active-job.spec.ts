// Unit tests for the PURE active-job stopwatch/phase logic (screen 33).
import { attendancePhase, elapsedWorkedSeconds, formatStopwatch } from '../../features/labour/active-job';
import type { LabourAttendance } from '@krishalaya/sdk-js';

const att = (over: Partial<LabourAttendance>): LabourAttendance => ({ id: 'a', assignmentId: 'x', bookingId: 'b', workDate: '2026-08-15', ...over });

describe('active job (screen 33)', () => {
  it('attendancePhase reflects status', () => {
    expect(attendancePhase(null)).toBe('none');
    expect(attendancePhase(att({}))).toBe('none');
    expect(attendancePhase(att({ status: 'clocked_in' }))).toBe('working');
    expect(attendancePhase(att({ status: 'clocked_out' }))).toBe('done');
    expect(attendancePhase(att({ status: 'confirmed' }))).toBe('done');
  });
  it('elapsedWorkedSeconds subtracts break, floors at 0', () => {
    const now = Date.parse('2026-08-15T11:35:18Z');
    // clocked in at 07:05, 30 min break → 4h30m18s − 30m = 4h00m18s = 14418s
    expect(elapsedWorkedSeconds('2026-08-15T07:05:00Z', 30, now)).toBe(14418);
    expect(elapsedWorkedSeconds(null, 30, now)).toBe(0);
    expect(elapsedWorkedSeconds('2026-08-15T11:40:00Z', 0, now)).toBe(0); // clock-in in the future → clamp 0
  });
  it('formatStopwatch zero-pads HH:MM:SS', () => {
    expect(formatStopwatch(14418)).toBe('04:00:18');
    expect(formatStopwatch(0)).toBe('00:00:00');
    expect(formatStopwatch(-5)).toBe('00:00:00');
    expect(formatStopwatch(3661)).toBe('01:01:01');
  });
});
