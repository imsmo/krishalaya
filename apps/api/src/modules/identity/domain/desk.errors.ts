// modules/identity/domain/desk.errors.ts · PC-56 TENANT-13b · desks — typed errors with stable codes (each a sentence on W185 / the
// W2574–W2580 chains, `dk.refusal.<CODE>` en/hi/gu).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class DeskForbiddenError extends AppError {
  constructor() { super('DESK_FORBIDDEN', 'Desks need desk.manage — tenant_admin, with a second administrator confirming every desk change', 403); }
}
export class DeskNotFoundError extends NotFoundError {
  constructor(id: string) { super('Desk not found'); (this as any).code = 'DESK_NOT_FOUND'; (this as any).details = { id }; }
}
export class DeskProposalNotFoundError extends NotFoundError {
  constructor(id: string) { super('Desk proposal not found'); (this as any).code = 'DESK_PROPOSAL_NOT_FOUND'; (this as any).details = { id }; }
}
/** Every refusal of a desk form, each against the field to blame (W2574 "every invalid field is listed with its reason"). */
export class DeskInvalidError extends DomainError {
  constructor(refusals: Array<{ field: string | null; code: string; detail?: Record<string, unknown> }>) {
    super('DESK_INVALID', 'The desk change cannot be proposed as entered', 422, { refusals });
  }
}
export class DeskNeedsSecondAdminError extends AppError {
  constructor(admins: number) { super('NEEDS_SECOND_ADMIN', 'Desk changes need a second administrator to confirm them — your organisation has one', 409, { admins }); }
}
export class DeskCheckerIsMakerError extends AppError {
  constructor(id: string) { super('CHECKER_IS_MAKER', 'The person who proposed this desk change cannot also confirm it — a second administrator must', 409, { proposalId: id }); }
}
export class DeskProposalLiveError extends AppError {
  constructor(proposalId: string) { super('DESK_PROPOSAL_LIVE', 'This desk already has a change waiting for a second administrator', 409, { proposalId }); }
}
export class DeskProposalExpiredError extends AppError {
  constructor(id: string) { super('DESK_PROPOSAL_EXPIRED', 'This desk proposal expired unconfirmed after 7 days', 409, { proposalId: id }); }
}
export class DeskStaleError extends AppError {
  constructor(reason: string) { super('DESK_PROPOSAL_STALE', `The desk changed since this was proposed: ${reason}`, 409, { reason }); }
}
export class DeskMemberError extends DomainError {
  constructor(code: 'DESK_MEMBER_NOT_IN_TENANT' | 'DESK_MEMBER_ALREADY' | 'DESK_MEMBER_NOT_ON_DESK' | 'DESK_DISABLED' | 'DESK_MEMBER_REASON', message: string) {
    super(code, message, code === 'DESK_MEMBER_REASON' || code === 'DESK_MEMBER_NOT_IN_TENANT' ? 422 : 409);
  }
}
