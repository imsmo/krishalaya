// modules/promotions/domain/promotion.rules.ts · PC-56 TENANT-10b · W2720–W2723 (New promotion) and W2539–W2542 (New
// coupon). PURE.
//
// ONE FUNCTION ANSWERS "CAN THIS BE WRITTEN, AND IF NOT, WHY" — for the review step (W2721 / W2540; with refusals it IS
// W2720 / W2539, the form-error screen) AND for the act itself, which re-gathers the facts inside its own transaction and
// re-asks. A review that reports `ready` therefore cannot be followed by a failure for a reason the review could have named.
// Every reason, never the first: W2720 says "every invalid field is listed with its reason".
//
// THE THREE RULINGS THIS FILE CARRIES
//   • B2 / F-8 — A NEW PROMOTION HAS A BUDGET. An uncapped promotion is refused BY NAME (BUDGET_REQUIRED): the budget is
//     what the tenant's wallet is asked to fund, and "uncapped" would let one promotion reserve the whole Main account.
//     A percent rule may carry a per-order ceiling (`maxDiscountMinor`); a flat rule may not (it IS its ceiling).
//   • B7 / F-24 — ONLY THE TYPES WITH AN ENGINE. `discount` and `festival`; `cashback`, `recharge_bonus`, `listing_boost`
//     are refused as PROMO_TYPE_NO_ENGINE — there is no cashback credit, no recharge bonus and no listing-boost link to
//     honour them, and creating one would be a label promising money nothing pays.
//   • A flat discount larger than the whole budget can never be reserved once — DISCOUNT_EXCEEDS_BUDGET says so before a
//     promotion that cannot ever apply is created.
import { ENGINE_PROMO_TYPES, NO_ENGINE_PROMO_TYPES, DISCOUNT_TYPES } from './promotions.events';
import { derivePromotionStatus, PromotionStatus } from './promotion.state';

export const PROMOTION_FIELDS = ['defaultName', 'promoType', 'discountType', 'percentOff', 'amountOffMinor', 'maxDiscountMinor', 'minOrderMinor', 'budgetMinor', 'startsAt', 'endsAt'] as const;
export const PROMOTION_REFUSALS = ['NAME_INVALID', 'PROMO_TYPE_UNKNOWN', 'PROMO_TYPE_NO_ENGINE', 'DISCOUNT_TYPE_UNKNOWN', 'PERCENT_INVALID', 'AMOUNT_INVALID',
  'MAX_DISCOUNT_INVALID', 'MAX_DISCOUNT_NOT_FOR_FLAT', 'MIN_ORDER_INVALID', 'BUDGET_REQUIRED', 'BUDGET_INVALID', 'DISCOUNT_EXCEEDS_BUDGET',
  'WINDOW_INVALID', 'WINDOW_ENDED'] as const;
export type PromotionRefusalCode = (typeof PROMOTION_REFUSALS)[number];

export const COUPON_FIELDS = ['promotionId', 'code', 'maxUses', 'perUserLimit'] as const;
export const COUPON_REFUSALS = ['PROMOTION_REQUIRED', 'PROMOTION_UNKNOWN', 'PROMOTION_ENDED', 'PROMOTION_NO_ENGINE', 'CODE_INVALID', 'CODE_TAKEN', 'MAX_USES_INVALID', 'PER_USER_INVALID'] as const;
export type CouponRefusalCode = (typeof COUPON_REFUSALS)[number];

export interface Refusal<C extends string = string> { field: string | null; code: C }
export interface ReviewField { name: string; entered: string | null; stored: string | null; normalised: boolean }
export interface Review<C extends string = string> { ready: boolean; fields: ReviewField[]; refusals: Refusal<C>[]; diff: null; entityType: string }

/** What the form sent — every entry an optional string (a review must answer a mistyped value, not 400 on it). */
export interface PromotionEntries {
  defaultName?: string; promoType?: string; discountType?: string; percentOff?: string; amountOffMinor?: string;
  maxDiscountMinor?: string; minOrderMinor?: string; budgetMinor?: string; startsAt?: string; endsAt?: string;
}
export interface CouponEntries { promotionId?: string; code?: string; maxUses?: string; perUserLimit?: string }

const MINOR_POS = /^[1-9]\d{0,15}$/;
const MINOR_0 = /^\d{1,16}$/;
const INT = /^\d{1,9}$/;
const CODE = /^[A-Za-z0-9_-]{3,40}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const blank = (v: string | undefined) => v === undefined || v.trim() === '';
const t = (v: string | undefined) => (v ?? '').trim();
const date = (v: string | undefined): Date | null => { if (blank(v)) return null; const d = new Date(t(v)); return Number.isNaN(d.getTime()) ? null : d; };

/** Every reason a promotion would be refused, against its field. */
export function promotionRefusals(e: PromotionEntries, now: Date = new Date()): Refusal<PromotionRefusalCode>[] {
  const out: Refusal<PromotionRefusalCode>[] = [];
  const name = t(e.defaultName);
  if (name.length < 3 || name.length > 150) out.push({ field: 'defaultName', code: 'NAME_INVALID' });

  const type = t(e.promoType);
  if ((NO_ENGINE_PROMO_TYPES as readonly string[]).includes(type)) out.push({ field: 'promoType', code: 'PROMO_TYPE_NO_ENGINE' });
  else if (!(ENGINE_PROMO_TYPES as readonly string[]).includes(type)) out.push({ field: 'promoType', code: 'PROMO_TYPE_UNKNOWN' });

  const dt = t(e.discountType);
  if (!(DISCOUNT_TYPES as readonly string[]).includes(dt)) out.push({ field: 'discountType', code: 'DISCOUNT_TYPE_UNKNOWN' });
  if (dt === 'percent') {
    const p = t(e.percentOff);
    if (!/^\d{1,3}$/.test(p) || Number(p) < 1 || Number(p) > 100) out.push({ field: 'percentOff', code: 'PERCENT_INVALID' });
    if (!blank(e.maxDiscountMinor) && !MINOR_POS.test(t(e.maxDiscountMinor))) out.push({ field: 'maxDiscountMinor', code: 'MAX_DISCOUNT_INVALID' });
  }
  if (dt === 'flat') {
    if (!MINOR_POS.test(t(e.amountOffMinor))) out.push({ field: 'amountOffMinor', code: 'AMOUNT_INVALID' });
    if (!blank(e.maxDiscountMinor)) out.push({ field: 'maxDiscountMinor', code: 'MAX_DISCOUNT_NOT_FOR_FLAT' });
  }
  if (!blank(e.minOrderMinor) && !MINOR_0.test(t(e.minOrderMinor))) out.push({ field: 'minOrderMinor', code: 'MIN_ORDER_INVALID' });

  if (blank(e.budgetMinor)) out.push({ field: 'budgetMinor', code: 'BUDGET_REQUIRED' });
  else if (!MINOR_POS.test(t(e.budgetMinor))) out.push({ field: 'budgetMinor', code: 'BUDGET_INVALID' });
  else if (dt === 'flat' && MINOR_POS.test(t(e.amountOffMinor)) && BigInt(t(e.amountOffMinor)) > BigInt(t(e.budgetMinor))) out.push({ field: 'amountOffMinor', code: 'DISCOUNT_EXCEEDS_BUDGET' });

  const s = date(e.startsAt); const en = date(e.endsAt);
  if (!s || !en || en.getTime() <= s.getTime()) out.push({ field: 'endsAt', code: 'WINDOW_INVALID' });
  else if (en.getTime() <= now.getTime()) out.push({ field: 'endsAt', code: 'WINDOW_ENDED' });
  return out;
}

/** W2721 — everything entered, what will be stored, every refusal. `computedStatus` is the status it would have NOW. */
export function promotionReview(e: PromotionEntries, now: Date = new Date()): Review<PromotionRefusalCode> & { computedStatus: PromotionStatus | null } {
  const refusals = promotionRefusals(e, now);
  const dt = t(e.discountType);
  const s = date(e.startsAt); const en = date(e.endsAt);
  const stored = (name: (typeof PROMOTION_FIELDS)[number]): string | null => {
    const v = t((e as Record<string, string | undefined>)[name]);
    if (name === 'percentOff') return dt === 'percent' && v ? v : null;
    if (name === 'amountOffMinor') return dt === 'flat' && v ? v : null;
    if (name === 'maxDiscountMinor') return dt === 'percent' && v ? v : null;
    if (name === 'startsAt') return s ? s.toISOString() : null;
    if (name === 'endsAt') return en ? en.toISOString() : null;
    if (name === 'defaultName') return v ? v : null;
    return v ? v : null;
  };
  const fields: ReviewField[] = PROMOTION_FIELDS.map((name) => {
    const entered = blank((e as Record<string, string | undefined>)[name]) ? null : t((e as Record<string, string | undefined>)[name]);
    const st = stored(name);
    return { name, entered, stored: st, normalised: entered !== st };
  });
  const computedStatus = refusals.length === 0 && s && en
    ? derivePromotionStatus({ isActive: true, startsAt: s, endsAt: en, budgetMinor: BigInt(t(e.budgetMinor)), spentMinor: 0n }, now)
    : null;
  return { ready: refusals.length === 0, fields, refusals, diff: null, entityType: 'promotion', computedStatus };
}

/** The facts a coupon review needs (gathered by the service — from the replica for a review, in-tx for the act). */
export interface CouponFacts { promotion: { status: PromotionStatus; promoType: string } | null; codeTaken: boolean }

export function couponRefusals(e: CouponEntries, f: CouponFacts): Refusal<CouponRefusalCode>[] {
  const out: Refusal<CouponRefusalCode>[] = [];
  if (blank(e.promotionId)) out.push({ field: 'promotionId', code: 'PROMOTION_REQUIRED' });
  else if (!UUID.test(t(e.promotionId)) || !f.promotion) out.push({ field: 'promotionId', code: 'PROMOTION_UNKNOWN' });
  else if (f.promotion.status === 'expired' || f.promotion.status === 'exhausted') out.push({ field: 'promotionId', code: 'PROMOTION_ENDED' });
  else if (!(ENGINE_PROMO_TYPES as readonly string[]).includes(f.promotion.promoType)) out.push({ field: 'promotionId', code: 'PROMOTION_NO_ENGINE' });
  if (!CODE.test(t(e.code))) out.push({ field: 'code', code: 'CODE_INVALID' });
  else if (f.codeTaken) out.push({ field: 'code', code: 'CODE_TAKEN' });
  if (!blank(e.maxUses) && (!INT.test(t(e.maxUses)) || Number(t(e.maxUses)) < 1 || Number(t(e.maxUses)) > 100_000_000)) out.push({ field: 'maxUses', code: 'MAX_USES_INVALID' });
  if (!blank(e.perUserLimit) && (!INT.test(t(e.perUserLimit)) || Number(t(e.perUserLimit)) < 1 || Number(t(e.perUserLimit)) > 1000)) out.push({ field: 'perUserLimit', code: 'PER_USER_INVALID' });
  return out;
}

export function couponReview(e: CouponEntries, f: CouponFacts): Review<CouponRefusalCode> {
  const refusals = couponRefusals(e, f);
  const fields: ReviewField[] = COUPON_FIELDS.map((name) => {
    const raw = (e as Record<string, string | undefined>)[name];
    const entered = blank(raw) ? null : t(raw);
    let stored: string | null = entered;
    if (name === 'code' && entered) stored = entered.toUpperCase();
    if (name === 'perUserLimit' && entered === null) stored = '1';          // the column's default — shown, not hidden
    return { name, entered, stored, normalised: entered !== stored };
  });
  return { ready: refusals.length === 0, fields, refusals, diff: null, entityType: 'coupon' };
}

/** Mutate reasons — mirrors the console's MIN_REASON / MAX_REASON. */
export const MIN_REASON = 3;
export const MAX_REASON = 300;
export function reasonOk(r: string | null | undefined): r is string {
  const s = (r ?? '').trim();
  return s.length >= MIN_REASON && s.length <= MAX_REASON;
}
