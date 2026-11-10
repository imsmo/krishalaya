// modules/equipment/domain/equipment.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class AssetNotFoundError extends NotFoundError { constructor(id: string) { super('Equipment asset not found'); (this as any).code = 'ASSET_NOT_FOUND'; (this as any).details = { id }; } }
export class RateNotFoundError extends NotFoundError { constructor(id: string) { super('Equipment rate not found'); (this as any).code = 'RATE_NOT_FOUND'; (this as any).details = { id }; } }
export class NoActiveRateError extends DomainError { constructor(basis: string) { super('NO_ACTIVE_RATE', `No active rate for basis '${basis}' on this asset`, 422, { basis }); } }
export class BookingNotFoundError extends NotFoundError { constructor(id: string) { super('Equipment booking not found'); (this as any).code = 'EQ_BOOKING_NOT_FOUND'; (this as any).details = { id }; } }

export class InvalidRateError extends DomainError { constructor(message: string) { super('RATE_INVALID', message, 422); } }
export class InvalidBookingError extends DomainError { constructor(message: string) { super('BOOKING_INVALID', message, 422); } }
export class AssetNotBookableError extends DomainError { constructor(status: string) { super('ASSET_NOT_BOOKABLE', `Asset is not bookable (status: ${status})`, 409, { status }); } }
/** actual usage exceeds the agreed estimate — needs a re-quote (anti over-billing). */
export class OverEstimateError extends DomainError { constructor() { super('OVER_ESTIMATE', 'Actual quantity exceeds the agreed estimate; re-quote required', 422); } }
export class BookingStartOtpInvalidError extends AppError { constructor() { super('BOOKING_START_OTP_INVALID', 'Invalid start OTP', 403); } }
export class BookingStartOtpNotIssuedError extends DomainError { constructor() { super('BOOKING_START_OTP_NOT_ISSUED', 'No start OTP issued for this booking', 409); } }
export class EquipmentForbiddenError extends AppError { constructor(message = 'Not allowed on this equipment resource') { super('EQUIPMENT_FORBIDDEN', message, 403); } }
export class RegNoExistsError extends AppError { constructor() { super('REG_NO_EXISTS', 'An asset with this registration number already exists', 409); } }

// [PC-56 HOTFIX-13 · founder Q1-A, 2026-11-09] NOBODY SPENDS HER MONEY BUT HER. Each refusal is by name, before the idempotency
// record and before any write (the services pre-read the row; the ordering spies pin it).
/** The hire deposit is escrowed from the RENTER's wallet — only she confirms the hire (the administrator escape is gone). */
export class EqConfirmNotRenterError extends AppError { constructor() { super('EQ_CONFIRM_NOT_RENTER', 'Only the renter can confirm this hire and pay its deposit, from her own account.', 403); } }
/** Only the renter confirms the hours the owner recorded — not the owner, not an administrator, not anyone else. */
export class UsageConfirmNotRenterError extends AppError { constructor() { super('USAGE_CONFIRM_NOT_RENTER', 'Only the renter can confirm the hours of this hire, from her own account.', 403); } }
/** quote / start / complete / settle are the machine owner's acts only (the administrator escape is gone). */
export class EqNotMachineOwnerError extends AppError { constructor() { super('EQ_NOT_MACHINE_OWNER', 'Only the owner of this machine can do this.', 403); } }
/** Settling would take money beyond the deposit from the renter's wallet, and she has not confirmed the hours. */
export class SettleHoursNotConfirmedError extends DomainError { constructor() { super('SETTLE_HOURS_NOT_CONFIRMED', 'Not settled: the renter has not confirmed these hours in her own app. Nothing beyond the deposit leaves the renter\'s wallet until she confirms those hours in her own app.', 409); } }
/** Hours are confirmed on a completed hire only. */
export class UsageNotConfirmableError extends DomainError { constructor(status: string) { super('USAGE_NOT_CONFIRMABLE', `The hours can be confirmed only on a completed hire (this hire is ${status}).`, 409, { status }); } }
/** The renter has already confirmed these hours; a confirmation is final. */
export class UsageAlreadyConfirmedError extends DomainError { constructor() { super('USAGE_ALREADY_CONFIRMED', 'The renter has already confirmed the hours of this hire.', 409); } }

// [PC-56 OPS-4a · E10] a rate line that a hire has already snapshotted is never overwritten in place (the hire's price is the record of
// what that line said). Refused before any write.
export class RateAlreadyPricedAHireError extends DomainError { constructor() { super('RATE_ALREADY_PRICED_A_HIRE', 'This rate line has already priced a hire, so it is not overwritten. A rate can be set from a different day.', 409); } }

// [PC-56 OPS-4b · OPS4-B7 / E11, survey C-9 / F-8] A MACHINE'S MAINTENANCE IS ITS OWNER'S RECORD. Each refusal is by name, after the permission and
// key checks and BEFORE the idempotency record and any write (the service pre-reads the machine; an ordering spy pins it).
/** Only the machine's owner records its maintenance — no administrator escape. */
export class MaintenanceNotYourMachineError extends AppError { constructor() { super('MAINTENANCE_NOT_YOUR_MACHINE', 'Only the owner of this machine can record its maintenance.', 403); } }
/** A maintenance entry is dated on or before the organisation's own today (the tenant-day rule, `tenantDay`). */
export class MaintenanceDateInFutureError extends AppError { constructor(today: string) { super('MAINTENANCE_DATE_IN_FUTURE', 'A maintenance entry cannot be dated after today.', 400, { today }); } }
// [PC-56 OPS-4b · lead-applied from OPS-2a "an operator's cancel needs a reason"] a hire cancelled by anyone other than its renter needs a reason.
export class CancelReasonRequiredError extends AppError { constructor() { super('CANCEL_REASON_REQUIRED', 'A reason is needed to cancel a hire you did not request.', 400); } }
