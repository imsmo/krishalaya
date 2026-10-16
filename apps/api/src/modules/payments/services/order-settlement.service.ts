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
//
// PC-56 HOTFIX-7 · B1 (founder D1 — HOTFIX-5's P0 closed) — A PAY-ON-DELIVERY COMPLETION SETTLES NOTHING FROM ESCROW, WHOEVER COMPLETES IT.
//   Before: nothing here checked that escrow was ever funded. A COD order completed by a moderator (or by a dispute decided `rejected` /
//   `replacement`) posted `escrow −gross → seller …` from an escrow nobody paid into (survey STORE-5 F-1). Now, AFTER the hold gate and BEFORE any
//   leg, the order's funding is read as kv_app (SettlementFundingRepository — a captured `success` payment, the dispute handler's read; or
//   ledger-booked COD cash / an applied auction deposit covering the gross). Unfunded → outcome `skipped_unfunded`: NO wallet post, NO
//   settlement line, metric `payments.settlement_skipped_unfunded`, audit `order.settlement_skipped { reason, totalMinor }` (actor null, on the
//   relay tx — audit_log INSERT is granted to kv_relay). The ONE place (E1), so the buyer, the clock, a moderator and a dispute's completion
//   all fail closed alike. An online-paid order settles exactly as before (same legs, same key).
//   THE COUPON TOP-UP STILL RUNS for an unfunded (COD) order: it is the TENANT's own money, reserved in its Hold at checkout for the discount
//   (`promo-settle:<orderId>:<couponId>`, tenant Hold → seller Main), owed to the seller for the sale whatever way the buyer paid the
//   discounted price — holding it back would strand the reservation and short the seller by the discount. It never touches escrow.
//   `partial` (some cash booked, less than the gross — a shortfall written off outside the hold) releases NOTHING either (reason
//   `partially_funded_escrow`): escrow keeps what it holds for the money desk.
// PC-56 HOTFIX-7 · B3 (Rule Zero) — THE TAX COUNTRY IS THE ORGANISATION'S. `countryCode` comes from the completion payload (orders now carries
//   `tenants.country_code`, read at completion) and, for an older payload, from `tenants.country_code` read here as kv_app. Neither → the named
//   refusal SETTLEMENT_COUNTRY_UNKNOWN (InfraError — the relay retries; metric `payments.settlement_country_unknown`) before any leg. Never a literal country.
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
import { SettlementCountryUnknownError } from '../domain/payments.errors';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { SettlementFundingRepository, fundingVerdict } from '../repositories/settlement-funding.repository';

export type SettleOutcome = 'settled' | 'deferred' | 'skipped' | 'skipped_unfunded';

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
    // PC-56 HOTFIX-7 · B1 / B3: the funding + country reads (kv_app) and the skipped-settlement audit (relay tx)
    private readonly funding: SettlementFundingRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** HOTFIX-7 · B3: the organisation's tax country — the payload's (orders reads `tenants.country_code` at completion), else `tenants.country_code`
   *  read now as kv_app; neither → SETTLEMENT_COUNTRY_UNKNOWN. Shared by the dispute / return remainder pricing. Never a literal. */
  async countryFor(tenantId: string, payload: Record<string, unknown>, where: string): Promise<string> {
    const fromPayload = typeof payload.countryCode === 'string' && /^[A-Z]{2}$/.test(payload.countryCode) ? payload.countryCode : null;
    const country = fromPayload ?? await this.uow.run(tenantId, (r) => this.funding.tenantCountryTx(r, tenantId), { userId: 'system' });
    if (!country) { this.metrics.inc('payments.settlement_country_unknown', { tenant: tenantId, where }); throw new SettlementCountryUnknownError(tenantId, where); }
    return country;
  }

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

    // (1b) PC-56 HOTFIX-7 · B1 (founder D1) — WAS ESCROW EVER FUNDED? Read as kv_app BEFORE any leg. Unfunded (pay-on-delivery: the farmer was
    //      paid in cash) or only partly funded → nothing is released from escrow, whoever completed the order; the tenant's coupon top-up
    //      still runs (its own reserved money — see the header).
    const funding = await this.uow.run(tenantId, (r) => this.funding.escrowFundingTx(r, tenantId, orderId), { userId: 'system' });
    const verdict = fundingVerdict(funding, gross);
    if (verdict !== 'funded') {
      const reason = verdict === 'partial' ? 'partially_funded_escrow' : 'unfunded_escrow';
      this.metrics.inc('payments.settlement_skipped_unfunded', { tenant: tenantId, reason });
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'order.settlement_skipped', entityType: 'order', entityId: orderId, ip: null,
        reason: 'escrow was never funded for this order (pay on delivery) — nothing is released from escrow; the seller was paid outside the platform',
        newValue: { reason, totalMinor: gross.toString(), codLedgerMinor: funding.codLedgerMinor.toString(), emdMinor: funding.emdMinor.toString(),
          currencyCode: (payload.currencyCode as string) ?? null } });
      await this.couponMoney.settleOrderInTx(tx, { tenantId, orderId, sellerUserId });
      return 'skipped_unfunded';
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
      const countryCode = await this.countryFor(tenantId, payload, 'settle');   // HOTFIX-7 · B3: the organisation's, never a default
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
  lines?: SettlementLineRepository; metrics?: Metrics; audit?: AuditWriter }): OrderSettlementService {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CommissionRuleRepository } = require('../repositories/commission-rule.repository') as typeof import('../repositories/commission-rule.repository');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TaxRuleRepository } = require('../repositories/tax-rule.repository') as typeof import('../repositories/tax-rule.repository');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrderRepository } = require('../../orders/repositories/order.repository') as typeof import('../../orders/repositories/order.repository');
  const replica = d.replica as never;
  const pricing = new SettlementPricingService(new CommissionRuleRepository(replica), new TaxRuleRepository(replica), new OrderRepository(replica));
  const metrics: Metrics = d.metrics ?? ({ inc: () => undefined, observe: () => undefined } as unknown as Metrics);
  // HOTFIX-7: the funding / country reads, and an audit writer whose `write(tx, …)` uses only the caller's tx (no pool is needed for it)
  const audit = d.audit ?? new AuditWriter(undefined as never);
  return new OrderSettlementService(d.wallet, d.flags, pricing, d.lines ?? new SettlementLineRepository(), new SettlementHoldRepository(), d.couponMoney, d.uow, metrics,
    new SettlementFundingRepository(), audit);
}
