// modules/dairy/domain/dairy.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class MccNotFoundError extends NotFoundError { constructor(id: string) { super('MCC centre not found'); (this as any).code = 'MCC_NOT_FOUND'; (this as any).details = { id }; } }
export class MembershipNotFoundError extends NotFoundError { constructor(id: string) { super('Dairy membership not found'); (this as any).code = 'DAIRY_MEMBERSHIP_NOT_FOUND'; (this as any).details = { id }; } }
export class RateCardNotFoundError extends NotFoundError { constructor(id: string) { super('Milk rate card not found'); (this as any).code = 'RATE_CARD_NOT_FOUND'; (this as any).details = { id }; } }
export class NoActiveRateCardError extends DomainError { constructor(animalType: string) { super('NO_ACTIVE_RATE_CARD', `No active milk rate card for animal type '${animalType}'`, 422, { animalType }); } }
export class CollectionNotFoundError extends NotFoundError { constructor(id: string) { super('Milk collection not found'); (this as any).code = 'COLLECTION_NOT_FOUND'; (this as any).details = { id }; } }
export class BillNotFoundError extends NotFoundError { constructor(id: string) { super('Milk bill not found'); (this as any).code = 'MILK_BILL_NOT_FOUND'; (this as any).details = { id }; } }

export class MccCodeExistsError extends AppError { constructor() { super('MCC_CODE_EXISTS', 'An MCC with this code already exists', 409); } }
export class MemberCodeExistsError extends AppError { constructor() { super('MEMBER_CODE_EXISTS', 'A membership with this member code already exists at this MCC', 409); } }
export class DuplicateCollectionError extends AppError { constructor() { super('DUPLICATE_COLLECTION', 'A collection for this member/shift/day already exists', 409); } }
export class InvalidRateCardError extends DomainError { constructor(message: string) { super('RATE_CARD_INVALID', message, 422); } }
export class InvalidCollectionError extends DomainError { constructor(message: string) { super('COLLECTION_INVALID', message, 422); } }
export class BillNotPayableError extends DomainError { constructor(status: string) { super('BILL_NOT_PAYABLE', `Milk bill cannot be paid from status '${status}'`, 409, { status }); } }
export class EmptyBillError extends DomainError { constructor() { super('EMPTY_BILL', 'No collections in the period to bill', 422); } }
export class DairyForbiddenError extends AppError { constructor(message = 'Not allowed on this dairy resource') { super('DAIRY_FORBIDDEN', message, 403); } }

export class QualityReviewNotFoundError extends NotFoundError {
  constructor(id: string) { super('Milk quality review not found'); (this as any).code = 'QUALITY_REVIEW_NOT_FOUND'; (this as any).details = { id }; }
}

/**
 * [PC-56 TENANT-6b-1] Every pour in the period is under a quality hold, so there is nothing to bill YET.
 *
 * Distinct from `EMPTY_BILL` on purpose: "this member did not pour" and "this member's three pours are all awaiting a
 * re-test" are different facts, and a cycle job that logs the first when the second is true sends somebody looking for
 * a farmer who is standing at the counter every morning.
 */
export class AllPoursHeldError extends DomainError {
  constructor(heldCount: number, heldMinor: string) {
    super('ALL_POURS_HELD', `Every unbilled pour in the period is under a quality hold (${heldCount})`, 422, { heldCount, heldMinor });
  }
}

/**
 * [PC-56 TENANT-6b-1] A bill-attach UPDATE that matched NO ROW.
 *
 * `attachToBill` stamps `milk_bill_id` onto the collections a bill settled, matching on `(id, collected_on)` because
 * `collected_on` is the partition key. If that predicate misses — which it did, for every deployment ahead of UTC,
 * because the date came back through `toISOString()` a day early — the bill is still inserted, approved and PAID while
 * the collections stay unbilled, and the next cycle bills and pays them AGAIN.
 *
 * So it fails CLOSED: the transaction rolls back, no bill exists, no outbox row is written, and a human sees an error
 * instead of a farmer being paid twice out of the cooperative's wallet. Law 12 — degrade, never die: a write that
 * moves a family's milk money may fail loudly, and may not vanish. (Same ruling TENANT-5d made for
 * `SHIPMENT_UPDATE_LOST`, on the same defect shape.)
 */
export class CollectionStampLostError extends AppError {
  constructor(collectionId: string, collectedOn: string) {
    super('COLLECTION_STAMP_LOST', 'Bill-attach matched no collection row — refusing to leave a paid pour unbilled', 409, { collectionId, collectedOn });
  }
}
