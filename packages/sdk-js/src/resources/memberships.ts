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

  // --- PC-54 W54-7 `governance-agm`, PC-56 TENANT-9b · W198 + the form chain W2741–W2744 + the mutate chain W2745–W2747 ---
  // Every write takes the Idempotency-Key its review / confirm page minted (Law 3); open / close / withdraw go through ONE
  // act route (the old `:id/open` / `:id/close` are gone — one write path, through the confirm).

  /** W198: one keyset page (µs cursor), GET-form filters. Each row's `result` is its SNAPSHOT for a closed resolution. */
  async resolutionsPage(params: { status?: string; type?: string; year?: number; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ResolutionRow[]; nextCursor: string | null; zone: string | null }> {
    const r = await this.http.request<ResolutionRow[]>('GET', 'governance/resolutions', { query: { status: params.status, type: params.type, year: params.year, cursor: params.cursor, limit: params.limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, zone: (r.meta?.zone as string | null) ?? null };
  }
  async resolutionCatalogue(signal?: AbortSignal): Promise<ResolutionCatalogue> {
    return (await this.http.request<ResolutionCatalogue>('GET', 'governance/resolutions/catalogue', { signal })).data;
  }
  /** W2742: the API's review (read-only). Pass `id` to review an EDIT of that draft. */
  async previewResolution(input: ResolutionDraftInput, id?: string): Promise<ResolutionDraftReview> {
    return (await this.http.request<ResolutionDraftReview>('POST', 'governance/resolutions/preview', { body: { ...input, ...(id ? { id } : {}) } })).data;
  }
  async createResolution(input: ResolutionDraftInput, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', 'governance/resolutions', { body: input, idempotencyKey })).data;
  }
  async resolutionDraft(id: string, signal?: AbortSignal): Promise<ResolutionDraftValues> {
    return (await this.http.request<ResolutionDraftValues>('GET', `governance/resolutions/${encodeURIComponent(id)}/draft`, { signal })).data;
  }
  async updateResolution(id: string, input: ResolutionDraftInput, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('PATCH', `governance/resolutions/${encodeURIComponent(id)}`, { body: input, idempotencyKey })).data;
  }
  /** W2745: the verdict at confirm (read-only). */
  async previewResolutionAct(id: string, act: ResolutionAct, input: { reasonCode?: string; note?: string }): Promise<ResolutionActPreview> {
    return (await this.http.request<ResolutionActPreview>('POST', `governance/resolutions/${encodeURIComponent(id)}/acts/${act}/preview`, { body: input })).data;
  }
  /** W2746: the act — recorded with actor · time · reason · before/after. */
  async resolutionAct(id: string, act: ResolutionAct, input: { reasonCode?: string; note?: string }, idempotencyKey: string): Promise<{ id: string; status: string; outcome: string | null }> {
    return (await this.http.request<{ id: string; status: string; outcome: string | null }>('POST', `governance/resolutions/${encodeURIComponent(id)}/acts/${act}`, { body: input, idempotencyKey })).data;
  }
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

  /** The tally — for a CLOSED resolution its snapshot only (`result.basis`: snapshot | not_recorded), never today's roll. */
  async resolutionResults(id: string, signal?: AbortSignal): Promise<ResolutionResults> {
    return (await this.http.request<ResolutionResults>('GET', `governance/resolutions/${encodeURIComponent(id)}/results`, { signal })).data;
  }

  // --- PC-55 A8 `coop-payout-runs`, PC-56 TENANT-9b: a PASSED dividend/patronage vote → QUEUED payouts, in TWO acts. Nothing executes
  // here; execution needs live RazorpayX credentials and the response says so. One vote pays ONCE (DB-guarded),
  // the split sums to the pot exactly, and a run needs a SECOND human (maker != checker). ---
  async coopPayoutPreview(resolutionId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `governance/resolutions/${encodeURIComponent(resolutionId)}/payout-preview`, { signal })).data;
  }
  /** The MAKER prepares — no batch, no payout row (PC-56 TENANT-9b; the old one-call run "confirmed" with a uuid in its own body). */
  async coopPayoutPrepare(resolutionId: string, idempotencyKey: string): Promise<{ id: string; status: 'prepared'; purpose: string; totalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; note: string }> {
    return (await this.http.request<{ id: string; status: 'prepared'; purpose: string; totalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; note: string }>('POST', `governance/resolutions/${encodeURIComponent(resolutionId)}/payout-run`, { body: {}, idempotencyKey })).data;
  }
  /** The CHECKER confirms — the caller IS the checker and may not be the maker (PAYOUT_RUN_MAKER_IS_CHECKER). */
  async coopPayoutConfirm(runId: string, idempotencyKey: string): Promise<{ id: string; batchId: string; status: 'queued'; purpose: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; execution: { executed: boolean; note: string } }> {
    return (await this.http.request<{ id: string; batchId: string; status: 'queued'; purpose: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ userId: string; reason: string }>; execution: { executed: boolean; note: string } }>('POST', `governance/resolutions/payout-runs/${encodeURIComponent(runId)}/confirm`, { body: {}, idempotencyKey })).data;
  }
  async coopPayoutCancel(runId: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'cancelled' }> {
    return (await this.http.request<{ id: string; status: 'cancelled' }>('POST', `governance/resolutions/payout-runs/${encodeURIComponent(runId)}/cancel`, { body: { reason }, idempotencyKey })).data;
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

/* ---------------------------------------------------------------------------------------------------------------- */
/* PC-56 TENANT-9b · W198 + W2741–W2747 · THE RESOLUTIONS                                                             */
/* ---------------------------------------------------------------------------------------------------------------- */

export const RESOLUTION_ACTS = ['open', 'close', 'withdraw'] as const;
export type ResolutionAct = (typeof RESOLUTION_ACTS)[number];
export const RESOLUTION_DRAFT_FIELDS = ['title', 'body', 'resolutionType', 'majority', 'votingOpens', 'votingCloses',
  'formulaMode', 'potAmount', 'ratePct', 'capAmount', 'fiscalYear'] as const;
export type ResolutionDraftField = (typeof RESOLUTION_DRAFT_FIELDS)[number];
/** Every field as typed: times are CIVIL `YYYY-MM-DDTHH:MM` in the cooperative's zone; money in MAJOR units. */
export type ResolutionDraftInput = Partial<Record<ResolutionDraftField, string>>;

export interface PassRule { quorumBp: number; num: number; den: number; strict: boolean }

export interface ResolutionRow {
  id: string; title: string; body: string | null; resolutionType: string; majority: string; status: string;
  votingOpens: string | null; votingCloses: string | null; votingOpensCivil: string | null; votingClosesCivil: string | null;
  payload: Record<string, unknown>; createdAt: string | null; openedAt: string | null; openedBy: string | null;
  closedAt: string | null; closedBy: string | null; closeReason: string | null; withdrawnAt: string | null; withdrawReason: string | null;
  eligibleAtClose: number | null; quorumBp: number | null; ruleFixedAt: 'open' | 'close' | null; outcome: string | null; cast: number;
  result: { basis: 'live' | 'snapshot' | 'not_recorded' | 'none'; outcome: string | null; cast: number; eligibleAtClose: number | null;
    turnoutBp: number | null; quorumBp: number | null; quorumMet: boolean | null };
}

export interface ResolutionCatalogue {
  types: Array<{ code: string; dividendClass: boolean; modelled: boolean }>;
  choices: Array<{ code: string; types: string[]; inFavour: boolean }>;
  choicesByType: Record<string, string[]>;
  closeReasons: string[]; withdrawReasons: string[];
  rules: { ordinary: PassRule; special: PassRule };
  zone: string; currency: { code: string; minorUnits: number } | null; fiscalYearStartMonth: number | null;
}

export interface ResolutionDraftReview {
  ready: boolean;
  fields: Array<{ name: string; entered: string | null; stored: string | null; normalised: boolean }>;
  refusals: Array<{ field: string | null; code: string }>;
  diff: Array<{ field: string; before: string | null; after: string | null }> | null;
  entityType: string;
  choices: string[]; rule: PassRule | null; secondPersonToClose: boolean;
  window: { zone: string; opensCivil: string | null; closesCivil: string | null; opensAt: string | null; closesAt: string | null };
  payload: Record<string, unknown> | null;
  formula: null | { mode: string; potMinor: string | null; rateBp: number | null; capMinor: string | null; fiscalYear: number | null;
    fiscalYearFrom: string | null; fiscalYearToExclusive: string | null; currency: string | null };
}

export interface ResolutionDraftValues {
  id: string; status: string; title: string; body: string | null; resolutionType: string; majority: string;
  votingOpens: string | null; votingCloses: string | null; payload: Record<string, unknown>; zone: string;
  currency: { code: string; minorUnits: number } | null;
}

export interface ResolutionActPreview {
  act: ResolutionAct; allowed: boolean; refusals: string[]; secondPerson: boolean;
  resolution: { id: string; title: string; status: string; resolutionType: string; majority: string; openedAt: string | null;
    openedBy: string | null; votingCloses: string | null; openedByYou: boolean };
  willRecord: { rule?: PassRule; choices?: string[]; eligibleNow?: number | null; cast?: number; ruleFixedAt?: 'open' | 'close' };
  reasons: string[];
}

export interface ResolutionResults {
  resolution: ResolutionRow | Record<string, unknown>;
  tally: ResolutionTally | null;
  result: { basis: 'live' | 'snapshot' | 'not_recorded' | 'none'; tally: ResolutionTally | null; rule: PassRule | null;
    ruleFixedAt: 'open' | 'close' | null; outcome: 'passed' | 'failed' | 'not_recorded' | null; disagreement: boolean };
  choices: string[];
}
