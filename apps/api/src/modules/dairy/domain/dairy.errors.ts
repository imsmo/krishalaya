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

/** [PC-56 TENANT-6c-2] The member's 24h window is still open, so the money must not move yet (W169). */
export class DisputeWindowOpenError extends DomainError {
  constructor(billId: string, windowEndsAt: string) {
    super('DISPUTE_WINDOW_OPEN',
      'This member still has time to check their bill — the payment waits until their window closes',
      409, { billId, windowEndsAt });
  }
}

/** [PC-56 TENANT-6c-2] A dispute raised outside the window the member was given. */
export class DisputeWindowClosedError extends DomainError {
  constructor(billId: string, windowEndsAt: string | null) {
    super('DISPUTE_WINDOW_CLOSED',
      windowEndsAt === null
        ? 'This bill has not been shown to its member yet, so there is nothing to dispute'
        : 'The window for raising a query on this bill has closed',
      409, { billId, windowEndsAt });
  }
}

/** [PC-56 TENANT-6c-2] A voided bill is a member's fortnight leaving the record; it does not happen without a reason. */
export class BillVoidReasonRequiredError extends DomainError {
  constructor(billId: string) {
    super('BILL_VOID_REASON_REQUIRED', 'Voiding a milk bill requires a reason of at least 10 characters', 422, { billId });
  }
}

/** [PC-56 TENANT-6c-2] Two open disputes on one bill would let two resolutions disagree about one payment. */
export class DisputeAlreadyOpenError extends DomainError {
  constructor(billId: string) {
    super('DISPUTE_ALREADY_OPEN', 'There is already an open query on this bill', 409, { billId });
  }
}

export class DisputeNotFoundError extends NotFoundError {
  constructor(id: string) { super('Milk bill query not found'); (this as any).code = 'DISPUTE_NOT_FOUND'; (this as any).details = { id }; }
}

export class BillCycleNotFoundError extends NotFoundError {
  constructor(id: string) { super('Dairy bill cycle not found'); (this as any).code = 'DAIRY_CYCLE_NOT_FOUND'; (this as any).details = { id }; }
}

/**
 * [PC-56 TENANT-6c-3] An approval refused — either the cycle was never previewed, or the checker IS the previewer.
 *
 * The second case carries the previewer's id so the console can say *"previewed by Rameshbhai — somebody else must
 * approve"* rather than "forbidden", which is the difference between a control a cooperative can work with and one
 * that looks like a bug.
 */
export class CycleApprovalRefusedError extends DomainError {
  constructor(id: string, reason: 'DAIRY_CYCLE_NOT_PREVIEWED' | 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER', previewedBy: string | null) {
    super(reason,
      reason === 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER'
        ? 'The person who previewed this cycle cannot also approve it — 312 families\' milk money needs two humans'
        : 'This cycle has not been shown to its members yet, so there is nothing to approve',
      409, { id, reason, previewedBy });
  }
}

/** [PC-56 TENANT-6c-1] A cycle asked to close before its window shut, or to build bills before it closed. */
export class CycleNotClosableError extends DomainError {
  constructor(id: string, why: string, closesAt: string | null) {
    super('DAIRY_CYCLE_NOT_CLOSABLE', `Dairy bill cycle cannot close: ${why}`, 409, { id, why, closesAt });
  }
}

/**
 * [PC-56 TENANT-6c-1] A bill carrying deductions was asked to be PAID, and this platform has nowhere to send them.
 *
 * `milk_bills.deductions` is `[{type, amount_minor}]` with `type` a free-typed 40-character string — no vocabulary
 * table, no seed, and no reference to the loan, input advance or insurance policy it is supposedly repaying (Law 6).
 * `pay()` posts ONE ledger movement: the NET, cooperative → farmer. The deducted amount is never paid to the member
 * and never posted anywhere else, so a `loan_emi` line takes Rs 300 out of a family's milk money and reduces no loan
 * by anything — the farmer pays that instalment twice, and the cooperative's wallet quietly keeps the difference with
 * no ledger row to find it by.
 *
 * So the money path FAILS CLOSED, exactly as `COLLECTION_STAMP_LOST` does for a lost bill-attach: a bill with
 * deductions cannot be paid until the destination exists (TENANT-6c-2). A refusal an operator can read beats a
 * silent transfer nobody can reconcile, and there is no third option that is honest — Law 2 forbids inventing a
 * ledger leg here, and paying the gross would hand back money the cooperative is owed.
 */
export class DeductionHasNoDestinationError extends DomainError {
  constructor(billId: string, deductionsMinor: string, types: string[]) {
    super('DEDUCTION_HAS_NO_DESTINATION',
      'This bill carries deductions and no account to post them to — refusing to keep a member\'s money without a ledger entry',
      409, { billId, deductionsMinor, types });
  }
}
