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
}

export interface PaymentGateway {
  readonly providerCode: string;
  /** Create a gateway order for the given amount (resilience-wrapped). */
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  /** Constant-time verify the webhook signature over the raw body. Returns false on any mismatch. */
  verifySignature(rawBody: string, signature: string): boolean;
  /** Map a verified raw webhook body to a normalized event. */
  parseEvent(rawBody: string): GatewayEvent;
}
