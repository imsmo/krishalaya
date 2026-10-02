// modules/ambassadors/domain/commission-plan.entity.ts · an ambassador earning rule (commission_plans_ambassador).
// A plan pays EITHER a flat amount_minor OR rate_bps of a base amount, capped at cap_minor — float-free bigint.
// Platform plans (tenant_id NULL) are the defaults; a tenant may override per event_code. Read-only here.
// DEV-26/Q15: `rate_bps` split now goes through the platform's ONE canonical `applyBpsFloor` (core/money/
// rounding.ts) instead of a re-typed `(base * BigInt(bps)) / 10000n` — identical math (verified: same floor-
// division expression), just no longer a duplicate implementation of the same rounding rule.
import { applyBpsFloor } from '../../../core/money/rounding';

/**
 * PC-56 TENANT-10a · F-5 — THE CONDITIONS ARE READ. Seed 0207 stores `{"max_sales_per_farmer":5}`, `{"within_days":30}`,
 * `{"max_per_farmer":5}`; until this wave nothing evaluated them, so a referred seller's every completed order accrued the
 * sale commission forever. The vocabulary is CLOSED: a key this evaluator does not know refuses the accrual
 * (`unknown_condition`) rather than paying as if the rule were absent — a rate-config typo must never become money.
 */
export const PLAN_CONDITION_KEYS = ['max_sales_per_farmer', 'max_per_farmer', 'within_days', 'after_first_sales'] as const;
export type PlanConditionKey = (typeof PLAN_CONDITION_KEYS)[number];
export type ConditionRefusal = 'unknown_condition' | 'malformed_condition' | 'no_farmer' | 'cap_reached' | 'no_referral_window' | 'window_closed' | 'trail_not_reached';

export interface ConditionContext {
  now: Date;
  /** When the referral that attributes this farmer to the ambassador was created (the `within_days` anchor). */
  referralCreatedAt: Date | null;
  /** The farmer this earning is about (the per-farmer caps). */
  subjectUserId: string | null;
  /** Earnings of THIS event already accrued to THIS ambassador on THIS farmer (read in the accrual's own tx, under lock). */
  priorCountForSubject: number;
  /** `first_sale_facilitated` earnings already accrued to this ambassador on this farmer (the `after_first_sales` trail). */
  priorSalesForSubject: number;
}
/** The event whose count `after_first_sales` reads (seed 0207's `sale_trail`: "₹10/sale loyalty trail" after the first 5). */
export const TRAIL_BASE_EVENT = 'first_sale_facilitated';

const DAY_MS = 86_400_000;
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000 ? v : null);

/** PURE. `null` = the plan's conditions allow this accrual; otherwise the first refusal, by name. */
export function evaluatePlanConditions(conditions: Record<string, unknown>, ctx: ConditionContext): ConditionRefusal | null {
  for (const key of Object.keys(conditions ?? {})) {
    if (!(PLAN_CONDITION_KEYS as readonly string[]).includes(key)) return 'unknown_condition';
  }
  const cap = conditions.max_sales_per_farmer ?? conditions.max_per_farmer;
  if (conditions.max_sales_per_farmer !== undefined && posInt(conditions.max_sales_per_farmer) === null) return 'malformed_condition';
  if (conditions.max_per_farmer !== undefined && posInt(conditions.max_per_farmer) === null) return 'malformed_condition';
  if (conditions.within_days !== undefined && posInt(conditions.within_days) === null) return 'malformed_condition';
  if (conditions.after_first_sales !== undefined && posInt(conditions.after_first_sales) === null) return 'malformed_condition';
  if (cap !== undefined) {
    if (!ctx.subjectUserId) return 'no_farmer';
    // both keys present → the tighter one binds
    const limit = Math.min(...[conditions.max_sales_per_farmer, conditions.max_per_farmer].map(posInt).filter((x): x is number => x !== null));
    if (ctx.priorCountForSubject >= limit) return 'cap_reached';
  }
  if (conditions.after_first_sales !== undefined) {
    if (!ctx.subjectUserId) return 'no_farmer';
    if (ctx.priorSalesForSubject < posInt(conditions.after_first_sales)!) return 'trail_not_reached';
  }
  if (conditions.within_days !== undefined) {
    if (!ctx.referralCreatedAt) return 'no_referral_window';
    const days = posInt(conditions.within_days)!;
    if (ctx.referralCreatedAt.getTime() + days * DAY_MS < ctx.now.getTime()) return 'window_closed';
  }
  return null;
}

/** Does this plan need the per-farmer prior count (so the service takes the lock and counts only when it must)? */
export function needsSubjectCount(conditions: Record<string, unknown>): boolean {
  return conditions?.max_sales_per_farmer !== undefined || conditions?.max_per_farmer !== undefined || conditions?.after_first_sales !== undefined;
}

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
