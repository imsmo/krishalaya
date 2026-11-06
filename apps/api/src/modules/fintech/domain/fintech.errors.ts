// modules/fintech/domain/fintech.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class PartnerNotFoundError extends NotFoundError { constructor(id: string) { super('Financial partner not found'); (this as any).code = 'PARTNER_NOT_FOUND'; (this as any).details = { id }; } }
export class LoanProductNotFoundError extends NotFoundError { constructor(id: string) { super('Loan product not found'); (this as any).code = 'LOAN_PRODUCT_NOT_FOUND'; (this as any).details = { id }; } }
export class LoanApplicationNotFoundError extends NotFoundError { constructor(id: string) { super('Loan application not found'); (this as any).code = 'LOAN_APPLICATION_NOT_FOUND'; (this as any).details = { id }; } }
export class LoanNotFoundError extends NotFoundError { constructor(id: string) { super('Loan not found'); (this as any).code = 'LOAN_NOT_FOUND'; (this as any).details = { id }; } }

/** Requested amount outside the product's [min,max]. */
export class AmountOutOfRangeError extends DomainError { constructor(minMinor: bigint, maxMinor: bigint) { super('LOAN_AMOUNT_OUT_OF_RANGE', 'Requested amount is outside the product limits', 422, { minMinor: minMinor.toString(), maxMinor: maxMinor.toString() }); } }
/** Approved amount exceeds the requested amount (lender cannot inflate the loan). */
export class ApprovedExceedsRequestedError extends DomainError { constructor() { super('APPROVED_EXCEEDS_REQUESTED', 'Approved amount cannot exceed the requested amount', 422); } }
/** Anti-predatory cooling-off window still open — disbursal not yet allowed (PRD §59.4). */
export class CoolingOffActiveError extends DomainError { constructor(until: Date) { super('COOLING_OFF_ACTIVE', 'Cooling-off window is still open; disbursal not yet allowed', 409, { until: until.toISOString() }); } }
/** Repayment exceeds the outstanding balance. */
export class OverRepaymentError extends DomainError { constructor(outstandingMinor: bigint) { super('OVER_REPAYMENT', 'Repayment exceeds the outstanding balance', 422, { outstandingMinor: outstandingMinor.toString() }); } }
export class InvalidLoanError extends DomainError { constructor(message: string) { super('LOAN_INVALID', message, 422); } }
export class FintechForbiddenError extends AppError { constructor(message = 'Not allowed on this fintech resource') { super('FINTECH_FORBIDDEN', message, 403); } }
/**
 * PC-56 PARTNER-4b · founder 4b-2 (survey F-3, P4-B4) — THE SECOND DOOR TO THE SAME MONEY IS SHUT BY NAME.
 * Two rails disburse one loan: the FPO wallet (immediate, `LoanApplicationService.disburse`) and a bank payout
 * (queued by a disbursement run, never executed). The run rail already refuses an application the wallet rail has
 * paid (`already_disbursed`, 0089's `uq_loan_disb_item_once`); the wallet rail consulted NOTHING, so a borrower
 * whose payout was queued could also be credited from the wallet — paid twice, owing once, on two screens that
 * promise "double-funding is impossible, not just unlikely". The wallet rail now refuses it here.
 * WHICH RAIL IS THE REAL ONE REMAINS THE FOUNDER'S CALL (4b-2): neither rail is removed.
 */
export class LoanAlreadyQueuedForDisbursalError extends DomainError {
  constructor(applicationId: string) {
    super('LOAN_ALREADY_QUEUED_FOR_DISBURSAL',
      'This application is already claimed by a bank-payout disbursement run, so it cannot also be disbursed from the wallet — one application is disbursed once, by one rail.',
      409, { applicationId });
  }
}
/** PC-56 PARTNER-0 · founder D3: the product's partner decides its own applications in its partner console — tenant staff are refused by name. */
export class LoanDecidedByPartnerError extends AppError {
  constructor(partnerId: string) {
    super('LOAN_DECIDED_BY_PARTNER', 'This application is on a lending partner\'s product that the partner decides in its own console — your organisation disburses once the partner approves.', 403, { partnerId });
  }
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PC-56 PARTNER-5a · THE FOUR NAMED REFUSALS (founder 5a-1 … 5a-4, 2026-11-04 — survey_partner5.md F-1, F-2, F-3; the 2a/3a precedent: a
// tenant-plane first commit in the REFUSING direction only). Each carries the founder's sentence VERBATIM, and each is thrown BEFORE any
// lock, any write and any ledger call, so a refused act leaves nothing behind. The real activation, the write-off record and the second
// person are the fintech owner's founder-signed money wave (P5-B0 + P4-B9; P5-B1 + P4-B12); the borrower's own acceptance is P5-B4.
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 5a-1 · `activated` froze the loan (a `restructured` loan can be neither repaid, deducted, closed nor written off) and applied no term. */
export class RestructureActivationNotLiveError extends DomainError {
  constructor() {
    super('RESTRUCTURE_ACTIVATION_NOT_LIVE',
      'A restructure cannot be activated on the platform yet: the agreed terms would not reach the loan and the loan could no longer be repaid. Nothing was changed.',
      409);
  }
}
/** 5a-2 · `accepted` was a desk click recorded against the borrower's name; she has no screen to accept on. */
export class RestructureAcceptanceNotLiveError extends DomainError {
  constructor() {
    super('RESTRUCTURE_ACCEPTANCE_NOT_LIVE',
      'A borrower\'s acceptance cannot be recorded on the platform yet: the borrower has no screen to accept on, and no one may accept for her.',
      409);
  }
}
/** 5a-3 · a write-off was one person's click that kept no record of who, when or why, and threw the reason away. */
export class WriteOffNotLiveError extends DomainError {
  constructor() {
    super('WRITE_OFF_NOT_LIVE',
      'A write-off cannot be recorded on the platform yet: it would keep no record of who decided it, when, or why, and would need a second person. Nothing was changed.',
      409);
  }
}
/** 5a-4 · the repay route debits the CALLER's own wallet only; a desk can no longer debit a member's wallet "as a repayment". */
export class LoanRepayOwnWalletOnlyError extends AppError {
  constructor() {
    super('LOAN_REPAY_OWN_WALLET_ONLY',
      'A repayment is made from the borrower\'s own wallet by the borrower. A desk cannot repay a member\'s loan from her wallet.',
      403);
  }
}
/**
 * PC-56 OPS-2b · OPS2-B8 (founder Q7-A, 2026-11-06; survey F-8, C-11) — A LOAN APPLICATION CANNOT NAME A WAREHOUSE RECEIPT. `nwrId` was stored as
 * given: any receipt UUID — someone else's, or a cancelled one — with no holder, status or uniqueness check, and the receipt never became `pledged`.
 * Pledging a warehouse receipt is not on this platform, so an application carrying `nwrId` is refused BY NAME after the permission check, BEFORE
 * the idempotency record, the quota and any read or write: nothing is applied for. Without `nwrId` the application is unchanged.
 */
export const LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM_SENTENCE =
  'A loan application cannot name a warehouse receipt: pledging a warehouse receipt is not on this platform. Nothing was applied for.';
export class LoanEnwrPledgeNotOnPlatformError extends DomainError {
  constructor() { super('LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM', LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM_SENTENCE, 422, {}); }
}
