// modules/payments/services/commission-snapshot.service.ts · PC-56 TENANT-SW-a · A2 / A4 — THE RULE IS FROZEN WHEN THE ORDER IS PLACED.
//
// F-4: the commission rate was re-resolved at completion (`onDate` = today), so a rule written afterwards — or back-dated — re-priced
// every order not yet completed. Canon W149: "Rate is snapshotted onto the order — later rule changes never touch past orders". Now
// checkout calls `freezeAtPlacement` inside its own transaction, per seller order: the best rule ON THE IST PLACEMENT DATE (tenant then
// platform, the resolver's order), with the platform share it carries (a tenant row's is the plan floor, 0196), is written to
// `orders.commission_snapshot`; settlement reads it and never resolves again.
//
// F-10 (charged_to = buyer): when the frozen rule charges the BUYER and `commission_split` is on for the tenant, the commission on the
// goods value plus GST on it becomes a BUYER charge added at placement — through the charges plane: it is recorded in the charge
// snapshot (`buyer_commission`) and in `orders.buyer_commission_minor`, it is part of the order total, and settlement routes it to the
// tenant / platform / GST while the seller is settled on the full goods value. With `commission_split` off nothing is charged to anyone
// (the split itself is off), and the snapshot records that the buyer paid no commission (buyerCharge null) — settlement then takes no
// commission from either side for that order, which is what the buyer was billed.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { buyerCommissionCharge, CommissionSnapshot, snapshotFromRule } from '../domain/commission-rule.entity';
import { istToday } from '../domain/commission-proposal';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';

export interface FrozenAtPlacement {
  snapshot: CommissionSnapshot;
  /** commission + GST the buyer pays now (0 unless charged_to = buyer and the split is on) */
  buyerCommissionMinor: bigint;
  /** the charge-snapshot entry for the buyer commission (null when none) */
  chargeEntry: { code: 'buyer_commission'; calcMethod: 'commission_rule'; config: Record<string, unknown>; definitionId: string | null; effectiveFrom: string; tenantOverride: boolean; amountMinor: string } | null;
}

@Injectable()
export class CommissionSnapshotService {
  constructor(private readonly rules: CommissionRuleRepository, private readonly tax: TaxRuleRepository) {}

  async freezeAtPlacement(tx: TxContext, i: { tenantId: string; source: string; categoryId: string | null; goodsMinor: bigint; splitOn: boolean; now?: Date }): Promise<FrozenAtPlacement> {
    const onDate = istToday(i.now);
    const rule = await this.rules.resolveBest(tx, { tenantId: i.tenantId, categoryId: i.categoryId, sellerRoleId: null, source: i.source, onDate });
    if (!rule || rule.chargedTo !== 'buyer' || !i.splitOn) {
      return { snapshot: snapshotFromRule(rule, onDate, { buyerCharge: null }), buyerCommissionMinor: 0n, chargeEntry: null };
    }
    const gst = await this.tax.resolve(tx, { countryCode: 'IN', taxCode: 'gst', categoryId: i.categoryId, onDate });
    const charge = buyerCommissionCharge(i.goodsMinor, rule, gst);
    const total = charge.commissionMinor + charge.gstMinor;
    const snapshot = snapshotFromRule(rule, onDate, {
      buyerCharge: { commissionMinor: charge.commissionMinor.toString(), gstMinor: charge.gstMinor.toString(), gstRateBps: gst?.rateBps ?? null },
    });
    return {
      snapshot, buyerCommissionMinor: total,
      chargeEntry: total > 0n ? { code: 'buyer_commission', calcMethod: 'commission_rule',
        config: { ruleId: rule.id, rateBps: rule.rateBps, fixedMinor: rule.fixedMinor.toString(), capMinor: rule.capMinor?.toString() ?? null,
          gstRateBps: gst?.rateBps ?? null, commissionMinor: charge.commissionMinor.toString(), gstMinor: charge.gstMinor.toString() },
        definitionId: null, effectiveFrom: onDate, tenantOverride: rule.scope === 'tenant', amountMinor: total.toString() } : null,
    };
  }
}
