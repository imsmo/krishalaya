// modules/payments/events/handlers/dispute-resolved.handler.ts
// Consumes disputes.dispute_resolved (via the outbox relay). Performs the MONEY reversal for a dispute
// decided in the buyer's favour, ONLY via the wallet boundary (Law 2), behind the `dispute_refunds`
// flag (default OFF). rejected/replacement move no money here (the order completes → the normal
// escrow→seller release runs).
//
// Two cases, UNIFIED so escrow always holds the gross before the refund:
//   • NOT yet settled (the common path — a dispute pauses the order BEFORE settlement): escrow still
//     holds the buyer's gross.
//   • ALREADY settled (a dispute raised after the order completed): first REVERSE the recorded
//     settlement leg-for-leg (seller net + tenant commission + GST/TDS payable + platform fees → back
//     to escrow) using the breakdown stored on settlement_lines — a precise, zero-sum clawback. If the
//     seller already withdrew their net, the wallet's no-overdraw rule makes this fail loudly → DLQ
//     (manual recovery), never a silent wrong move. (A line already rolled into a paid statement is
//     refused here → DLQ.)
// Then the refund runs against escrow:
//   • refund_full    → escrow → buyer wallet (the full gross);
//   • refund_partial → escrow → buyer (the partial) + the kept remainder is RE-SETTLED to the seller
//     through the commission/tax engine (recording a fresh settlement_line). Always ZERO-SUM,
//     idempotent (`dispute-refund:<disputeId>` / `dispute-clawback:<disputeId>`).
// Emits payments.dispute_refunded so disputes stamps resolution_txn_id.
//
// PC-56 HOTFIX-2 (SWEEP F-2, MONEY) — the relay runs this as `kv_relay`, which holds NO privilege on `payments`, `commission_rules`
// or `tax_rules`. With `dispute_refunds` ON the payment lookup died 42501 on every refund; with `commission_split` ON the kept
// remainder's rule lookup did too — quarantining the event. Both are READS of committed rows, so both now run in a request-tier
// unit of work (kv_app, RLS-bound to the event's tenant). The clawback, the refund legs, their amounts and keys, the settlement
// line and the `payments.dispute_refunded` outbox row are unchanged and still commit atomically with the event on the relay tx.
// No grant was added to kv_relay.
//
// PC-56 HOTFIX-7 · D3 (founder Q3) — THE BUYER'S LEG GOES BACK TO THE SOURCE. The refund used to be `escrow → user:<buyer>:main` (the buyer's
// wallet, whatever they paid with) while 2c's cancel refund went back to the card / UPI source — one buyer, two refund rules (survey STORE-5
// F-4). The money now runs through ResolutionMoneyService (shared with the return handler): the refund through PaymentService.refundForResolution
// (escrow −refund · source +refund under `dispute-refund:<id>`, its own kv_app transaction, the payment → `refund_initiated` → `refunded`), the
// clawback (`dispute-clawback:<id>`) and the kept remainder (`dispute-remainder:<id>` — new; it used to ride inside the refund txn) on the relay tx,
// priced in the ORGANISATION's country (B3 — the India literal is gone). The leg table and the failure order are in that service's header.
// `payments.dispute_refunded` carries the REFUND's ledger txn id (the stamp the disputes module records as resolution_txn_id).
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { ResolutionMoneyService } from '../../services/resolution-money.service';

@Injectable()
export class DisputeResolvedHandler implements OutboxHandler {
  readonly eventType = 'disputes.dispute_resolved';
  constructor(
    private readonly flags: FlagsService,
    private readonly money: ResolutionMoneyService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const disputeId = (p.disputeId as string | undefined) ?? event.aggregateId;
    const orderId = p.orderId as string | undefined;
    const resolutionType = p.resolutionType as string | undefined;
    if (!tenantId || !disputeId || !orderId || !resolutionType) return;
    if (resolutionType !== 'refund_full' && resolutionType !== 'refund_partial') return;   // no money move here
    if (!(await this.flags.isEnabled('dispute_refunds', { tenantId }))) return;             // kill-switch (default OFF; HOTFIX-7 D2 also refuses upstream)

    const raisedBy = p.raisedBy as string | undefined;
    const againstUser = p.againstUser as string | undefined;
    const res = await this.money.apply(tx, {
      kind: 'dispute', referenceId: disputeId, tenantId, orderId, payload: p,
      requested: resolutionType === 'refund_full' ? 'full' : BigInt((p.resolutionAmountMinor as string) ?? '0'),
      // the seller is the party who is not the buyer (the payment's payer)
      resolveSeller: (buyer) => (raisedBy === buyer ? againstUser : (againstUser === buyer ? raisedBy : undefined)) ?? null,
    });
    if (res.outcome === 'unpaid' || res.outcome === 'nothing') return;                     // COD / no escrowed payment → nothing to reverse
    if (res.refundBookedNow) this.metrics.inc('payments.dispute_refund', { tenant: tenantId, type: resolutionType });
    await this.outbox.write(tx, { tenantId, aggregateType: 'dispute', aggregateId: disputeId, eventType: 'payments.dispute_refunded',
      payload: { v: 1, disputeId, txnId: res.refundTxnId, refundedMinor: res.refundMinor.toString(), remainderMinor: res.remainderMinor.toString(), remainderTxnId: res.remainderTxnId } });
  }
}
