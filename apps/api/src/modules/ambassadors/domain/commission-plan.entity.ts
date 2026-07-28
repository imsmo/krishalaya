// modules/ambassadors/domain/commission-plan.entity.ts · an ambassador earning rule (commission_plans_ambassador).
// A plan pays EITHER a flat amount_minor OR rate_bps of a base amount, capped at cap_minor — float-free bigint.
// Platform plans (tenant_id NULL) are the defaults; a tenant may override per event_code. Read-only here.
// DEV-26/Q15: `rate_bps` split now goes through the platform's ONE canonical `applyBpsFloor` (core/money/
// rounding.ts) instead of a re-typed `(base * BigInt(bps)) / 10000n` — identical math (verified: same floor-
// division expression), just no longer a duplicate implementation of the same rounding rule.
import { applyBpsFloor } from '../../../core/money/rounding';

export interface CommissionPlanProps {
  id: string; tenantId: string | null; eventCode: string; amountMinor: bigint | null; rateBps: number | null; capMinor: bigint | null;
  conditions: Record<string, unknown>; isActive: boolean;
}
export class CommissionPlan {
  private constructor(private readonly props: CommissionPlanProps) {}
  static rehydrate(p: CommissionPlanProps): CommissionPlan { return new CommissionPlan(p); }
  get id() { return this.props.id; }
  get eventCode() { return this.props.eventCode; }
  get conditions() { return this.props.conditions; }

  /** Commission for this event. Flat amount, or rate_bps of `baseMinor` (floored), capped at cap_minor. */
  compute(baseMinor: bigint): bigint {
    let amount = this.props.amountMinor ?? (this.props.rateBps != null ? applyBpsFloor(baseMinor, this.props.rateBps) : 0n);
    if (amount < 0n) amount = 0n;
    if (this.props.capMinor != null && amount > this.props.capMinor) amount = this.props.capMinor;
    return amount;
  }
  toJSON() { const v = this.props; return { id: v.id, eventCode: v.eventCode, amountMinor: v.amountMinor?.toString() ?? null, rateBps: v.rateBps, capMinor: v.capMinor?.toString() ?? null, conditions: v.conditions, isActive: v.isActive }; }
}
