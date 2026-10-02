// modules/promotions/domain/coupon.entity.ts
// Coupon aggregate — a redeemable CODE attached to a promotion, with a global cap (max_uses) and a
// per-user cap (per_user_limit). Pure domain. No version column → the service locks the row FOR UPDATE
// while redeeming so concurrent redemptions can't oversell the cap.
import { InvalidPromotionError, CouponExhaustedError } from './promotions.errors';

export interface CouponProps {
  id: string; tenantId: string; promotionId: string; code: string;
  maxUses: number | null; uses: number; perUserLimit: number; deletedAt: Date | null; createdAt: Date;
  /** `created_at::text` — the microsecond keyset cursor (PC-56 TENANT-10b, F-17). */
  createdAtRaw?: string | null;
}
const CODE_RE = /^[A-Z0-9_-]{3,40}$/;

export class Coupon {
  private constructor(private props: CouponProps) {}

  static create(input: { id: string; tenantId: string; promotionId: string; code: string; maxUses?: number | null; perUserLimit?: number; now?: Date }): Coupon {
    const code = (input.code ?? '').trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new InvalidPromotionError('code must be 3..40 chars of A-Z 0-9 _ -');
    if (input.maxUses != null && (!Number.isInteger(input.maxUses) || input.maxUses <= 0)) throw new InvalidPromotionError('maxUses must be a positive integer');
    const perUser = input.perUserLimit ?? 1;
    if (!Number.isInteger(perUser) || perUser < 1 || perUser > 1000) throw new InvalidPromotionError('perUserLimit must be 1..1000');
    return new Coupon({ id: input.id, tenantId: input.tenantId, promotionId: input.promotionId, code, maxUses: input.maxUses ?? null, uses: 0, perUserLimit: perUser, deletedAt: null, createdAt: input.now ?? new Date() });
  }
  static rehydrate(props: CouponProps): Coupon { return new Coupon(props); }

  get id() { return this.props.id; }
  get code() { return this.props.code; }
  get promotionId() { return this.props.promotionId; }
  get perUserLimit() { return this.props.perUserLimit; }
  get isDeleted() { return this.props.deletedAt != null; }
  toProps(): Readonly<CouponProps> { return Object.freeze({ ...this.props }); }

  /** Consume one global use (fail CLOSED at the cap). */
  consumeUse(): void {
    if (this.props.maxUses != null && this.props.uses >= this.props.maxUses) throw new CouponExhaustedError();
    this.props.uses += 1;
  }
  /** The BACKSTOP's use: the discount is already on the order, so the cap is recorded as exceeded rather than refused. */
  consumeUseUnchecked(): void { this.props.uses += 1; }
  /** PC-56 TENANT-10b · A3 — a use given back when its order is cancelled/refunded before settlement. */
  releaseUse(): void { if (this.props.uses > 0) this.props.uses -= 1; }
  get maxUses() { return this.props.maxUses; }
  get uses() { return this.props.uses; }
  hasGlobalCapacity(): boolean { return this.props.maxUses == null || this.props.uses < this.props.maxUses; }
}
