// modules/payments/events/handlers/order-completed.handler.ts
// Consumes orders.order_completed (via the outbox relay). Settles the held escrow. With the
// `commission_split` flag ON (Law 10), the escrow is split via the commission/tax engine into:
//   seller net (residual) + tenant commission + platform share (fees) + GST-on-commission
//   (gst_payable) + 194-O TDS (tds_payable) — a ZERO-SUM ledger transaction.
// With the flag OFF (default), the full amount is released to the seller (legacy behaviour), so the
// split can be rolled out per-tenant safely. The seller/amount/source come from the event payload
// (cross-module data travels in the event, not via the orders repository — Law 11). IDEMPOTENT:
// keyed on settle:<orderId>, so a re-delivery (or a flag flip after settlement) is a no-op.
//
// PC-56 TENANT-10b · F-2 / A2 — THE PROMOTION TOP-UP (one additive leg, founder review owed per Law 9). Founder decision:
// the TENANT's wallet funds a coupon discount. The escrow legs below are UNCHANGED — the seller is still settled on
// `total − buyer charges`, which is the DISCOUNTED goods value, and commission/TDS are still computed on it. AFTER them,
// in THIS transaction, `CouponMoneyService.settleOrderInTx` pays every discount the tenant reserved at checkout from the
// tenant's Hold to the seller (`promo_settle`, keyed `promo-settle:<orderId>:<couponId>`), so the seller is settled on
// the FULL goods value. It is its own balanced ledger transaction rather than extra legs inside `settle:<orderId>`, so the
// escrow transaction every existing reconciliation and statement reads stays byte-identical; it rides the same database
// transaction, so the two commit or roll back together. The redemption is read IN-TX by order id (the event does not
// carry it) and locked, so a cancel racing this cannot spend the same reservation twice. Idempotent per order.
// A fully discounted order with no buyer charges has `gross = 0` and no escrow to release; its top-up is still paid.
//
// PC-56 HOTFIX-2 (SWEEP F-2, MONEY) — THE SPLIT'S RULE LOOKUP RUNS IN kv_app's UNIT OF WORK, THE MONEY STAYS ON THE RELAY TX.
// With `commission_split` ON, `SettlementPricingService.quote` read `commission_rules` + `tax_rules` on the relay transaction,
// as `kv_relay`, which holds NO SELECT on either — the day the flag turned on, every settlement (and every other handler of
// `order_completed`) would have died 42501. The rule lookup is a pure READ of committed platform/tenant configuration, so it
// now runs in its own request-tier unit of work (kv_app, RLS-bound to the event's tenant: the tenant's rows + the platform
// defaults, exactly what the request tier's own quote sees). Nothing about atomicity changes: the relay tx runs at READ
// COMMITTED, where every statement already reads the latest committed rules — a separate read-only transaction sees the
// same rows. The ledger legs, their amounts, the idempotency key and the settlement line are untouched and still commit
// atomically with the event on the relay tx. No grant was added to kv_relay.
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort, LedgerLeg } from '../../../../core/wallet/wallet.port';
import { platform, userMain, tenantCommission, PlatformAccount } from '../../../../core/wallet/account-codes';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { SettlementPricingService } from '../../services/settlement-pricing.service';
import { SettlementLineRepository } from '../../repositories/settlement-line.repository';
import { CouponMoneyService } from '../../../promotions/services/coupon-money.service';

@Injectable()
export class OrderCompletedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_completed';
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly pricing: SettlementPricingService,
    private readonly lines: SettlementLineRepository,
    private readonly couponMoney: CouponMoneyService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const sellerUserId = event.payload.sellerUserId as string | undefined;
    const totalRaw = event.payload.totalMinor as string | undefined;
    if (!tenantId || !sellerUserId || !totalRaw) return;
    const gross = BigInt(totalRaw);                 // total the buyer paid into escrow
    if (gross < 0n) return;                         // malformed event — fail closed, don't settle
    if (gross === 0n) {                             // nothing in escrow (a fully discounted order with no charges)
      await this.couponMoney.settleOrderInTx(tx, { tenantId, orderId: event.aggregateId, sellerUserId });
      return;
    }

    // BUYER-side charges (delivery + platform fee) are the PLATFORM's revenue, not the seller's —
    // exclude them from the settleable gross and route them to the platform's fees account.
    const buyerCharges = BigInt((event.payload.deliveryFeeMinor as string) ?? '0') + BigInt((event.payload.platformFeeMinor as string) ?? '0');
    const settleable = gross - buyerCharges;        // the goods value the seller settles on
    if (settleable < 0n) return;                    // malformed event — fail closed, don't settle

    const split = await this.flags.isEnabled('commission_split', { tenantId });
    const legs: LedgerLeg[] = [{ account: platform(PlatformAccount.Escrow), amountMinor: -gross }];
    let line = { gross: settleable, commission: 0n, gst: 0n, tds: 0n, net: settleable, tenantCommission: 0n };
    let platformFees = buyerCharges;                // platform keeps the buyer charges

    if (split) {
      // HOTFIX-2: the rule lookup reads as kv_app (read-only, committed config); the legs below stay on the relay tx
      const b = await this.uow.run(tenantId, (ruleTx) => this.pricing.quote(ruleTx, {
        tenantId, grossMinor: settleable,
        categoryId: (event.payload.categoryId as string) ?? null,
        source: (event.payload.source as string) ?? null,
        countryCode: (event.payload.countryCode as string) ?? 'IN',
      }), { userId: 'system' });
      legs.push(
        { account: userMain(sellerUserId), amountMinor: b.sellerNetMinor },
        { account: tenantCommission(tenantId), amountMinor: b.tenantCommissionMinor },
        { account: platform(PlatformAccount.GstPayable), amountMinor: b.gstOnCommissionMinor },
        { account: platform(PlatformAccount.TdsPayable), amountMinor: b.tdsMinor },
      );
      platformFees += b.platformShareMinor;         // platform commission share + buyer charges
      line = { gross: settleable, commission: b.commissionMinor, gst: b.gstOnCommissionMinor, tds: b.tdsMinor, net: b.sellerNetMinor, tenantCommission: b.tenantCommissionMinor };
    } else {
      legs.push({ account: userMain(sellerUserId), amountMinor: settleable });
    }
    if (platformFees > 0n) legs.push({ account: platform(PlatformAccount.Fees), amountMinor: platformFees });

    await this.wallet.post(tx, { tenantId, txnType: 'escrow_release', idempotencyKey: `settle:${event.aggregateId}`, referenceType: 'order', referenceId: event.aggregateId, initiatedBy: 'system', legs: legs.filter((l) => l.amountMinor !== 0n) });
    // record the per-order settlement line (source for the seller's statement) — idempotent per order
    await this.lines.insert(tx, { tenantId, sellerUserId, orderId: event.aggregateId, grossMinor: line.gross, commissionMinor: line.commission, gstMinor: line.gst, tdsMinor: line.tds, netMinor: line.net, tenantCommissionMinor: line.tenantCommission, platformFeesMinor: platformFees });
    // A2 — the promotion top-up: tenant Hold → seller Main for every discount reserved on this order (none → no-op).
    await this.couponMoney.settleOrderInTx(tx, { tenantId, orderId: event.aggregateId, sellerUserId });
  }
}
