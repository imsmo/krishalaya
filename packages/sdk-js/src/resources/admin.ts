// @krishalaya/sdk-js · tenant-admin-lite resources (P-17). RBAC role-assignments (the tenant's roster + the
// pending-approval queue) + APPROVE; disputes moderation (list/get/review/escalate/resolve); tenant users
// (read a member + admin-add a farmer); KYC review. EVERY action is authorized SERVER-SIDE by the tenant's own
// permissions (Report/Approve/dispute.resolve) — this is NOT god-mode (Law 11): a tenant admin only acts within
// their own tenant, the server re-checks tenant membership + permission on each call. Mutations carry an
// Idempotency-Key (Law 3). Money is bigint minor strings (Law 2).
import { HttpClient } from '../http';
import { RoleAssignment, RoleDef, PermissionDef, AssignRoleInput, StaffOverrideInput, Dispute, DisputeMessage, UserProfile, Page } from '../types';

export class RbacResource {
  constructor(private readonly http: HttpClient) {}
  /** Role assignments for the tenant. `pendingOnly` = the approval queue (147). Needs identity.report. */
  async assignments(params: { userId?: string; roleCode?: string; pendingOnly?: boolean } = {}, signal?: AbortSignal): Promise<RoleAssignment[]> {
    return (await this.http.request<RoleAssignment[]>('GET', 'rbac/assignments', { query: { userId: params.userId, roleCode: params.roleCode, pendingOnly: params.pendingOnly }, signal })).data;
  }
  /** Approve a pending assignment (e.g. a farmer joining the tenant). Needs identity.approve. */
  async approveAssignment(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `rbac/assignments/${encodeURIComponent(id)}/approve`, {})).data;
  }

  // --- staff-permissions matrix (P1-11) ---
  // The catalogue + assign/revoke/override. EVERY guard is SERVER-authoritative (Law 11): platform/owner roles are
  // NOT assignable via the tenant API; a staff override can never hand out `*`/money/god perms (UNGRANTABLE) nor
  // exceed what the granter holds. The app mirrors the *static* guards for UX only — it never relaxes the server.
  /** The tenant's role catalogue (platform-scope roles are returned but NOT assignable via this API). */
  async roles(params: { scope?: 'tenant' | 'platform'; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<RoleDef[]> {
    return (await this.http.request<RoleDef[]>('GET', 'rbac/roles', { query: { scope: params.scope, activeOnly: params.activeOnly }, signal })).data;
  }
  /** The permission catalogue (optionally one module). Used to render the role→permission matrix. */
  async permissions(moduleCode?: string, signal?: AbortSignal): Promise<PermissionDef[]> {
    return (await this.http.request<PermissionDef[]>('GET', 'rbac/permissions', { query: { moduleCode }, signal })).data;
  }
  /** Assign a (non-platform) role to a member. Idempotent (Law 3). Needs identity.approve. */
  async assign(input: AssignRoleInput, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'rbac/assignments', { idempotencyKey, body: input })).data;
  }
  /** Revoke a role assignment. Needs identity.approve. */
  async revoke(assignmentId: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('DELETE', `rbac/assignments/${encodeURIComponent(assignmentId)}`, {})).data;
  }
  /** Grant/deny a single permission on one assignment (a staff override). Server enforces the no-escalation rules. */
  async setOverride(input: StaffOverrideInput): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', 'rbac/overrides', { body: input })).data;
  }
}

export class DisputesResource {
  constructor(private readonly http: HttpClient) {}
  /** `box=all` = the tenant moderation view (needs dispute.resolve). Keyset. */
  async list(params: { box?: 'raised' | 'against' | 'all'; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Dispute>> {
    const r = await this.http.request<Dispute[]>('GET', 'disputes', { query: { box: params.box ?? 'all', status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Dispute> {
    return (await this.http.request<Dispute>('GET', `disputes/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Moderator: take the dispute under review. Needs dispute.resolve. */
  async review(id: string): Promise<Dispute> {
    return (await this.http.request<Dispute>('POST', `disputes/${encodeURIComponent(id)}/review`, {})).data;
  }
  async escalate(id: string): Promise<Dispute> {
    return (await this.http.request<Dispute>('POST', `disputes/${encodeURIComponent(id)}/escalate`, {})).data;
  }
  /** Resolve with a decision. `resolutionAmountMinor` is bigint minor (Law 2); refunds/reversals move money
   * SERVER-SIDE (the app never does, Law 11). Needs dispute.resolve. */
  async resolve(id: string, input: { resolutionType: string; resolutionAmountMinor?: string; note?: string }): Promise<Dispute> {
    return (await this.http.request<Dispute>('POST', `disputes/${encodeURIComponent(id)}/resolve`, { body: input })).data;
  }
  /** The append-only evidence/conversation thread for a dispute (author + body + time). Keyset. Party-vs-party +
   * moderator authority enforced SERVER-SIDE per row. */
  async messages(id: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DisputeMessage>> {
    const r = await this.http.request<DisputeMessage[]>('GET', `disputes/${encodeURIComponent(id)}/messages`, { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** BUYER action (PC-24b): raise a dispute against an order (needs dispute.raise; eligibility — own order,
   * legal window — enforced in the service). Idempotency-Key required (Law 3). reasonCode is the server enum. */
  async raise(input: { orderId: string; reasonCode: string; description?: string }, idempotencyKey: string): Promise<Dispute> {
    return (await this.http.request<Dispute>('POST', 'disputes', { idempotencyKey, body: input })).data;
  }
  /** PARTY action (PC-22): the respondent marks the dispute responded (seller_responded transition, 48h window).
   * The server enforces WHO may respond (assertParty) — a non-party gets 403, never client-guessed. */
  async respond(id: string): Promise<Dispute> {
    return (await this.http.request<Dispute>('POST', `disputes/${encodeURIComponent(id)}/respond`, {})).data;
  }
  /** PARTY/moderator action (PC-22): append one message to the evidence thread (≤4000 chars, server-validated). */
  async postMessage(id: string, body: string): Promise<DisputeMessage> {
    return (await this.http.request<DisputeMessage>('POST', `disputes/${encodeURIComponent(id)}/messages`, { body: { body } })).data;
  }
}

export class UsersResource {
  constructor(private readonly http: HttpClient) {}
  /** The signed-in caller's own profile (server resolves from the token — no id, no IDOR). */
  async me(signal?: AbortSignal): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('GET', 'users/me', { signal })).data;
  }
  /** Update the caller's own profile (PATCH /users/me). PII-minimal: name/gender/dob/language/email/photo. */
  async updateMe(patch: { fullName?: string; gender?: 'male' | 'female' | 'other' | 'undisclosed'; dob?: string; languageCode?: string; email?: string; photoMediaId?: string }): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('PATCH', 'users/me', { body: patch })).data;
  }
  /** Read a member of the tenant (tenant-scoped server-side; 404 for a non-member). Needs identity.report. */
  async get(id: string, signal?: AbortSignal): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('GET', `users/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Admin-add a farmer who can't self-register (idempotent). Needs identity.approve. PII-minimal payload. */
  async create(input: { phone: string; fullName?: string; languageCode?: string; countryCode?: string }, idempotencyKey: string): Promise<UserProfile> {
    return (await this.http.request<UserProfile>('POST', 'users', { idempotencyKey, body: input })).data;
  }
}
