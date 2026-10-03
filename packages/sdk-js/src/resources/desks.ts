// @krishalaya/sdk-js · desks (W185) — PC-56 TENANT-13b. One typed method per route of `/v1/desks` (every one needs `desk.manage`).
//
// Founder decision: TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE.
//   • `board()` — the cards AS BUILT: members, codes, each canon label MAPPED to a real permission or REFUSED by name, the honest
//     guarantees (built or not), the grantable list, pending proposals, the labour suggestion (a real count, or null);
//   • create / edit permissions / disable / enable / install templates are PROPOSALS a second tenant_admin confirms (`confirm`); the
//     database refuses the proposer; `preview()` is W2575's diff;
//   • members are a direct act (`addMember` / `removeMember`, the latter with a reason).
import { HttpClient } from '../http';

export type DeskProposalKind = 'create' | 'edit' | 'disable' | 'enable' | 'install_templates';
export type DeskProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired';
export type DeskCodeVerdict = 'grantable' | 'ungrantable' | 'not_held' | 'unknown';
export interface DeskRefusal { field: string | null; code: string; detail?: Record<string, unknown> }
export interface DeskDiff { add: string[]; remove: string[]; members: { add: string[]; remove: string[] }; code?: string; name?: string; description?: string | null; templateCode?: string | null; status?: 'active' | 'disabled'; desks?: Array<{ code: string; name: string; templateCode: string; permissions: string[] }> }
export interface DeskProposalView {
  id: string; kind: DeskProposalKind; deskId: string | null; diff: DeskDiff; reason: string; proposedBy: string; proposedByName: string | null;
  proposedAt: string; expiresAt: string; status: DeskProposalStatus; confirmedBy: string | null; confirmedAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null;
  youProposed: boolean; canConfirm: boolean; canRefuse: boolean; reGranted?: number;
}
export interface DeskMember { userId: string; name: string | null; addedBy: string; addedAt: string }
export interface DeskView {
  id: string; code: string; name: string; description: string | null; templateCode: string | null; status: 'active' | 'disabled';
  createdBy: string; confirmedBy: string; createdAt: string; disabledAt: string | null;
  permissions: string[]; members: DeskMember[]; pendingProposal: DeskProposalView | null;
}
export type DeskTemplateLabel =
  | { label: string; kind: 'mapped'; code: string; grant: DeskCodeVerdict; noteKey: string | null }
  | { label: string; kind: 'refused'; reasonKey: 'no_route' | 'rides_other'; ridesOn: string | null };
export interface DeskTemplateView {
  code: string; installed: boolean; inLookup: boolean; labels: DeskTemplateLabel[];
  guarantees: Array<{ key: string; built: boolean; evidence: string }>; installs: string[];
}
export interface DeskBoard {
  desks: DeskView[]; templates: DeskTemplateView[]; grantable: string[]; pending: DeskProposalView[];
  suggestion: { template: 'labour'; season: 'kharif' | 'rabi' | 'zaid'; adminBookings: number; from: string; to: string } | null;
  admins: { count: number; youAreAdmin: boolean };
  people: Array<{ userId: string; name: string | null; roles: string[] }>;
}
export interface DeskProposalInput {
  kind: DeskProposalKind; deskId?: string | null; code?: string | null; name?: string | null; description?: string | null;
  templateCode?: string | null; permissions?: string[] | null; members?: { add?: string[]; remove?: string[] } | null; reason?: string | null;
}
export interface DeskReview {
  kind: DeskProposalKind; desk: Omit<DeskView, 'permissions' | 'members' | 'pendingProposal'> | null; before: string[]; after: string[];
  diff: DeskDiff; reGranted: number; admins: number; confirmer: { rule: 'a_different_tenant_admin'; admins: number };
  ready: boolean; refusals: DeskRefusal[];
}

export class DesksResource {
  constructor(private readonly http: HttpClient) {}
  async board(signal?: AbortSignal): Promise<DeskBoard> { return (await this.http.request<DeskBoard>('GET', 'desks', { signal })).data; }
  async preview(input: DeskProposalInput, signal?: AbortSignal): Promise<DeskReview> {
    return (await this.http.request<DeskReview>('POST', 'desks/preview', { body: input, signal })).data;
  }
  async proposals(params: { status?: DeskProposalStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: DeskProposalView[]; nextCursor: string | null }> {
    const r = await this.http.request<DeskProposalView[]>('GET', 'desks/proposals', { query: { status: params.status, cursor: params.cursor, limit: params.limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async proposal(id: string, signal?: AbortSignal): Promise<DeskProposalView & { desk: DeskReview['desk']; admins: number }> {
    return (await this.http.request<DeskProposalView & { desk: DeskReview['desk']; admins: number }>('GET', `desks/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  async propose(input: DeskProposalInput, idempotencyKey: string): Promise<DeskProposalView> {
    return (await this.http.request<DeskProposalView>('POST', 'desks/proposals', { idempotencyKey, body: input })).data;
  }
  async confirm(id: string, idempotencyKey: string): Promise<DeskProposalView> {
    return (await this.http.request<DeskProposalView>('POST', `desks/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<DeskProposalView> {
    return (await this.http.request<DeskProposalView>('POST', `desks/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }
  async addMember(deskId: string, userId: string, reason: string | null, idempotencyKey: string): Promise<{ deskId: string; userId: string; grants: string[] }> {
    return (await this.http.request<{ deskId: string; userId: string; grants: string[] }>('POST', `desks/${encodeURIComponent(deskId)}/members`, { idempotencyKey, body: { userId, reason } })).data;
  }
  async removeMember(deskId: string, userId: string, reason: string, idempotencyKey: string): Promise<{ deskId: string; userId: string }> {
    return (await this.http.request<{ deskId: string; userId: string }>('POST', `desks/${encodeURIComponent(deskId)}/members/${encodeURIComponent(userId)}/remove`, { idempotencyKey, body: { reason } })).data;
  }
}
