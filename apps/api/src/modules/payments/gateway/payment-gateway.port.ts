// modules/payments/gateway/payment-gateway.port.ts
// Gateway-agnostic port for money-IN (Razorpay, UPI, …). Adapters are wrapped in core/resilience
// and selected by provider_code. Webhook signatures are verified here (HMAC, constant-time) — an
// attacker forging a "payment.captured" must never be believed (see §4: fail closed).
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CreateOrderInput { amountMinor: bigint; currencyCode: string; receipt: string; notes?: Record<string, string>; }
export interface CreateOrderResult { gatewayOrderId: string; }

/** Normalized gateway event (provider payloads are mapped to this). */
export interface GatewayEvent {
  /** Stable provider event id — used as the idempotency key for webhook processing. */
  eventId: string;
  kind: 'payment_captured' | 'payment_failed' | 'refund_processed' | 'ignored';
  /** Tenant the payment belongs to, carried in the signature-verified order `notes` (the webhook
   *  is unauthenticated, so we trust this only because the whole body is HMAC-verified). */
  tenantId?: string;
  /** PC-56 HOTFIX-4 · A4: OUR payment id when the gateway echoed it in the entity's notes — a CROSS-CHECK only. The webhook's context comes
   *  from the payment row the gateway ORDER id resolves to (0206); `tenantId` above is likewise a cross-check now, never the source. */
  notesPaymentId?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  amountMinor?: bigint;
  /** ISO currency from the verified webhook entity — guarded against the payment's currency (tamper). */
  currencyCode?: string;
  method?: string;
  failureCode?: string;
  failureReason?: string;
  /** PC-56 STORE-2c · B2: the gateway's refund id on a `refund_processed` event. */
  gatewayRefundId?: string;
}

/** PC-56 STORE-2c · B2 (founder D3): refund a CAPTURED gateway payment back to its source (the buyer's card / UPI / bank). `receipt` is OUR
 *  idempotency reference (`refund:<orderId>`), sent to the gateway so a retried call is recognisable on its side too. */
export interface RefundInput { gatewayPaymentId: string; amountMinor: bigint; currencyCode: string; receipt: string; notes?: Record<string, string>; }
/** `processed` = the money is on its way back now (the sandbox; an instant refund); `pending` = the gateway accepted it and confirms later
 *  (Razorpay's `refund.processed` webhook) — the payment stays `refund_initiated` until then. */
export interface RefundResult { gatewayRefundId: string; status: 'processed' | 'pending'; }

export interface PaymentGateway {
  readonly providerCode: string;
  /** PC-56 STORE-2c · B2: refund a captured payment to its source (resilience-wrapped for a real PSP). Throws on a refused / failed call — the
   *  caller (the auto-refund handler) lets the relay retry it; the ledger refund is already booked and the payment `refund_initiated`. */
  refund(input: RefundInput): Promise<RefundResult>;
  /** Create a gateway order for the given amount (resilience-wrapped). */
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /** Constant-time verify the webhook signature over the raw body. Returns false on any mismatch. */
  verifySignature(rawBody: string, signature: string): boolean;
  /** Map a verified raw webhook body to a normalized event. */
  parseEvent(rawBody: string): GatewayEvent;
}
