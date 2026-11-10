// @krishalaya/sdk-js · the GOVERNMENT CONSOLE realm (`/v1/gov/*`) — PC-56 GOV-0 · a government authority is an organisation (GOV-1 Q2-A,
// Q3-A, Q4-A, Q5-A, lead-applied 2026-11-10; the founder may reopen them).
//
// An official signs in TO THEIR AUTHORITY (not to a tenant, not to a partner): the token carries `aid` + `realm: 'gov'` and no `tid` / `pid`.
// The API refuses a tenant or partner token on every gov route and a gov token on every tenant and partner route.
//   • sign-in is the phone code THEN the authenticator code (Q5-A); there is no SSO / departmental / hardware-key method;
//   • no confirmed authenticator → `SdkError` code `GOV_TWO_FACTOR_REQUIRED`, `details: { enrolToken, expiresInSec }` — no session exists;
//     `auth.enrol(enrolToken)` then `auth.confirm(enrolToken, code)`, then sign in again;
//   • confirmed authenticator → `SdkError` code `TWO_FACTOR_PENDING`, `details.challengeToken`; finish with `auth.verifyTwoFactor`;
//   • several authorities → `GOV_CHOICE_REQUIRED`, `details: { choiceToken, authorities: [{ id, name }] }`; finish with `auth.choose`;
//   • members: `request` (any member; a person by phone, a role, 1–12 months, a reason), `approve` (a head who is neither the requester nor
//     the grantee — the second person), `remove` (one head, at once, with a reason) — each needs an Idempotency-Key;
//   • applications: to the authority's own schemes, NEVER a farmer's unsent draft (PC-56 GOV-2a); every `get` is recorded server-side and the
//     organisation can see it; the form is the DECLARED fields of the version it was filed under, personal ones masked (••••••xyz) — an
//     undeclared field never arrives (GOV-2 Q3-A);
//   • `applications.act` (PC-56 GOV-2a, GOV-2 Q2-A): verify / clarify (authority.applications.verify) and approve / reject
//     (authority.applications.decide — the head only). A decision follows a check BY ANOTHER PERSON: never the checker, never the applicant,
//     never the assister (`GOV_DECIDER_IS_VERIFIER` / `_APPLICANT` / `_ASSISTER`, `GOV_NOT_VERIFIED`); a rejection names a listed
//     `reasonCode` and a `note` of 10–500 characters; approval carries NO amount (Q1-A). Needs an Idempotency-Key;
//   • `schemes` (PC-56 GOV-2a, Q5-A): the authority's own schemes read-only — published fields only, never an amount, never a draft's
//     content, never an operator id. There is no scheme write in this realm.
import { HttpClient } from '../http';
import { AuthTokens } from '../types';

export type GovRoleCode = 'authority_head' | 'authority_officer';
export type GovPermission = 'authority.applications.read' | 'authority.members.read' | 'authority.members.request' | 'authority.members.approve' | 'authority.members.remove'
  | 'authority.applications.verify' | 'authority.applications.decide';
export interface GovMe {
  authority: { id: string; name: string; level: 'central' | 'state' | 'district' | 'body' | string } | null;
  person: { userId: string; roles: string[]; permissions: string[]; phoneMasked: string | null; accessEndsAt: string | null };
  realm: 'gov';
}
export type GovMembershipStatus = 'requested' | 'active' | 'removed';
export interface GovMembership {
  membershipId: string; userId: string; name: string | null; phoneMasked: string; roleCode: GovRoleCode | string; status: GovMembershipStatus;
  /** true only while active AND before `expiresAt` — an expired membership grants nothing. */
  live: boolean; termMonths: number;
  requestedBy: string | null; requestedByPlatform: boolean; requestReason: string; requestedAt: string | null;
  approvedBy: string | null; approvedAt: string | null; expiresAt: string | null;
  removedBy: string | null; removedAt: string | null; removedReason: string | null;
}
/** `draft` never arrives (PC-56 GOV-2a) — kept in the union for older callers. */
export type GovApplicationStatus = 'draft' | 'submitted' | 'under_verification' | 'clarification_needed' | 'approved' | 'rejected' | 'disbursed' | 'closed' | 'appealed';
export interface GovApplication {
  id: string;
  /** The organisation (FPO) the application belongs to. Never the applicant. */
  organisationId: string;
  scheme: { id: string; code: string; name: string }; schemeVersion: number; status: GovApplicationStatus | string;
  submittedAt: string | null; decidedAt: string | null; createdAt: string;
}
/** PC-56 GOV-2a · one DECLARED form field (the scheme version declares it); a personal value arrives as ••••••xyz. */
export interface GovFormField { key: string; label: string; kind: 'text' | 'number' | 'date' | 'boolean' | 'choice' | string; personal: boolean; value: unknown }
export interface GovApplicationOpened extends GovApplication {
  /** The DECLARED fields only, in declared order; `[]` when the version declares none. */
  form: GovFormField[];
  /** false → the version this application was filed under declares no form field, so none is shown. */
  formDeclared: boolean;
  /** Always true: this opening was recorded for the application's organisation. */
  recorded: true;
}
export type GovAct = 'verify' | 'clarify' | 'approve' | 'reject';
/** The 11 listed rejection reasons (0106). */
export type GovRejectionCode = 'aadhaar_seeding_mismatch' | 'land_record_name_variance' | 'duplicate_application' | 'window_missed' | 'documents_missing'
  | 'ineligible_landholding' | 'ineligible_category' | 'ineligible_region' | 'portal_rejected' | 'withdrawn_by_applicant' | 'other';
export interface GovActInput { act: GovAct; reasonCode?: GovRejectionCode; note?: string }
export interface GovActResult { id: string; act: GovAct; status: GovApplicationStatus | string; from: string; decidedAt: string | null; recorded: true }
/** PC-56 GOV-2a · B3 — the authority's own scheme, from its PUBLISHED version. No amount, no fee, no draft content, no operator id. */
export interface GovScheme {
  id: string; code: string; name: string; category: { code: string; name: string } | null; isActive: boolean;
  version: number | null; publishedAt: string | null; publishedBySecondPerson: boolean; isBackfilled: boolean; newerDraftExists: boolean;
  /** Versions below this number were not recorded (rewritten in place before versioning existed). */
  unrecordedBelow: number | null;
  published: {
    benefitType: string | null; instalments: number | null;
    /** The evaluator's five fields only: roles, landholding_max_acres, gender, age_min, age_max. */
    rules: Record<string, unknown>;
    /** As stored in the rules (not enforced at apply today). */
    applicationWindow: unknown;
    regions: Array<{ id: string; name: string }>; requiredDocuments: Array<{ id: string; code: string; name: string }>;
    formFields: Array<{ key: string; label: string; kind: string; personal: boolean }>;
  } | null;
}
export interface GovSchemeVersion { version: number; status: 'published' | 'superseded' | string; publishedAt: string | null; publishedBySecondPerson: boolean; isBackfilled: boolean }
export interface GovSchemeVersionDiff { version: number; comparedWith: number | null; changes: Array<{ field: string; from: unknown; to: unknown }> }
/** PC-56 GOV-1b · the statuses the overview counts (every application status except `draft`). */
export type GovOverviewStatus = 'submitted' | 'under_verification' | 'clarification_needed' | 'approved' | 'rejected' | 'disbursed' | 'closed' | 'appealed';
/** PC-56 GOV-1b · GOV1-B5 — the authority's overview: COUNTS ONLY, computed by the server in SQL over every application ever submitted to the
 *  schemes the authority runs (all organisations; drafts not counted). No application id, organisation, applicant, form field, share or money
 *  figure; no credit (the government axis cannot read credits). `computedAt` is the server's time. */
export interface GovOverview {
  window: { kind: 'all_time'; draftsCounted: false };
  computedAt: string;
  schemes: { count: number };
  byScheme: Array<{ scheme: { id: string; code: string; name: string }; total: number; byStatus: Record<GovOverviewStatus, number> }>;
  totals: { total: number; byStatus: Record<GovOverviewStatus, number> };
  /** The queues only a person clears; `oldestDays` = whole 24-hour days since the oldest one last changed (null when the queue is empty). */
  queues: Array<{ status: 'clarification_needed' | 'appealed'; count: number; oldestDays: number | null }>;
}
export interface GovApplicationsPage { items: GovApplication[]; nextCursor: string | null; limit: number; asOf: string | null }

class GovAuth {
  constructor(private readonly http: HttpClient) {}
  async otp(phone: string): Promise<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }> {
    return (await this.http.request<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }>('POST', 'gov/auth/otp', { anonymous: true, body: { phone } })).data;
  }
  /** Phone + code (+ the authority when known). No authenticator yet → GOV_TWO_FACTOR_REQUIRED; with one → TWO_FACTOR_PENDING. Anonymous. */
  async verify(phone: string, code: string, authorityId?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'gov/auth/verify', { anonymous: true, body: { phone, code, ...(authorityId ? { authorityId } : {}) } })).data;
  }
  async choose(choiceToken: string, authorityId: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'gov/auth/verify', { anonymous: true, body: { choiceToken, authorityId } })).data;
  }
  async verifyTwoFactor(input: { challengeToken: string; code?: string; recoveryCode?: string }): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'gov/auth/2fa/verify', { anonymous: true, body: input })).data;
  }
  /** The authenticator set-up step (no session exists yet): the secret and otpauth URI, shown ONCE. Anonymous — the enrol token is the credential. */
  async enrol(enrolToken: string): Promise<{ secret: string; otpauthUri: string; shownOnce: true }> {
    return (await this.http.request<{ secret: string; otpauthUri: string; shownOnce: true }>('POST', 'gov/auth/2fa/enrol', { anonymous: true, body: { enrolToken } })).data;
  }
  /** Confirm with a current code: the recovery codes, shown ONCE; then sign in again. */
  async confirm(enrolToken: string, code: string): Promise<{ confirmed: true; recoveryCodes: string[]; next: 'sign_in_again' }> {
    return (await this.http.request<{ confirmed: true; recoveryCodes: string[]; next: 'sign_in_again' }>('POST', 'gov/auth/2fa/confirm', { anonymous: true, body: { enrolToken, code } })).data;
  }
  async refresh(refreshToken: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'gov/auth/refresh', { anonymous: true, body: { refreshToken } })).data;
  }
  async logout(): Promise<{ ok: true }> { return (await this.http.request<{ ok: true }>('POST', 'gov/auth/logout')).data; }
}

class GovMembers {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<GovMembership[]> { return (await this.http.request<GovMembership[]>('GET', 'gov/members', { signal })).data; }
  async request(input: { phone: string; roleCode: GovRoleCode; termMonths: number; reason: string }, idempotencyKey: string): Promise<{ id: string; status: 'requested'; roleCode: string; termMonths: number; phoneMasked: string | null }> {
    return (await this.http.request<{ id: string; status: 'requested'; roleCode: string; termMonths: number; phoneMasked: string | null }>('POST', 'gov/members/requests', { idempotencyKey, body: input })).data;
  }
  async approve(membershipId: string, idempotencyKey: string): Promise<{ id: string; status: 'active'; expiresAt: string | null }> {
    return (await this.http.request<{ id: string; status: 'active'; expiresAt: string | null }>('POST', `gov/members/${encodeURIComponent(membershipId)}/approve`, { idempotencyKey })).data;
  }
  async remove(membershipId: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'removed'; sessionsEnded: number }> {
    return (await this.http.request<{ id: string; status: 'removed'; sessionsEnded: number }>('POST', `gov/members/${encodeURIComponent(membershipId)}/remove`, { idempotencyKey, body: { reason } })).data;
  }
}

class GovApplications {
  constructor(private readonly http: HttpClient) {}
  async list(q: { status?: Exclude<GovApplicationStatus, 'draft'>; schemeId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GovApplicationsPage> {
    const r = await this.http.request<GovApplication[]>('GET', 'gov/applications', { query: { status: q.status, schemeId: q.schemeId, cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; asOf?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, asOf: m.asOf ?? null };
  }
  /** Opens ONE application — recorded for its organisation every time. */
  async get(id: string, signal?: AbortSignal): Promise<GovApplicationOpened> {
    return (await this.http.request<GovApplicationOpened>('GET', `gov/applications/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** PC-56 GOV-2a — one act (verify / clarify / approve / reject), recorded for the organisation. Approval carries no amount. */
  async act(id: string, input: GovActInput, idempotencyKey: string): Promise<GovActResult> {
    return (await this.http.request<GovActResult>('POST', `gov/applications/${encodeURIComponent(id)}/act`, { idempotencyKey, body: input })).data;
  }
}

/** PC-56 GOV-2a · the authority's own schemes — read only. */
class GovSchemes {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<GovScheme[]> { return (await this.http.request<GovScheme[]>('GET', 'gov/schemes', { signal })).data; }
  async get(id: string, signal?: AbortSignal): Promise<GovScheme> { return (await this.http.request<GovScheme>('GET', `gov/schemes/${encodeURIComponent(id)}`, { signal })).data; }
  async versions(id: string, signal?: AbortSignal): Promise<GovSchemeVersion[]> {
    return (await this.http.request<GovSchemeVersion[]>('GET', `gov/schemes/${encodeURIComponent(id)}/versions`, { signal })).data;
  }
  async diff(id: string, version: number, signal?: AbortSignal): Promise<GovSchemeVersionDiff> {
    return (await this.http.request<GovSchemeVersionDiff>('GET', `gov/schemes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(version))}/diff`, { signal })).data;
  }
}

export class GovResource {
  readonly auth: GovAuth;
  readonly members: GovMembers;
  readonly applications: GovApplications;
  readonly schemes: GovSchemes;
  constructor(private readonly http: HttpClient) {
    this.auth = new GovAuth(http); this.members = new GovMembers(http); this.applications = new GovApplications(http); this.schemes = new GovSchemes(http);
  }
  /** The authority and the signed-in person (roles, permissions, phone by its last 3, when their access ends). */
  async me(signal?: AbortSignal): Promise<GovMe> { return (await this.http.request<GovMe>('GET', 'gov/me', { signal })).data; }
  /** PC-56 GOV-1b · the authority's overview (counts only; nothing recorded — no application is opened). */
  async overview(signal?: AbortSignal): Promise<GovOverview> { return (await this.http.request<GovOverview>('GET', 'gov/overview', { signal })).data; }
}
