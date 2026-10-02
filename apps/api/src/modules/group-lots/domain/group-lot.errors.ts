// modules/group-lots/domain/group-lot.errors.ts · typed errors with stable codes. Every refusal the console can meet has a
// code here and a sentence in web-tenant's i18n (`gl.code.*`).
import { DomainError } from '../../../shared/errors/app-error';

export class GroupLotForbiddenError extends DomainError {
  constructor(msg = 'requires group_lot.coordinate', details?: Record<string, unknown>) { super('GROUP_LOT_FORBIDDEN', msg, 403, details); }
}
/** F-23 — an act only THIS lot's coordinator (or tenant_admin, group_lot.manage) may perform. */
export class NotLotCoordinatorError extends DomainError {
  constructor(id: string) { super('GROUP_LOT_NOT_COORDINATOR', 'Only this lot\'s coordinator or tenant_admin may do that', 403, { id }); }
}
export class GroupLotNotFoundError extends DomainError {
  constructor(id: string) { super('GROUP_LOT_NOT_FOUND', `Group lot ${id} not found`, 404, { id }); }
}
export class PledgeClosedError extends DomainError {
  constructor() { super('GROUP_LOT_PLEDGE_CLOSED', 'Pledging is closed for this lot', 409); }
}
export class InvalidGroupLotError extends DomainError {
  constructor(msg: string, code = 'GROUP_LOT_INVALID') { super(code, msg, 422); }
}
export class EmptyGroupLotError extends DomainError {
  constructor() { super('GROUP_LOT_EMPTY', 'The lot has no active pledges', 422); }
}
export class NotAMemberError extends DomainError {
  constructor(userId: string) { super('GROUP_LOT_NOT_A_MEMBER', 'That person is not an active member of this organisation', 422, { userId }); }
}
export class CoordinatorConsentRequiredError extends DomainError {
  constructor(code: 'GROUP_LOT_CONSENT_REQUIRED' | 'GROUP_LOT_CONSENT_EVIDENCE_REQUIRED' = 'GROUP_LOT_CONSENT_REQUIRED') {
    super(code, code === 'GROUP_LOT_CONSENT_REQUIRED' ? 'Appointing another member as coordinator needs their recorded consent' : 'A voice or written consent needs its evidence media', 422);
  }
}
export class AlreadyExtendedError extends DomainError {
  constructor() { super('GROUP_LOT_ALREADY_EXTENDED', 'The deadline was already extended once', 409); }
}
export class ExtensionTooLongError extends DomainError {
  constructor(maxIso: string) { super('GROUP_LOT_EXTENSION_TOO_LONG', 'An extension is at most 48 hours past the current deadline', 422, { maxDeadline: maxIso }); }
}
export class NudgeTooSoonError extends DomainError {
  constructor(nextAtIso: string) { super('GROUP_LOT_NUDGE_TOO_SOON', 'This lot was nudged in the last 24 hours', 429, { nextAt: nextAtIso }); }
}
export class ReadyReasonRequiredError extends DomainError {
  constructor() { super('GROUP_LOT_READY_REASON_REQUIRED', 'Marking a lot ready below its target needs a reason', 422); }
}
export class CancelReasonError extends DomainError {
  constructor(code: 'GROUP_LOT_CANCEL_REASON_REQUIRED' | 'GROUP_LOT_CANCEL_TEXT_REQUIRED') {
    super(code, code === 'GROUP_LOT_CANCEL_REASON_REQUIRED' ? 'Choose why the lot is cancelled' : 'Write the reason (3–300 characters)', 422);
  }
}
export class ListingInAuctionError extends DomainError {
  constructor() { super('GROUP_LOT_LISTING_IN_AUCTION', 'The lot is under auction; the auction decides it', 409); }
}
export class WithdrawClosedError extends DomainError {
  constructor() { super('GROUP_LOT_WITHDRAW_CLOSED', 'A pledge can be withdrawn only until the lot lists', 409); }
}
export class NoPledgeError extends DomainError {
  constructor() { super('GROUP_LOT_NO_PLEDGE', 'You have no active pledge in this lot', 404); }
}
export class SettlementStateError extends DomainError {
  constructor(code: 'GROUP_LOT_NOT_SOLD' | 'GROUP_LOT_NOTHING_PREPARED' | 'GROUP_LOT_ALREADY_PREPARED', msg: string) { super(code, msg, 409); }
}
/** Maker ≠ checker — the service's door; the DB trigger is the wall behind it. */
export class SettlementCheckerError extends DomainError {
  constructor() { super('GROUP_LOT_CHECKER_IS_MAKER', 'The person who prepared the settlement, or the coordinator who earns its fee, cannot confirm it', 403); }
}
/** Defensive: the held proceeds are short of the gross (should be impossible). Nothing moves. */
export class HoldShortError extends DomainError {
  constructor(neededMinor: bigint, heldMinor: bigint) {
    super('GROUP_LOT_HOLD_SHORT', 'The held sale proceeds do not cover the settlement; nothing was paid', 409, { neededMinor: neededMinor.toString(), heldMinor: heldMinor.toString() });
  }
}
/** The sale consumer could not find the order's settlement yet (delivered before it committed) — the relay retries. */
export class SaleNotSettledError extends DomainError {
  constructor(orderId: string) { super('GROUP_LOT_SALE_NOT_SETTLED', `Order ${orderId} has no settlement line yet`, 409, { orderId }); }
}
