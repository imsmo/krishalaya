// modules/labour/domain/attendance.state.ts · STATE MACHINE for a day's attendance_records row (Law 5).
// attendance_records has no status column — the lifecycle is DERIVED from three persisted facts:
//   clock_in_at set                          → 'clocked_in'   (worker is on-site, geo-fenced; AttendanceService.clockIn)
//   + clock_out_at set                       → 'clocked_out'  (hours/overtime computed; AttendanceService.clockOut)
//   + confirmed_by_employer = true           → 'confirmed'    (employer DUAL-CONFIRM; wages may settle, P0-9)
// Legal transitions are the only place this advances; deriveStatus + assertTransition keep it honest.
import { DomainError } from '../../../shared/errors/app-error';

export const ATTENDANCE_STATUSES = ['clocked_in', 'clocked_out', 'confirmed'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<AttendanceStatus, readonly AttendanceStatus[]>> = Object.freeze({
  clocked_in:  ['clocked_out'],
  clocked_out: ['confirmed'],
  confirmed:   [],            // terminal — a confirmed day is immutable (audit integrity)
});

export class IllegalAttendanceTransitionError extends DomainError {
  constructor(from: string, to: string) { super('ATTENDANCE_ILLEGAL_TRANSITION', `Cannot move attendance ${from}→${to}`, 409, { from, to }); }
}

/** Derive the lifecycle status from the persisted facts of a row. */
export function deriveStatus(row: { clockInAt: Date | null; clockOutAt: Date | null; confirmedByEmployer: boolean; clockInMethod?: string }): AttendanceStatus {
  if (row.confirmedByEmployer) return 'confirmed';
  if (row.clockOutAt) return 'clocked_out';
  // PC-56 TENANT-SW-b: a PAPER BACKFILL carries no clock times (none exist) — its hours are the signed sheet's, final as recorded
  if (row.clockInMethod === 'paper_backfill') return 'clocked_out';
  return 'clocked_in';     // a row only exists once clock-in happened
}

export function canTransition(from: AttendanceStatus, to: AttendanceStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: AttendanceStatus, to: AttendanceStatus): void { if (!canTransition(from, to)) throw new IllegalAttendanceTransitionError(from, to); }
export function isConfirmed(s: AttendanceStatus): boolean { return s === 'confirmed'; }
