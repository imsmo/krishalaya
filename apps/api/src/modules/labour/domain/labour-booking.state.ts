// modules/labour/domain/labour-booking.state.ts · STATE MACHINE for labour_bookings.status (Law 5).
// Subset of the booking_status enum (db/migrations/0008_labour.sql) used by this build:
//   open → accepted (ROSTER CONFIRMED: wages escrowed) → in_progress → completed → paid
//   (+ cancel from open / accepted / in_progress; expire from open)
// PC-56 TENANT-11b: `accepted` is the existing enum value used for "roster confirmed" (founder decision: escrow at roster
// confirm). A booking can no longer start straight from `open` — the money is set aside first. 7 of the enum's 12 values
// are reachable on a booking; draft / pending_worker / rejected / disputed / no_show are not (named on the console).
import { DomainError } from '../../../shared/errors/app-error';

export const BOOKING_STATUSES = ['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled', 'expired'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  open:        ['accepted', 'cancelled', 'expired'],
  accepted:    ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed:   ['paid'],
  paid:        [],
  cancelled:   [],
  expired:     [],
});

export class IllegalBookingTransitionError extends DomainError {
  constructor(from: string, to: string) { super('BOOKING_ILLEGAL_TRANSITION', `Cannot move booking ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: BookingStatus, to: BookingStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: BookingStatus, to: BookingStatus): void { if (!canTransition(from, to)) throw new IllegalBookingTransitionError(from, to); }
/** Workers may still be assigned / accept only while the booking is open (the roster is not yet confirmed). */
export function acceptsAssignments(s: BookingStatus): boolean { return s === 'open'; }
/** Terminal states no job/worker action can change. */
export function isTerminal(s: BookingStatus): boolean { return s === 'paid' || s === 'cancelled' || s === 'expired'; }
/** Pay runs move confirmed attendance while the job runs and once it is done; a paid booking answers "nothing to move". */
export function acceptsPayRun(s: BookingStatus): boolean { return s === 'in_progress' || s === 'completed' || s === 'paid'; }
/** The enum values a booking can never reach in this build (the console omits them rather than drawing 0). */
export const UNREACHABLE_BOOKING_STATUSES = ['draft', 'pending_worker', 'rejected', 'disputed', 'no_show'] as const;
