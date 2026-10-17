// @krishalaya/sdk-js · the PARTNER CONSOLE realm (`/v1/partner/*`) — PC-56 PARTNER-0 · a partner is an organisation (founder D1–D8).
//
// A bank / NBFC person signs in TO THEIR PARTNER ORGANISATION (not to a tenant): `auth.verify` answers a token carrying `pid` + `realm:
// 'partner'` and no `tid`. The host stores it like any session (httpOnly cookie server-side) and passes it through `getToken` — the API
// refuses a tenant token on every partner route and a partner token on every tenant route. Distinct from `partnerApi` (the machine realm,
// API keys, `/v1/partner-api/*`).
//   • several partners → `SdkError` code `PARTNER_CHOICE_REQUIRED`, `details: { choiceToken, partners: [{ id, name }], expiresInSec }`;
//     finish with `auth.choose(choiceToken, partnerId)`;
//   • confirmed TOTP → `SdkError` code `TWO_FACTOR_PENDING`, `details.challengeToken`; finish with `auth.verifyTwoFactor`;
//   • the applications read is consent-gated: no applicant id, no name; the purpose text and a masked phone only after approval;
//   • every decision needs an Idempotency-Key (mint it when the form renders); `decide.disburse` is REFUSED by name
//     (`PARTNER_CANNOT_DISBURSE`) — it exists so a console can show the refusal, never to move money;
//   • `team.invite` answers the raw token ONCE (`token: null` on a replayed key).
// Money is a bigint minor-unit STRING (Law 2).
import { HttpClient } from '../http';
import { AuthTokens } from '../types';

export type PartnerRoleCode = 'partner_admin' | 'partner_checker' | 'partner_maker' | 'partner_viewer';
export interface PartnerChoice { id: string; name: string }
export interface PartnerMe {
  organisation: { id: string; name: string; kind: string; regulatorRefMasked: string | null; sla: Record<string, unknown> } | null;
  person: { userId: string; roles: string[]; permissions: string[]; phoneMasked: string | null };
  realm: 'partner';
}
export type PartnerApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn' | 'disbursed';
export interface PartnerApplication {
  id: string;
  /** Opaque: the application id. There is never an applicant user id or a name. */
  applicantRef: string;
  /** The organisation (FPO) the application belongs to. */
  tenantId: string;
  product: { id: string; name: string };
  /** The loan kind (crop, kcc, tractor …) — the purpose CATEGORY. */
  purposeCategory: string | null;
  /** The applicant's own words — null until the application is approved. */
  purposeText: string | null;
  amountRequestedMinor: string; amountApprovedMinor: string | null;
  status: PartnerApplicationStatus | string;
  createdAt: string; decisionAt: string | null; coolingOffUntil: string | null;
  /** `••••••318` — null until the application is approved. */
  applicantPhoneMasked: string | null;
}
export interface PartnerApplicationsPage { items: PartnerApplication[]; nextCursor: string | null; limit: number; asOf: string | null }
export interface PartnerDecisionResult {
  id: string; applicantRef: string; status: string; amountRequestedMinor: string; amountApprovedMinor: string | null; decisionAt: string | null; coolingOffUntil: string | null;
}
export interface PartnerTeamMember {
  membershipId: string; userId: string; name: string | null; phoneMasked: string; roleCode: PartnerRoleCode | string; active: boolean;
  since: string | null; removedAt: string | null; removedReason: string | null; twoFactor: boolean;
}
export interface PartnerPendingInvite { id: string; phoneMasked: string; roleCode: string; invitedBy: string; expiresAt: string | null; sentAt: string | null; sendFailure: string | null; createdAt: string | null }
export interface PartnerTeam { members: PartnerTeamMember[]; invites: PartnerPendingInvite[] }
export interface PartnerInviteCreated { id: string; expiresAt: string; phoneMasked: string; roleCode: string; days: number; token: string | null; tokenShown: boolean }
export interface PartnerInviteLookup { organisation: string; roleCode: string; phoneMasked: string | null; status: 'pending' | 'used' | 'revoked' | 'expired'; expiresAt: string }

class PartnerAuth {
  constructor(private readonly http: HttpClient) {}
  /** The phone OTP (the platform's — enumeration-safe). Anonymous. */
  async otp(phone: string): Promise<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }> {
    return (await this.http.request<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }>('POST', 'partner/auth/otp', { anonymous: true, body: { phone } })).data;
  }
  /** Phone + code (+ a partner id when already known). Several partners → SdkError PARTNER_CHOICE_REQUIRED. Anonymous. */
  async verify(phone: string, code: string, partnerId?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/verify', { anonymous: true, body: { phone, code, ...(partnerId ? { partnerId } : {}) } })).data;
  }
  /** The chooser's second step: the single-use choice token + the chosen partner. Anonymous. */
  async choose(choiceToken: string, partnerId: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/verify', { anonymous: true, body: { choiceToken, partnerId } })).data;
  }
  async verifyTwoFactor(input: { challengeToken: string; code?: string; recoveryCode?: string }): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/2fa/verify', { anonymous: true, body: input })).data;
  }
  /** Rotate a PARTNER refresh token (a tenant one is refused). Anonymous — the refresh token is the credential. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/refresh', { anonymous: true, body: { refreshToken } })).data;
  }
  async logout(): Promise<{ ok: true }> { return (await this.http.request<{ ok: true }>('POST', 'partner/auth/logout')).data; }
}

class PartnerApplications {
  constructor(private readonly http: HttpClient) {}
  async list(q: { status?: PartnerApplicationStatus; reviewQueue?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerApplicationsPage> {
    const r = await this.http.request<PartnerApplication[]>('GET', 'partner/applications', {
      query: { status: q.status, reviewQueue: q.reviewQueue === undefined ? undefined : String(q.reviewQueue), cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; asOf?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, asOf: m.asOf ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<PartnerApplication & { asOf: string }> {
    return (await this.http.request<PartnerApplication & { asOf: string }>('GET', `partner/applications/${encodeURIComponent(id)}`, { signal })).data;
  }
}

class PartnerDecide {
  constructor(private readonly http: HttpClient) {}
  async review(id: string, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/review`, { idempotencyKey })).data;
  }
  async approve(id: string, input: { amountApprovedMinor: string; coolingOffHours?: number }, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/approve`, { idempotencyKey, body: input })).data;
  }
  async reject(id: string, input: { note?: string }, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/reject`, { idempotencyKey, body: input })).data;
  }
  /** ALWAYS refused (403 PARTNER_CANNOT_DISBURSE): the FPO is the lender of record and disburses from its console. */
  async disburse(id: string, idempotencyKey: string): Promise<never> {
    await this.http.request('POST', `partner/applications/${encodeURIComponent(id)}/disburse`, { idempotencyKey });
    throw new Error('partner.decide.disburse: the API refuses a partner disbursal');
  }
}

class PartnerTeamApi {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<PartnerTeam> { return (await this.http.request<PartnerTeam>('GET', 'partner/team', { signal })).data; }
  async invite(input: { phone: string; roleCode: PartnerRoleCode; languageCode?: 'en' | 'hi' | 'gu' }, idempotencyKey: string): Promise<PartnerInviteCreated> {
    return (await this.http.request<PartnerInviteCreated>('POST', 'partner/team/invites', { idempotencyKey, body: input })).data;
  }
  async revokeInvite(id: string, reason: string): Promise<{ id: string; status: 'revoked' }> {
    return (await this.http.request<{ id: string; status: 'revoked' }>('POST', `partner/team/invites/${encodeURIComponent(id)}/revoke`, { body: { reason } })).data;
  }
  async removeMember(membershipId: string, reason: string): Promise<{ id: string; active: false; sessionsEnded: number }> {
    return (await this.http.request<{ id: string; active: false; sessionsEnded: number }>('POST', `partner/team/members/${encodeURIComponent(membershipId)}/remove`, { body: { reason } })).data;
  }
}

class PartnerInvites {
  constructor(private readonly http: HttpClient) {}
  async lookup(token: string): Promise<PartnerInviteLookup> {
    return (await this.http.request<PartnerInviteLookup>('GET', `partner/invites/${encodeURIComponent(token)}`, { anonymous: true })).data;
  }
  /** Accept: the token AND the OTP sent to the INVITED phone → a partner session. Anonymous. */
  async accept(input: { token: string; phone: string; code: string; fullName?: string }): Promise<AuthTokens & { invite: { id: string; roleCode: string } }> {
    return (await this.http.request<AuthTokens & { invite: { id: string; roleCode: string } }>('POST', 'partner/invites/accept', { anonymous: true, body: input })).data;
  }
}

class PartnerMe2fa {
  constructor(private readonly http: HttpClient) {}
  async state(): Promise<{ enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }> {
    return (await this.http.request<{ enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }>('GET', 'partner/me/2fa')).data;
  }
  async enrol(): Promise<{ secret: string; otpauthUri: string; shownOnce: true }> {
    return (await this.http.request<{ secret: string; otpauthUri: string; shownOnce: true }>('POST', 'partner/me/2fa/enrol')).data;
  }
  async confirm(code: string): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    return (await this.http.request<{ confirmed: true; recoveryCodes: string[] }>('POST', 'partner/me/2fa/confirm', { body: { code } })).data;
  }
}

export class PartnerResource {
  readonly auth: PartnerAuth;
  readonly applications: PartnerApplications;
  readonly decide: PartnerDecide;
  readonly team: PartnerTeamApi;
  readonly invites: PartnerInvites;
  readonly twoFactor: PartnerMe2fa;
  constructor(private readonly http: HttpClient) {
    this.auth = new PartnerAuth(http); this.applications = new PartnerApplications(http); this.decide = new PartnerDecide(http);
    this.team = new PartnerTeamApi(http); this.invites = new PartnerInvites(http); this.twoFactor = new PartnerMe2fa(http);
  }
  /** The organisation and the signed-in person. */
  async me(signal?: AbortSignal): Promise<PartnerMe> { return (await this.http.request<PartnerMe>('GET', 'partner/me', { signal })).data; }
}
