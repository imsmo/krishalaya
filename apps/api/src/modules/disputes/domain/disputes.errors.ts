// modules/disputes/domain/disputes.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class DisputeNotFoundError extends NotFoundError { constructor(id: string) { super('Dispute not found'); (this as any).details = { id }; } }
/** The raiser has no eligibility (no delivered order with this counterparty), or isn't a party to it. */
export class NotEligibleToDisputeError extends AppError { constructor() { super('DISPUTE_NOT_ELIGIBLE', 'You can only dispute an order you are a party to (after delivery)', 403); } }
/** The actor is not the raiser / the respondent / a moderator, as the action requires. */
export class DisputeForbiddenError extends AppError { constructor(message = 'Not allowed on this dispute') { super('DISPUTE_FORBIDDEN', message, 403); } }
/** Acting on a terminal dispute (resolved/rejected/withdrawn). */
export class DisputeNotActiveError extends AppError { constructor(status: string) { super('DISPUTE_NOT_ACTIVE', `Dispute is not active (status: ${status})`, 409, { status }); } }
/** The raiser already has an OPEN dispute on this order (bounds dispute spam — one active at a time). */
export class DuplicateDisputeError extends AppError { constructor() { super('DISPUTE_DUPLICATE', 'You already have an active dispute on this order', 409); } }
export class InvalidDisputeError extends DomainError { constructor(message: string) { super('DISPUTE_INVALID', message, 400); } }

// ---- returns / RMA ----
export class ReturnNotFoundError extends NotFoundError { constructor(id: string) { super('Return not found'); (this as any).details = { id }; } }
/** The actor is not the buyer / the seller / a moderator, as the return action requires. */
export class ReturnForbiddenError extends AppError { constructor(message = 'Not allowed on this return') { super('RETURN_FORBIDDEN', message, 403); } }
/** Acting on a terminal return (refunded/rejected). */
export class ReturnNotActiveError extends AppError { constructor(status: string) { super('RETURN_NOT_ACTIVE', `Return is not active (status: ${status})`, 409, { status }); } }
/** The order already has an ACTIVE return (one at a time — bounds abuse). */
export class DuplicateReturnError extends AppError { constructor() { super('RETURN_DUPLICATE', 'This order already has an active return', 409); } }
/** Only the order's buyer may request a return (eligibility resolved server-side, anti-IDOR). */
export class NotEligibleToReturnError extends AppError { constructor() { super('RETURN_NOT_ELIGIBLE', 'You can only return an order you bought (after delivery)', 403); } }
export class InvalidReturnError extends DomainError { constructor(message: string) { super('RETURN_INVALID', message, 400); } }

// ---- PC-56 HOTFIX-7 · D2 (founder Q2) ----
/** No "refunded" without money: a refund decision (a dispute resolved `refund_full` / `refund_partial`, or a return refunded) is refused BY NAME
 *  while the tenant's `dispute_refunds` money switch is OFF — the payments handlers move nothing then, so the status would be a lie. The dispute
 *  or return stays where it was. (Ops owed: switching `disputes` ON requires `dispute_refunds` ON — admin-api's toggle, Law 11.) */
export class DisputeRefundsOffError extends DomainError {
  constructor(kind: 'dispute' | 'return', id: string) {
    super('DISPUTE_REFUNDS_OFF', 'Refunds are switched off for this organisation — a refund cannot be decided until the money switch is on', 409, { kind, id });
  }
}
