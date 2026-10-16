// modules/payments/events/handlers/return-refunded.handler.ts
// Consumes disputes.return_refunded (via the outbox relay) and performs the MONEY reversal for a return whose goods
// came back — ONLY via the wallet boundary (Law 2), behind the `dispute_refunds` flag (default OFF, Law 10).
//
// **THIS HANDLER IS THE SUBSCRIBER THAT DID NOT EXIST.** Before PC-56 TENANT-3b, `ReturnService.refund` set
// status='refunded', wrote `disputes.return_refunded` to the outbox, and NOTHING in any app consumed that event.
// `Return.refund(null)` was the only call site, so `returns.refund_txn_id` was never written either — while W142
// printed "Refunds are ledger reversals (refund_txn_id) — the money trail always closes". A terminal status
// recording an act nobody performed, and the act was a buyer's money coming back.
//
// THE AMOUNT IS THE ONE RECORDED ON THE RETURN (0139's `refund_amount_minor`), re-read here inside the relay
// transaction rather than trusted from the event payload — an event is a message, and a message can be replayed
// after the row it describes has changed. It is then capped at the payment's gross: a return cannot refund more
// than the buyer paid, however the figure was recorded.
//
// TWO CASES, THE SAME SHAPE THE DISPUTE PATH USES (dispute-resolved.handler.ts):
//   • not settled — escrow still holds the buyer's gross: escrow → buyer for the refund, and the kept remainder is
//     re-settled to the seller through the commission engine (or paid straight through when commission_split is off).
//   • already settled — the release is reversed leg-for-leg from `settlement_lines` first, restoring escrow to gross,
//     then the refund runs. A line already rolled into a PAID statement is refused loudly → DLQ, never a silent
//     wrong move. If the seller has already withdrawn, the wallet's no-overdraw rule fails the same way.
//
// **WHY THIS IS NOT SHARED CODE WITH THE DISPUTE HANDLER, YET.** The two paths compute the same legs, and one day
// they should be one service. Unifying them means changing the constructor of a money handler whose behaviour is
// pinned by two existing suites, inside a wave whose subject is the tenant console — a refactor of a proven money
// path is its own change with its own review. It is recorded as a named follow-up (TENANT-3b stamp) rather than done
// halfway here, and the leg construction below is written to match the dispute path line for line so a future
// extraction is mechanical.
//
// PC-56 HOTFIX-2 (SWEEP F-2, MONEY) — the relay runs this as `kv_relay`, which holds NO privilege on `payments`, `commission_rules`
// or `tax_rules`. With `dispute_refunds` ON the payment lookup died 42501 on every refund; with `commission_split` ON the kept
// remainder's rule lookup did too — quarantining the event. Both are READS of committed rows, so both now run in a request-tier
// unit of work (kv_app, RLS-bound to the event's tenant). The clawback, the refund legs, their amounts and keys, the settlement
// line and the `payments.return_refunded` outbox row are unchanged and still commit atomically with the event on the relay tx.
// No grant was added to kv_relay.
//
// PC-56 HOTFIX-7 · D3 (founder Q3) — THE BUYER'S LEG GOES BACK TO THE SOURCE, and the shared code TENANT-3b promised exists: the money runs
// through ResolutionMoneyService (with the dispute handler) — the refund via PaymentService.refundForResolution (escrow −refund · source +refund
// under `return-refund:<id>`, its own kv_app transaction), the clawback (`return-clawback:<id>`) and the kept remainder (`return-remainder:<id>`,
// new) on the relay tx, priced in the ORGANISATION's country (B3 — the India literal is gone). The recorded amount is still re-read from the
// event's figure and capped at the gross; a refund event with no figure is still refused loudly.
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { InfraError } from '../../../../shared/errors/app-error';
import { ResolutionMoneyService } from '../../services/resolution-money.service';

@Injectable()
export class ReturnRefundedHandler implements OutboxHandler {
  readonly eventType = 'disputes.return_refunded';
  constructor(
    private readonly flags: FlagsService,
    private readonly money: ResolutionMoneyService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const returnId = (p.returnId as string | undefined) ?? event.aggregateId;
    const orderId = p.orderId as string | undefined;
    if (!tenantId || !returnId || !orderId) return;
    if (!(await this.flags.isEnabled('dispute_refunds', { tenantId }))) return;   // kill-switch (default OFF; HOTFIX-7 D2 also refuses upstream)

    const recorded = BigInt((p.refundAmountMinor as string) ?? '0');
    if (recorded <= 0n) {
      // The entity refuses to reach 'refunded' without an amount, so this can only be a replayed pre-0139 event.
      // Loud, not silent: a refund event with no figure must not be treated as "refund everything".
      throw new InfraError('RETURN_REFUND_NO_AMOUNT', 'return_refunded carried no recorded amount', { returnId, orderId });
    }
    const seller = (p.sellerUserId as string | undefined) ?? null;
    const res = await this.money.apply(tx, { kind: 'return', referenceId: returnId, tenantId, orderId, payload: p, requested: recorded, resolveSeller: () => seller });
    if (res.outcome === 'unpaid' || res.outcome === 'nothing') return;           // COD / no escrowed payment → nothing to reverse
    if (res.refundBookedNow) this.metrics.inc('payments.return_refund', { tenant: tenantId });
    await this.outbox.write(tx, { tenantId, aggregateType: 'return', aggregateId: returnId, eventType: 'payments.return_refunded',
      payload: { v: 1, returnId, orderId, txnId: res.refundTxnId, refundedMinor: res.refundMinor.toString(), remainderMinor: res.remainderMinor.toString(), remainderTxnId: res.remainderTxnId } });
  }
}
