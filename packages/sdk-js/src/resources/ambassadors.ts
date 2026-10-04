// @krishalaya/sdk-js · ambassadors resource (module 7 — village acquisition agents). Self-service surface for an
// ambassador: their OWN profile + earnings (server resolves the caller — no client id, no IDOR), the commission
// plan catalogue, and the REFERRAL engine (create a code, claim a code, list own referrals). Attribution is the
// real, server-recorded mechanism: an ambassador creates a code → the referred farmer self-signs-up and claims it
// → activation accrues commission SERVER-SIDE. createReferral carries an Idempotency-Key (Law 3). Money is bigint
// minor strings (Law 2). The app never enrolls/activates/pays out (those are ambassador.manage / back-office —
// Law 11). Gated server-side by the `ambassadors` flag.
import { HttpClient } from '../http';
import { AmbassadorProfile, Referral, AmbassadorEarning, CommissionPlan, AmbassadorVisit, AmbassadorTarget, LeaderboardEntry, AssistedOnboardingResult, SuggestedListingDraft, Page,
  EnrollAmbassadorInput, UpdateAmbassadorInput, SetTargetInput,
  AmbassadorRosterRow, AmbassadorRosterSort, AmbassadorSummary, AmbassadorCandidate, AmbassadorReview, AmbassadorReviewInput,
  ReferralDeskRow, ReferralDeskSummary,
  AmbassadorDetail, AmbassadorRunPrepared, AmbassadorRun, AmbassadorRunDetail, AmbassadorRunCurrent, AmbassadorRunPayOutcome } from '../types';
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

  // --- admin (tenant-operator; gated server-side by `ambassador.manage`, Law 11) — P1-12 · PC-56 TENANT-10a ---
  /** Recruit an existing MEMBER as an ambassador (back-office; NOT self-grant). Name them by `phone` or `userId` (exactly
   *  one). The act re-checks every refusal the review names (422 AMBASSADOR_REFUSED with `details.refusals`). Idempotent. */
  async enroll(input: EnrollAmbassadorInput, idempotencyKey: string): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', 'ambassadors', { body: input, idempotencyKey })).data;
  }
  /** The recruit form's review (W2482; with refusals it is W2481) — nothing is written. */
  async reviewRecruit(input: AmbassadorReviewInput): Promise<AmbassadorReview> {
    return (await this.http.request<AmbassadorReview>('POST', 'ambassadors/review', { body: input })).data;
  }
  /** The recruit form's member lookup by phone (masked; `null` when the phone belongs to nobody). */
  async candidate(phone: string, signal?: AbortSignal): Promise<AmbassadorCandidate | null> {
    return (await this.http.request<AmbassadorCandidate | null>('GET', 'ambassadors/candidates', { query: { phone }, signal })).data;
  }
  /** W159's roster (keyset; `total` for "Showing N of M"). `tier` is an ambassador_tier CODE; `inactive` = no recorded act in 60 days. */
  async list(params: { activeOnly?: boolean; tier?: string; inactive?: boolean; sort?: AmbassadorRosterSort; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorRosterRow>> {
    const r = await this.http.request<AmbassadorRosterRow[]>('GET', 'ambassadors', { query: { activeOnly: params.activeOnly, tier: params.tier, inactive: params.inactive, sort: params.sort, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, total: (r.meta?.total as number | undefined) ?? null };
  }
  /** W159's KPI tiles + tier-tab counts. */
  async summary(signal?: AbortSignal): Promise<AmbassadorSummary> {
    return (await this.http.request<AmbassadorSummary>('GET', 'ambassadors/summary', { signal })).data;
  }
  /** One ambassador, named the way the roster names them — plus `pay` (PC-56 TENANT-SW-b): the open run's line and ITS pay date,
   *  or `noRunReason: 'no_run_prepared'`, and the stipends recorded paid. */
  async get(id: string, signal?: AbortSignal): Promise<AmbassadorDetail> {
    return (await this.http.request<AmbassadorDetail>('GET', `ambassadors/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** The edit form's review — the diff against the profile as it stands; nothing is written. */
  async reviewEdit(id: string, input: AmbassadorReviewInput): Promise<AmbassadorReview> {
    return (await this.http.request<AmbassadorReview>('POST', `ambassadors/${encodeURIComponent(id)}/review`, { body: input })).data;
  }
  /** Edit (audited `ambassador.updated`, before → after of exactly the fields that changed; `reason` optional). */
  async update(id: string, patch: UpdateAmbassadorInput): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('PATCH', `ambassadors/${encodeURIComponent(id)}`, { body: patch })).data;
  }
  /** Suspend — a reason (3–300 chars) is REQUIRED and recorded. */
  async suspend(id: string, reason: string): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', `ambassadors/${encodeURIComponent(id)}/suspend`, { body: { reason } })).data;
  }
  /** Reinstate — a reason is optional (recorded when given). */
  async reinstate(id: string, reason?: string): Promise<AmbassadorProfile> {
    return (await this.http.request<AmbassadorProfile>('POST', `ambassadors/${encodeURIComponent(id)}/reinstate`, { body: reason ? { reason } : {} })).data;
  }
  /** An ambassador's earnings ledger (admin view; keyset). */
  async earnings(id: string, params: { unpaidOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorEarning>> {
    const r = await this.http.request<AmbassadorEarning[]>('GET', `ambassadors/${encodeURIComponent(id)}/earnings`, { query: { unpaidOnly: params.unpaidOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** PC-56 TENANT-SW-b · the EXCEPTION act: PREPARES a one-ambassador run (commission only) from the TENANT Main wallet
   *  (`ambassador.payout.prepare`; reason REQUIRED). Nothing moves until a DIFFERENT tenant_admin confirms the run. Idempotent. */
  async payout(id: string, reason: string, idempotencyKey: string): Promise<AmbassadorRunPrepared> {
    return (await this.http.request<AmbassadorRunPrepared>('POST', `ambassadors/${encodeURIComponent(id)}/payout`, { body: { reason }, idempotencyKey })).data;
  }
  /** PC-56 TENANT-SW-b · PREPARE the weekly run now (the job also prepares it every Thursday 23:00 IST). Same as `prepareRun`. */
  async runPayouts(reason: string, idempotencyKey: string): Promise<AmbassadorRunPrepared> {
    return (await this.http.request<AmbassadorRunPrepared>('POST', 'ambassadors/payouts/run', { body: { reason }, idempotencyKey })).data;
  }
  /** W160 "Message (Gujarati)": one notification to that ambassador through communication (their language), reason audited. */
  async message(id: string, input: { message: string; reason: string }, idempotencyKey: string): Promise<{ ambassadorId: string; queued: boolean }> {
    return (await this.http.request<{ ambassadorId: string; queued: boolean }>('POST', `ambassadors/${encodeURIComponent(id)}/message`, { body: input, idempotencyKey })).data;
  }

  // --- W161 · the weekly earnings RUN under maker-checker (PC-56 TENANT-SW-b) ---
  /** The open run (lines, the REAL funding read, the maker) or null — and when the job prepares the next one. */
  async currentRun(signal?: AbortSignal): Promise<AmbassadorRunCurrent> {
    return (await this.http.request<AmbassadorRunCurrent>('GET', 'ambassadors/payout-runs/current', { signal })).data;
  }
  /** Run history (µs keyset). */
  async runs(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AmbassadorRun>> {
    const r = await this.http.request<AmbassadorRun[]>('GET', 'ambassadors/payout-runs', { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async run(runId: string, signal?: AbortSignal): Promise<AmbassadorRunDetail> {
    return (await this.http.request<AmbassadorRunDetail>('GET', `ambassadors/payout-runs/${encodeURIComponent(runId)}`, { signal })).data;
  }
  /** Prepare a weekly run now (`ambassador.payout.prepare`; reason; Idempotency-Key). */
  async prepareRun(reason: string, idempotencyKey: string): Promise<AmbassadorRunPrepared> {
    return (await this.http.request<AmbassadorRunPrepared>('POST', 'ambassadors/payout-runs/prepare', { body: { reason }, idempotencyKey })).data;
  }
  /** The CHECKER confirms (`ambassador.payout`; the database refuses the preparer) — the run pays tenant Main → ambassador Main. */
  async confirmRun(runId: string, reason: string, idempotencyKey: string): Promise<AmbassadorRunPayOutcome> {
    return (await this.http.request<AmbassadorRunPayOutcome>('POST', `ambassadors/payout-runs/${encodeURIComponent(runId)}/confirm`, { body: { reason }, idempotencyKey })).data;
  }
  /** Re-run a partly paid / unfunded run's unpaid lines (never by its preparer). */
  async payRun(runId: string, reason: string, idempotencyKey: string): Promise<AmbassadorRunPayOutcome> {
    return (await this.http.request<AmbassadorRunPayOutcome>('POST', `ambassadors/payout-runs/${encodeURIComponent(runId)}/pay`, { body: { reason }, idempotencyKey })).data;
  }
  /** Refuse a prepared run (nothing moves). */
  async refuseRun(runId: string, reason: string): Promise<{ runId: string; status: 'refused' }> {
    return (await this.http.request<{ runId: string; status: 'refused' }>('POST', `ambassadors/payout-runs/${encodeURIComponent(runId)}/refuse`, { body: { reason } })).data;
  }
  /** Activate a referral (admin) — a reason is REQUIRED (audited `referral.activated`); accrues onboarding commission server-side. */
  async activateReferral(id: string, reason: string): Promise<Referral> {
    return (await this.http.request<Referral>('POST', `ambassadors/referrals/${encodeURIComponent(id)}/activate`, { body: { reason } })).data;
  }
  /** W162 · the tenant's referral desk (every referral; masked names; status filter; keyset; `total`). */
  async referralDesk(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ReferralDeskRow>> {
    const r = await this.http.request<ReferralDeskRow[]>('GET', 'ambassadors/referrals/all', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, total: (r.meta?.total as number | undefined) ?? null };
  }
  /** One W162 desk row (both people named, masked). */
  async referral(id: string, signal?: AbortSignal): Promise<ReferralDeskRow> {
    return (await this.http.request<ReferralDeskRow>('GET', `ambassadors/referrals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** W162's KPI tiles (`rewardsPaid30dMinor` is null by name — no reward rule exists). */
  async referralSummary(signal?: AbortSignal): Promise<ReferralDeskSummary> {
    return (await this.http.request<ReferralDeskSummary>('GET', 'ambassadors/referrals/summary', { signal })).data;
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
