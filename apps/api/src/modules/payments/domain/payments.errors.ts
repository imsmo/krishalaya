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

/** PC-56 HOTFIX-4 · A3: a `payment.captured` carrying the SAME gateway payment id as the attempt already recorded as FAILED. A later capture
 *  of ANOTHER attempt on the same gateway order is booked; this one is refused by name (logged by the webhook) — never silently booked. */
export class LateCaptureSameAttemptError extends DomainError {
  constructor(paymentId: string) { super('PAYMENT_CAPTURE_OF_FAILED_ATTEMPT', 'This gateway payment was recorded as failed; its capture is not booked automatically', 409, { paymentId }); }
}
/** PC-56 HOTFIX-4 · A4: the webhook's payment entity carried notes naming a tenant / payment OTHER than the payment row its gateway order
 *  resolves to. The row is the truth; a disagreeing note is refused (logged), never trusted. */
export class WebhookContextMismatchError extends DomainError {
  constructor(field: 'tenant_id' | 'payment_id') { super('PAYMENT_WEBHOOK_CONTEXT_MISMATCH', `Webhook notes disagree with the payment row (${field})`, 409, { field }); }
}

// ── PC-56 STORE-2c — THE MONEY WAVE (founder D3, brief B3/B5). ──
/** B3: a payment ATTEMPT for this order is still LIVE (initiated / pending / authorized, not yet past `platform.payment_attempt_ttl_seconds`).
 *  A second gateway order while one may still be paid would let the buyer pay twice — refused by name with the live attempt and when it lapses. */
export class PaymentAttemptLiveError extends DomainError {
  constructor(paymentId: string, expiresAt: string | null) {
    super('PAYMENT_ATTEMPT_LIVE', 'A payment attempt for this order is still open — finish it in the payment sheet, or wait until it lapses', 409, { paymentId, expiresAt });
  }
}
/** D3: the automatic refund cannot reach the gateway for this payment (no gateway payment id was ever recorded) — the ledger refund is booked and
 *  the payment stays `refund_initiated`; the money desk completes it. Thrown so the relay retries and, failing that, quarantines it LOUDLY. */
export class RefundGatewayReferenceMissingError extends DomainError {
  constructor(paymentId: string) { super('PAYMENT_REFUND_NO_GATEWAY_REFERENCE', 'This payment has no gateway payment id to refund against', 409, { paymentId }); }
}
/** B5 (founder D4): a charge definition whose method the pricing engine cannot compute (`per_km` needs a resolved delivery distance — deferred).
 *  Refused BY NAME where it is defined, and — for a row written before the gate (by SQL, or an old proposal) — REPORTED by name where it would
 *  be priced: never silently priced at 0 and never a 500. */
export class ChargeMethodUnsupportedError extends DomainError {
  constructor(chargeCode: string, method: string) {
    super('CHARGE_METHOD_UNSUPPORTED', `The charge '${chargeCode}' uses '${method}', which cannot be priced yet`, 422, { chargeCode, method, supported: ['flat', 'percent', 'slab', 'per_unit'] });
  }
}
