// modules/requirements/domain/requirements.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class RequirementNotFoundError extends NotFoundError { constructor(id: string) { super('Requirement not found'); (this as any).details = { id }; } }
export class ResponseNotFoundError extends NotFoundError { constructor(id: string) { super('Quote not found'); (this as any).details = { id }; } }
/** Acting on a requirement that is no longer soliciting/usable (fulfilled/expired/closed). */
export class RequirementNotOpenError extends AppError { constructor(status: string) { super('REQUIREMENT_NOT_OPEN', `Requirement is not open (status: ${status})`, 409, { status }); } }
/** Acting on a quote that is no longer live (accepted/rejected/expired). */
export class ResponseNotLiveError extends AppError { constructor(status: string) { super('RESPONSE_NOT_LIVE', `Quote is not live (status: ${status})`, 409, { status }); } }
/** The actor is not the requirement's buyer / the quote's seller / a moderator, as required. */
export class RequirementForbiddenError extends AppError { constructor(message = 'Not allowed on this requirement') { super('REQUIREMENT_FORBIDDEN', message, 403); } }
/** A seller cannot quote on their OWN requirement (no self-deal). */
export class SellerIsBuyerError extends AppError { constructor() { super('REQUIREMENT_SELF_QUOTE', 'You cannot quote on your own requirement', 403); } }
/** A quote can only become an order if it references a listing (order_items needs a listing+product). */
export class ResponseNotAcceptableError extends AppError { constructor() { super('RESPONSE_NOT_ACCEPTABLE', 'Quote must reference a listing before it can be accepted into an order', 409); } }
/** One quote per (requirement, seller) — UNIQUE in the schema. */
export class DuplicateResponseError extends AppError { constructor() { super('RESPONSE_DUPLICATE', 'You have already quoted on this requirement', 409); } }
export class InvalidRequirementError extends DomainError { constructor(message: string) { super('REQUIREMENT_INVALID', message, 400); } }
export class InvalidResponseError extends DomainError { constructor(message: string) { super('RESPONSE_INVALID', message, 400); } }

// ---- PC-56 TENANT-11d -------------------------------------------------------------------------------------------------------
/** A3 / A4: acting for a buyer, or responding with member stock, needs requirement.desk. */
export class RequirementDeskForbiddenError extends AppError { constructor(message = 'This needs the buyer desk (requirement.desk)') { super('REQUIREMENT_DESK_FORBIDDEN', message, 403); } }
/** A3 / A4 / F-20: the desk acts for the buyer only with the buyer's recorded consent for THAT act. */
export class BuyerConsentRequiredError extends AppError {
  constructor(act: string, code = 'REQUIREMENT_BUYER_CONSENT_REQUIRED') { super(code, code === 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED' ? 'A voice or written consent needs its evidence media' : `The buyer's recorded consent is required to ${act} for them`, 403, { act }); }
}
/** The named buyer / member is not an active member of this tenant. */
export class NotATenantMemberError extends AppError { constructor(userId: string, role: 'buyer' | 'member') { super('REQUIREMENT_NOT_A_MEMBER', `The named ${role} is not an active member of this tenant`, 422, { userId, role }); } }
/** A1: send is refused while any line lacks its member's consent — the refusal NAMES the member. */
export class ConsentMissingError extends AppError {
  constructor(members: Array<{ userId: string; name: string | null; lineId: string }>) {
    super('CONSENT_MISSING', `Not sent — ${members.map((m) => m.name ?? 'a member').join(', ')} ${members.length === 1 ? 'has' : 'have'} not consented to their line`, 409, { members });
  }
}
export class ResponseGroupNotFoundError extends NotFoundError { constructor(id: string) { super('Pooled quote not found'); (this as any).details = { id }; } }
export class GroupLineNotFoundError extends NotFoundError { constructor(id: string) { super('Line not found'); (this as any).details = { id }; } }
export class ResponseGroupStateError extends AppError { constructor(status: string, message = `The pooled quote is ${status}`) { super('REQUIREMENT_GROUP_STATE', message, 409, { status }); } }
export class EmptyResponseGroupError extends AppError { constructor() { super('REQUIREMENT_GROUP_EMPTY', 'A pooled quote needs at least one member line', 409); } }
/** A1: the line's listing must be a tenant member's PUBLISHED listing with available ≥ quantity, in the requirement's unit. */
export class GroupLineInvalidError extends AppError { constructor(code: string, message: string, details?: Record<string, unknown>) { super(code, message, 422, details); } }
/** A2: an accepted quantity must be > 0 and ≤ the quote's quantity. */
export class AcceptQuantityError extends AppError { constructor(max: string) { super('RESPONSE_ACCEPT_QUANTITY_INVALID', `Accept between 0 and ${max} (the quote's quantity)`, 422, { max }); } }
/** A7: a moderator closing a buyer's requirement must give a reason. */
export class CloseReasonRequiredError extends AppError { constructor() { super('REQUIREMENT_CLOSE_REASON_REQUIRED', 'Closing a buyer\'s requirement needs a reason (3–300 characters)', 422); } }
