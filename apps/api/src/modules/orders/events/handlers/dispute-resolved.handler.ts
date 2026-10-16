// modules/orders/events/handlers/dispute-resolved.handler.ts
// Consumes disputes.dispute_resolved (delivered by the outbox relay). Applies the resolution to a
// disputed order: refund_full → refunded, refund_partial → partially_refunded, rejected/replacement →
// completed (which releases escrow to the seller via the existing order_completed settlement path).
// Runs INSIDE the relay tx. IDEMPOTENT: applyDisputeResolution is a no-op unless the order is 'disputed'.
//
// PC-56 HOTFIX-7 · D2 (founder Q2) — NO "REFUNDED" WITHOUT MONEY, DEFENCE IN DEPTH. A refund status (`refunded` / `partially_refunded`) is applied
// ONLY while the tenant-scoped `dispute_refunds` flag is ON — the flag the payments handler of the same event moves the money behind. OFF → the
// order stays `disputed`, a warning is logged and `orders.dispute_refund_status_withheld` counted; nothing else (the first gate is
// DisputeService.resolve, which refuses a refund decision by name — DISPUTE_REFUNDS_OFF — while the flag is OFF; this branch is reached only if
// the flag was switched off between the decision and the relay). `rejected` / `replacement` are unchanged.
// PC-56 HOTFIX-7 · B3: a completion here carries the ORGANISATION's country (tenants.country_code, read on the relay tx — kv_relay holds SELECT on
// tenants) so settlement prices tax in it. A dispute decided `rejected` / `replacement` on a pay-on-delivery order completes it and settlement
// releases NOTHING (founder D1 — `skipped_unfunded`).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { METRICS, Metrics } from '../../../../core/observability/metrics';
import { OrderRepository } from '../../repositories/order.repository';

const REFUND_RESOLUTIONS: ReadonlySet<string> = new Set(['refund_full', 'refund_partial']);

@Injectable()
export class DisputeResolvedHandler implements OutboxHandler {
  readonly eventType = 'disputes.dispute_resolved';
  private readonly log = new Logger(DisputeResolvedHandler.name);
  constructor(
    private readonly repo: OrderRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = event.payload.orderId as string | undefined;
    const resolutionType = event.payload.resolutionType as string | undefined;
    if (!tenantId || !orderId || !resolutionType) return;
    if (REFUND_RESOLUTIONS.has(resolutionType) && !(await this.flags.isEnabled('dispute_refunds', { tenantId }))) {
      this.log.warn(`dispute ${String(event.payload.disputeId ?? event.aggregateId)} resolved ${resolutionType} while dispute_refunds is OFF — order ${orderId} stays disputed (no money moved)`);
      this.metrics.inc('orders.dispute_refund_status_withheld', { tenant: tenantId, type: resolutionType });
      return;
    }
    const order = await this.repo.getForUpdate(tx, tenantId, orderId);
    if (!order) return;
    const from = order.status;
    const countryCode = REFUND_RESOLUTIONS.has(resolutionType) ? null : await this.repo.tenantCountryTx(tx, tenantId);
    if (!order.applyDisputeResolution(resolutionType, new Date(), { countryCode })) return;   // idempotent / not disputed
    await this.repo.update(tx, order, from);
    for (const e of order.pullEvents()) await this.outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
