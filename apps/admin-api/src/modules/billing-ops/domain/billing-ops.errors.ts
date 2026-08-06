// apps/admin-api/src/modules/billing-ops/domain/billing-ops.errors.ts · typed errors → HTTP via HttpException
// subclasses with stable codes (mirrors recon-monitor / compliance-ops).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}
export class SaasInvoiceNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('SAAS_INVOICE_NOT_FOUND', `saas invoice ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class BillingTenantNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('BILLING_TENANT_NOT_FOUND', `tenant ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class InvalidAdjustmentError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_ADJUSTMENT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
// ---- PC-56 ADMIN-1b ----
export class InvalidPaymentError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_PAYMENT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class PaymentNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('BILLING_PAYMENT_NOT_FOUND', `payment ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
/** A duplicate reference against the same invoice (the 0092 unique index). 409, not 422: the caller's request was
 *  well-formed, it just collided with a payment that is already recorded — and telling them so is how they discover
 *  it was already banked rather than re-keying it a third time. */
export class DuplicatePaymentError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_PAYMENT_DUPLICATE', detail, HttpStatus.CONFLICT, { detail }); }
}
/** An adjustment workflow move that the maker-checker rules forbid (wrong state, or the requester deciding their own
 *  request). 409 for a state clash; 403 when it is an authority problem — the two are different conversations. */
export class AdjustmentStateError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_ADJUSTMENT_STATE', detail, HttpStatus.CONFLICT, { detail }); }
}
export class SelfApprovalError extends DomainHttpError {
  constructor() {
    super('BILLING_SELF_APPROVAL_FORBIDDEN',
      'the operator who requested an adjustment cannot decide it; a second approver is required', HttpStatus.FORBIDDEN);
  }
}
export class AdjustmentNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('BILLING_ADJUSTMENT_NOT_FOUND', `adjustment ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class InvalidExportError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_EXPORT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class InvalidBulkActionError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_BULK_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

export class SubscriptionNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('BILLING_SUBSCRIPTION_NOT_FOUND', `no subscription for ${ref}`, HttpStatus.NOT_FOUND, { ref }); }
}
/** A change the commercial rules refuse (dead subscription, same plan, zero price, currency switch, backwards addon
 *  dates). 422: the request was understood and is not allowed — the message says which rule. */
export class InvalidSubscriptionChangeError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_SUBSCRIPTION_CHANGE_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

export class InvalidDunningPolicyError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_DUNNING_POLICY_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

export class InvalidDunningError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_DUNNING_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** The wallet-service rejected or could not apply the money move (frozen/insufficient/unavailable). Never a partial. */
export class WalletAdjustmentFailedError extends DomainHttpError {
  constructor(detail: string) { super('BILLING_WALLET_ADJUSTMENT_FAILED', `manual adjustment not applied: ${detail}`, HttpStatus.BAD_GATEWAY, { detail }); }
}
