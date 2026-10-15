// modules/payments/domain/payment.entity.ts
// Payment aggregate (money IN). Pure domain: amounts in bigint minor units, status transitions
// ONLY via the state machine (Law 5), optimistic-locked by `version` (from add_std_columns).
// The actual ledger movement is performed by the wallet client in the service — the entity just
// governs the legal lifecycle and records what to emit.
import { PaymentStatus, assertTransition } from './payment.state';
import { PaymentEventType, DomainEvent } from './payments.events';
import { RefundExceedsPaymentError, LateCaptureSameAttemptError } from './payments.errors';

export interface PaymentProps {
  id: string; tenantId: string; userId: string; purposeId: string;
  referenceType: string | null; referenceId: string | null;
  amountMinor: bigint; refundedMinor: bigint; currencyCode: string;
  status: PaymentStatus; providerCode: string; gatewayOrderId: string | null; gatewayPaymentId: string | null;
  method: string | null; idempotencyKey: string; failureCode: string | null; failureReason: string | null;
  ledgerTxnId: string | null; version: number; createdAt: Date;
  /** PC-56 STORE-3a · B3 (0210, survey B11): the refund's facts, kept on the row where the refund is already audited — when the platform asked
   *  for it (`initiateRefund`, the moderator's `refund`), when the source confirmed it (`completeRefund`, `refund`) and the provider's refund
   *  reference (`rfnd_…`; null for a wallet refund). Optional: rows refunded before 0210 (and pre-0210 fixtures) carry none. */
  gatewayRefundId?: string | null; refundInitiatedAt?: Date | null; refundedAt?: Date | null;
}

export class Payment {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: PaymentProps) {}

  static initiate(input: {
    id: string; tenantId: string; userId: string; purposeId: string; referenceType: string | null; referenceId: string | null;
    amountMinor: bigint; currencyCode: string; providerCode: string; idempotencyKey: string; now?: Date;
  }): Payment {
    if (input.amountMinor <= 0n) throw new RefundExceedsPaymentError(); // amount must be positive (reuse guard family)
    const p = new Payment({
      id: input.id, tenantId: input.tenantId, userId: input.userId, purposeId: input.purposeId,
      referenceType: input.referenceType, referenceId: input.referenceId, amountMinor: input.amountMinor, refundedMinor: 0n,
      currencyCode: input.currencyCode, status: 'initiated', providerCode: input.providerCode, gatewayOrderId: null,
      gatewayPaymentId: null, method: null, idempotencyKey: input.idempotencyKey, failureCode: null, failureReason: null,
      ledgerTxnId: null, version: 1, createdAt: input.now ?? new Date(),
    });
    p.events.push({ type: PaymentEventType.Initiated, payload: { paymentId: p.props.id, amountMinor: p.props.amountMinor.toString() } });
    return p;
  }
  static rehydrate(props: PaymentProps): Payment { return new Payment(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get amountMinor() { return this.props.amountMinor; }
  get currencyCode() { return this.props.currencyCode; }
  get refundableMinor() { return this.props.amountMinor - this.props.refundedMinor; }
  get userId() { return this.props.userId; }
  get providerCode() { return this.props.providerCode; }
  get refundedMinor() { return this.props.refundedMinor; }
  get gatewayPaymentId() { return this.props.gatewayPaymentId; }
  get createdAt() { return this.props.createdAt; }
  get tenantId() { return this.props.tenantId; }
  toProps(): Readonly<PaymentProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  attachGatewayOrder(gatewayOrderId: string): void { this.props.gatewayOrderId = gatewayOrderId; }

  /** Gateway captured the money. Idempotent: a repeat capture is a no-op (returns false). */
  /**
   * PC-56 TENANT-4d-2: the payload is WIDENED, additively. It used to carry
   * `{paymentId, amountMinor, referenceType, referenceId}` — a verdict with no evidence. A consumer that wants
   * to RECORD the payment as a fact (0092's append-only `saas_invoice_payments`, whose `recorded_by` is NOT
   * NULL) needs who paid, by what instrument, in what currency, against what gateway reference, and when. None
   * of it was in the envelope, so the only thing a consumer could do with this event was assert an outcome —
   * which is exactly how the SaaS-invoice consumer ended up typing a status instead of summing receipts.
   * Existing consumers (orders) read the same four keys and are unaffected.
   */
  /**
   * PC-56 HOTFIX-4 · A3: a capture after a recorded FAILURE is booked when — and only when — it is ANOTHER attempt on the same gateway order
   * (its gateway payment id differs from the failed attempt's, which markFailed now records). The same id that failed cannot be "captured"
   * into success here: refused by name, never silently booked.
   */
  markCaptured(gatewayPaymentId: string, method: string | null, ledgerTxnId: string, at: Date = new Date()): boolean {
    if (this.props.status === 'success') return false;
    // (STORE-2c · B3: `expired → success` is legal for any id — a lapsed attempt captured late at the gateway is booked, never dropped)
    if (this.props.status === 'failed' && !this.isLaterAttempt(gatewayPaymentId)) throw new LateCaptureSameAttemptError(this.props.id);
    assertTransition(this.props.status, 'success');
    this.props.status = 'success';
    this.props.gatewayPaymentId = gatewayPaymentId;
    this.props.method = method;
    this.props.ledgerTxnId = ledgerTxnId;
    this.events.push({ type: PaymentEventType.Succeeded, payload: {
      paymentId: this.props.id, amountMinor: this.props.amountMinor.toString(),
      referenceType: this.props.referenceType, referenceId: this.props.referenceId,
      payerUserId: this.props.userId, currencyCode: this.props.currencyCode,
      method: this.props.method, gatewayPaymentId: this.props.gatewayPaymentId, capturedAt: at.toISOString(),
    } });
    return true;
  }

  /** HOTFIX-4 · A3: is this capture a DIFFERENT attempt from the one that failed? (a non-empty gateway payment id ≠ the failed one's) */
  isLaterAttempt(gatewayPaymentId: string | null | undefined): boolean {
    return !!gatewayPaymentId && gatewayPaymentId !== this.props.gatewayPaymentId;
  }
  /** HOTFIX-4 · A3: the replay of a capture already booked — same gateway payment id, already `success`. A no-op for the caller. */
  isCaptureReplay(gatewayPaymentId: string | null | undefined): boolean {
    return this.props.status === 'success' && !!gatewayPaymentId && gatewayPaymentId === this.props.gatewayPaymentId;
  }

  /** HOTFIX-4 · A3: + the failed ATTEMPT's gateway payment id (when the gateway sent one), so a later capture can be told apart from it. */
  markFailed(code: string | null, reason: string | null, gatewayPaymentId: string | null = null): boolean {
    if (this.props.status === 'failed') return false;
    assertTransition(this.props.status, 'failed');
    this.props.status = 'failed'; this.props.failureCode = code; this.props.failureReason = reason;
    if (gatewayPaymentId) this.props.gatewayPaymentId = gatewayPaymentId;
    // PC-56 STORE-2c · B3: + the payer and the reference (additive) — so the communication map CAN notify a failure once its template rows exist
    // (owed: `order.payment_failed` is catalogued in 0068 with no template, so nothing is mapped or sent today)
    this.events.push({ type: PaymentEventType.Failed, payload: { paymentId: this.props.id, code, reason: this.props.failureReason, payerUserId: this.props.userId,
      referenceType: this.props.referenceType, referenceId: this.props.referenceId } });
    return true;
  }

  /** PC-56 STORE-2c · B3: the platform LAPSES a live attempt the buyer replaced with a fresh one (initiated / pending only — an authorized
   *  card hold is never lapsed by us). No event: nothing happened to money. Returns false when there was nothing to lapse. */
  markExpired(): boolean {
    if (this.props.status !== 'initiated' && this.props.status !== 'pending') return false;
    assertTransition(this.props.status, 'expired');
    this.props.status = 'expired';
    return true;
  }

  /**
   * PC-56 STORE-2c · B2 (founder D3) — THE AUTOMATIC REFUND OF A CANCELLED, PAID ORDER BEGINS: the ledger refund (escrow → source) is booked by
   * the caller in the same transaction (`ledgerTxnId` is that refund's); the payment is `refund_initiated` until the source confirms. Only a
   * captured payment that nothing has refunded yet (`success`, refunded 0) — anything else is not this method's to touch. The capture's ledger
   * txn id stays on the row (the refund's is in the audit row and the event).
   */
  initiateRefund(amountMinor: bigint, at: Date = new Date()): void {
    if (this.props.status !== 'success' || this.props.refundedMinor !== 0n) throw new RefundExceedsPaymentError();
    if (amountMinor <= 0n || amountMinor > this.refundableMinor) throw new RefundExceedsPaymentError();
    assertTransition(this.props.status, 'refund_initiated');
    this.props.status = 'refund_initiated';
    this.props.refundedMinor += amountMinor;
    this.props.refundInitiatedAt = at;   // STORE-3a · B3: the instant the refund was asked for (the ledger refund is booked in the same tx)
  }
  /** B2: the source confirmed the refund (the sandbox at once; Razorpay's `refund.processed` webhook later) → `refunded`. Emits
   *  `payments.payment_refunded` with the buyer, for the communication map. Idempotent: false unless `refund_initiated`. */
  completeRefund(reason: string, orderId: string | null, gatewayRefundId: string | null, at: Date = new Date()): boolean {
    if (this.props.status !== 'refund_initiated') return false;
    const next: PaymentStatus = this.props.refundedMinor >= this.props.amountMinor ? 'refunded' : 'partially_refunded';
    assertTransition(this.props.status, next);
    this.props.status = next;
    this.props.refundedAt = at;                                   // STORE-3a · B3: the instant the source confirmed it
    this.props.gatewayRefundId = gatewayRefundId ?? null;          // the provider's reference (rfnd_…) — null for a wallet refund
    this.events.push({ type: PaymentEventType.Refunded, payload: { paymentId: this.props.id, refundedMinor: this.props.refundedMinor.toString(),
      totalRefundedMinor: this.props.refundedMinor.toString(), fully: next === 'refunded', reason, orderId, buyerUserId: this.props.userId,
      currencyCode: this.props.currencyCode, gatewayRefundId, provider: this.props.providerCode } });
    return true;
  }

  /** Record a refund of `amountMinor`; full vs partial decided by remaining balance. */
  refund(amountMinor: bigint, ledgerTxnId: string, at: Date = new Date()): void {
    if (amountMinor <= 0n || amountMinor > this.refundableMinor) throw new RefundExceedsPaymentError();
    this.props.refundedMinor += amountMinor;
    const next: PaymentStatus = this.props.refundedMinor >= this.props.amountMinor ? 'refunded' : 'partially_refunded';
    assertTransition(this.props.status, next);
    this.props.status = next;
    this.props.ledgerTxnId = ledgerTxnId;
    // STORE-3a · B3: the moderator's refund IS the ledger reversal — asked and done in one act (the first ask is kept on a later partial)
    this.props.refundInitiatedAt = this.props.refundInitiatedAt ?? at; this.props.refundedAt = at;
    this.events.push({ type: PaymentEventType.Refunded, payload: { paymentId: this.props.id, refundedMinor: amountMinor.toString(), totalRefundedMinor: this.props.refundedMinor.toString(), fully: next === 'refunded' } });
  }
}
