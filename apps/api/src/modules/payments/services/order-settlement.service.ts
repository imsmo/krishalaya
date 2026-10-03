// modules/payments/services/order-settlement.service.ts · PC-56 TENANT-SW-a — THE ONE PLACE AN ORDER'S ESCROW IS SETTLED.
//
// Extracted from OrderCompletedHandler (whose header keeps the history: 10b's promotion top-up, HOTFIX-2's kv_app rule read) so the
// completion AND the release of a settlement hold settle through the same code and the same idempotency key (`settle:<orderId>`).
// What changed in this wave, and only this (Law 9 — founder review owed):
//
//   1. HOLDS (founder decision "escrow holds only on a flagged POD"; COD shortfall). Before any leg, the order's open settlement holds
//      are LOCKED in a kv_app unit of work. With one open, the completion payload is kept (settlement_deferrals) and NOTHING settles;
//      releasing the last hold emits payments.settlement_hold_released and SettlementHoldReleasedHandler calls this again.
//   2. THE FROZEN RULE (F-4). The commission is priced from the ORDER's commission_snapshot — written at placement — never from a rule
//      resolved now. A pre-0196 order is resolved ONCE on its placement date and that is recorded (SettlementPricingService).
//   3. charged_to = BUYER (F-10). The buyer paid the commission + GST at placement (orders.buyer_commission_minor, in the total). It is
//      excluded from the seller's settleable gross like every buyer charge; the seller is settled on the FULL goods value (less 194-O
//      TDS when the split is on); the frozen commission splits tenant / platform share (the plan floor frozen at placement); its GST goes
//      to gst_payable.
//
// LEG TABLE (all on the relay transaction, one balanced transaction keyed settle:<orderId>; + = credit, − = debit):
//   SELLER-CHARGED, split ON   : escrow −gross · seller main +net · tenant commission +tc · gst_payable +gst · tds_payable +tds ·
//                                platform fees +(share + delivery + platform fee)              net = goods − commission − gst − tds
//   BUYER-CHARGED,  split ON   : escrow −gross · seller main +(goods − tds) · tenant commission +tc · gst_payable +G · tds_payable +tds ·
//                                platform fees +(share + delivery + platform fee)              gross = goods + C + G + delivery + fee
//   either, split OFF          : escrow −gross · seller main +goods · platform fees +(delivery + platform fee) [+ a frozen buyer
//                                commission still splits tc / share / G — the buyer paid it]
// Zero-sum by construction; the wallet port refuses anything else. The settlement line mirrors the legs so a clawback reverses them.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../core/wallet/wallet.port';
import { platform, userMain, tenantCommission, PlatformAccount } from '../../../core/wallet/account-codes';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { SettlementPricingService } from './settlement-pricing.service';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { SettlementHoldRepository } from '../repositories/settlement-hold.repository';
import { CouponMoneyService } from '../../promotions/services/coupon-money.service';
import { computeBuyerChargedSettlement } from '../domain/commission-rule.entity';
import { FrozenSnapshotMismatchError } from '../domain/commission.errors';

export type SettleOutcome = 'settled' | 'deferred' | 'skipped';

@Injectable()
export class OrderSettlementService {
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly pricing: SettlementPricingService,
    private readonly lines: SettlementLineRepository,
    private readonly holds: SettlementHoldRepository,
    private readonly couponMoney: CouponMoneyService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** Settle (or defer) one completed order. `tx` is the relay transaction — every LEG is posted on it; every table READ / hold row is
   *  in a kv_app unit of work (HOTFIX-2: the relay holds no grant on orders, commission_rules, settlement_holds). */
  async settle(tx: TxContext, tenantId: string, orderId: string, payload: Record<string, unknown>): Promise<SettleOutcome> {
    const sellerUserId = payload.sellerUserId as string | undefined;
    const totalRaw = payload.totalMinor as string | undefined;
    if (!tenantId || !sellerUserId || !totalRaw) return 'skipped';
    const gross = BigInt(totalRaw);                 // total the buyer paid into escrow
    if (gross < 0n) return 'skipped';               // malformed event — fail closed, don't settle

    // (1) THE HOLD GATE. The open holds are locked; with one open, the payload is kept and nothing settles. A release committed before
    //     this read is seen (no hold → settle); one waiting on these locks runs after the deferral commits and finds it.
    const deferred = await this.uow.run(tenantId, async (h) => {
      const open = await this.holds.lockOpenTx(h, tenantId, orderId);
      if (open.length === 0) return false;
      await this.holds.deferTx(h, tenantId, orderId, payload);
      return true;
    }, { userId: 'system' });
    if (deferred) { this.metrics.inc('payments.settlement_deferred', { tenant: tenantId }); return 'deferred'; }

    if (gross === 0n) {                             // nothing in escrow (a fully discounted order with no charges)
      await this.couponMoney.settleOrderInTx(tx, { tenantId, orderId, sellerUserId });
      return 'settled';
    }

    // BUYER-side charges (delivery + platform fee + a buyer-charged commission) are not the seller's — excluded from the settleable gross.
    const deliveryFee = BigInt((payload.deliveryFeeMinor as string) ?? '0');
    const platformFee = BigInt((payload.platformFeeMinor as string) ?? '0');
    const buyerCommissionPaid = BigInt((payload.buyerCommissionMinor as string) ?? '0');
    const settleable = gross - deliveryFee - platformFee - buyerCommissionPaid;   // the goods value the seller settles on
    if (settleable < 0n) return 'skipped';

    const split = await this.flags.isEnabled('commission_split', { tenantId });
    const legs: LedgerLeg[] = [{ account: platform(PlatformAccount.Escrow), amountMinor: -gross }];
    let platformFees = deliveryFee + platformFee;
    let line = { gross: settleable, commission: 0n, gst: 0n, tds: 0n, net: settleable, tenantCommission: 0n, buyerCommission: 0n, buyerCommissionGst: 0n };

    if (split || buyerCommissionPaid > 0n) {
      // (2) THE FROZEN RULE — read (or, pre-0196, resolved once on the placement date and recorded) as kv_app.
      const categoryId = (payload.categoryId as string) ?? null;
      const countryCode = (payload.countryCode as string) ?? 'IN';
      const frozen = await this.uow.run(tenantId, (r) => this.pricing.frozenForOrder(r, tenantId, orderId, { categoryId, source: (payload.source as string) ?? null }), { userId: 'system' });
      if (frozen.buyerCommissionMinor !== buyerCommissionPaid) {
        throw new FrozenSnapshotMismatchError({ orderId, payloadBuyerCommission: buyerCommissionPaid.toString(), orderBuyerCommission: frozen.buyerCommissionMinor.toString() });
      }
      const snap = frozen.snapshot;
      if (snap.chargedTo === 'buyer') {
        // (3) charged_to = BUYER — from the frozen amounts the buyer paid; the seller keeps the full goods value (less TDS when split on)
        const bc = snap.buyerCharge;
        const C = bc ? BigInt(bc.commissionMinor) : 0n;
        const G = bc ? BigInt(bc.gstMinor) : 0n;
        if (C + G !== buyerCommissionPaid) throw new FrozenSnapshotMismatchError({ orderId, snapshotCommission: C.toString(), snapshotGst: G.toString(), paid: buyerCommissionPaid.toString() });
        const { tds } = split ? await this.uow.run(tenantId, (r) => this.pricing.taxes(r, countryCode, categoryId, snap.resolvedOn), { userId: 'system' }) : { tds: null };
        const b = computeBuyerChargedSettlement(settleable, { commissionMinor: C, gstMinor: G, platformShareBps: snap.platformShareBps }, tds);
        legs.push(
          { account: userMain(sellerUserId), amountMinor: b.sellerNetMinor },
          { account: tenantCommission(tenantId), amountMinor: b.tenantCommissionMinor },
          { account: platform(PlatformAccount.GstPayable), amountMinor: b.gstMinor },
          { account: platform(PlatformAccount.TdsPayable), amountMinor: b.tdsMinor },
        );
        platformFees += b.platformShareMinor;
        line = { gross: settleable, commission: 0n, gst: 0n, tds: b.tdsMinor, net: b.sellerNetMinor, tenantCommission: b.tenantCommissionMinor, buyerCommission: C, buyerCommissionGst: G };
      } else if (split) {
        const b = await this.uow.run(tenantId, (r) => this.pricing.quoteFrozen(r, { tenantId, grossMinor: settleable, snapshot: snap, categoryId, countryCode }), { userId: 'system' });
        legs.push(
          { account: userMain(sellerUserId), amountMinor: b.sellerNetMinor },
          { account: tenantCommission(tenantId), amountMinor: b.tenantCommissionMinor },
          { account: platform(PlatformAccount.GstPayable), amountMinor: b.gstOnCommissionMinor },
          { account: platform(PlatformAccount.TdsPayable), amountMinor: b.tdsMinor },
        );
        platformFees += b.platformShareMinor;
        line = { gross: settleable, commission: b.commissionMinor, gst: b.gstOnCommissionMinor, tds: b.tdsMinor, net: b.sellerNetMinor, tenantCommission: b.tenantCommissionMinor, buyerCommission: 0n, buyerCommissionGst: 0n };
      } else {
        legs.push({ account: userMain(sellerUserId), amountMinor: settleable });
      }
    } else {
      legs.push({ account: userMain(sellerUserId), amountMinor: settleable });
    }
    if (platformFees > 0n) legs.push({ account: platform(PlatformAccount.Fees), amountMinor: platformFees });

    await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `settle:${orderId}`, referenceType: 'order', referenceId: orderId, initiatedBy: 'system', legs: legs.filter((l) => l.amountMinor !== 0n) });
    await this.lines.insert(tx, { tenantId, sellerUserId, orderId, grossMinor: line.gross, commissionMinor: line.commission, gstMinor: line.gst, tdsMinor: line.tds,
      netMinor: line.net, tenantCommissionMinor: line.tenantCommission, platformFeesMinor: platformFees, buyerCommissionMinor: line.buyerCommission, buyerCommissionGstMinor: line.buyerCommissionGst });
    // 10b A2 — the promotion top-up: tenant Hold → seller Main for every discount reserved on this order (none → no-op).
    await this.couponMoney.settleOrderInTx(tx, { tenantId, orderId, sellerUserId });
    return 'settled';
  }
}

/** Hand-wiring for the pilot relay tick and integration specs that build the settlement handler without the Nest container. The SAME
 *  classes the module provides — nothing about settlement differs between the two. */
export function composeOrderSettlement(d: { wallet: WalletPort; flags: FlagsService; replica: unknown; uow: UnitOfWork; couponMoney: CouponMoneyService;
  lines?: SettlementLineRepository; metrics?: Metrics }): OrderSettlementService {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CommissionRuleRepository } = require('../repositories/commission-rule.repository') as typeof import('../repositories/commission-rule.repository');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TaxRuleRepository } = require('../repositories/tax-rule.repository') as typeof import('../repositories/tax-rule.repository');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrderRepository } = require('../../orders/repositories/order.repository') as typeof import('../../orders/repositories/order.repository');
  const replica = d.replica as never;
  const pricing = new SettlementPricingService(new CommissionRuleRepository(replica), new TaxRuleRepository(replica), new OrderRepository(replica));
  const metrics: Metrics = d.metrics ?? ({ inc: () => undefined, observe: () => undefined } as unknown as Metrics);
  return new OrderSettlementService(d.wallet, d.flags, pricing, d.lines ?? new SettlementLineRepository(), new SettlementHoldRepository(), d.couponMoney, d.uow, metrics);
}
