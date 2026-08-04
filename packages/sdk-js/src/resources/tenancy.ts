// @krishalaya/sdk-js · tenancy resource (P-17 — tenant-admin-lite). Plans catalogue + the tenant's subscription
// (apply / current / list). create is idempotent (Law 3; a paid plan moves money SERVER-SIDE — the app never
// does, Law 11). Money is bigint minor strings (Law 2). Gated server-side by the tenant's own permissions.
import { HttpClient } from '../http';
import { Plan, Subscription, TenantAnalytics, TenantBroadcast, Page } from '../types';

export class TenancyResource {
  constructor(private readonly http: HttpClient) {}

  /** Public plan catalogue (apply screen). */
  async plans(signal?: AbortSignal): Promise<Plan[]> {
    return (await this.http.request<Plan[]>('GET', 'plans', { signal })).data;
  }
  /** The tenant's current subscription (+ limits/usage), or { subscription: null } before applying. */
  async currentSubscription(signal?: AbortSignal): Promise<{ subscription: Subscription | null; limits?: Record<string, string>; usage?: Record<string, string> }> {
    return (await this.http.request<{ subscription: Subscription | null; limits?: Record<string, string>; usage?: Record<string, string> }>('GET', 'subscriptions/current', { signal })).data;
  }
  async listSubscriptions(cursor?: string, signal?: AbortSignal): Promise<Page<Subscription>> {
    const r = await this.http.request<Subscription[]>('GET', 'subscriptions', { query: { cursor }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Apply for a plan (create a subscription). Idempotent (Law 3). */
  async apply(input: { planId: string; billingCycle?: 'monthly' | 'annual' }, idempotencyKey: string): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', 'subscriptions', { idempotencyKey, body: input })).data;
  }
  /** Change the plan on an existing subscription (server prices it; the app never computes money — Law 2/11). */
  async changePlan(subscriptionId: string, planId: string): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', `subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, { body: { planId } })).data;
  }
  /** Cancel a subscription — at period end (default, keeps access until renewal) or immediately. */
  async cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', `subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { body: { atPeriodEnd } })).data;
  }

  // --- analytics + broadcast (API-W10) ---
  /** The calling tenant's own analytics dashboard over a window (default last 30 days). Money is bigint minor. */
  async analytics(params: { from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<TenantAnalytics> {
    return (await this.http.request<TenantAnalytics>('GET', 'tenancy/analytics', { query: { from: params.from, to: params.to, currency: params.currency }, signal })).data;
  }
  /** Send a broadcast to an audience (all active members, or one role). Async fan-out via the notification spine. Idempotent (Law 3). */
  async broadcast(input: { title: string; body: string; audienceRoleCode?: string }, idempotencyKey: string): Promise<TenantBroadcast> {
    return (await this.http.request<TenantBroadcast>('POST', 'communication/broadcasts', { idempotencyKey, body: input })).data;
  }
  /** The tenant's broadcast history (keyset). */
  async listBroadcasts(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<TenantBroadcast>> {
    const r = await this.http.request<TenantBroadcast[]>('GET', 'communication/broadcasts', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
