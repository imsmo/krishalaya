// @krishalaya/sdk-js · promotions + coupons resource (PC-28b). Operator surface, server-gated by
// promotion.manage; discounts are applied server-side at checkout (checkout.preview shows the truth) — this
// resource only DEFINES them. Money is bigint minor-unit STRINGS (Law 2).
import { HttpClient } from '../http';
import { Page } from '../types';

export interface Promotion {
  id: string; promoType: string; defaultName: string;
  rules: { discountType: string; percentOff?: number; amountOffMinor?: string; minOrderMinor?: string; maxDiscountMinor?: string };
  budgetMinor?: string | null; startsAt: string; endsAt: string; isActive?: boolean; createdAt?: string;
}
export interface Coupon { id: string; promotionId: string; code: string; maxUses?: number | null; perUserLimit?: number | null; uses?: number; isActive?: boolean; createdAt?: string; }
export interface CouponRedemption { id: string; couponId: string; couponCode?: string | null; orderId?: string | null; userId?: string | null; amountMinor?: string | null; createdAt?: string; }

export class PromotionsResource {
  constructor(private readonly http: HttpClient) {}

  async create(input: { promoType: string; defaultName: string; rules: Promotion['rules']; budgetMinor?: string; startsAt: string; endsAt: string }): Promise<Promotion> {
    return (await this.http.request<Promotion>('POST', 'promotions', { body: input })).data;
  }
  async list(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Promotion>> {
    const r = await this.http.request<Promotion[]>('GET', 'promotions', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async setActive(id: string, active: boolean): Promise<Promotion> {
    return (await this.http.request<Promotion>('POST', `promotions/${encodeURIComponent(id)}/active`, { body: { active } })).data;
  }

  // --- coupon codes hanging off a promotion ---
  async createCoupon(input: { promotionId: string; code: string; maxUses?: number; perUserLimit?: number }): Promise<Coupon> {
    return (await this.http.request<Coupon>('POST', 'coupons', { body: input })).data;
  }
  async coupons(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Coupon>> {
    const r = await this.http.request<Coupon[]>('GET', 'coupons', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async redemptions(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CouponRedemption>> {
    const r = await this.http.request<CouponRedemption[]>('GET', 'coupons/redemptions', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
