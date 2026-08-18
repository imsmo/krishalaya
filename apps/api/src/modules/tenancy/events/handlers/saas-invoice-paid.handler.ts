// modules/tenancy/events/handlers/saas-invoice-paid.handler.ts · PC-56 TENANT-4d-4
//
// **`tenancy.saas_invoice_paid` HAD NO SUBSCRIBER.** It was emitted through the outbox by
// `SaasInvoiceService.applyPayment`, relayed by the OutboxRelayRunner, and dropped — the only other match for
// the string anywhere in apps/ was a metrics counter. So the one event that should advance a subscription's
// billing period was written, delivered, and ignored, and `current_period_end` was set once at `subscribe()`
// and never moved again by anything (0148 defect 1).
//
// That is what made the SaaS billing cadence unschedulable: the expiry finder matches every live subscription
// within a month of creation, so a tenant who paid on time would have been expired exactly as fast as one who
// never paid. This handler is the join that was missing.
//
// Runs INSIDE the relay's per-event transaction, so the period advance commits with the event being marked
// published. IDEMPOTENT at the aggregate: a re-delivered event finds the period already rolled and
// `Subscription.rollPeriod` returns false without writing.
import { Injectable, Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { SubscriptionService } from '../../services/subscription.service';

@Injectable()
export class SaasInvoicePaidHandler implements OutboxHandler {
  readonly eventType = 'tenancy.saas_invoice_paid';
  private readonly log = new Logger(SaasInvoicePaidHandler.name);

  constructor(private readonly subscriptions: SubscriptionService) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    // Only a FULLY settled invoice rolls the period. A partial payment is progress, not a renewal: rolling on
    // the first instalment would give a tenant a whole new period for a fraction of the price, and the grace
    // window is exactly the mechanism that gives them time to finish paying.
    if (!tenantId || p.status !== 'paid') return;
    const subscriptionId = typeof p.subscriptionId === 'string' ? p.subscriptionId : undefined;
    // An invoice with no subscription is a one-off (an upgrade proration is billed against the subscription,
    // but a manual charge need not be). Nothing to roll, and not an error.
    if (!subscriptionId) return;
    const rolled = await this.subscriptions.rollPeriod(tx, tenantId, subscriptionId, new Date());
    if (rolled) this.log.log(`subscription ${subscriptionId} period rolled after invoice ${String(p.invoiceId)} was paid`);
  }
}
