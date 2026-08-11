// modules/payments/domain/payments.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class PaymentNotFoundError extends NotFoundError {
  constructor(id: string) { super('Payment not found'); (this as any).details = { id }; }
}
/** Webhook signature failed verification — treat as hostile, never trust the payload. */
export class WebhookSignatureError extends AppError {
  constructor() { super('PAYMENT_WEBHOOK_BAD_SIGNATURE', 'Invalid webhook signature', 401); }
}
/** Webhook amount disagrees with the recorded intent — possible tampering. */
export class PaymentAmountMismatchError extends AppError {
  constructor(expected: bigint, got: bigint) { super('PAYMENT_AMOUNT_MISMATCH', 'Webhook amount does not match the payment', 409, { expected: expected.toString(), got: got.toString() }); }
}
export class PaymentCurrencyMismatchError extends AppError {
  constructor(expected: string, got: string) { super('PAYMENT_CURRENCY_MISMATCH', 'Webhook currency does not match the payment', 409, { expected, got }); }
}
export class PaymentConcurrencyError extends AppError {
  constructor(id: string) { super('PAYMENT_CONCURRENCY', 'Payment was modified concurrently; retry', 409, { id }); }
}
/** S6 device-test P0: intent-time guard when referenceType==='order' — the requested amountMinor
 *  does not equal the order's outstanding payable total (orders.total_minor). No partial pay at
 *  pilot — exact match only. Both amounts are already known to the caller (their own request + their
 *  own order's total, since ownership was verified first), so echoing them is safe. */
export class OrderPaymentAmountMismatchError extends AppError {
  constructor(expectedMinor: bigint, gotMinor: bigint) {
    super('ORDER_PAYMENT_AMOUNT_MISMATCH', 'Amount does not match the order total due for payment', 409, { expectedMinor: expectedMinor.toString(), gotMinor: gotMinor.toString() });
  }
}
/** S6 device-test P0: webhook-time defense-in-depth — immediately before moving money on a
 *  'payment_captured' event whose payment references an order, re-verify the order is STILL the
 *  same buyer's, STILL awaiting payment, and STILL owes exactly the captured amount. Closes the
 *  window between intent-time validation (createIntent, once) and capture (seconds to days later —
 *  e.g. the order was cancelled meanwhile). Never surfaced to an interactive caller (the webhook has
 *  none), so the message stays generic; `reason` is for logs/alerting only. */
export class PaymentOrderReferenceInvalidError extends AppError {
  constructor(paymentId: string, reason: 'not_found' | 'wrong_buyer' | 'wrong_state' | 'amount_drift') {
    super('PAYMENT_ORDER_REFERENCE_INVALID', 'Order reference no longer matches this payment; money not moved', 409, { paymentId, reason });
  }
}
export class RefundExceedsPaymentError extends DomainError {
  constructor() { super('REFUND_EXCEEDS_PAYMENT', 'Refund amount exceeds the refundable balance', 409); }
}
export class PaymentForbiddenError extends AppError {
  constructor(message = 'Not allowed on this payment') { super('PAYMENT_FORBIDDEN', message, 403); }
}
/** Pay-from-wallet fails closed when the buyer's spendable balance can't cover the order in full. */
export class InsufficientWalletBalanceError extends DomainError {
  constructor(required: bigint, available: bigint) {
    super('WALLET_INSUFFICIENT_BALANCE', 'Wallet balance is less than the amount required', 422, { requiredMinor: required.toString(), availableMinor: available.toString() });
  }
}

/** A batch row was not found in the caller's scope (404, never 403 — no enumeration). */
export class PayoutBatchNotFoundError extends NotFoundError {
  constructor(id: string) { super('Payout batch not found'); (this as any).details = { id }; }
}
/** The payout referenced by an async gateway callback could not be located (unknown gateway id). */
export class PayoutNotFoundError extends NotFoundError {
  constructor(ref: string) { super('Payout not found'); (this as any).details = { ref }; }
}
/** A payout webhook signature failed verification — treat as hostile, never trust the payload. */
export class PayoutWebhookSignatureError extends AppError {
  constructor() { super('PAYOUT_WEBHOOK_BAD_SIGNATURE', 'Invalid payout webhook signature', 401); }
}
/** S3 review finding: an unverified caller (kyc_status none/pending/rejected/expired on every active
 *  role in this tenant) reached money-out. Gates PayoutService.requestPayout BEFORE any debit/ledger
 *  work (reviewer also suggested mirroring this on BankAccountService.add* — that service lives in
 *  modules/identity, out of scope for this change; see the payments-module hardening note). 403,
 *  deliberately generic message — never echoes back which kyc_status the caller is actually in (no
 *  enumeration of verification state). */
export class KycRequiredError extends DomainError {
  constructor() { super('KYC_REQUIRED', 'Complete KYC verification before this action', 403); }
}

/**
 * **THE REFUSAL THAT NAMES THE ROLE (PC-56 TENANT-1).** KYC is per role, not per person: a member verified as a worker
 * may not draw a farmer settlement. A bare "KYC required" on that path is a refusal a field officer cannot act on and a
 * member cannot fix, so this carries the purpose, the roles it accepts, and the role the decision turned on.
 *
 * 403 like its parent — the request is well formed and the caller is who they say they are; what they lack is the
 * verified capacity to receive THIS money.
 */
export class RoleKycRequiredError extends DomainError {
  constructor(detail: { purpose: string; eligibleRoles: string[]; decidingRole: string | null; decidingStatus: string | null; reason: string }) {
    super('ROLE_KYC_REQUIRED',
      detail.decidingRole
        ? `${detail.purpose} money is claimed as ${detail.eligibleRoles.join(' or ') || 'a fully verified member'}; your ${detail.decidingRole} verification is ${detail.decidingStatus}`
        : `${detail.purpose} money is claimed as ${detail.eligibleRoles.join(' or ') || 'a fully verified member'}, and you hold no such verified role in this organisation`,
      403, detail);
  }
}

/** A UPI autopay mandate was not found in the caller's scope (404, never 403 — no enumeration). */
export class MandateNotFoundError extends NotFoundError {
  constructor(id: string) { super('Mandate not found'); (this as any).details = { id }; }
}
/** The caller already holds a live (pending/active/paused) mandate for this purpose. */
export class MandateAlreadyExistsError extends AppError {
  constructor(purpose: string) { super('MANDATE_ALREADY_EXISTS', 'A live autopay mandate already exists for this purpose', 409, { purpose }); }
}
/** A submitted VPA failed the handle@psp shape check — never store/parse an unvalidated VPA. */
export class InvalidVpaError extends DomainError {
  constructor() { super('MANDATE_INVALID_VPA', 'VPA must look like handle@psp', 422); }
}
/** A debit was attempted against a mandate that is not active (pending/cancelled/expired). */
export class MandateNotActiveError extends DomainError {
  constructor(status: string) { super('MANDATE_NOT_ACTIVE', `Mandate is ${status}, not active — cannot collect`, 409, { status }); }
}
/** A requested collection exceeded the mandate's authorised per-debit cap (honour the user's ceiling). */
export class MandateAmountExceedsCapError extends DomainError {
  constructor(amountMinor: bigint, capMinor: bigint) {
    super('MANDATE_AMOUNT_OVER_CAP', 'Collection exceeds the mandate per-debit cap', 422, { amountMinor: amountMinor.toString(), capMinor: capMinor.toString() });
  }
}
/** AutoPay execution is behind the `autopay_execution` flag (default OFF until a live UPI-AutoPay PSP is wired). */
export class MandateExecutionDisabledError extends AppError {
  constructor() { super('MANDATE_EXECUTION_DISABLED', 'UPI AutoPay execution is not enabled', 403); }
}
