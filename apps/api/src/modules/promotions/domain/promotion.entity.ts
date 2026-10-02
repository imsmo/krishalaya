// modules/promotions/domain/promotion.entity.ts
// Promotion aggregate — a budgeted campaign whose `rules` jsonb defines a coupon discount. Pure domain:
// money (budget/spent/discount) in bigint minor units. No version column (add_std_columns) → the service
// serializes budget mutations with SELECT … FOR UPDATE. Validity (window/active/budget) lives in
// promotion.state (Law 5). `rules` is parsed/validated on the way IN, never trusted as freeform.
//
// PC-56 TENANT-10b · F-2 / A6 — `spent_minor` IS NOW THE SUM OF RESERVATIONS TAKEN. A redemption reserves its discount
// from the tenant's wallet (tenant Main → Hold, a real ledger txn, coupon-money.service); `reserve()` admits that amount
// against the budget under the promotion row lock and `releaseSpend()` gives it back when the order is cancelled before
// settlement. The entity moves no money itself — it is the budget's arithmetic; the wallet port is the money.
// The human-pause bit (F-10): `pausedAt` set = a PERSON paused it, and the festival scheduler never re-opens it.
import { derivePromotionStatus, isRedeemable, PromotionStatus } from './promotion.state';
import { PromotionEventType, DomainEvent, DiscountType } from './promotions.events';
import { InvalidPromotionError, PromotionBudgetExceededError } from './promotions.errors';

export interface PromoRules {
  discountType: DiscountType;
  percentOff: number | null;        // 1..100 when discountType='percent'
  amountOffMinor: bigint | null;    // when discountType='flat'
  minOrderMinor: bigint | null;     // eligibility floor
  maxDiscountMinor: bigint | null;  // cap (percent)
}
export interface PromotionProps {
  id: string; tenantId: string; promoType: string; defaultName: string; rules: PromoRules;
  budgetMinor: bigint | null; spentMinor: bigint; startsAt: Date; endsAt: Date; isActive: boolean; createdAt: Date;
  /** PC-56 TENANT-10b: who paused it (NULL with pausedAt set = paused before 0185 recorded who) and when. */
  pausedByUserId?: string | null; pausedAt?: Date | null;
  /** `created_at::text` — every microsecond Postgres stored (the keyset cursor, F-17). */
  createdAtRaw?: string | null;
}

/** Parse + VALIDATE the freeform rules jsonb into a typed, bounded PromoRules (no ReDoS, no junk). */
export function parsePromoRules(raw: any): PromoRules {
  const type = raw?.discountType;
  if (type !== 'percent' && type !== 'flat') throw new InvalidPromotionError('rules.discountType must be percent|flat');
  const big = (v: any, name: string): bigint | null => {
    if (v == null) return null;
    if (typeof v !== 'string' || !/^\d{1,16}$/.test(v)) throw new InvalidPromotionError(`rules.${name} must be a non-negative integer string of minor units`);
    return BigInt(v);
  };
  let percentOff: number | null = null; let amountOffMinor: bigint | null = null;
  if (type === 'percent') {
    const po = raw.percentOff;
    if (!Number.isInteger(po) || po < 1 || po > 100) throw new InvalidPromotionError('rules.percentOff must be an integer 1..100');
    percentOff = po as number;
  } else {
    amountOffMinor = big(raw.amountOffMinor, 'amountOffMinor');
    if (amountOffMinor == null || amountOffMinor <= 0n) throw new InvalidPromotionError('rules.amountOffMinor must be a positive minor amount');
  }
  return { discountType: type, percentOff, amountOffMinor, minOrderMinor: big(raw.minOrderMinor, 'minOrderMinor'), maxDiscountMinor: big(raw.maxDiscountMinor, 'maxDiscountMinor') };
}

export class Promotion {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: PromotionProps) {}

  static create(input: { id: string; tenantId: string; promoType: string; defaultName: string; rules: PromoRules; budgetMinor?: bigint | null; startsAt: Date; endsAt: Date; now?: Date }): Promotion {
    if (!input.defaultName?.trim()) throw new InvalidPromotionError('name is required');
    if (input.endsAt.getTime() <= input.startsAt.getTime()) throw new InvalidPromotionError('endsAt must be after startsAt');
    if (input.budgetMinor != null && input.budgetMinor < 0n) throw new InvalidPromotionError('budget cannot be negative');
    const p = new Promotion({ id: input.id, tenantId: input.tenantId, promoType: input.promoType, defaultName: input.defaultName.trim(),
      rules: input.rules, budgetMinor: input.budgetMinor ?? null, spentMinor: 0n, startsAt: input.startsAt, endsAt: input.endsAt, isActive: true, createdAt: input.now ?? new Date(),
      pausedByUserId: null, pausedAt: null, createdAtRaw: null });
    p.events.push({ type: PromotionEventType.PromotionCreated, payload: { promotionId: p.props.id, promoType: p.props.promoType } });
    return p;
  }
  static rehydrate(props: PromotionProps): Promotion { return new Promotion(props); }

  get id() { return this.props.id; }
  get isActive() { return this.props.isActive; }
  get spentMinor() { return this.props.spentMinor; }
  get budgetMinor() { return this.props.budgetMinor; }
  get promoType() { return this.props.promoType; }
  /** A PERSON paused this promotion (F-10). The scheduler reads this and never re-opens it. */
  get isHumanPaused() { return this.props.pausedAt != null; }
  status(now: Date = new Date()): PromotionStatus { return derivePromotionStatus(this.props, now); }
  isRedeemableNow(now: Date = new Date()): boolean { return isRedeemable(this.props, now); }
  toProps(): Readonly<PromotionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** SYSTEM toggle (budget sweep, festival scheduler) — never touches the human-pause bit. */
  setActive(active: boolean): void {
    this.props.isActive = active;
    this.events.push({ type: PromotionEventType.PromotionUpdated, payload: { promotionId: this.props.id, isActive: active } });
  }

  /** A PERSON pauses (F-10): inactive AND the human-pause bit, so no sweep re-opens it. */
  pauseBy(userId: string, now: Date = new Date()): void {
    this.props.isActive = false;
    this.props.pausedByUserId = userId;
    this.props.pausedAt = now;
    this.events.push({ type: PromotionEventType.PromotionUpdated, payload: { promotionId: this.props.id, isActive: false, pausedBy: userId } });
  }
  /** A PERSON resumes: active, and the human-pause bit cleared. */
  resume(): void {
    this.props.isActive = true;
    this.props.pausedByUserId = null;
    this.props.pausedAt = null;
    this.events.push({ type: PromotionEventType.PromotionUpdated, payload: { promotionId: this.props.id, isActive: true } });
  }

  /** A6 — would reserving `amountMinor` keep the reservations within the budget? (A NULL budget is a legacy uncapped row.) */
  canReserve(amountMinor: bigint): boolean {
    return this.props.budgetMinor == null || this.props.spentMinor + amountMinor <= this.props.budgetMinor;
  }
  /** A6 — take a reservation into the spend (the caller has ALREADY posted the wallet hold). Never over budget. */
  reserve(amountMinor: bigint): void {
    if (amountMinor <= 0n) return;
    if (!this.canReserve(amountMinor)) throw new PromotionBudgetExceededError();
    this.props.spentMinor += amountMinor;
    if (this.props.budgetMinor != null && this.props.spentMinor >= this.props.budgetMinor) this.events.push({ type: PromotionEventType.BudgetExhausted, payload: { promotionId: this.props.id } });
  }
  /** A3 — a reservation returned to the tenant (order cancelled/refunded before settlement) leaves the spend. */
  releaseSpend(amountMinor: bigint): void {
    if (amountMinor <= 0n) return;
    this.props.spentMinor = this.props.spentMinor > amountMinor ? this.props.spentMinor - amountMinor : 0n;
  }

  /** The discount this promotion grants on `subtotalMinor` (0 if below the minimum or it computes to 0). */
  computeDiscount(subtotalMinor: bigint): bigint {
    if (subtotalMinor <= 0n) return 0n;
    if (this.props.rules.minOrderMinor != null && subtotalMinor < this.props.rules.minOrderMinor) return 0n;
    let disc: bigint;
    if (this.props.rules.discountType === 'percent') {
      disc = (subtotalMinor * BigInt(this.props.rules.percentOff!)) / 100n;
      if (this.props.rules.maxDiscountMinor != null && disc > this.props.rules.maxDiscountMinor) disc = this.props.rules.maxDiscountMinor;
    } else {
      disc = this.props.rules.amountOffMinor!;
    }
    if (disc > subtotalMinor) disc = subtotalMinor;       // never below zero total
    return disc < 0n ? 0n : disc;
  }

  /** Record promotional spend against the budget. By default fails CLOSED if it would exceed the budget
   *  (the synchronous redeem path). `enforceBudget:false` is for the ASYNC backstop recorder: the discount
   *  is already committed on the order, so accounting must reflect reality and MUST NOT throw inside the
   *  relay tx — it still emits BudgetExhausted when it crosses so the budget-watch can deactivate. */
  recordSpend(amountMinor: bigint, opts: { enforceBudget?: boolean } = {}): void {
    if (amountMinor <= 0n) return;
    const enforce = opts.enforceBudget !== false;
    if (enforce && this.props.budgetMinor != null && this.props.spentMinor + amountMinor > this.props.budgetMinor) throw new PromotionBudgetExceededError();
    this.props.spentMinor += amountMinor;
    if (this.props.budgetMinor != null && this.props.spentMinor >= this.props.budgetMinor) this.events.push({ type: PromotionEventType.BudgetExhausted, payload: { promotionId: this.props.id } });
  }

  /** Whether the promotion has burned through its budget (drives the budget-watch deactivation). */
  isBudgetExhausted(): boolean { return this.props.budgetMinor != null && this.props.spentMinor >= this.props.budgetMinor; }

  /** True iff the promotion's active window covers `now` (the festival-scheduler activation predicate). */
  isWithinWindow(now: Date = new Date()): boolean { return now.getTime() >= this.props.startsAt.getTime() && now.getTime() <= this.props.endsAt.getTime(); }
}
