// apps/admin-api/src/modules/support-oversight/domain/support-oversight.errors.ts · typed errors → HTTP via
// HttpException subclasses with stable codes (mirrors the other ops modules).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}
export class TicketNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SUPPORT_TICKET_NOT_FOUND', `support ticket ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class AssigneeNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SUPPORT_ASSIGNEE_NOT_FOUND', `assignee user ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
/** Escalation can only RAISE priority and must change something (severity and/or status). */
export class InvalidEscalationError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_ESCALATION_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** Illegal ticket status transition (e.g. escalating a resolved/closed ticket). */
export class IllegalTicketTransitionError extends Error {
  readonly code = 'SUPPORT_TICKET_ILLEGAL_TRANSITION';
  constructor(public readonly from: string, public readonly to: string) {
    super(`Cannot move ticket ${from}→${to}`);
    this.name = 'IllegalTicketTransitionError';
  }
}

// ---- PC-56 ADMIN-2 ----
/** A macro the rules refuse (bad shortcut, unreviewed language, body too short to be a canned answer). 422: the
 *  request was understood and is not allowed, and the message says which rule. */
export class InvalidMacroError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_MACRO_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** The shortcut is already in use. 409, not 422: the request was fine, it collided — and telling an author so is how
 *  they discover the answer they were about to write already exists. */
export class DuplicateMacroError extends DomainHttpError {
  constructor(slug: string) { super('SUPPORT_MACRO_DUPLICATE', `the shortcut /${slug} is already in use`, HttpStatus.CONFLICT, { slug }); }
}
export class MacroNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SUPPORT_MACRO_NOT_FOUND', `macro ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}

/** A support policy the rules refuse — a chain that wakes somebody at an hour the policy says the desk is shut, an SLA
 *  with no chain behind it, targets that tighten as severity falls. 422 with the specific rule in the message. */
export class InvalidSupportPolicyError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_POLICY_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** An oversight write the ticket's state machine refuses. 409: the request was fine, the ticket has moved on. */
export class TicketStateError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_TICKET_STATE', detail, HttpStatus.CONFLICT, { detail }); }
}

/** A review or coaching record the rules refuse — no reasoning, a session in the past, or coaching somebody for a
 *  verdict that blamed a process rather than a person. 422 with the specific rule in the message. */
export class InvalidCoachingError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_COACHING_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class CoachingNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SUPPORT_COACHING_NOT_FOUND', `coaching record ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
/** A rating that does not exist. 404 rather than a foreign-key 500: an operator can read a 404. */
export class CsatResponseNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SUPPORT_CSAT_NOT_FOUND', `rating ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}

/** A reply the rules refuse — too short to be an answer, or in a language the platform has no template for. 422 with
 *  the specific rule, because the operator has just written something and needs to know what to change. */
export class InvalidPlatformReplyError extends DomainHttpError {
  constructor(detail: string) { super('SUPPORT_REPLY_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
