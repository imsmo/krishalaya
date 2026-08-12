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
  // ---- PC-56 TENANT-3b: W140's console, W141's money card, and the refund maker-checker plane ----
  /** W140's four KPI cards + tab counts (dispute.resolve — tenant-wide figures, not one party's own cases). */
  async consoleKpis(signal?: AbortSignal): Promise<{ kpis: DisputeKpis; counts: Record<string, number> }> {
    return (await this.http.request<{ kpis: DisputeKpis; counts: Record<string, number> }>('GET', 'disputes/console/kpis', { signal })).data;
  }
  /** W140's table, one tab at a time. Keyset only — there is no page number to ask for. */
  async consoleList(params: { view?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DisputeQueueRow>> {
    const r = await this.http.request<DisputeQueueRow[]>('GET', 'disputes/console/list', { query: { view: params.view, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** W141's money card. Reports what is ACTUALLY held, with its basis — see the api's dispute-money-state.ts for
   *  why this does not repeat the canon's "only this amount is frozen". */
  async money(id: string, signal?: AbortSignal): Promise<DisputeMoneyState | null> {
    return (await this.http.request<DisputeMoneyState | null>('GET', `disputes/${encodeURIComponent(id)}/money`, { signal })).data;
  }
  /** The refund gate for an amount, as a read: what stands between this refund and the money moving. */
  async refundState(id: string, amountMinor: string, signal?: AbortSignal): Promise<RefundGateState> {
    return (await this.http.request<RefundGateState>('GET', `disputes/${encodeURIComponent(id)}/refund-state`, { query: { amountMinor }, signal })).data;
  }

  /** BUYER action (PC-24b): raise a dispute against an order (needs dispute.raise; eligibility — own order,
   * legal window — enforced in the service). Idempotency-Key required (Law 3). reasonCode is the server enum.
   * `disputedAmountMinor`/`disputedQuantity` are W141's disputed SCOPE (0139) — optional, and absent means
   * "not recorded", never "the whole order". */
  async raise(input: { orderId: string; reasonCode: string; description?: string; disputedAmountMinor?: string; disputedQuantity?: string }, idempotencyKey: string): Promise<Dispute> {
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


// ---------------------------------------------------------------------------
// PC-56 TENANT-3b · the refund maker-checker plane (api: modules/disputes, schema 0139)
// ---------------------------------------------------------------------------
export interface DisputeKpis {
  activeCount: number; activeUnder24h: number; escalatedCount: number;
  /** null = NOTHING CLOSED IN THE WINDOW. Never render a 0 here — it reads as "we resolve instantly". */
  medianResolutionHours: number | null;
  resolvedInWindow: number;
  outcomes: { raiser: number; respondent: number; amicable: number; noDecision: number };
  outcomeUnknownParty: number; windowDays: number;
}
export interface DisputeQueueRow {
  id: string; status: string; reasonCode: string | null; orderId: string; orderNo: string | null;
  raisedBy: string; raisedByName: string | null; againstUser: string; againstUserName: string | null;
  disputedAmountMinor: string | null; disputedQuantity: string | null; currencyCode: string | null;
  slaDueAt: string | null; sellerRespondBy: string | null; createdAt: string;
  aiTriageConfidence: string | null; aiTriageClassification: string | null; pendingApprovalId: string | null;
}
export interface DisputeMoneyState {
  orderId: string; orderNo: string | null; currencyCode: string | null;
  /** escrow_holds_order_gross | settled_to_seller_before_dispute | no_escrowed_payment */
  basis: string;
  heldMinor: string | null; disputedMinor: string | null; disputedQuantity: string | null;
  scopeRecorded: boolean; undisputedMinor: string | null;
  /** TRUE when the undisputed remainder is held too — the sentence W141 does not have. */
  undisputedHeldToo: boolean;
  maxRefundableMinor: string | null; resolutionAmountMinor: string | null; resolutionTxnId: string | null;
}
export interface RefundGateState {
  /** single_signature | needs_proposal | awaiting_checker | rejected_by_checker | ready | amount_changed | already_applied */
  gate: string;
  approvalId: string | null; thresholdMinor: string; usedDefaultThreshold: boolean;
}
export interface RefundApproval {
  id: string; subjectType: 'dispute' | 'return'; subjectId: string; orderId: string;
  amountMinor: string; resolutionType: string | null; status: 'pending' | 'approved' | 'rejected' | 'applied';
  proposedBy: string; proposedAt: string; proposalNote: string; thresholdMinor: string;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; appliedAt: string | null;
}

/** Propose → decide → (the refund applies it). W140/W141/W142's "maker-checker >= Rs 10,000", which nothing
 *  enforced before TENANT-3b. Proposing needs dispute.resolve; DECIDING needs order.refund and a different human. */
export class RefundApprovalsResource {
  constructor(private readonly http: HttpClient) {}
  async propose(input: { subjectType: 'dispute' | 'return'; subjectId: string; amountMinor: string; resolutionType?: 'refund_full' | 'refund_partial'; note: string }): Promise<RefundApproval & { needsChecker: boolean; usedDefaultThreshold: boolean }> {
    return (await this.http.request<RefundApproval & { needsChecker: boolean; usedDefaultThreshold: boolean }>('POST', 'refund-approvals', { body: input })).data;
  }
  async decide(id: string, input: { decision: 'approved' | 'rejected'; note?: string }): Promise<RefundApproval> {
    return (await this.http.request<RefundApproval>('POST', `refund-approvals/${encodeURIComponent(id)}/decision`, { body: input })).data;
  }
  /** The checker queue — OLDEST FIRST (a refund waiting three days is the one that matters). Keyset. */
  async pending(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<RefundApproval>> {
    const r = await this.http.request<RefundApproval[]>('GET', 'refund-approvals', { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async history(subjectType: 'dispute' | 'return', subjectId: string, signal?: AbortSignal): Promise<RefundApproval[]> {
    return (await this.http.request<RefundApproval[]>('GET', `refund-approvals/${subjectType}/${encodeURIComponent(subjectId)}`, { signal })).data;
  }
}
