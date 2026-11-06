// modules/warehousing/domain/warehousing.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class WarehouseNotFoundError extends NotFoundError { constructor(id: string) { super('Warehouse not found'); (this as any).code = 'WAREHOUSE_NOT_FOUND'; (this as any).details = { id }; } }
export class BookingNotFoundError extends NotFoundError { constructor(id: string) { super('Storage booking not found'); (this as any).code = 'STORAGE_BOOKING_NOT_FOUND'; (this as any).details = { id }; } }
export class AssayNotFoundError extends NotFoundError { constructor(id: string) { super('Assay report not found'); (this as any).code = 'ASSAY_NOT_FOUND'; (this as any).details = { id }; } }
export class NwrNotFoundError extends NotFoundError { constructor(id: string) { super('NWR receipt not found'); (this as any).code = 'NWR_NOT_FOUND'; (this as any).details = { id }; } }

export class InvalidWarehouseError extends DomainError { constructor(message: string) { super('WAREHOUSE_INVALID', message, 422); } }
export class InvalidBookingError extends DomainError { constructor(message: string) { super('STORAGE_BOOKING_INVALID', message, 422); } }
export class InvalidAssayError extends DomainError { constructor(message: string) { super('ASSAY_INVALID', message, 422); } }
export class InvalidNwrError extends DomainError { constructor(message: string) { super('NWR_INVALID', message, 422); } }
/** Booking must be 'stored' before it can be assayed / receipted / released. */
export class BookingNotStoredError extends DomainError { constructor(status: string) { super('BOOKING_NOT_STORED', `Booking is not in storage (status: ${status})`, 409, { status }); } }
/** The warehouse has no payee/operator configured to receive the storage fee. */
export class NoWarehouseOperatorError extends DomainError { constructor() { super('NO_WAREHOUSE_OPERATOR', 'Warehouse has no operator to receive the storage fee', 409); } }
export class EnwrExistsError extends AppError { constructor() { super('ENWR_EXISTS', 'An eNWR with this number already exists', 409); } }
/** An NWR already exists for the booking (one active receipt per deposit). */
export class NwrAlreadyIssuedError extends AppError { constructor() { super('NWR_ALREADY_ISSUED', 'An active NWR already exists for this booking', 409); } }
/**
 * PC-56 OPS-1a (founder Q3-A, 2026-11-05) — THE RELEASE THAT DEBITS THE DEPOSITOR'S WALLET IS PAUSED.
 * Release collects the storage fee from the depositor's wallet on the operator's act alone; until she confirms the release and
 * its fee in her own session (a later wave), the route refuses BY NAME, before any lock, fee or state write. Nothing moves.
 */
export const STORAGE_RELEASE_AWAITS_DEPOSITOR_SENTENCE =
  'A release cannot be made here yet: the storage fee would leave the depositor\'s wallet without her confirming it. Nothing was released or charged.';
export class StorageReleaseAwaitsDepositorError extends DomainError {
  constructor() { super('STORAGE_RELEASE_AWAITS_DEPOSITOR', STORAGE_RELEASE_AWAITS_DEPOSITOR_SENTENCE, 409, {}); }
}
/**
 * PC-56 OPS-2c · OPS2-B5 (founder Q2-A, 2026-11-06) — A STORAGE BOOKING IS MADE IN QUINTALS ONLY. The storage fee is computed on the booking's
 * quantity read as quintals (`storage-booking.entity.ts` storageFeeMinor); a booking in kilograms would be charged as if each kilogram were a
 * quintal. So the request is refused BY NAME for any other unit — after the permission check, BEFORE the idempotency record, the unit of work and
 * any write (the OPS-1a ordering): nothing is booked, remembered or emitted, and a replay gets the same refusal.
 */
export const STORAGE_UNIT_NOT_QUINTAL_SENTENCE =
  'Storage is booked in quintals only, because the storage fee is computed on the quantity in quintals. Nothing was booked.';
export class StorageUnitNotQuintalError extends DomainError {
  constructor(unitCode: string) { super('STORAGE_UNIT_NOT_QUINTAL', STORAGE_UNIT_NOT_QUINTAL_SENTENCE, 422, { unitCode, required: 'quintal' }); }
}
/**
 * PC-56 OPS-2c · OPS2-B6 (survey F-3, F-5) — THE OPERATOR NAMED ON A WAREHOUSE MUST BE A MEMBER OF ITS ORGANISATION. The operator's own wallet is
 * where the storage fee would be paid today (founder Q1-A records it; the money wave moves it to the organisation's account), so naming a person
 * who is not an active member of the tenant — any UUID was accepted — is refused BY NAME on listing and on update. Nothing is written.
 */
export const WAREHOUSE_OPERATOR_NOT_A_MEMBER_SENTENCE =
  'The person named as the warehouse operator is not an active member of this organisation. Nothing was saved.';
export class WarehouseOperatorNotAMemberError extends DomainError {
  constructor() { super('WAREHOUSE_OPERATOR_NOT_A_MEMBER', WAREHOUSE_OPERATOR_NOT_A_MEMBER_SENTENCE, 422, {}); }
}
/**
 * PC-56 OPS-2b · OPS2-B2 (founder Q3-A, 2026-11-06) — THIS PLATFORM DOES NOT ISSUE AN eNWR. `POST /v1/warehousing/nwr` recorded a receipt in the
 * depositor's name on the operator's word alone: a number the operator typed, a repository picked from a two-item list, a valuation the operator
 * typed — no repository was called and the depositor was never asked (survey F-2, C-5). It is now refused BY NAME — after the permission check and
 * the Idempotency-Key check, BEFORE the idempotency record, the unit of work and any read or write (the OPS-1a ordering): nothing is recorded,
 * remembered or emitted, and a replay gets the same refusal. Receipts already recorded stay readable (`GET …/nwr`, `GET …/nwr/:id`).
 */
export const ENWR_ISSUE_NOT_ON_PLATFORM_SENTENCE =
  'This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name. Nothing was recorded.';
export class EnwrIssueNotOnPlatformError extends DomainError {
  constructor() { super('ENWR_ISSUE_NOT_ON_PLATFORM', ENWR_ISSUE_NOT_ON_PLATFORM_SENTENCE, 409, {}); }
}
/**
 * PC-56 OPS-2b · OPS2-B1 (founder Q5-A, 2026-11-06) — A RECEIPT IS NEVER RELEASED ON ITS OWN. `POST …/nwr/:id/release` marked a depositor's receipt
 * surrendered while her goods could still be `stored` — nothing tied it to the goods (survey F-1, C-7) — and the release of stored goods is itself
 * refused by name since OPS-1a (STORAGE_RELEASE_AWAITS_DEPOSITOR). Refused BY NAME after the permission check, BEFORE any lock or write.
 */
export const ENWR_RELEASE_NOT_STANDALONE_SENTENCE =
  'A receipt is never released on its own. The release of stored goods is paused, so no receipt is released here. Nothing was changed.';
export class EnwrReleaseNotStandaloneError extends DomainError {
  constructor() { super('ENWR_RELEASE_NOT_STANDALONE', ENWR_RELEASE_NOT_STANDALONE_SENTENCE, 409, {}); }
}
/** PC-56 OPS-2b · OPS2-B1 (founder Q5-A): a receipt is cancelled only with a reason (1–500 characters), refused BY NAME before the idempotency record. */
export const ENWR_CANCEL_REASON_REQUIRED_SENTENCE = 'A reason is required to cancel a receipt. Nothing was changed.';
export class EnwrCancelReasonRequiredError extends DomainError {
  constructor() { super('ENWR_CANCEL_REASON_REQUIRED', ENWR_CANCEL_REASON_REQUIRED_SENTENCE, 400, { maxLength: 500 }); }
}
/**
 * PC-56 OPS-2b (founder Q11-A, applied STRICTLY to the two acts this wave touches — receipt cancel and assay record): only the warehouse's NAMED
 * operator (`warehouses.operator_user_id = the caller`) acts. No administrator escape on these two acts (the shared `isWarehouseAdmin` /
 * `booking.manage` escape on the other acts is OPS-2a's first commit).
 */
export const WAREHOUSE_OPERATOR_ONLY_SENTENCE = 'Only this warehouse\'s named operator can do this. Nothing was changed.';
export class WarehouseOperatorOnlyError extends AppError {
  constructor(act: 'nwr.cancel' | 'assay.record') { super('WAREHOUSE_OPERATOR_ONLY', WAREHOUSE_OPERATOR_ONLY_SENTENCE, 403, { act }); }
}
export class WarehousingForbiddenError extends AppError { constructor(message = 'Not allowed on this warehousing resource') { super('WAREHOUSING_FORBIDDEN', message, 403); } }
