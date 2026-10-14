// modules/payments/gateway/razorpay.gateway.ts
// Razorpay adapter (India standard). Order creation goes through core/resilience (timeout + retry
// + circuit-breaker) so a Razorpay outage degrades gracefully instead of cascading. Webhook
// signatures are HMAC-SHA256 over the raw body, compared in constant time (timingSafeEqual) —
// a forged event is rejected. Secrets come from config and are NEVER logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { InfraError } from '../../../shared/errors/app-error';
import { PaymentGateway, CreateOrderInput, CreateOrderResult, GatewayEvent } from './payment-gateway.port';

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

  verifySignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.cfg.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(signature ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string): GatewayEvent {
    const p = JSON.parse(rawBody) as any;
    const entity = p?.payload?.payment?.entity ?? p?.payload?.refund?.entity ?? {};
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
      failureReason: entity?.error_description,
    };
  }
}
