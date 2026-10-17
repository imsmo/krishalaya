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
/** PC-56 PARTNER-0 · founder D3: the product's partner decides its own applications in its partner console — tenant staff are refused by name. */
export class LoanDecidedByPartnerError extends AppError {
  constructor(partnerId: string) {
    super('LOAN_DECIDED_BY_PARTNER', 'This application is on a lending partner\'s product that the partner decides in its own console — your organisation disburses once the partner approves.', 403, { partnerId });
  }
}
