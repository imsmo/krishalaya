// modules/payments/services/resolution-money.service.ts · PC-56 HOTFIX-7 · D3 (founder Q3) — THE MONEY OF A DISPUTE OR RETURN REFUND, ONE PLACE.
//
// The two payments handlers (dispute-resolved.handler.ts, return-refunded.handler.ts) computed the same legs line for line (TENANT-3b's note
// said "one day they should be one service"). HOTFIX-7 changes the BUYER's leg in both — from `userMain(buyer)` (the buyer's wallet, whatever
// they paid with) to 2c's refund-to-source — so the change is made ONCE, here, and the handlers keep only what differs (how the amount, the
// seller and the reference are read from their event). Law 9 — every leg below is named in the wave report §9.
//
// THE LEGS (+ credit / − debit), per resolution of an order whose payment was CAPTURED (a pay-on-delivery order has none → nothing moves):
//   [refund]     PaymentService.refundForResolution — its OWN kv_app transaction, posted FIRST:
//                  `dispute-refund:<id>` / `return-refund:<id>` (txn type `refund`): escrow −refund · source +refund
//                  (source = platform:gateway for a card / UPI / netbanking payment, user:<buyer>:main for a wallet payment)
//   [clawback]   only when the order had ALREADY settled — on the relay tx, unchanged from TENANT-3b:
//                  `dispute-clawback:<id>` / `return-clawback:<id>` (escrow_release): seller −net · tenant commission −tc · gst_payable −(gst+buyer gst)
//                  · tds_payable −tds · fees −fees · escrow +gross; the settlement line is deleted
//   [remainder]  only on a PARTIAL refund — on the relay tx, a NEW key (it used to ride inside the refund txn):
//                  `dispute-remainder:<id>` / `return-remainder:<id>` (refund): escrow −remainder · seller net + tenant commission + gst_payable
//                  + tds_payable + fees (commission_split ON, priced from the ORDER's frozen rule in the ORGANISATION's country) — or
//                  escrow −remainder · seller +remainder (split OFF); a fresh settlement line records it
//   Each is a balanced transaction (the wallet refuses anything else); escrow nets to zero for the order: +gross (capture or clawback)
//   −refund −remainder.
//
// ORDER AND FAILURE (the refund commits before the relay transaction does — HOTFIX-2's kv_app rule; the relay role holds nothing on `payments`):
//   1. Everything that could refuse the relay part is asked FIRST, before any money moves: a line already in a paid statement
//      (…_AFTER_STATEMENT), a remainder with no nameable seller (…_NO_SELLER), the organisation's country (SETTLEMENT_COUNTRY_UNKNOWN), a
//      buyer-paid commission on a partial refund (BUYER_COMMISSION_PARTIAL_REFUND_UNSUPPORTED), and — when a clawback is due — that the seller
//      and the organisation still hold what it debits (…_CLAWBACK_SHORT; the wallet's no-overdraw rule would refuse it AFTER the refund had
//      gone out). A race in the gap (a withdrawal between the check and the clawback) quarantines the event with the refund booked — named.
//      A line that re-settled an EARLIER resolution's remainder (a second refund on the same order) cannot be clawed back to the gross — refused
//      too (…_REFUND_AFTER_RESETTLEMENT), before the refund (the pre-HOTFIX-7 handler failed the same case unbalanced, atomically, with nothing moved).
//   2. The refund (its own transaction; idempotent on its key). 3. The clawback and the remainder on the relay tx (idempotent on theirs).
//   A relay retry re-runs 1–3: the refund finds its key and books nothing; a replay after a complete run finds the remainder key (or, for a
//   full refund, no line left to claw back) and books nothing. A refund booked by the PRE-HOTFIX-7 handler (one txn: escrow → buyer wallet +
//   the remainder to the seller; the payment row untouched) is recognised — its key is booked while the payment still shows nothing refunded
//   for it — and nothing is booked again.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../core/wallet/wallet.port';
import { platform, userMain, tenantCommission, PlatformAccount } from '../../../core/wallet/account-codes';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InfraError } from '../../../shared/errors/app-error';
import { PaymentRepository } from '../repositories/payment.repository';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { SettlementPricingService } from './settlement-pricing.service';
import { OrderSettlementService } from './order-settlement.service';
import { PaymentService } from './payment.service';
import { BuyerCommissionPartialRefundError } from '../domain/commission.errors';
import { ResolutionRefundKind, RESOLUTION_REFUND_TXN_TYPE, resolutionClawbackKey, resolutionRefundKey, resolutionRemainderKey, splitResolution } from '../domain/resolution-refund';

export interface ResolutionInput {
  kind: ResolutionRefundKind;
  referenceId: string;
  tenantId: string;
  orderId: string;
  /** 'full' = the captured gross; else the decided / recorded amount (capped at the gross) */
  requested: 'full' | bigint;
  /** who keeps a partial remainder — resolved by the handler from its event (null = cannot be named) */
  resolveSeller: (buyerUserId: string) => string | null;
  /** the event payload (categoryId / source / countryCode hints for the remainder's pricing) */
  payload: Record<string, unknown>;
}
export interface ResolutionResult {
  outcome: 'unpaid' | 'nothing' | 'applied' | 'already';
  refundMinor: bigint; remainderMinor: bigint;
  refundTxnId: string | null; remainderTxnId: string | null;
  /** true when THIS run booked the refund (false on a replay) */
  refundBookedNow: boolean;
}

const NONE = (outcome: ResolutionResult['outcome']): ResolutionResult => ({ outcome, refundMinor: 0n, remainderMinor: 0n, refundTxnId: null, remainderTxnId: null, refundBookedNow: false });

@Injectable()
export class ResolutionMoneyService {
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly repo: PaymentRepository,
    private readonly lines: SettlementLineRepository,
    private readonly pricing: SettlementPricingService,
    private readonly settlement: OrderSettlementService,
    private readonly payments: PaymentService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async apply(tx: TxContext, i: ResolutionInput): Promise<ResolutionResult> {
    const { tenantId, orderId, kind, referenceId } = i;
    const tag = kind.toUpperCase();   // DISPUTE / RETURN — the refusal names the handler's
    // (0) the captured payment and the facts already booked, as kv_app (any captured status: a relay retry after the refund committed must still
    //     find it — HOTFIX-7; the pre-HOTFIX-7 read was `success` only)
    const facts = await this.uow.run(tenantId, async (r) => {
      const payment = await this.repo.capturedForOrderTx(r, tenantId, orderId);
      if (!payment) return null;
      return { payment, refundTxn: await this.repo.ledgerTxnIdByKeyTx(r, resolutionRefundKey(kind, referenceId)),
        remainderTxn: await this.repo.ledgerTxnIdByKeyTx(r, resolutionRemainderKey(kind, referenceId)) };
    }, { userId: 'system' });
    if (!facts) return NONE('unpaid');                                   // pay-on-delivery / never captured → nothing to reverse
    const { payment } = facts;
    const gross = payment.amountMinor;
    const { refundMinor: refund, remainderMinor: remainder } = splitResolution(gross, i.requested === 'full' ? gross : i.requested);
    if (refund <= 0n) return NONE('nothing');
    // a complete earlier run (the remainder is the relay part's last posting), or the PRE-HOTFIX-7 single transaction (its key booked while the
    // payment row was never moved for it) → books nothing
    if (facts.remainderTxn) return { outcome: 'already', refundMinor: refund, remainderMinor: remainder, refundTxnId: facts.refundTxn, remainderTxnId: facts.remainderTxn, refundBookedNow: false };
    if (facts.refundTxn && payment.refundedMinor === 0n) return { outcome: 'already', refundMinor: refund, remainderMinor: remainder, refundTxnId: facts.refundTxn, remainderTxnId: null, refundBookedNow: false };

    // (1) PRE-CHECKS — nothing has moved yet
    const line = await this.lines.findByOrder(tx, tenantId, orderId);
    if (line?.statementId) throw new InfraError(`${tag}_REFUND_AFTER_STATEMENT`, 'order settled into a paid statement; needs manual clawback', { orderId, referenceId });
    let seller: string | null = null;
    let remainderPlan: { legs: LedgerLeg[]; line: Parameters<SettlementLineRepository['insert']>[1] } | null = null;
    if (remainder > 0n) {
      seller = i.resolveSeller(payment.userId);
      // A partial refund with no nameable seller is refused rather than parked in a platform account: money with no owner is the one outcome a
      // ledger must never record.
      if (!seller) throw new InfraError(`${tag}_REFUND_NO_SELLER`, 'cannot resolve the seller for the kept remainder', { referenceId, orderId });
      remainderPlan = await this.priceRemainder(tenantId, orderId, seller, remainder, kind, referenceId, i.payload);
    }
    if (line) {
      // the clawback restores escrow to the GROSS from the line's legs — balanced only for a line that settled the whole gross. A line that
      // re-settled an earlier resolution's REMAINDER (a return after a partial dispute refund on the same order) sums to less: the wallet would
      // refuse the clawback AFTER the refund had gone out — refused here, by name, before anything moves (the money desk's case).
      const settled = line.netMinor + line.tenantCommissionMinor + line.gstMinor + (line.buyerCommissionGstMinor ?? 0n) + line.tdsMinor + line.platformFeesMinor;
      if (settled !== gross) throw new InfraError(`${tag}_REFUND_AFTER_RESETTLEMENT`, 'this order was already re-settled after an earlier refund; a second refund needs the money desk', { orderId, referenceId, settledMinor: settled.toString(), grossMinor: gross.toString() });
      await this.assertClawbackCoverable(tx, tenantId, line, tag, referenceId);
    }

    // (2) THE REFUND, TO SOURCE (founder D3) — its own kv_app transaction; escrow −refund · source +refund
    const r = await this.payments.refundForResolution(tenantId, orderId, { referenceType: kind, referenceId, amountMinor: refund });

    // (3) the order had ALREADY settled → reverse the release leg-for-leg (escrow restored to the gross), then (4) the kept remainder
    if (line) {
      const reversal: LedgerLeg[] = [
        { account: userMain(line.sellerUserId), amountMinor: -line.netMinor },
        { account: tenantCommission(tenantId), amountMinor: -line.tenantCommissionMinor },
        { account: platform(PlatformAccount.GstPayable), amountMinor: -(line.gstMinor + (line.buyerCommissionGstMinor ?? 0n)) },   // SW-a: + GST on a buyer-paid commission
        { account: platform(PlatformAccount.TdsPayable), amountMinor: -line.tdsMinor },
        { account: platform(PlatformAccount.Fees), amountMinor: -line.platformFeesMinor },
        { account: platform(PlatformAccount.Escrow), amountMinor: gross },
      ].filter((l) => l.amountMinor !== 0n);
      await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: resolutionClawbackKey(kind, referenceId), referenceType: kind, referenceId, initiatedBy: 'system', legs: reversal });
      await this.lines.deleteByOrder(tx, tenantId, orderId);
    }
    let remainderTxnId: string | null = null;
    if (remainderPlan) {
      const res = await this.wallet.post(tx, { tenantId, txnType: RESOLUTION_REFUND_TXN_TYPE, idempotencyKey: resolutionRemainderKey(kind, referenceId), referenceType: kind, referenceId,
        initiatedBy: 'system', legs: remainderPlan.legs.filter((l) => l.amountMinor !== 0n) });
      remainderTxnId = res.txnId;
      await this.lines.insert(tx, remainderPlan.line);
    }
    return { outcome: 'applied', refundMinor: refund, remainderMinor: remainder, refundTxnId: r.ledgerTxnId ?? null, remainderTxnId,
      refundBookedNow: r.outcome !== 'already' && r.alreadyBooked !== true };
  }

  /** The kept remainder's legs and settlement line — escrow −remainder → the seller (split ON: through the ORDER's frozen rule, priced in the
   *  ORGANISATION's country — never a literal). Computed before any money moves so a pricing refusal moves nothing. */
  private async priceRemainder(tenantId: string, orderId: string, seller: string, remainder: bigint, kind: ResolutionRefundKind, referenceId: string, p: Record<string, unknown>) {
    const legs: LedgerLeg[] = [{ account: platform(PlatformAccount.Escrow), amountMinor: -remainder }];
    const split = await this.flags.isEnabled('commission_split', { tenantId });
    if (!split) {
      legs.push({ account: userMain(seller), amountMinor: remainder });
      return { legs, line: { tenantId, sellerUserId: seller, orderId, grossMinor: remainder, commissionMinor: 0n, gstMinor: 0n, tdsMinor: 0n, netMinor: remainder, tenantCommissionMinor: 0n, platformFeesMinor: 0n } };
    }
    const categoryId = (p.categoryId as string) ?? null;
    // PC-56 TENANT-SW-a · A2: the kept remainder is priced from the ORDER's FROZEN rule (placement day), never a rule resolved now.
    const frozen = await this.uow.run(tenantId, (r) => this.pricing.frozenForOrder(r, tenantId, orderId, { categoryId, source: (p.source as string) ?? null }), { userId: 'system' });
    if (frozen.snapshot.chargedTo === 'buyer') throw new BuyerCommissionPartialRefundError({ orderId, [`${kind}Id`]: referenceId });
    // HOTFIX-7 · B3: the organisation's country (the event carries none — read as kv_app; unknown → SETTLEMENT_COUNTRY_UNKNOWN)
    const countryCode = await this.settlement.countryFor(tenantId, p, `${kind}_remainder`);
    const b = await this.uow.run(tenantId, (r) => this.pricing.quoteFrozen(r, { tenantId, grossMinor: remainder, snapshot: frozen.snapshot, categoryId, countryCode }), { userId: 'system' });
    legs.push(
      { account: userMain(seller), amountMinor: b.sellerNetMinor },
      { account: tenantCommission(tenantId), amountMinor: b.tenantCommissionMinor },
      { account: platform(PlatformAccount.GstPayable), amountMinor: b.gstOnCommissionMinor },
      { account: platform(PlatformAccount.TdsPayable), amountMinor: b.tdsMinor },
      { account: platform(PlatformAccount.Fees), amountMinor: b.platformShareMinor },
    );
    return { legs, line: { tenantId, sellerUserId: seller, orderId, grossMinor: remainder, commissionMinor: b.commissionMinor, gstMinor: b.gstOnCommissionMinor, tdsMinor: b.tdsMinor,
      netMinor: b.sellerNetMinor, tenantCommissionMinor: b.tenantCommissionMinor, platformFeesMinor: b.platformShareMinor } };
  }

  /** The clawback debits the seller's main and the organisation's commission account (both no-overdraw). Asked BEFORE the refund goes out, so a
   *  seller who already withdrew stops the whole resolution with nothing moved (…_CLAWBACK_SHORT → the relay quarantines it for the desk). */
  private async assertClawbackCoverable(tx: TxContext, tenantId: string, line: { sellerUserId: string; netMinor: bigint; tenantCommissionMinor: bigint }, tag: string, referenceId: string): Promise<void> {
    const checks: Array<[ReturnType<typeof userMain>, bigint, string]> = [
      [userMain(line.sellerUserId), line.netMinor, 'seller_main'],
      [tenantCommission(tenantId), line.tenantCommissionMinor, 'tenant_commission'],
    ];
    for (const [account, needed, which] of checks) {
      if (needed <= 0n) continue;
      const held = await this.wallet.balanceMinor(tx, account);
      if (held < needed) throw new InfraError(`${tag}_CLAWBACK_SHORT`, 'the settled amount has already left the account it would be clawed back from', { referenceId, account: which, neededMinor: needed.toString(), heldMinor: held.toString() });
    }
  }
}
