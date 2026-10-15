// modules/payments/gateway/razorpay.gateway.ts
// Razorpay adapter (India standard). Order creation goes through core/resilience (timeout + retry
// + circuit-breaker) so a Razorpay outage degrades gracefully instead of cascading. Webhook
// signatures are HMAC-SHA256 over the raw body, compared in constant time (timingSafeEqual) —
// a forged event is rejected. Secrets come from config and are NEVER logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { InfraError } from '../../../shared/errors/app-error';
import { PaymentGateway, CreateOrderInput, CreateOrderResult, GatewayEvent, RefundInput, RefundResult } from './payment-gateway.port';

const DEP = 'razorpay';

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret: string; baseUrl?: string; }

export class RazorpayGateway implements PaymentGateway {
  readonly providerCode = 'razorpay';
  constructor(private readonly cfg: RazorpayConfig, private readonly resilience: ResilienceService) {}

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    return this.resilience.run(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl ?? 'https://api.razorpay.com'}/v1/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Basic ' + Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64'),
        },
        // Razorpay amounts are in the smallest currency unit (paise) — our bigint minor units map 1:1.
        body: JSON.stringify({ amount: Number(input.amountMinor), currency: input.currencyCode, receipt: input.receipt, notes: input.notes ?? {} }),
      });
      if (!res.ok) throw new InfraError('RAZORPAY_ORDER_FAILED', `Razorpay order create failed (${res.status})`, { status: res.status });
      const body = (await res.json()) as { id: string };
      return { gatewayOrderId: body.id };
    });
  }

  /**
   * PC-56 STORE-2c · B2 (founder D3) — refund a captured payment to its source: `POST /v1/payments/{id}/refund {amount, receipt, notes}`.
   * Razorpay answers with the refund entity; `status` is `pending` until its own processing finishes, then `refund.processed` arrives on the
   * webhook (handled by PaymentService.handleWebhook → `refunded`). `processed` straight away (an instant refund) is honoured too.
   * UNPROVEN in Razorpay test mode on this Mac (no keys) — owed in the wave report §8, with the webhook payload's shape.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    return this.resilience.run(DEP, async () => {
      const res = await fetch(`${this.cfg.baseUrl ?? 'https://api.razorpay.com'}/v1/payments/${encodeURIComponent(input.gatewayPaymentId)}/refund`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Basic ' + Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString('base64'),
        },
        body: JSON.stringify({ amount: Number(input.amountMinor), receipt: input.receipt.slice(0, 40), notes: input.notes ?? {} }),
      });
      if (!res.ok) throw new InfraError('RAZORPAY_REFUND_FAILED', `Razorpay refund failed (${res.status})`, { status: res.status });
      const body = (await res.json()) as { id: string; status?: string };
      return { gatewayRefundId: body.id, status: body.status === 'processed' ? 'processed' : 'pending' };
    });
  }

  verifySignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(signature ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string): GatewayEvent {
    const p = JSON.parse(rawBody) as any;
    const entity = p?.payload?.payment?.entity ?? p?.payload?.refund?.entity ?? {};
    // PC-56 STORE-2c · B2: a `refund.*` event carries the REFUND entity (its id, its payment_id) and — documented, unproven here — the payment
    // entity too (whose order_id resolves OUR row). The refund id is kept for the audit.
    const refundEntity = p?.payload?.refund?.entity ?? null;
    const map: Record<string, GatewayEvent['kind']> = {
      'payment.captured': 'payment_captured',
      'payment.failed': 'payment_failed',
      'refund.processed': 'refund_processed',
    };
    return {
      eventId: p?.id ?? `${p?.event}:${entity?.id}`,
      kind: map[p?.event] ?? 'ignored',
      // PC-56 HOTFIX-4 · A4: notes are a CROSS-CHECK (present only if the gateway copied them onto the payment); the context is resolved
      // from our payment row by `order_id` (PaymentService.handleWebhook). A notes value that is not a plain string is treated as absent.
      tenantId: typeof entity?.notes?.tenant_id === 'string' ? entity.notes.tenant_id : undefined,
      notesPaymentId: typeof entity?.notes?.payment_id === 'string' ? entity.notes.payment_id : undefined,
      gatewayOrderId: entity?.order_id,
      gatewayPaymentId: entity?.id,
      amountMinor: entity?.amount != null ? BigInt(entity.amount) : undefined,
      currencyCode: entity?.currency ? String(entity.currency).toUpperCase() : undefined,
      method: entity?.method,
      failureCode: entity?.error_code,
      // PC-56 STORE-2c · B3: the MACHINE reason (`error_reason`, e.g. payment_cancelled / payment_timed_out) when Razorpay sends it — the buyer's
      // page localizes it by code; the free-text description is the fallback the storefront never prints verbatim.
      failureReason: entity?.error_reason ?? entity?.error_description,
      gatewayRefundId: typeof refundEntity?.id === 'string' ? refundEntity.id : undefined,
    };
  }
}
