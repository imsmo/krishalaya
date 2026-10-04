// modules/labour/domain/labour.errors.ts · typed errors with stable codes (mapped to i18n + HTTP by the filter).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class WorkerProfileNotFoundError extends NotFoundError { constructor(id: string) { super('Worker profile not found'); (this as any).code = 'WORKER_NOT_FOUND'; (this as any).details = { id }; } }
export class BookingNotFoundError extends NotFoundError { constructor(id: string) { super('Labour booking not found'); (this as any).code = 'BOOKING_NOT_FOUND'; (this as any).details = { id }; } }
export class AssignmentNotFoundError extends NotFoundError { constructor(id: string) { super('Booking assignment not found'); (this as any).code = 'ASSIGNMENT_NOT_FOUND'; (this as any).details = { id }; } }

/** A worker may register only ONE profile (worker_profiles.user_id is UNIQUE). */
export class WorkerAlreadyRegisteredError extends AppError { constructor() { super('WORKER_ALREADY_REGISTERED', 'You already have a worker profile', 409); } }

/** HARD RULE (worker_profiles.age_verified_18): an unverified worker cannot be assigned to a booking. */
export class WorkerNotAgeVerifiedError extends DomainError { constructor(workerId: string) { super('WORKER_NOT_AGE_VERIFIED', 'Worker is not age-verified (18+) and cannot be assigned', 409, { workerId }); } }

/** THE DIGNITY FLOOR (chk_dignity_floor in physics): an offer below the statutory minimum is rejected. */
export class WageBelowMinimumError extends DomainError {
  constructor(offeredMinor: bigint, floorMinor: bigint) {
    super('WAGE_BELOW_MINIMUM', 'Offered wage is below the statutory minimum wage', 422,
      { offeredMinor: offeredMinor.toString(), floorMinor: floorMinor.toString() });
  }
}

/** No statutory minimum-wage row resolves for the booking's region + skill level → fail closed. */
export class NoMinimumWageFloorError extends DomainError {
  constructor(regionId: string, skillLevel: string) {
    super('NO_MIN_WAGE_FLOOR', 'No statutory minimum wage is configured for this region/skill level', 422, { regionId, skillLevel });
  }
}

/** More workers accepted/assigned than the booking needs. */
export class BookingFullError extends DomainError { constructor(needed: number) { super('BOOKING_FULL', 'Booking already has all the workers it needs', 409, { needed }); } }

/** Optimistic-lock loss on the booking (concurrent writer). */
export class BookingConcurrencyError extends AppError { constructor(id: string) { super('BOOKING_CONCURRENCY', 'Booking was modified concurrently; retry', 409, { id }); } }

/** Caller is not the employer / worker / admin entitled to act here. */
export class LabourForbiddenError extends AppError { constructor(message = 'Not allowed on this labour resource') { super('LABOUR_FORBIDDEN', message, 403); } }

/** A worker may hold only one assignment per booking (booking_assignments UNIQUE(booking_id, worker_id)). */
export class WorkerAlreadyAssignedError extends AppError { constructor() { super('WORKER_ALREADY_ASSIGNED', 'Worker is already assigned to this booking', 409); } }

/** Acting on a booking whose state forbids it (e.g. paying a non-completed booking). */
export class BookingNotPayableError extends DomainError { constructor(status: string) { super('BOOKING_NOT_PAYABLE', `Booking cannot be paid from status '${status}'`, 409, { status }); } }

/** Unknown labour_demand_type code. */
export class InvalidDemandTypeError extends DomainError { constructor(code: string) { super('INVALID_DEMAND_TYPE', `Unknown labour demand type '${code}'`, 422, { code }); } }
/** The referenced skill does not exist / is inactive. */
export class SkillNotFoundError extends NotFoundError { constructor(id: string) { super('Skill not found'); (this as any).code = 'SKILL_NOT_FOUND'; (this as any).details = { id }; } }

/** A worker may only clock in once they are an ACCEPTED assignee on the booking. */
export class AssignmentNotAcceptedError extends DomainError { constructor(status: string) { super('ASSIGNMENT_NOT_ACCEPTED', `Cannot clock in from assignment status '${status}'`, 409, { status }); } }
/** The clock-in location is outside the booking's ≤100m geofence (server-computed; the device can't fake it). */
export class OutOfFenceError extends DomainError { constructor(distanceM: number, fenceM: number) { super('ATTENDANCE_OUT_OF_FENCE', `Clock-in is ${distanceM}m from the farm (fence is ${fenceM}m)`, 422, { distanceM, fenceM }); } }
/** A worker has already clocked in for this assignment today (one attendance per assignment per day). */
export class AlreadyClockedInError extends DomainError { constructor() { super('ATTENDANCE_ALREADY_CLOCKED_IN', 'Already clocked in for today', 409); } }
/** No clock-in exists yet for this assignment + day (cannot clock out / confirm what never started). */
export class NotClockedInError extends NotFoundError { constructor() { super('No attendance record for this day'); (this as any).code = 'ATTENDANCE_NOT_CLOCKED_IN'; } }
/** The day is already clocked out — a second clock-out is a no-op guard (idempotent at the API, conflict here). */
export class AlreadyClockedOutError extends DomainError { constructor() { super('ATTENDANCE_ALREADY_CLOCKED_OUT', 'Already clocked out for today', 409); } }
/** Clock-out time is not strictly after clock-in (clock skew / tamper) — refuse to compute negative hours. */
export class ClockOutBeforeClockInError extends DomainError { constructor() { super('ATTENDANCE_CLOCK_OUT_BEFORE_IN', 'Clock-out must be after clock-in', 422); } }
/** Employer tried to confirm a day that has not been clocked out yet (hours not finalised). */
export class NotClockedOutError extends DomainError { constructor(status: string) { super('ATTENDANCE_NOT_CLOCKED_OUT', `Cannot confirm attendance from status '${status}'`, 409, { status }); } }
/** The day is already employer-confirmed (terminal — immutable for audit integrity). Repeat is a no-op. */
export class AlreadyConfirmedError extends DomainError { constructor() { super('ATTENDANCE_ALREADY_CONFIRMED', 'Attendance already confirmed', 409); } }

// ---- PC-56 TENANT-11b ----
/** F-6: an attendance UPDATE that matched no row for a reason that is NOT a race (the row was read in this transaction). */
export class AttendanceRowMismatchError extends AppError {
  constructor(id: string, op: string) { super('ATTENDANCE_ROW_MISMATCH', `Attendance ${id} could not be ${op}: the row read in this transaction did not match on write`, 500, { id, op }); }
}
/** A3: the employer's Main cannot fund wages + fee. NOTHING moved; the roster stays unconfirmed. */
export class EmployerFundsUnavailableError extends AppError {
  constructor(neededMinor: bigint, availableMinor: bigint) {
    super('EMPLOYER_FUNDS_UNAVAILABLE', 'The employer wallet cannot cover the wages and the platform fee', 409,
      { neededMinor: neededMinor.toString(), availableMinor: availableMinor.toString(), shortMinor: (neededMinor > availableMinor ? neededMinor - availableMinor : 0n).toString() });
  }
}
/** A3: start() needs a confirmed roster (the wages set aside first). */
export class RosterNotConfirmedError extends DomainError { constructor(status: string) { super('ROSTER_NOT_CONFIRMED', 'Confirm the roster (wages set aside) before the job starts', 409, { status }); } }
/** A3: a roster with nobody on it cannot be confirmed. */
export class RosterEmptyError extends DomainError { constructor() { super('ROSTER_EMPTY', 'No worker has accepted this job yet', 409); } }
/** The roster is locked once confirmed: a pending worker can no longer accept, nobody new can be added. */
export class RosterLockedError extends DomainError { constructor(status: string) { super('ROSTER_LOCKED', 'The roster of this job is already confirmed', 409, { status }); } }
/** A6: the desk acted for an employer without a recorded consent for THAT act. */
export class EmployerConsentRequiredError extends DomainError { constructor(act: string, code = 'EMPLOYER_CONSENT_REQUIRED') { super(code, `The employer's recorded consent is required to ${act} for them`, 422, { act }); } }
/** A7: a women-only job refuses a worker who is not recorded as a woman. */
export class WomenOnlyBookingError extends DomainError { constructor() { super('WOMEN_ONLY_BOOKING', 'This job is women-only', 409); } }
/** A7: a women-only job refuses a worker whose profile records no gender (no declaration exists to rely on). */
export class WorkerGenderNotRecordedError extends DomainError { constructor() { super('WORKER_GENDER_NOT_RECORDED', 'This job is women-only and the worker has no gender recorded on their profile', 409); } }
/** A7: cancel needs a reason from the lookup; `other` needs the employer's words. */
export class CancelReasonRequiredError extends DomainError { constructor(code = 'CANCEL_REASON_REQUIRED') { super(code, 'A cancel reason is required', 422); } }
/** A4: cancelling a started job would strand confirmed days nobody paid. */
export class BookingHasUnpaidAttendanceError extends DomainError { constructor(days: number) { super('BOOKING_HAS_UNPAID_ATTENDANCE', 'Run pay for the confirmed days before cancelling', 409, { days }); } }
/** A2: a pay run on a booking in a state that has nothing to pay. */
export class BookingNotPayableYetError extends DomainError { constructor(status: string) { super('BOOKING_NOT_PAYABLE', `Booking cannot be paid from status '${status}'`, 409, { status }); } }
/** Attendance can only be confirmed while the money can still move (not after the job is paid out or cancelled). */
export class BookingSettledError extends DomainError { constructor(status: string) { super('BOOKING_SETTLED', `Attendance cannot change on a booking that is '${status}'`, 409, { status }); } }

// ---- PC-56 TENANT-SW-b (0198) — attendance review, the daily wage run, advances ----
/** A refusal the DATABASE makes by name (`[ATTENDANCE_SELF_CONFIRM] …`, `[ADVANCE_APPROVER_IS_REQUESTER] …`): the service names it. */
export class LabourRefusedError extends DomainError { constructor(code: string, message: string, status = 409, details: Record<string, unknown> = {}) { super(code, message, status, details); } }
export class AttendanceRecordNotFoundError extends DomainError { constructor(id: string) { super('ATTENDANCE_NOT_FOUND', `Attendance record ${id} not found`, 404, { id }); } }
export class AttendanceReasonRequiredError extends DomainError { constructor(act: string) { super('ATTENDANCE_REASON_REQUIRED', `A reason (10–500 characters) is required to ${act}`, 422, { act }); } }
export class AdvanceNotFoundError extends DomainError { constructor(id: string) { super('ADVANCE_NOT_FOUND', `Advance ${id} not found`, 404, { id }); } }
export class AdvanceEscrowShortError extends DomainError { constructor(neededMinor: bigint, heldMinor: bigint) { super('ADVANCE_ESCROW_SHORT', 'The booking escrow cannot cover this advance — nothing moved', 409, { neededMinor: neededMinor.toString(), heldMinor: heldMinor.toString(), shortMinor: (neededMinor > heldMinor ? neededMinor - heldMinor : 0n).toString() }); } }
export class AdvanceNotAllowedError extends DomainError { constructor(detail: string) { super('ADVANCE_NOT_ALLOWED', detail, 409, {}); } }
export class WageRunNotFoundError extends DomainError { constructor(id: string) { super('WAGE_RUN_NOT_FOUND', `Wage run ${id} not found`, 404, { id }); } }

const LABOUR_TRIGGER_CODES: Record<string, { status: number; message: string }> = {
  ATTENDANCE_SELF_CONFIRM: { status: 403, message: 'You cannot confirm your own attendance (dual-confirm law).' },
  ATTENDANCE_SELF_VOUCH: { status: 403, message: 'You cannot vouch for your own attendance (dual-confirm law).' },
  ATTENDANCE_NEEDS_VOUCH: { status: 409, message: 'This day was recorded for review (outside the fence, or from paper) — it is confirmed only after someone other than the worker vouches for it.' },
  ATTENDANCE_REFUSED: { status: 409, message: 'This day was refused on review and will not be confirmed.' },
  ATTENDANCE_BACKFILL_VOUCH_IS_RECORDER: { status: 403, message: 'The person who recorded a paper day cannot also vouch for it.' },
  ATTENDANCE_SELF_BACKFILL: { status: 403, message: 'Nobody records their own day from paper.' },
  ATTENDANCE_REVIEW_MOVE: { status: 409, message: 'This day is not waiting for review.' },
  ATTENDANCE_CONFIRMED_FINAL: { status: 409, message: 'A confirmed day is final.' },
  ATTENDANCE_NOT_YOURS: { status: 403, message: 'An act on attendance is made in your own session.' },
  ADVANCE_APPROVER_IS_REQUESTER: { status: 409, message: 'The person who requested this advance cannot also approve it — someone else must.' },
  ADVANCE_APPROVER_IS_WORKER: { status: 403, message: 'A worker never approves their own advance.' },
  ADVANCE_OVER_CAP: { status: 422, message: 'Advances on one job may total at most half of the expected wage.' },
  ADVANCE_WRITE_OFF_REFUSED: { status: 409, message: 'Writing an advance off is not a recorded act on this platform.' },
  ADVANCE_CLOSED: { status: 409, message: 'This advance is already decided.' },
  ADVANCE_NO_EXPECTED_WAGE: { status: 422, message: 'This job has no expected wage to advance against.' },
  ADVANCE_NOT_YOURS: { status: 403, message: 'An act on an advance is made in your own session.' },
};
/** `[CODE] …` from a 0198 trigger → LabourRefusedError(CODE); anything else unchanged. */
export function namedLabourRefusal(e: unknown): unknown {
  const m = /\[([A-Z_]+)\]/.exec(String((e as Error)?.message ?? ''));
  const t = m ? LABOUR_TRIGGER_CODES[m[1]] : undefined;
  return t && m ? new LabourRefusedError(m[1], t.message, t.status) : e;
}
