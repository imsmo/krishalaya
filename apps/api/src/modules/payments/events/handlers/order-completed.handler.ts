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
//
// PC-56 TENANT-SW-a — THE SETTLEMENT ITSELF MOVED TO OrderSettlementService (shared with the hold-release handler, same key). This
// handler is now the door: it hands the completion to the service, which (1) defers it while a settlement hold is open (a flagged POD
// review, a COD shortfall), (2) prices the commission from the ORDER's frozen snapshot — never a rule resolved now (F-4), and (3) settles
// a buyer-charged commission without touching the seller (F-10). The leg table is in the service's header.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { OrderSettlementService } from '../../services/order-settlement.service';

@Injectable()
export class OrderCompletedHandler implements OutboxHandler {
  readonly eventType = 'orders.order_completed';
  constructor(private readonly settlement: OrderSettlementService) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    if (!event.tenantId) return;
    await this.settlement.settle(tx, event.tenantId, event.aggregateId, event.payload as Record<string, unknown>);
  }
}
