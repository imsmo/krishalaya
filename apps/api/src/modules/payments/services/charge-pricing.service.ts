// modules/payments/services/charge-pricing.service.ts
// The buyer-charge ENGINE: resolves a charge definition (tenant override → platform default) and
// computes the fee (pure math in charge.calculator). Read-only — it quotes amounts; it never moves
// money. Used by the orders checkout to add delivery + platform fees to the buyer's bill. An
// unknown/unconfigured charge resolves to 0 (no surprise fees).
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { computeCharge } from '../domain/charge.calculator';
import { ChargeDefinitionRepository } from '../repositories/charge-definition.repository';

export interface CheckoutCharges { deliveryFeeMinor: bigint; platformFeeMinor: bigint; }

/** PC-56 TENANT-3a: what the order freezes as its price basis. The RESOLVED definition (code, method, config,
 *  effective date) rather than the computed amount alone — an amount cannot be re-checked, a rule can. */
export interface ChargeSnapshot {
  resolvedAt: string;
  /** Set by checkout when a membership benefit overrode a resolved amount — without it the frozen rules would
   *  disagree with what the buyer actually paid, and a snapshot that disagrees with the money is worse than none. */
  memberBenefit?: { freeDelivery: boolean; platformFeeBpsOverride: number | null; appliedDeliveryFeeMinor: string; appliedPlatformFeeMinor: string };
  charges: Array<{ code: string; calcMethod: string; config: unknown; definitionId: string | null; effectiveFrom: string | null; tenantOverride: boolean; amountMinor: string }>;
}

@Injectable()
export class ChargePricingService {
  constructor(private readonly defs: ChargeDefinitionRepository) {}

  /** Quote a single charge by code. Returns 0n when no active definition applies. */
  async quote(tx: TxContext, tenantId: string, chargeCode: string, base: { amountMinor: bigint; qty?: number }, onDate?: string): Promise<bigint> {
    const def = await this.defs.resolve(tx, tenantId, chargeCode, onDate);
    if (!def) return 0n;
    return computeCharge(def.calcMethod, def.config, base);
  }

  /** Quote a SPECIFIC charge definition by id (e.g. a delivery zone's charge_definition_id). Returns 0n when
   *  the definition is missing/expired/inactive (a zone with no fee is free, not an error). */
  async quoteByDefinitionId(tx: TxContext, tenantId: string, definitionId: string, base: { amountMinor: bigint; qty?: number }, onDate?: string): Promise<bigint> {
    const def = await this.defs.resolveById(tx, tenantId, definitionId, onDate);
    if (!def) return 0n;
    return computeCharge(def.calcMethod, def.config, base);
  }

  /** The two buyer-side charges applied at checkout, computed on the order subtotal. */
  async checkoutCharges(tx: TxContext, tenantId: string, subtotalMinor: bigint): Promise<CheckoutCharges> {
    const [deliveryFeeMinor, platformFeeMinor] = await Promise.all([
      this.quote(tx, tenantId, 'delivery_fee', { amountMinor: subtotalMinor }),
      this.quote(tx, tenantId, 'buyer_platform_fee', { amountMinor: subtotalMinor }),
    ]);
    return { deliveryFeeMinor, platformFeeMinor };
  }

  /** THE SAME TWO CHARGES, PLUS THE RULES THEY CAME FROM (PC-56 TENANT-3a). The order row freezes this so
   *  "snapshotted at order time, never recalculated" stops being a comment over an empty column: a definition
   *  edited or expired next month can no longer change what an FPO's accountant reads about last month's order.
   *  A charge with no active definition contributes 0 and is recorded as ABSENT rather than omitted — "no fee
   *  applied" and "no rule existed" are different facts about the same ₹0. */
  async checkoutChargesWithSnapshot(tx: TxContext, tenantId: string, subtotalMinor: bigint, now: Date): Promise<CheckoutCharges & { snapshot: ChargeSnapshot }> {
    const codes = ['delivery_fee', 'buyer_platform_fee'] as const;
    const resolved = await Promise.all(codes.map(async (code) => {
      const def = await this.defs.resolve(tx, tenantId, code);
      const amountMinor = def ? computeCharge(def.calcMethod, def.config, { amountMinor: subtotalMinor }) : 0n;
      return {
        code,
        // 'none' is a REAL value here: no active definition existed, which is a different fact from a rule that
        // computed zero — the order freezes which of the two it was.
        calcMethod: def ? def.calcMethod : 'none',
        config: def ? def.config : null,
        definitionId: def?.id ?? null,
        effectiveFrom: def?.effectiveFrom ?? null,
        tenantOverride: def?.isTenantOverride === true,
        amountMinor: amountMinor.toString(),
      };
    }));
    const by = (code: string) => BigInt(resolved.find((r) => r.code === code)!.amountMinor);
    return {
      deliveryFeeMinor: by('delivery_fee'),
      platformFeeMinor: by('buyer_platform_fee'),
      snapshot: { resolvedAt: now.toISOString(), charges: resolved },
    };
  }
}
