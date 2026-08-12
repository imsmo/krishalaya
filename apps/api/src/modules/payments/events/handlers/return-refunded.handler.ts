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
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../../core/outbox/outbox.writer';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../../core/wallet/wallet.port';
import { platform, userMain, tenantCommission, PlatformAccount } from '../../../../core/wallet/account-codes';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { Metrics, METRICS } from '../../../../core/observability/metrics';
import { InfraError } from '../../../../shared/errors/app-error';
import { PaymentRepository } from '../../repositories/payment.repository';
import { SettlementLineRepository } from '../../repositories/settlement-line.repository';
import { SettlementPricingService } from '../../services/settlement-pricing.service';

@Injectable()
export class ReturnRefundedHandler implements OutboxHandler {
  readonly eventType = 'disputes.return_refunded';
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly repo: PaymentRepository,
    private readonly lines: SettlementLineRepository,
    private readonly pricing: SettlementPricingService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const returnId = (p.returnId as string | undefined) ?? event.aggregateId;
    const orderId = p.orderId as string | undefined;
    if (!tenantId || !returnId || !orderId) return;
    if (!(await this.flags.isEnabled('dispute_refunds', { tenantId }))) return;   // kill-switch (default OFF)

    const payment = await this.repo.findSuccessByOrder(tx, tenantId, orderId);
    if (!payment) return;                                  // COD / no escrowed payment → nothing to reverse
    const gross = payment.amountMinor;
    const buyer = payment.userId;
    const recorded = BigInt((p.refundAmountMinor as string) ?? '0');
    if (recorded <= 0n) {
      // The entity refuses to reach 'refunded' without an amount, so this can only be a replayed pre-0139 event.
      // Loud, not silent: a refund event with no figure must not be treated as "refund everything".
      throw new InfraError('RETURN_REFUND_NO_AMOUNT', 'return_refunded carried no recorded amount', { returnId, orderId });
    }
    const refund = recorded > gross ? gross : recorded;     // never refund more than was paid
    const remainder = gross - refund;                      // the seller keeps this (partial returns)
    const seller = (p.sellerUserId as string | undefined) ?? null;

    // (1) if the order ALREADY settled, reverse the release leg-for-leg → escrow restored to `gross`.
    const line = await this.lines.findByOrder(tx, tenantId, orderId);
    if (line) {
      if (line.statementId) throw new InfraError('RETURN_REFUND_AFTER_STATEMENT', 'order settled into a paid statement; needs manual clawback', { orderId, returnId });
      const reversal: LedgerLeg[] = [
        { account: userMain(line.sellerUserId), amountMinor: -line.netMinor },
        { account: tenantCommission(tenantId), amountMinor: -line.tenantCommissionMinor },
        { account: platform(PlatformAccount.GstPayable), amountMinor: -line.gstMinor },
        { account: platform(PlatformAccount.TdsPayable), amountMinor: -line.tdsMinor },
        { account: platform(PlatformAccount.Fees), amountMinor: -line.platformFeesMinor },
        { account: platform(PlatformAccount.Escrow), amountMinor: gross },
      ].filter((l) => l.amountMinor !== 0n);
      await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `return-clawback:${returnId}`, referenceType: 'return', referenceId: returnId, initiatedBy: 'system', legs: reversal });
      await this.lines.deleteByOrder(tx, tenantId, orderId);
    }

    // (2) escrow now holds `gross`. Refund the buyer; re-settle the kept remainder to the seller.
    const legs: LedgerLeg[] = [
      { account: platform(PlatformAccount.Escrow), amountMinor: -gross },
      { account: userMain(buyer), amountMinor: refund },
    ];
    if (remainder > 0n) {
      // A partial return with no nameable seller is refused rather than parked in a platform account: money with no
      // owner is the one outcome a ledger must never record (the dispute path's identical refusal).
      if (!seller) throw new InfraError('RETURN_REFUND_NO_SELLER', 'cannot resolve the seller for the kept remainder', { returnId, orderId });
      const split = await this.flags.isEnabled('commission_split', { tenantId });
      if (split) {
        const b = await this.pricing.quote(tx, { tenantId, grossMinor: remainder, categoryId: (p.categoryId as string) ?? null, source: (p.source as string) ?? null, countryCode: 'IN' });
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
    const res = await this.wallet.post(tx, { tenantId, txnType: 'refund', idempotencyKey: `return-refund:${returnId}`, referenceType: 'return', referenceId: returnId, initiatedBy: 'system', legs: legs.filter((l) => l.amountMinor !== 0n) });
    if (!res.alreadyApplied) this.metrics.inc('payments.return_refund', { tenant: tenantId });
    await this.outbox.write(tx, { tenantId, aggregateType: 'return', aggregateId: returnId, eventType: 'payments.return_refunded', payload: { v: 1, returnId, orderId, txnId: res.txnId, refundedMinor: refund.toString(), remainderMinor: remainder.toString() } });
  }
}
