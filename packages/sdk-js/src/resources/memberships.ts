// @krishalaya/sdk-js · memberships resource (PC-28). FPO membership tiers + member subscriptions.
// Gated server-side by the `memberships` flag; tier authoring needs membership.manage; subscribe/renew are the
// member's own (server-resolved). A PAID subscribe moves money server-side — Idempotency-Key required (Law 3).
// Money is bigint minor-unit STRINGS (Law 2).
import { HttpClient } from '../http';
import { Page } from '../types';

export interface MembershipTier {
  id: string; code: string; defaultName: string; audienceRoleId?: string | null;
  monthlyFeeMinor: string; annualFeeMinor?: string | null; currencyCode?: string;
  benefits?: { freeDelivery?: boolean; creditDays?: number; creditLimitMinor?: string } | null;
  isActive?: boolean; createdAt?: string;
}
export interface UserMembership {
  id: string; userId: string; tierId: string; tierCode?: string | null; tierName?: string | null;
  billingCycle: string; status: string; startsAt?: string | null; expiresAt?: string | null; createdAt?: string;
}

export class MembershipsResource {
  constructor(private readonly http: HttpClient) {}

  // --- tiers (operator: membership.manage) ---
  async tiers(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<MembershipTier>> {
    const r = await this.http.request<MembershipTier[]>('GET', 'membership-tiers', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async createTier(input: { code: string; defaultName: string; monthlyFeeMinor: string; annualFeeMinor?: string; currencyCode?: string; benefits?: { freeDelivery?: boolean; creditDays?: number; creditLimitMinor?: string } }): Promise<MembershipTier> {
    return (await this.http.request<MembershipTier>('POST', 'membership-tiers', { body: input })).data;
  }
  async setTierActive(id: string, active: boolean): Promise<MembershipTier> {
    return (await this.http.request<MembershipTier>('POST', `membership-tiers/${encodeURIComponent(id)}/active`, { body: { active } })).data;
  }

  // --- member subscriptions ---
  async subscribe(input: { tierId: string; billingCycle?: 'monthly' | 'annual' }, idempotencyKey: string): Promise<UserMembership> {
    return (await this.http.request<UserMembership>('POST', 'memberships/subscribe', { idempotencyKey, body: input })).data;
  }
  async mine(signal?: AbortSignal): Promise<UserMembership | null> {
    try { return (await this.http.request<UserMembership | null>('GET', 'memberships/me', { signal })).data; }
    catch { return null; }
  }
  /** Operator roster (box/status per the query DTO; server enforces membership.manage for box=all). */
  async list(params: { box?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<UserMembership>> {
    const r = await this.http.request<UserMembership[]>('GET', 'memberships', { query: { box: params.box, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async renew(id: string, idempotencyKey: string): Promise<UserMembership> {
    return (await this.http.request<UserMembership>('POST', `memberships/${encodeURIComponent(id)}/renew`, { idempotencyKey, body: {} })).data;
  }
  async cancel(id: string): Promise<UserMembership> {
    return (await this.http.request<UserMembership>('POST', `memberships/${encodeURIComponent(id)}/cancel`, { body: {} })).data;
  }
}
