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

  // --- PC-54 W54-7 `governance-agm` (coop_resolutions/coop_votes) ---
  async createResolution(input: { title: string; body?: string; resolutionType: 'agm_vote' | 'dividend' | 'patronage_bonus' | 'board_election'; votingOpens?: string; votingCloses?: string; payload?: Record<string, unknown> }, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', 'governance/resolutions', { body: input, idempotencyKey })).data;
  }
  async resolutions(status?: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'governance/resolutions', { query: { status }, signal })).data;
  }
  openResolution(id: string): Promise<{ id: string; status: string }> { return this.govStep(id, 'open'); }
  closeResolution(id: string): Promise<{ id: string; status: string }> { return this.govStep(id, 'close'); }
  /** One ballot per member — the server's PK is the ballot box (409 on a second vote). */
  async castVote(id: string, choice: string): Promise<{ resolutionId: string; choice: string }> {
    return (await this.http.request<{ resolutionId: string; choice: string }>('POST', `governance/resolutions/${encodeURIComponent(id)}/vote`, { body: { choice } })).data;
  }
  async resolutionResults(id: string, signal?: AbortSignal): Promise<{ resolution: Record<string, unknown>; tally: Array<{ choice: string; votes: number }> }> {
    return (await this.http.request<{ resolution: Record<string, unknown>; tally: Array<{ choice: string; votes: number }> }>('GET', `governance/resolutions/${encodeURIComponent(id)}/results`, { signal })).data;
  }
  private govStep(id: string, action: string): Promise<{ id: string; status: string }> {
    return this.http.request<{ id: string; status: string }>('POST', `governance/resolutions/${encodeURIComponent(id)}/${action}`, { body: {} }).then((r) => r.data);
  }

  // --- PC-55 A8 `coop-payout-runs`: an ACTIVATED dividend/patronage vote → QUEUED payouts. Nothing executes
  // here; execution needs live RazorpayX credentials and the response says so. One vote pays ONCE (DB-guarded),
  // the split sums to the pot exactly, and a run needs a SECOND human (maker != checker). ---
  async coopPayoutPreview(resolutionId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `governance/resolutions/${encodeURIComponent(resolutionId)}/payout-preview`, { signal })).data;
  }
  async coopPayoutRun(resolutionId: string, input: { confirmedBy: string }, idempotencyKey: string): Promise<{ id: string; batchId: string; purpose: string; potMinor: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; execution: { executed: boolean; note: string } }> {
    return (await this.http.request<{ id: string; batchId: string; purpose: string; potMinor: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; execution: { executed: boolean; note: string } }>('POST', `governance/resolutions/${encodeURIComponent(resolutionId)}/payout-run`, { body: input, idempotencyKey })).data;
  }
  async coopPayoutRuns(limit = 50, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'governance/resolutions/payout-runs/list', { query: { limit }, signal })).data;
  }
  async coopPayoutRunDetail(runId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `governance/resolutions/payout-runs/${encodeURIComponent(runId)}`, { signal })).data;
  }
}
