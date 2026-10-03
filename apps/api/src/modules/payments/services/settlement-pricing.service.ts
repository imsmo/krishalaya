// modules/payments/services/settlement-pricing.service.ts
// The commission/tax ENGINE: the zero-sum SettlementBreakdown (pure math in commission-rule.entity). Read-only — it never moves money;
// the handlers post the resulting legs through the wallet boundary. Fails CLOSED (no commission rule ⇒ throw, don't settle).
//
// PC-56 TENANT-SW-a · A2 (founder decision "freeze at placement") — SETTLEMENT NEVER RE-RESOLVES A RULE.
//   • `frozenForOrder` reads the ORDER's `commission_snapshot` (written at placement by CommissionSnapshotService). An order placed
//     before 0196 has none: it is resolved ONCE, on its own placement date (IST), and recorded on the order (resolvedAtCompletion) —
//     the only resolution that ever happens after placement, and it happens once (0196 trg_orders_frozen_once).
//   • `quoteFrozen` prices a settleable amount from the frozen VALUES (rate, fixed, cap, platform share = the plan floor at
//     placement, charged_to). Taxes are statutory platform data resolved on the snapshot's date.
//   • `quoteLive` (the old `quote`) resolves today's rule. It is for placement and previews only — no settlement path calls it
//     (the spec's mutation: route completion through it and the frozen-rate test goes red).
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { computeSettlement, CommissionSnapshot, isCommissionSnapshot, SettlementBreakdown, snapshotFromRule, valuesFromSnapshot, TaxRuleValues } from '../domain/commission-rule.entity';
import { NoCommissionRuleError } from '../domain/commission.errors';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';

export interface SettlementQuoteInput {
  tenantId: string;
  grossMinor: bigint;
  categoryId?: string | null;
  sellerRoleId?: string | null;
  source?: string | null;
  countryCode?: string;          // for tax resolution (default 'IN')
  onDate?: string;
}

export interface FrozenOrderPricing { snapshot: CommissionSnapshot; buyerCommissionMinor: bigint; recordedNow: boolean; sellerUserId: string; buyerUserId: string }

@Injectable()
export class SettlementPricingService {
  constructor(private readonly commission: CommissionRuleRepository, private readonly tax: TaxRuleRepository, private readonly orders: OrderRepository) {}

  /** Placement / preview only: today's (or onDate's) best rule priced on a gross. NEVER called at settlement. */
  async quoteLive(tx: TxContext, input: SettlementQuoteInput): Promise<SettlementBreakdown> {
    const rule = await this.commission.resolveBest(tx, {
      tenantId: input.tenantId, categoryId: input.categoryId ?? null, sellerRoleId: input.sellerRoleId ?? null, source: input.source ?? null, onDate: input.onDate,
    });
    if (!rule) throw new NoCommissionRuleError({ tenantId: input.tenantId, source: input.source ?? null });
    const { gst, tds } = await this.taxes(tx, input.countryCode ?? 'IN', input.categoryId ?? null, input.onDate);
    return computeSettlement(input.grossMinor, rule, gst, tds);
  }

  /** The order's frozen commission snapshot — read, or (pre-0196 orders only) resolved once on the placement date and recorded.
   *  Runs in a kv_app unit of work (the relay holds no grant on orders' snapshot column nor on commission_rules — HOTFIX-2). */
  async frozenForOrder(tx: TxContext, tenantId: string, orderId: string, fallback: { categoryId: string | null; source: string | null }): Promise<FrozenOrderPricing> {
    const facts = await this.orders.pricingFactsTx(tx, tenantId, orderId);
    if (!facts) throw new NoCommissionRuleError({ tenantId, orderId, reason: 'order_not_found' });
    if (isCommissionSnapshot(facts.commissionSnapshot)) {
      return { snapshot: facts.commissionSnapshot, buyerCommissionMinor: facts.buyerCommissionMinor, recordedNow: false, sellerUserId: facts.sellerUserId, buyerUserId: facts.buyerUserId };
    }
    // A2 · placed before 0196: resolve ONCE, on the day it was placed (never "today"), and record it.
    const rule = await this.commission.resolveBest(tx, { tenantId, categoryId: fallback.categoryId, sellerRoleId: null, source: fallback.source ?? facts.source, onDate: facts.placedOn });
    const snap = snapshotFromRule(rule, facts.placedOn, { resolvedAtCompletion: true, buyerCharge: null });
    const n = await this.orders.recordCommissionSnapshotOnceTx(tx, tenantId, orderId, snap as unknown as Record<string, unknown>);
    if (n === 0) {   // a concurrent completion recorded it first — that record wins
      const again = await this.orders.pricingFactsTx(tx, tenantId, orderId);
      if (again && isCommissionSnapshot(again.commissionSnapshot)) return { snapshot: again.commissionSnapshot, buyerCommissionMinor: again.buyerCommissionMinor, recordedNow: false, sellerUserId: again.sellerUserId, buyerUserId: again.buyerUserId };
    }
    return { snapshot: snap, buyerCommissionMinor: facts.buyerCommissionMinor, recordedNow: n > 0, sellerUserId: facts.sellerUserId, buyerUserId: facts.buyerUserId };
  }

  /** Price a settleable gross from the FROZEN rule (seller-charged model). No rule was frozen ⇒ fail closed. */
  async quoteFrozen(tx: TxContext, input: { tenantId: string; grossMinor: bigint; snapshot: CommissionSnapshot; categoryId?: string | null; countryCode?: string }): Promise<SettlementBreakdown> {
    if (!input.snapshot.ruleId) throw new NoCommissionRuleError({ tenantId: input.tenantId, resolvedOn: input.snapshot.resolvedOn, frozen: true });
    const { gst, tds } = await this.taxes(tx, input.countryCode ?? 'IN', input.categoryId ?? null, input.snapshot.resolvedOn);
    return computeSettlement(input.grossMinor, valuesFromSnapshot(input.snapshot), gst, tds);
  }

  /** The statutory taxes on a date (GST on the commission service, 194-O TDS on the seller's gross). */
  async taxes(tx: TxContext, countryCode: string, categoryId: string | null, onDate?: string): Promise<{ gst: TaxRuleValues | null; tds: TaxRuleValues | null }> {
    const gst = await this.tax.resolve(tx, { countryCode, taxCode: 'gst', categoryId, onDate });
    const tds = await this.tax.resolve(tx, { countryCode, taxCode: 'tds_194o', categoryId, onDate });
    return { gst, tds };
  }
}
