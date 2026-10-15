// modules/payments/domain/payment.state.ts · the payment_status state machine (Law 5). The ONLY
// place transitions live. Mirrors the payment_status enum in db/migrations/0006_money.sql.
import { DomainError } from '../../../shared/errors/app-error';

export const PAYMENT_STATUSES = [
  'initiated', 'pending', 'authorized', 'success', 'failed', 'expired',
  'refund_initiated', 'refunded', 'partially_refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = Object.freeze({
  initiated:          ['pending', 'authorized', 'success', 'failed', 'expired'],
  pending:            ['authorized', 'success', 'failed', 'expired'],
  authorized:         ['success', 'failed'],
  success:            ['refund_initiated', 'partially_refunded', 'refunded'],
  refund_initiated:   ['refunded', 'partially_refunded', 'failed'],
  partially_refunded: ['refund_initiated', 'partially_refunded', 'refunded'],
  refunded:           [],
  // PC-56 HOTFIX-4 · A3 (survey F-4a / B6): a gateway order can carry SEVERAL payment attempts (a retry inside the same Razorpay sheet). A
  // failed attempt followed by a CAPTURED one must be booked — before this, `failed` was terminal and the late capture rolled the whole
  // webhook transaction back after posting the escrow legs: money taken at the gateway, never booked, the order auto-cancelled at 24 h.
  // The entity (Payment.markCaptured) allows this edge ONLY for a capture whose gateway payment id differs from the failed attempt's.
  failed:             ['success'],
  // PC-56 STORE-2c · B3: an attempt the platform LAPSED (the buyer sent a fresh request after `platform.payment_attempt_ttl_seconds`) can still be
  // captured late at the gateway — a UPI collect approved at minute 16. That money is real: it is booked (once — the wallet key is per payment
  // row), never dropped. The entity allows it for any gateway payment id (a lapsed attempt was never captured, so no id can be its own replay).
  expired:            ['success'],
});

export class IllegalPaymentTransitionError extends DomainError {
  constructor(from: string, to: string) { super('PAYMENT_ILLEGAL_TRANSITION', `Cannot move payment ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void { if (!canTransition(from, to)) throw new IllegalPaymentTransitionError(from, to); }
export function isTerminal(s: PaymentStatus): boolean { return s === 'refunded' || s === 'failed' || s === 'expired'; }
export function isSettled(s: PaymentStatus): boolean { return s === 'success' || s === 'partially_refunded' || s === 'refunded'; }
