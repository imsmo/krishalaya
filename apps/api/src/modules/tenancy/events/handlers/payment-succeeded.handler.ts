// modules/tenancy/events/handlers/payment-succeeded.handler.ts
// Consumes payments.payment_succeeded (delivered by the outbox relay). Acts ONLY on payments whose
// referenceType is 'saas_invoice' — i.e. a tenant paying its SaaS bill — and marks that invoice paid /
// partially_paid via the invoice state machine. Runs INSIDE the relay tx and touches only this module's repo.
// IDEMPOTENT at the consumer: a re-delivered event for an already-paid invoice is a no-op (applyPayment returns
// false). Other payment references (orders, wallet recharge, EMD, …) are ignored here.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { SaasInvoiceService } from '../../services/saas-invoice.service';

@Injectable()
export class SaasInvoicePaymentHandler implements OutboxHandler {
  readonly eventType = 'payments.payment_succeeded';
  constructor(private readonly invoices: SaasInvoiceService) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId || p.referenceType !== 'saas_invoice') return;       // not a SaaS-invoice payment → ignore
    const invoiceId = typeof p.referenceId === 'string' ? p.referenceId : undefined;
    const amountRaw = p.amountMinor;
    if (!invoiceId || amountRaw === undefined || amountRaw === null) return;
    let amountMinor: bigint;
    try { amountMinor = BigInt(amountRaw as any); } catch { return; }   // malformed amount → ignore (fail closed)
    if (amountMinor <= 0n) return;
    const paymentId = typeof p.paymentId === 'string' ? p.paymentId : undefined;
    // Without the payment's own id there is no idempotency key for the receipt, and without one an
    // at-least-once relay would record the same money twice. Fail closed rather than double-count.
    if (!paymentId) return;
    const str = (k: string) => (typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : null);
    // `capturedAt` is the moment the gateway captured; the relay's own clock is the fallback and is minutes
    // later at worst. Never silently a different day: an unparseable value falls back rather than being coerced.
    const capturedAt = str('capturedAt') ? new Date(str('capturedAt') as string) : new Date();
    await this.invoices.applyPayment(tx, tenantId, invoiceId, {
      amountMinor,
      at: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
      paymentId,
      method: str('method'),
      currencyCode: str('currencyCode'),
      payerUserId: str('payerUserId'),
      gatewayPaymentId: str('gatewayPaymentId'),
    });   // idempotent at the receipt's unique key AND at the invoice's state machine
  }
}
