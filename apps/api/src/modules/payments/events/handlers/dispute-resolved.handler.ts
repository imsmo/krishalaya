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
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../../core/wallet/wallet.port';
import { platform, userMain, tenantCommission, PlatformAccount } from '../../../../core/wallet/account-codes';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { InfraError } from '../../../../shared/errors/app-error';
import { PaymentRepository } from '../../repositories/payment.repository';
import { SettlementLineRepository } from '../../repositories/settlement-line.repository';
import { SettlementPricingService } from '../../services/settlement-pricing.service';

@Injectable()
export class DisputeResolvedHandler implements OutboxHandler {
  readonly eventType = 'disputes.dispute_resolved';
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly repo: PaymentRepository,
    private readonly lines: SettlementLineRepository,
    private readonly pricing: SettlementPricingService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const disputeId = (p.disputeId as string | undefined) ?? event.aggregateId;
    const orderId = p.orderId as string | undefined;
    const resolutionType = p.resolutionType as string | undefined;
    if (!tenantId || !disputeId || !orderId || !resolutionType) return;
    if (resolutionType !== 'refund_full' && resolutionType !== 'refund_partial') return;   // no money move here
    if (!(await this.flags.isEnabled('dispute_refunds', { tenantId }))) return;             // kill-switch (default OFF)

    // HOTFIX-2: `payments` is read as kv_app (kv_relay holds no privilege on it); a captured payment is committed history
    const payment = await this.uow.run(tenantId, (readTx) => this.repo.findSuccessByOrder(readTx, tenantId, orderId), { userId: 'system' });
    if (!payment) return;                                  // COD / no escrowed payment → nothing to reverse
    const gross = payment.amountMinor;
    const buyer = payment.userId;
    const raisedBy = p.raisedBy as string | undefined;
    const againstUser = p.againstUser as string | undefined;
    const seller = raisedBy === buyer ? againstUser : (againstUser === buyer ? raisedBy : undefined);
    const requested = resolutionType === 'refund_full' ? gross : BigInt((p.resolutionAmountMinor as string) ?? '0');
    const refund = requested > gross ? gross : requested;  // never refund more than was paid
    if (refund <= 0n) return;
    const remainder = gross - refund;                      // the seller keeps this (partial refunds)

    // (1) if the order ALREADY settled, reverse the release leg-for-leg → escrow restored to `gross`.
    const line = await this.lines.findByOrder(tx, tenantId, orderId);
    if (line) {
      if (line.statementId) throw new InfraError('DISPUTE_REFUND_AFTER_STATEMENT', 'order settled into a paid statement; needs manual clawback', { orderId, disputeId });
      const reversal: LedgerLeg[] = [
        { account: userMain(line.sellerUserId), amountMinor: -line.netMinor },
        { account: tenantCommission(tenantId), amountMinor: -line.tenantCommissionMinor },
        { account: platform(PlatformAccount.GstPayable), amountMinor: -line.gstMinor },
        { account: platform(PlatformAccount.TdsPayable), amountMinor: -line.tdsMinor },
        { account: platform(PlatformAccount.Fees), amountMinor: -line.platformFeesMinor },
        { account: platform(PlatformAccount.Escrow), amountMinor: gross },
      ].filter((l) => l.amountMinor !== 0n);
      await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `dispute-clawback:${disputeId}`, referenceType: 'dispute', referenceId: disputeId, initiatedBy: 'system', legs: reversal });
      await this.lines.deleteByOrder(tx, tenantId, orderId);
    }

    // (2) escrow now holds `gross`. Refund the buyer; re-settle the kept remainder to the seller.
    const legs: LedgerLeg[] = [
      { account: platform(PlatformAccount.Escrow), amountMinor: -gross },
      { account: userMain(buyer), amountMinor: refund },
    ];
    if (remainder > 0n) {
      if (!seller) throw new InfraError('DISPUTE_REFUND_NO_SELLER', 'cannot resolve the seller for the kept remainder', { disputeId, orderId });
      const split = await this.flags.isEnabled('commission_split', { tenantId });
      if (split) {
        const b = await this.uow.run(tenantId, (ruleTx) => this.pricing.quote(ruleTx, { tenantId, grossMinor: remainder, categoryId: (p.categoryId as string) ?? null, source: (p.source as string) ?? null, countryCode: 'IN' }), { userId: 'system' });
        legs.push(
          { account: userMain(seller), amountMinor: b.sellerNetMinor },
          { account: tenantCommission(tenantId), amountMinor: b.tenantCommissionMinor },
          { account: platform(PlatformAccount.GstPayable), amountMinor: b.gstOnCommissionMinor },
          { account: platform(PlatformAccount.TdsPayable), amountMinor: b.tdsMinor },
          { account: platform(PlatformAccount.Fees), amountMinor: b.platformShareMinor },
        );
        await this.lines.insert(tx, { tenantId, sellerUserId: seller, orderId, grossMinor: remainder, commissionMinor: b.commissionMinor, gstMinor: b.gstOnCommissionMinor, tdsMinor: b.tdsMinor, netMinor: b.sellerNetMinor, tenantCommissionMinor: b.tenantCommissionMinor, platformFeesMinor: b.platformShareMinor });
      } else {
        legs.push({ account: userMain(seller), amountMinor: remainder });
        await this.lines.insert(tx, { tenantId, sellerUserId: seller, orderId, grossMinor: remainder, commissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, netMinor: remainder, tenantCommissionMinor: 0n, platformFeesMinor: 0n });
      }
    }
    const res = await this.wallet.post(tx, { tenantId, txnType: 'refund', idempotencyKey: `dispute-refund:${disputeId}`, referenceType: 'dispute', referenceId: disputeId, initiatedBy: 'system', legs: legs.filter((l) => l.amountMinor !== 0n) });
    if (!res.alreadyApplied) this.metrics.inc('payments.dispute_refund', { tenant: tenantId, type: resolutionType });
    await this.outbox.write(tx, { tenantId, aggregateType: 'dispute', aggregateId: disputeId, eventType: 'payments.dispute_refunded', payload: { v: 1, disputeId, txnId: res.txnId, refundedMinor: refund.toString(), remainderMinor: remainder.toString() } });
  }
}
