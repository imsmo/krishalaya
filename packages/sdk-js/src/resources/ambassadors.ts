// @krishalaya/sdk-js · ambassadors resource (module 7 — village acquisition agents). Self-service surface for an
// ambassador: their OWN profile + earnings (server resolves the caller — no client id, no IDOR), the commission
// plan catalogue, and the REFERRAL engine (create a code, claim a code, list own referrals). Attribution is the
// real, server-recorded mechanism: an ambassador creates a code → the referred farmer self-signs-up and claims it
// → activation accrues commission SERVER-SIDE. createReferral carries an Idempotency-Key (Law 3). Money is bigint
// minor strings (Law 2). The app never enrolls/activates/pays out (those are ambassador.manage / back-office —
// Law 11). Gated server-side by the `ambassadors` flag.
import { HttpClient } from '../http';
import { AmbassadorProfile, Referral, AmbassadorEarning, CommissionPlan, AmbassadorVisit, AmbassadorTarget, LeaderboardEntry, AssistedOnboardingResult, SuggestedListingDraft, Page,
  EnrollAmbassadorInput, UpdateAmbassadorInput, SetTargetInput, AmbassadorPayoutResult } from '../types';
import type { CreateListingInput } from './listings';

/** Ambassador-assisted farmer onboarding (the farmer is created on-behalf; DPDP consent is mandatory). */
export interface AssistedOnboardingInput {
  phone: string; fullName?: string; languageCode?: string; countryCode?: string; regionId?: string;
  consents: { purposeCode: string; granted: boolean }[];
}

export class AmbassadorsResource {
  constructor(private readonly http: HttpClient) {}

  /** The caller's own ambassador profile (404 if not an ambassador). */
  async myProfile(signal?: AbortSignal): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('GET', 'ambassadors/me', { signal })).data;
  }
  /** The caller's own accrued earnings (keyset). `unpaidOnly` filters to not-yet-paid commission. */
  async myEarnings(params: { unpaidOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorEarning>> {
    const r = await this.http.request<AmbassadorEarning[]>('GET', 'ambassadors/me/earnings', { query: { unpaidOnly: params.unpaidOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The commission plan catalogue (read-only). */
  async plans(signal?: AbortSignal): Promise<CommissionPlan[]> {
    return (await this.http.request<CommissionPlan[]>('GET', 'ambassadors/plans', { signal })).data;
  }

  // --- referrals (the caller's own) ---
  /** Create a referral code to share with a farmer (4–20 uppercase alphanumerics). Idempotent (Law 3). */
  async createReferral(code: string, idempotencyKey: string): Promise<Referral> {
    return (await this.http.request<Referral>('POST', 'ambassadors/referrals', { idempotencyKey, body: { code } })).data;
  }
  /** Claim a referral code (the referred user calls this after sign-up — attribution recorded server-side). */
  async claimReferral(code: string): Promise<Referral> {
    return (await this.http.request<Referral>('POST', 'ambassadors/referrals/claim', { body: { code } })).data;
  }
  /** List the caller's referrals (optionally by status). Keyset. */
  async listReferrals(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Referral>> {
    const r = await this.http.request<Referral[]>('GET', 'ambassadors/referrals', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // --- field-ops (API-W9) ---
  /** Onboard a farmer ON-BEHALF (the caller must be an active ambassador; DPDP consent is required). The farmer
   * account + consent + a 'signed_up' attribution referral are created server-side; the onboarding COMMISSION
   * accrues only when an admin activates the referral. Idempotent (Law 3). */
  async assistedOnboard(input: AssistedOnboardingInput, idempotencyKey: string): Promise<AssistedOnboardingResult> {
    return (await this.http.request<AssistedOnboardingResult>('POST', 'ambassadors/assisted-onboarding', { idempotencyKey, body: input })).data;
  }
  /** P1-16 · create a listing ON BEHALF of an onboarded farmer. Consent-gated server-side: the farmer must have
   * granted 'on_behalf_listing' consent to the caller-ambassador (403 otherwise). Idempotency-keyed (Law 3). */
  async createListingOnBehalf(farmerUserId: string, listing: CreateListingInput, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'ambassadors/on-behalf/listings', { idempotencyKey, body: { farmerUserId, listing } })).data;
  }
  /** P1-16-AI · ask the AI tier to SUGGEST listing fields from a farmer's document text (OCR'd upstream). ADVISORY:
   * the suggestion is never auto-submitted — the ambassador edits + confirms via createListingOnBehalf. Same
   * consent gate; behind the `assisted_doc_prefill` flag (404 when off). Degrades to an empty draft when the model
   * tier is unavailable — never a fabricated value. */
  async suggestListingFromDocs(input: { farmerUserId: string; docText: string; locale?: 'hi' | 'en' | 'gu'; mediaIds?: string[] }): Promise<SuggestedListingDraft> {
    return (await this.http.request<SuggestedListingDraft>('POST', 'ambassadors/on-behalf/listings/suggest', { body: input })).data;
  }
  /** Log a geo-stamped field visit the caller-ambassador made. */
  async logVisit(input: { purpose?: string; visitedUserId?: string; notes?: string; lat?: number; lng?: number; regionId?: string }): Promise<AmbassadorVisit> {
    return (await this.http.request<AmbassadorVisit>('POST', 'ambassadors/visits', { body: input })).data;
  }
  /** The caller-ambassador's own visit timeline (keyset). */
  async listVisits(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorVisit>> {
    const r = await this.http.request<AmbassadorVisit[]>('GET', 'ambassadors/visits', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The tenant leaderboard (ranked by commission earned, optional date window). */
  async leaderboard(params: { periodStart?: string; periodEnd?: string; limit?: number } = {}, signal?: AbortSignal): Promise<LeaderboardEntry[]> {
    return (await this.http.request<LeaderboardEntry[]>('GET', 'ambassadors/leaderboard', { query: { periodStart: params.periodStart, periodEnd: params.periodEnd, limit: params.limit ?? 20 }, signal })).data;
  }
  /** The caller-ambassador's own period targets. */
  async myTargets(limit = 50, signal?: AbortSignal): Promise<AmbassadorTarget[]> {
    return (await this.http.request<AmbassadorTarget[]>('GET', 'ambassadors/targets/me', { query: { limit }, signal })).data;
  }

  // --- admin (tenant-operator; gated server-side by `ambassador.manage`, Law 11) — P1-12 ---
  /** Enroll a user as an ambassador (back-office; NOT self-grant). */
  async enroll(input: EnrollAmbassadorInput): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', 'ambassadors', { body: input })).data;
  }
  /** List the tenant's ambassadors (keyset). */
  async list(params: { activeOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorProfile>> {
    const r = await this.http.request<AmbassadorProfile[]>('GET', 'ambassadors', { query: { activeOnly: params.activeOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('GET', `ambassadors/${encodeURIComponent(id)}`, { signal })).data;
  }
  async update(id: string, patch: UpdateAmbassadorInput): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('PATCH', `ambassadors/${encodeURIComponent(id)}`, { body: patch })).data;
  }
  async suspend(id: string): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', `ambassadors/${encodeURIComponent(id)}/suspend`, {})).data;
  }
  async reinstate(id: string): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', `ambassadors/${encodeURIComponent(id)}/reinstate`, {})).data;
  }
  /** An ambassador's earnings ledger (admin view; keyset). */
  async earnings(id: string, params: { unpaidOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorEarning>> {
    const r = await this.http.request<AmbassadorEarning[]>('GET', `ambassadors/${encodeURIComponent(id)}/earnings`, { query: { unpaidOnly: params.unpaidOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Pay out an ambassador's unpaid commission (server computes + moves money via the ledger; Law 2/3). Idempotent. */
  async payout(id: string, idempotencyKey: string): Promise<AmbassadorPayoutResult> {
    return (await this.http.request<AmbassadorPayoutResult>('POST', `ambassadors/${encodeURIComponent(id)}/payout`, { idempotencyKey })).data;
  }
  /** Activate a referral (admin) — accrues attribution commission server-side. */
  async activateReferral(id: string): Promise<Referral> {
    return (await this.http.request<Referral>('POST', `ambassadors/referrals/${encodeURIComponent(id)}/activate`, {})).data;
  }
  /** Set a per-period target for an ambassador metric. */
  async setTarget(input: SetTargetInput): Promise<AmbassadorTarget> {
    return (await this.http.request<AmbassadorTarget>('POST', 'ambassadors/targets', { body: input })).data;
  }

  // --- PC-54 W54-13 `aeps-service-events` (0071) — a LOG, never a money primitive ---
  /** Kiosk record (offline-first → idempotent). Masked last4s only; amount is the BANK-side figure. */
  async recordAepsEvent(input: Record<string, unknown>, idempotencyKey: string): Promise<{ recorded: boolean }> {
    return (await this.http.request<{ recorded: boolean }>('POST', 'ambassadors/aeps/events', { body: input, idempotencyKey })).data;
  }
  async myAepsEvents(limit = 50, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'ambassadors/aeps/events/mine', { query: { limit }, signal })).data;
  }
  async aepsOversight(params: { status?: string; exceptionCode?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'ambassadors/aeps/events', { query: { status: params.status, exceptionCode: params.exceptionCode, limit: params.limit ?? 100 }, signal })).data;
  }
}
