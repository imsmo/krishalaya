// modules/promotions/domain/promotion.state.ts · the promotion's DERIVED status (Law 5: the one place
// validity is decided). `promotions` has no status column — validity is computed from is_active + the
// [starts_at, ends_at] window + the budget. A coupon is only redeemable while its promotion is 'active'.
//
// PC-56 TENANT-10b · F-10 — THE ORDER IS THE TRUTH-TELLING ORDER. It used to return `paused` FIRST, so a promotion the
// budget sweep switched off (or one whose window closed while inactive) read "paused" — W129's "ended (budget cap)" could
// not be printed, and a person could not tell a human pause from a spent budget. Now:
//   exhausted (spent ≥ budget) → expired (ends_at < now) → paused (inactive) → scheduled (starts_at > now) → active.
// A spent budget is the strongest fact (no money is left to reserve, whatever anyone toggles); an ended window next
// (resuming it would change nothing); only then the switch a person or the sweep flips.
export const PROMOTION_STATUSES = ['scheduled', 'active', 'paused', 'exhausted', 'expired'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export interface PromotionValidity { isActive: boolean; startsAt: Date; endsAt: Date; budgetMinor: bigint | null; spentMinor: bigint; }

export function derivePromotionStatus(p: PromotionValidity, now: Date): PromotionStatus {
  if (p.budgetMinor != null && p.spentMinor >= p.budgetMinor) return 'exhausted';
  if (now.getTime() > p.endsAt.getTime()) return 'expired';
  if (!p.isActive) return 'paused';
  if (now.getTime() < p.startsAt.getTime()) return 'scheduled';
  return 'active';
}
export function isRedeemable(p: PromotionValidity, now: Date): boolean { return derivePromotionStatus(p, now) === 'active'; }
