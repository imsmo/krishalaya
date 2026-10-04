// @krishalaya/sdk-js · the team (W183 / W184) and the person's own security page (`/me/security`) — PC-56 TENANT-SW-c.
//
// Founder decisions: STAFF SEATS PER PLAN · SMS INVITE TOKEN · TOTP 2FA FOR STAFF · STAFF SELF-DECLARE CONFLICTS + ONBOARDER RULE.
//   • `team.*` needs `user.approve` (tenant_admin) — "Team restricted — only tenant_admin manages staff";
//   • an invite's raw token is in the `invite()` answer ONCE (a replayed key answers `token: null`); the SMS leaves through the outbox;
//   • `me.enrolTwoFactor()` answers the secret + otpauth URI ONCE; `confirmTwoFactor()` answers the 10 recovery codes ONCE.
import { HttpClient } from '../http';

export type SeatState =
  | { kind: 'limited'; used: number; seats: number; planName: string; full: boolean }
  | { kind: 'unlimited'; used: number; planName: string }
  | { kind: 'no_plan'; used: number }
  | { kind: 'not_defined'; used: number; planName: string };
export interface StaffRow {
  userId: string; name: string | null; roles: string[]; desks: Array<{ id: string; code: string; name: string }>; overrides: number;
  twoFactor: 'confirmed' | 'pending' | 'not_enrolled'; lastActiveAt: string | null; since: string; suspended: boolean;
}
export interface MakerCheckerPair { code: string; enforcedBy: string; makers: Array<{ userId: string; name: string | null }>; checkers: Array<{ userId: string; name: string | null }>; live: boolean }
export interface StaffInvite {
  id: string; phoneMasked: string; roleCode: string; deskIds: string[]; invitedBy: string; invitedByName: string | null; languageCode: string; channel: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked'; expiresAt: string; sentAt: string | null; sendFailure: string | null; acceptedUserId: string | null; acceptedAt: string | null;
  revokedBy: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string; live: boolean;
}
export interface OverrideProposal {
  id: string; userTenantRoleId: string; granteeUserId: string; granteeName: string | null; permissionCode: string; overrideExpiresAt: string | null; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string; status: 'proposed' | 'confirmed' | 'refused' | 'expired';
  confirmedBy: string | null; confirmedAt: string | null; refusedBy: string | null; refusedAt: string | null; refuseReason: string | null;
}
export interface TeamOverview {
  seats: SeatState; staff: StaffRow[]; nextCursor: string | null; pairs: MakerCheckerPair[]; pairsOver: number;
  invites: StaffInvite[]; proposals: OverrideProposal[]; staffRoles: string[]; invitesEnabled: boolean;
  /** The REAL bound on how fast a removed person's sessions end (the posture cache), and the access token's own TTL. */
  sessionEndBoundSec: number; accessTokenTtlSec: number;
}
export interface StaffOverride {
  userTenantRoleId: string; roleCode: string; permissionCode: string; isGranted: boolean; reason: string; grantedBy: string | null; grantedByName: string | null;
  grantedAt: string | null; expiresAt: string | null; revokedAt: string | null; revokedBy: string | null; revokeReason: string | null; proposalId: string | null;
  live: boolean; legacy: boolean;
}
export interface ConflictDeclaration {
  id: string; staffUserId: string; staffName: string | null; memberUserId: string; memberName: string | null; relation: 'family' | 'household' | 'business' | 'other';
  relationNote: string | null; reason: string; declaredBy: string; declaredVia: 'self' | 'admin'; active: boolean; createdAt: string;
  revokedBy: string | null; revokedAt: string | null; revokeReason: string | null;
}
export interface StaffDetail {
  userId: string; name: string | null; lastActiveAt: string | null; twoFactor: 'confirmed' | 'pending' | 'not_enrolled'; twoFactorConfirmedAt: string | null; suspended: boolean;
  assignments: Array<{ id: string; roleCode: string; isStaff: boolean; isActive: boolean; approvedAt: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string; createdBy: string | null }>;
  desks: Array<{ id: string; code: string; name: string; addedAt: string; addedBy: string }>;
  overrides: StaffOverride[]; conflicts: ConflictDeclaration[]; proposals: OverrideProposal[]; sessionCutoffAt: string | null;
  checkerCodes: Record<string, 'money' | 'pii'>; effectivePermissions: string[]; isSelf: boolean; sessionEndBoundSec: number; accessTokenTtlSec: number;
}
export interface InviteCreated {
  id: string; expiresAt: string; phoneMasked: string; roleCode: string; deskIds: string[]; days: number;
  /** Shown ONCE — null on a replayed key. */
  token: string | null; link: string | null; tokenShown: boolean;
}
export interface ConflictInput { memberUserId: string; relation: ConflictDeclaration['relation']; relationNote?: string; reason: string }

export class TeamResource {
  constructor(private readonly http: HttpClient) {}
  async overview(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<TeamOverview> {
    return (await this.http.request<TeamOverview>('GET', 'team', { query: { cursor: q.cursor, limit: q.limit ?? 25 }, signal })).data;
  }
  async staff(userId: string, signal?: AbortSignal): Promise<StaffDetail> {
    return (await this.http.request<StaffDetail>('GET', `team/staff/${encodeURIComponent(userId)}`, { signal })).data;
  }
  async invites(q: { status?: StaffInvite['status']; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: StaffInvite[]; nextCursor: string | null }> {
    const r = await this.http.request<StaffInvite[]>('GET', 'team/invites', { query: { status: q.status, cursor: q.cursor, limit: q.limit ?? 25 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async invite(input: { phone: string; roleCode: string; deskIds?: string[]; languageCode?: 'en' | 'hi' | 'gu' }, idempotencyKey: string): Promise<InviteCreated> {
    return (await this.http.request<InviteCreated>('POST', 'team/invites', { idempotencyKey, body: input })).data;
  }
  async revokeInvite(id: string, reason: string): Promise<{ id: string; status: 'revoked' }> {
    return (await this.http.request<{ id: string; status: 'revoked' }>('POST', `team/invites/${encodeURIComponent(id)}/revoke`, { body: { reason } })).data;
  }
  /** "Add staff directly" — the exception act (no invite), with a reason. */
  async addDirectly(input: { phone: string; fullName?: string; roleCode: string; deskIds?: string[]; reason: string }, idempotencyKey: string): Promise<{ userId: string; roleCode: string; desks: number }> {
    return (await this.http.request<{ userId: string; roleCode: string; desks: number }>('POST', 'team/staff', { idempotencyKey, body: input })).data;
  }
  async conflictsOf(userId: string, signal?: AbortSignal): Promise<ConflictDeclaration[]> {
    return (await this.http.request<ConflictDeclaration[]>('GET', `team/staff/${encodeURIComponent(userId)}/conflicts`, { signal })).data;
  }
  async declareConflictFor(userId: string, input: ConflictInput, idempotencyKey: string): Promise<{ id: string; via: 'admin' | 'self' }> {
    return (await this.http.request<{ id: string; via: 'admin' | 'self' }>('POST', `team/staff/${encodeURIComponent(userId)}/conflicts`, { idempotencyKey, body: input })).data;
  }
  async liftConflict(id: string, reason: string): Promise<{ id: string; active: false }> {
    return (await this.http.request<{ id: string; active: false }>('POST', `team/conflicts/${encodeURIComponent(id)}/lift`, { body: { reason } })).data;
  }
  async members(q = '', signal?: AbortSignal): Promise<Array<{ userId: string; name: string | null; roles: string[] }>> {
    return (await this.http.request<Array<{ userId: string; name: string | null; roles: string[] }>>('GET', 'team/members', { query: { q }, signal })).data;
  }
}

export interface TwoFactorState { enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }

/** The signed-in person's OWN security: 2FA and their conflict declarations. */
export class MeSecurityResource {
  constructor(private readonly http: HttpClient) {}
  async twoFactor(signal?: AbortSignal): Promise<TwoFactorState> {
    return (await this.http.request<TwoFactorState>('GET', 'me/2fa', { signal })).data;
  }
  async enrolTwoFactor(): Promise<{ secret: string; otpauthUri: string; shownOnce: true }> {
    return (await this.http.request<{ secret: string; otpauthUri: string; shownOnce: true }>('POST', 'me/2fa/enrol', {})).data;
  }
  async confirmTwoFactor(code: string): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    return (await this.http.request<{ confirmed: true; recoveryCodes: string[] }>('POST', 'me/2fa/confirm', { body: { code } })).data;
  }
  async disableTwoFactor(input: { code?: string; recoveryCode?: string; reason?: string }): Promise<{ disabled: true }> {
    return (await this.http.request<{ disabled: true }>('POST', 'me/2fa/disable', { body: input })).data;
  }
  async conflicts(signal?: AbortSignal): Promise<ConflictDeclaration[]> {
    return (await this.http.request<ConflictDeclaration[]>('GET', 'me/conflicts', { signal })).data;
  }
  async conflictMembers(q = '', signal?: AbortSignal): Promise<Array<{ userId: string; name: string | null; roles: string[] }>> {
    return (await this.http.request<Array<{ userId: string; name: string | null; roles: string[] }>>('GET', 'me/conflicts/members', { query: { q }, signal })).data;
  }
  async declareConflict(input: ConflictInput, idempotencyKey: string): Promise<{ id: string; via: 'self' }> {
    return (await this.http.request<{ id: string; via: 'self' }>('POST', 'me/conflicts', { idempotencyKey, body: input })).data;
  }
}
