// modules/labour/domain/labour.events.ts · integration events published by labour (via outbox, Law 4).
// Every booking lifecycle change + the wage settlement is emitted here so other modules (notifications,
// reviews-of-workers, analytics) can react without reading labour's tables (Law 11).
export const LabourEventType = {
  WorkerRegistered:   'labour.worker_registered',
  WorkerUpdated:      'labour.worker_updated',
  BookingPosted:      'labour.booking_posted',
  WorkerAssigned:     'labour.worker_assigned',
  AssignmentAccepted: 'labour.assignment_accepted',
  AssignmentRejected: 'labour.assignment_rejected',
  AssignmentExpired:  'labour.assignment_expired',
  RosterConfirmed:    'labour.roster_confirmed',        // PC-56 TENANT-11b: the roster is confirmed and the wages are escrowed
  BookingStarted:     'labour.booking_started',
  BookingCompleted:   'labour.booking_completed',
  WagesPaid:          'labour.wages_paid',
  BookingCancelled:   'labour.booking_cancelled',
  BookingExpired:     'labour.booking_expired',
  AttendanceClockedIn:'labour.attendance_clocked_in',
  AttendanceClockedOut:'labour.attendance_clocked_out',   // hours/overtime finalised for the day (P0-9)
  AttendanceConfirmed:'labour.attendance_confirmed',       // employer dual-confirmed the day → wages may settle
} as const;

export type DomainEvent = { type: string; payload: Record<string, unknown> };

/** Statutory floor skill levels (minimum_wages.skill_level). */
export const SKILL_LEVELS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** How a wage is quoted on a booking (labour_bookings.wage_kind). */
export const WAGE_KINDS = ['per_day', 'per_hour', 'per_task'] as const;
export type WageKind = (typeof WAGE_KINDS)[number];
