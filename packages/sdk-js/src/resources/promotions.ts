// @krishalaya/sdk-js · promotions + coupons resource (PC-28b; PC-56 TENANT-10b). Operator surface, server-gated by
// promotion.manage; discounts are applied server-side at checkout (checkout.preview shows the truth) — this resource
// DEFINES them and reads what happened. Money is bigint minor-unit STRINGS (Law 2).
//
// PC-56 TENANT-10b · F-7 — EVERY CALL HERE USED TO 400 AGAINST THE REAL API: `create` / `createCoupon` sent no
// Idempotency-Key (both routes require one), `setActive` sent `{ active }` against a strict `{ isActive }`, and `coupons()`
// sent no `promotionId` (required). Fixed, and the reads W129 / W130 need are added: `get`, `summary`, `review`,
// `reviewCoupon`, the tenant-wide `allCoupons` (GET /coupons/all), `couponRedemptions(couponId)` and `deleteCoupon`.
// Founder decision F-2: a coupon discount is RESERVED from the tenant's wallet at redemption and paid to the seller at
// settlement — `spentMinor` is the sum of those reservations.
import { HttpClient } from '../http';
import { Page } from '../types';
import type { DairyReviewField, DairyReviewRefusal } from '../types';

export type PromotionStatus = 'scheduled' | 'active' | 'paused' | 'exhausted' | 'expired';
export interface PromotionRules { discountType: string; percentOff?: number | null; amountOffMinor?: string | null; minOrderMinor?: string | null; maxDiscountMinor?: string | null }
export interface Promotion {
  id: string; promoType: string; defaultName: string; rules: PromotionRules;
  /** Derived server-side: exhausted → expired → paused → scheduled → active (F-10). */
  status: PromotionStatus;
  /** false for `cashback` / `recharge_bonus` / `listing_boost` rows — "no engine — label only" (F-24). */
  hasEngine: boolean;
  budgetMinor: string | null; spentMinor: string; maxDiscountMinor: string | null;
  startsAt: string; endsAt: string; isActive: boolean;
  /** A PERSON paused it (the festival scheduler never re-opens it). */
  pausedByHuman: boolean; pausedAt: string | null; createdAt: string;
}
export interface CreatePromotionInput {
  promoType: 'discount' | 'festival'; defaultName: string;
  rules: { discountType: 'percent' | 'flat'; percentOff?: number; amountOffMinor?: string; minOrderMinor?: string; maxDiscountMinor?: string };
  /** REQUIRED — an uncapped promotion is refused by name (BUDGET_REQUIRED). */
  budgetMinor: string; startsAt: string; endsAt: string;
}
/** The New promotion form's raw entries (every value optional — a mistyped one is answered with its refusal). */
export interface PromotionReviewInput {
  defaultName?: string; promoType?: string; discountType?: string; percentOff?: string; amountOffMinor?: string; maxDiscountMinor?: string;
  minOrderMinor?: string; budgetMinor?: string; startsAt?: string; endsAt?: string;
}
export interface PromotionReview { ready: boolean; fields: DairyReviewField[]; refusals: DairyReviewRefusal[]; diff: null; entityType: string; computedStatus: PromotionStatus | null }
export interface CouponReviewInput { promotionId?: string; code?: string; maxUses?: string; perUserLimit?: string }
export interface CouponReview { ready: boolean; fields: DairyReviewField[]; refusals: DairyReviewRefusal[]; diff: null; entityType: string }

/** W129's KPI tiles — every figure a SUM over rows that exist (see the API's offers.read-model for the definitions). */
export interface OffersSummary {
  year: number; activeCount: number; scheduledCount: number; budgetCommittedMinor: string;
  /** Reservations taken this year (Asia/Kolkata) and not released, all promotions incl. ended. */
  spentYearMinor: string; endedSpentYearMinor: string;
  /** Discounts recorded before wallet funding (seller-funded, F-2) — a separate figure, never mixed in. */
  legacyDiscountYearMinor: string;
  /** "GMV of coupon orders (30d)" — not "attributed": nothing measures that the coupon caused the order. */
  couponGmv30dMinor: string; couponDiscount30dMinor: string; gmvToSpendTenths: string | null; couponOrders30d: number;
}

export interface Coupon { id: string; promotionId: string; code: string; maxUses: number | null; perUserLimit: number; uses?: number; createdAt?: string; }
export type CouponStatus = PromotionStatus | 'used_up' | 'no_promotion';
/** W130's row — the tenant-wide list (B1). `maxUses: null` = unlimited. */
export interface CouponListRow {
  id: string; code: string; promotionId: string | null; promotionName: string | null; promoType: string | null; promotionHasEngine: boolean;
  uses: number; maxUses: number | null; perUserLimit: number;
  /** SUM of applied, reserved discounts (not released). */
  redeemedValueMinor: string; legacyValueMinor: string;
  status: CouponStatus; startsAt: string | null; endsAt: string | null; createdAt: string;
}
export type CouponOutcome = 'applied' | 'user_limit' | 'budget_exhausted' | 'window' | 'tenant_funds_unavailable' | 'invalid' | 'max_uses_reached' | 'not_applicable';
/** One line of W130's "Recent redemptions": an applied redemption (with what happened to its money) or a declined attempt. */
export interface CouponRedemptionRow {
  id: string; at: string; outcome: CouponOutcome | string; stage: 'preview' | 'redeem' | 'backstop' | null; amountMinor: string | null;
  orderId: string | null; orderNo: string | null; buyerPhoneMasked: string | null; buyerPlace: string | null;
  moneyState: 'reserved' | 'settled' | 'released' | 'unfunded' | null;
}
/** The buyer-facing notice for a declined coupon: render `messageKey` (kind copy), never `code`. */
export interface CouponNotice { code: string; outcome: Exclude<CouponOutcome, 'applied'>; messageKey: string }
export interface CouponRedemption { id: string; couponId: string; couponCode?: string | null; orderId?: string | null; userId?: string | null; amountMinor?: string | null; createdAt?: string; }

const page = <T>(r: { data: T[]; meta?: Record<string, unknown> }): Page<T> & { total: number | null } =>
  ({ items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, total: (r.meta?.total as number | undefined) ?? null });

export class PromotionsResource {
  constructor(private readonly http: HttpClient) {}

  // --- promotions ---
  async create(input: CreatePromotionInput, idempotencyKey: string): Promise<Promotion> {
    return (await this.http.request<Promotion>('POST', 'promotions', { body: input, idempotencyKey })).data;
  }
  /** W2721 — the review (with refusals it is W2720's form-error). No write. */
  async review(input: PromotionReviewInput): Promise<PromotionReview> {
    return (await this.http.request<PromotionReview>('POST', 'promotions/review', { body: input })).data;
  }
  async list(params: { cursor?: string; limit?: number; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<Page<Promotion> & { total: number | null }> {
    return page(await this.http.request<Promotion[]>('GET', 'promotions', { query: { cursor: params.cursor, limit: params.limit ?? 25, activeOnly: params.activeOnly }, signal }));
  }
  async get(id: string, signal?: AbortSignal): Promise<Promotion> {
    return (await this.http.request<Promotion>('GET', `promotions/${encodeURIComponent(id)}`, { signal })).data;
  }
  async summary(signal?: AbortSignal): Promise<OffersSummary> {
    return (await this.http.request<OffersSummary>('GET', 'promotions/summary', { signal })).data;
  }
  /** W2724 — pause (`false`) or resume (`true`), with a REASON (3–300; audited). */
  async setActive(id: string, isActive: boolean, reason: string): Promise<Promotion> {
    return (await this.http.request<Promotion>('POST', `promotions/${encodeURIComponent(id)}/active`, { body: { isActive, reason } })).data;
  }

  // --- coupon codes hanging off a promotion ---
  async createCoupon(input: { promotionId: string; code: string; maxUses?: number; perUserLimit?: number }, idempotencyKey: string): Promise<Coupon> {
    return (await this.http.request<Coupon>('POST', 'coupons', { body: input, idempotencyKey })).data;
  }
  async reviewCoupon(input: CouponReviewInput): Promise<CouponReview> {
    return (await this.http.request<CouponReview>('POST', 'coupons/review', { body: input })).data;
  }
  /** One promotion's coupons — `promotionId` is REQUIRED (F-7). */
  async coupons(promotionId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Coupon>> {
    return page(await this.http.request<Coupon[]>('GET', 'coupons', { query: { promotionId, cursor: params.cursor, limit: params.limit ?? 50 }, signal }));
  }
  /** B1 — every live coupon of the tenant (W130), with promotion, derived status and redeemed value. */
  async allCoupons(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CouponListRow> & { total: number | null }> {
    return page(await this.http.request<CouponListRow[]>('GET', 'coupons/all', { query: { cursor: params.cursor, limit: params.limit ?? 25 }, signal }));
  }
  /** One live coupon as W130 shows it (404 when there is none). */
  async getCoupon(id: string, signal?: AbortSignal): Promise<CouponListRow> {
    return (await this.http.request<CouponListRow>('GET', `coupons/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** W130's "Recent redemptions" for one coupon — applied and declined, masked buyer + place. */
  async couponRedemptions(couponId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CouponRedemptionRow>> {
    return page(await this.http.request<CouponRedemptionRow[]>('GET', `coupons/${encodeURIComponent(couponId)}/redemptions`, { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal }));
  }
  /** W2543 — soft delete with a REASON; 404 when there was nothing to delete (F-12). */
  async deleteCoupon(id: string, reason: string): Promise<{ id: string; deleted: true }> {
    return (await this.http.request<{ id: string; deleted: true }>('DELETE', `coupons/${encodeURIComponent(id)}`, { body: { reason } })).data;
  }
  /** The CALLER's own redemptions (a buyer's history). */
  async redemptions(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CouponRedemption>> {
    return page(await this.http.request<CouponRedemption[]>('GET', 'coupons/redemptions', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal }));
  }
}
