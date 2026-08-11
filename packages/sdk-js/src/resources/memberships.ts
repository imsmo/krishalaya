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
  /** `changed: true` when this replaced an earlier ballot — W198's "changeable until close". */
  async castVote(id: string, choice: string): Promise<{ resolutionId: string; choice: string; changed: boolean }> {
    return (await this.http.request<{ resolutionId: string; choice: string; changed: boolean }>('POST', `governance/resolutions/${encodeURIComponent(id)}/vote`, { body: { choice } })).data;
  }
  /**
   * W197's share register — tiles, bylaw panel, one keyset page of rows with a per-member verdict.
   *
   * The verdict is computed by the API from the SAME domain rule the vote path enforces, never read from
   * `coop_share_registers.voting_eligible` (which 0130 documents as deliberately unread). So a row that says "eligible" is a
   * row whose ballot will be accepted.
   */
  async shareRegister(cursor?: string, signal?: AbortSignal): Promise<ShareRegisterView> {
    return (await this.http.request<ShareRegisterView>('GET', 'governance/resolutions/register', { query: { cursor }, signal })).data;
  }

  /** May the CALLER vote, and if not, what would they need? About themselves only — there is no user parameter. */
  async myVotingEligibility(signal?: AbortSignal): Promise<MyVotingEligibility> {
    return (await this.http.request<MyVotingEligibility>('GET', 'governance/resolutions/me/eligibility', { signal })).data;
  }

  async resolutionResults(id: string, signal?: AbortSignal): Promise<{ resolution: Record<string, unknown>; tally: ResolutionTally }> {
    return (await this.http.request<{ resolution: Record<string, unknown>; tally: ResolutionTally }>('GET', `governance/resolutions/${encodeURIComponent(id)}/results`, { signal })).data;
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

/* ---------------------------------------------------------------------------------------------------------------- */
/* PC-56 TENANT-1e · W197/W198 · the co-operative's own arithmetic                                                    */
/* ---------------------------------------------------------------------------------------------------------------- */

/** The tenant's bylaws, as data (0130). Not compiled in — a Bangladeshi society's minimum shareholding is not Gujarat's. */
export interface CoopBylaws { minShares: number; minMembershipMonths: number; quorumBp: number }

export type VoteIneligibleReason = 'not_a_member' | 'suspended' | 'too_few_shares' | 'too_new';

export interface VotingVerdict {
  eligible: boolean;
  reason: VoteIneligibleReason | null;
  /** How many more shares would be needed. 0 when shares are not the obstacle. */
  sharesShort: number;
  /** When the tenure rule is satisfied — W197's "eligible Nov 2026". null when unknowable. */
  eligibleFrom: string | null;
}

export interface ShareRegisterRow {
  userId: string;
  fullName: string | null;
  phoneMasked: string | null;
  sharesHeld: number;
  /** Minor units, string (Law 2). TOTAL value of the holding, not a per-share face value. */
  valueMinor: string;
  memberSince: string | null;
  verdict: VotingVerdict;
}

export interface ShareRegisterTiles {
  members: number;
  shareholders: number;
  pendingAllotment: number;
  totalShares: number;
  shareCapitalMinor: string;
  /** null when the register holds shares issued at different prices — see the API's own note. */
  faceValueMinor: string | null;
  votingEligible: number;
  eligibleOfShareholdersBp: number | null;
  /** `eligible`/`turnoutBp` are null for a resolution closed before its denominator was recorded — unknown, not zero. */
  lastAgm: { resolutionId: string; title: string; closedAt: string | null; cast: number; eligible: number | null; turnoutBp: number | null } | null;
}

export interface ShareRegisterView {
  tiles: ShareRegisterTiles;
  bylaws: CoopBylaws;
  rows: ShareRegisterRow[];
  nextCursor: string | null;
}

export interface MyVotingEligibility {
  bylaws: CoopBylaws;
  facts: { isMember: boolean; memberSince: string | null; sharesHeld: number; suspended: boolean };
  verdict: VotingVerdict;
}

/**
 * A resolution's tally, with a denominator.
 *
 * **`cast` COUNTS MEMBERS, NEVER SHARES.** One member, one vote is a co-operative principle rather than a setting, and it is
 * protected structurally: the API's tally function receives counts and has no access to shareholdings.
 */
export interface ResolutionTally {
  cast: number;
  eligible: number;
  turnoutBp: number;
  quorumBp: number;
  quorumMet: boolean;
  byChoice: Array<{ choice: string; votes: number }>;
  /** Share of CAST votes in favour. null when nobody has voted — "0% in favour" reads as a rejection, and no votes is not one. */
  inFavourBp: number | null;
  passed: boolean | null;
}
