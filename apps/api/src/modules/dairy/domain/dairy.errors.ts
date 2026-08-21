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

/**
 * [PC-56 TENANT-6c-4] A deduction line names a TYPE whose money this platform cannot move.
 *
 * Replaces the blanket refusal above for every type that now HAS a destination. The reason is not composed here — it
 * is read from `lookup_values.meta.unsupported_reason`, the same row the vocabulary comes from, so an operator is told
 * why `insurance` cannot be recovered (its premium is a gateway intent, not a wallet movement) or why `share` cannot
 * (the registry wave's ruling: the deduction, the consent and the certificate are one movement, and the allotment act
 * does not exist) rather than being told "unsupported".
 */
export class DeductionTypeUnsupportedError extends DomainError {
  constructor(billId: string, typeCode: string, reason: string) {
    super('DEDUCTION_TYPE_UNSUPPORTED', `Deduction type '${typeCode}' has no destination: ${reason}`, 409, { billId, typeCode, reason });
  }
}

/** [PC-56 TENANT-6c-4] A line points at a source row that does not exist, belongs to somebody else, or is settled. */
export class DeductionSourceInvalidError extends DomainError {
  constructor(sourceType: string, sourceId: string, why: string) {
    super('DEDUCTION_SOURCE_INVALID', `Deduction source ${sourceType} is not recoverable: ${why}`, 409, { sourceType, sourceId, why });
  }
}

/**
 * [PC-56 TENANT-6c-4] W169: *"Deductions above 25% of gross need the member's fresh consent, not just standing
 * instructions."* The threshold is crossed and there is no matching consent, so the payment refuses.
 *
 * `stale` distinguishes the two cases an operator must not confuse: the member has never been asked, versus the
 * member consented to FIGURES THAT HAVE SINCE CHANGED (a bill voided and rebuilt after a dispute is a different bill
 * with the same period). The second one needs a fresh ask, not a chase.
 */
export class DeductionConsentRequiredError extends DomainError {
  constructor(billId: string, grossMinor: string, deductionsMinor: string, thresholdPct: number, stale: boolean) {
    super('DEDUCTION_CONSENT_REQUIRED',
      stale
        ? 'This member consented to different figures — the bill has changed since, so their consent must be asked again'
        : 'Deductions are above the consent threshold and this member has not agreed to them',
      409, { billId, grossMinor, deductionsMinor, thresholdPct, stale });
  }
}

/** [PC-56 TENANT-6c-4] The member REFUSED. Not an error state to retry — a decision the cooperative must answer. */
export class DeductionConsentRefusedError extends DomainError {
  constructor(billId: string, recordedAt: string) {
    super('DEDUCTION_CONSENT_REFUSED',
      'This member has refused these deductions — the bill must be corrected or the deduction dropped, not retried',
      409, { billId, recordedAt });
  }
}

/** [PC-56 TENANT-6c-4] The recovery kill-switch (`dairy_deduction_recovery`) is off for this tenant. */
export class DeductionRecoveryDisabledError extends DomainError {
  constructor(billId: string) {
    super('DEDUCTION_RECOVERY_DISABLED',
      'Deduction recovery is switched off for this tenant, so a bill carrying deductions cannot be paid',
      409, { billId });
  }
}

/**
 * [PC-56 TENANT-6c-4] A bill was asked about its deduction LINES and they were never loaded.
 *
 * An empty array and "not loaded" are different facts, and the difference is a member's money: list reads deliberately
 * do not join the lines (312 rows × N lines on a partitioned money table), so a bill from `listFor` carries `null`
 * rather than `[]`. Any code that needs the lines gets this refusal instead of a silent zero — the same ruling
 * TENANT-6c-1 made about measuring a fact rather than inferring it from an absence.
 */
export class DeductionLinesNotLoadedError extends DomainError {
  constructor(billId: string) {
    super('DEDUCTION_LINES_NOT_LOADED', 'This bill was read without its deduction lines', 500, { billId });
  }
}

/** [PC-56 TENANT-6c-4] A member credit was asked to record a recovery it cannot support. */
export class MemberCreditNotRecoverableError extends DomainError {
  constructor(id: string, why: string) {
    super('DAIRY_MEMBER_CREDIT_NOT_RECOVERABLE', `Member credit cannot be recovered: ${why}`, 409, { id, why });
  }
}

/** [PC-56 TENANT-6c-4] Zero-row UPDATE on the credit or the line — the fail-closed shape 5d/6b-1/6c-2 all closed. */
export class MemberCreditNotFoundError extends DomainError {
  constructor(id: string) { super('DAIRY_MEMBER_CREDIT_NOT_FOUND', 'Member credit not found', 404, { id }); }
}
export class BillDeductionNotFoundError extends DomainError {
  constructor(id: string) { super('MILK_BILL_DEDUCTION_NOT_FOUND', 'Bill deduction line not found', 404, { id }); }
}

/** [PC-56 TENANT-6c-5] A standing instruction this platform cannot honour as described. */
export class DeductionInstructionInvalidError extends DomainError {
  constructor(why: string) { super('DAIRY_DEDUCTION_INSTRUCTION_INVALID', `Standing instruction refused: ${why}`, 422, { why }); }
}
/** [PC-56 TENANT-6c-5] Not this member's arrangement, or no such arrangement — 404-shaped, so ids are not probeable. */
export class DeductionInstructionNotFoundError extends DomainError {
  constructor(id: string) { super('DAIRY_DEDUCTION_INSTRUCTION_NOT_FOUND', 'Standing instruction not found', 404, { id }); }
}

/* --------------------------------------------------------------------------------------------------------------- */
/* PC-56 TENANT-6d-1 · W170 — the tank                                                                             */
/* --------------------------------------------------------------------------------------------------------------- */

/** A cooler whose band, level or state does not make sense. 422: the caller can fix it. */
export class BmcUnitInvalidError extends DomainError {
  constructor(reason: string) { super('BMC_UNIT_INVALID', reason, 422, { reason }); }
}

/** No such cooler for this tenant. A 404 rather than a 403, for the reason every other read here gives. */
export class BmcUnitNotFoundError extends NotFoundError {
  constructor(id: string) { super('BMC unit not found', { id }); (this as any).code = 'BMC_UNIT_NOT_FOUND'; }
}

/**
 * A reading arrived for a cooler this platform cannot judge.
 *
 * Deliberately NOT "store it anyway": a temperature with no band is a number, and `cold_chain_logs.is_breach` would
 * have to be guessed. The sensor's owner gets told, which is how a mis-registered device gets fixed instead of
 * quietly filling a table.
 */
export class BmcReadingRefusedError extends DomainError {
  constructor(reason: string, detail: Record<string, unknown> = {}) { super('BMC_READING_REFUSED', reason, 422, { reason, ...detail }); }
}

/**
 * [PC-56 TENANT-6d-2 · W171] An operator who is not of this cooperative.
 *
 * `mcc_centres.operator_user_id` references the PLATFORM-WIDE `users` table (0003 — `phone` is unique across every
 * tenant, a person's tenants live in `user_tenant_roles`), so the foreign key says nothing about tenancy. Handing
 * custody of 108 families' milk to somebody with no active role in the cooperative is refused here with their id, and
 * refused again by 0163's trigger for anything that does not come through this service.
 */
export class MccOperatorNotInTenantError extends DomainError {
  constructor(userId: string) {
    super('MCC_OPERATOR_NOT_IN_TENANT',
      'This person holds no active role in the cooperative — custody of member milk cannot be assigned to them', 422, { userId });
  }
}

/** A shift window, or a custody handover, that the centre refuses. 422: the caller can fix what they sent. */
export class MccCentreInvalidError extends DomainError {
  constructor(reason: string) { super('MCC_CENTRE_INVALID', reason, 422, { reason }); }
}

/**
 * [PC-56 TENANT-6d-3 · W171] A move this platform will not make, with the reason and the earliest date it could.
 *
 * 422 rather than 409: everything that refuses a move is something the caller can change — a different destination, a
 * different card, a later effective date. The one exception is a membership with no route at all, which is a gap in
 * the record rather than a bad request, and is reported the same way because the operator's next step is identical
 * (tell somebody; do not move this member).
 */
export class MembershipMoveRefusedError extends DomainError {
  constructor(refusal: string, detail: Record<string, unknown> = {}) {
    super('MEMBERSHIP_MOVE_REFUSED', `This membership cannot be moved: ${refusal}`, 422, { refusal, ...detail });
  }
}

/**
 * [PC-56 TENANT-6d-5 · W2521] A call this platform will not place, with every reason at once.
 *
 * 422 rather than 403 even when the reason is a permission: the caller reached a route they are allowed to reach (the
 * dairy desk's own monitor) and asked for an act that cannot be performed on THIS tank right now. The screen prints the
 * reasons; the status code is not the message.
 */
export class BmcCallRefusedError extends DomainError {
  constructor(refusals: readonly string[]) {
    super('BMC_CALL_REFUSED', `this call cannot be placed: ${refusals.join(', ')}`, 422, { refusals });
  }
}

/**
 * [PC-56 TENANT-6d-6 · W170] A diversion this platform will not record, with every reason at once.
 */
export class DiversionRefusedError extends DomainError {
  constructor(refusals: readonly string[]) {
    super('DAIRY_DIVERSION_REFUSED', `this diversion cannot be recorded: ${refusals.join(', ')}`, 422, { refusals });
  }
}

/**
 * [PC-56 TENANT-6d-6] A pour recorded at a centre the member is not routed to, with no live diversion permitting it.
 *
 * 409 rather than 422: the entry is well formed and the platform's STATE is what refuses it — there is no authority for
 * this member's milk to be taken at this village tonight. The message names the centre the counter asked for and the
 * one the member belongs to, because an operator at a counter needs to know which of the two is wrong.
 */
export class PourNotAtThisCentreError extends DomainError {
  constructor(membershipId: string, enteredMccId: string, routeMccId: string | null) {
    super('POUR_NOT_AT_THIS_CENTRE',
      routeMccId === null
        ? `membership ${membershipId} has no recorded route for that day, so a pour cannot be attributed to a centre`
        : `membership ${membershipId} is routed to centre ${routeMccId} that day, and no live diversion sends that shift to ${enteredMccId}`,
      409, { membershipId, enteredMccId, routeMccId });
  }
}
