// modules/memberships/domain/memberships.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class TierNotFoundError extends NotFoundError { constructor(id: string) { super('Membership tier not found'); (this as any).details = { id }; } }
export class MembershipNotFoundError extends NotFoundError { constructor(id: string) { super('Membership not found'); (this as any).details = { id }; } }
export class MembershipForbiddenError extends AppError { constructor(message = 'Not allowed on this membership') { super('MEMBERSHIP_FORBIDDEN', message, 403); } }
export class InvalidTierError extends DomainError { constructor(message: string) { super('MEMBERSHIP_TIER_INVALID', message, 400); } }
/** The chosen tier is inactive (paused) or the requested billing cycle has no price. */
export class TierCodeExistsError extends AppError { constructor() { super('TIER_CODE_EXISTS', 'A tier with this code already exists', 409); } }
export class TierNotSubscribableError extends AppError { constructor(message = 'Tier is not available for subscription') { super('TIER_NOT_SUBSCRIBABLE', message, 409, {}); } }
/** The user already has a live membership — cancel/let it lapse before subscribing again. */
export class AlreadySubscribedError extends AppError { constructor() { super('ALREADY_SUBSCRIBED', 'You already have an active membership', 409); } }
/** Acting on a terminal (cancelled/expired) membership. */
export class MembershipNotLiveError extends AppError { constructor(status: string) { super('MEMBERSHIP_NOT_LIVE', `Membership is not live (status: ${status})`, 409, { status }); } }

// ---- PC-56 TENANT-9b · THE RESOLUTIONS ----
/** A draft, an edit or an act refused — EVERY refusal by name (the form-error / failure screens print the list). */
export class GovernanceRefusedError extends DomainError {
  constructor(refusals: Array<{ field: string | null; code: string }>) {
    super('GOVERNANCE_REFUSED', `refused: ${refusals.map((r) => r.code).join(', ')}`, 422, { refusals });
  }
}
/** F-13: "any word is a ballot" — a choice not declared for this resolution's type (0182 `resolution_choice`). */
export class BallotChoiceUndeclaredError extends DomainError {
  constructor(choice: string, resolutionType: string, declared: string[], code: 'CHOICE_UNDECLARED' | 'BOARD_ELECTION_NOT_MODELLED') {
    super('BALLOT_CHOICE_UNDECLARED', code === 'BOARD_ELECTION_NOT_MODELLED'
      ? 'a board_election ballot names candidates, and no candidate table exists on this platform — refused by name'
      : `'${choice}' is not a choice declared for a ${resolutionType} ballot`, 422, { choice, resolutionType, declared, reason: code });
  }
}
/** F-14: a payout run on a resolution that did not decide to pay (open, failed, not dividend-class, not recorded). */
export class ResolutionNotPayableError extends DomainError {
  constructor(reason: string, message: string) { super('RESOLUTION_NOT_PAYABLE', message, 422, { reason }); }
}
/** The co-op run's maker cannot be its checker; the confirm is a different person's act. */
export class PayoutRunMakerCheckerError extends DomainError {
  constructor() { super('PAYOUT_RUN_MAKER_IS_CHECKER', 'maker-checker: the person who prepared a co-op payout run cannot also confirm it', 403); }
}
/** The roll or the formula moved between prepare and confirm — the checker must not confirm a different run. */
export class PayoutRunDriftedError extends DomainError {
  constructor(detail: Record<string, unknown>) { super('PAYOUT_RUN_DRIFTED', 'the run no longer matches what was prepared — cancel it and prepare again', 409, detail); }
}
