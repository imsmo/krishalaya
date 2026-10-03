// @krishalaya/sdk-js · tenant integrations — PC-56 TENANT-13c (W187 + W2643–W2649). One typed method per route of `/v1/integrations`
// (every route, reads included, needs `api.manage` OR `tenant.settings`).
//
//   • a provider is `ownable` (razorpay, gupshup, inaph — the platform allow-list) or `managed` (agmarknet, pfms, pmkisan, …): a managed
//     provider is refused BY NAME (`INTEGRATION_PROVIDER_NOT_OWNABLE`) and can never be connected;
//   • every change — connect, rotate, disconnect — is a PROPOSAL a different tenant_admin confirms. A connect / rotate credential is
//     verified against the provider in shadow when proposed (a failure stores nothing anywhere: `INTEGRATION_VERIFY_FAILED` with its
//     class auth / network / unknown) and AGAIN on confirm, and is vaulted only then. The credential is sent once and never returned;
//   • a connection's status is `verified` / `verify_failed` / `disconnected` / `unverified` — NEVER "active": `consumers` lists the
//     platform paths that read it, and it is EMPTY today (payments and SMS run on platform accounts); `directSettlement` is refused;
//   • Health (24 h) is a count of real verification checks and the last good instant — never a percentage of calls;
//   • `maskedRef` (`…••41`) is the only form of the vault reference that ever leaves the API.
import { HttpClient } from '../http';

export type IntegrationKind = 'connect' | 'rotate' | 'disconnect';
export type IntegrationConnectionStatus = 'unverified' | 'verified' | 'verify_failed' | 'disconnected';
export type IntegrationProposalStatus = 'proposed' | 'confirmed' | 'applied' | 'verify_failed' | 'refused' | 'expired';
export type IntegrationVerifyClass = 'auth' | 'network' | 'unknown';
export interface IntegrationRefusal { field: string | null; code: string; detail?: string }

export interface IntegrationProvider {
  code: string; name: string; category: string; ownable: boolean; managed: boolean; verifyMethod: string | null; verifiable: boolean;
  credentialFields: { name: string; secret: boolean }[]; consumers: string[];
}
export interface IntegrationVerifyResult { ok: boolean; errorClass: IntegrationVerifyClass | null; detail: string; httpStatus: number | null; durationMs: number; at: string }
export interface IntegrationHealth { checks24h: number; ok24h: number; failed24h: number; lastOkAt: string | null; lastCheckAt: string | null }
export interface TenantIntegration {
  id: string; providerCode: string; providerName: string | null; category: string | null; config: Record<string, unknown>;
  maskedRef: string | null; credentialHint: string | null; status: IntegrationConnectionStatus; verifiedAt: string | null;
  verifyResult: IntegrationVerifyResult | null; lastCheckedAt: string | null; disconnectedAt: string | null; disconnectReason: string | null;
  createdAt: string | null; health: IntegrationHealth; consumers: string[];
  disconnect: { blockedByInFlightSettlements: false; reason: 'no_platform_path_reads_it' };
}
export interface IntegrationProposal {
  id: string; providerCode: string; providerName: string | null; kind: IntegrationKind; credentialHint: string | null; config: Record<string, unknown>;
  shadowResult: IntegrationVerifyResult | null; reason: string; proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string;
  status: IntegrationProposalStatus; confirmedBy: string | null; confirmedAt: string | null; outcome: IntegrationVerifyResult | null; closedAt: string | null;
  refusedBy: string | null; refuseReason: string | null; youProposed: boolean; canConfirm: boolean; canRefuse: boolean;
}
export interface IntegrationList {
  items: TenantIntegration[]; providers: IntegrationProvider[]; proposals: IntegrationProposal[];
  count: { providers: number; ownable: number; connected: number };
  platformDefaults: { payments: 'platform_account'; sms: 'platform_route'; inUse: boolean };
  directSettlement: { available: false; reason: 'law9_own_wave' };
}
export interface IntegrationProposalInput {
  providerCode: string; kind: IntegrationKind; credential?: Record<string, string>; config?: Record<string, string | number | boolean>; reason: string;
}
export interface IntegrationReview {
  ready: boolean; refusals: IntegrationRefusal[]; provider: IntegrationProvider | null; kind: IntegrationKind | null; willVerifyInShadow: boolean;
  connection: TenantIntegration | null;
}
export interface IntegrationProposed { id: string; providerCode: string; kind: IntegrationKind; status: 'proposed'; credentialHint: string | null; shadowResult: IntegrationVerifyResult | null }
export interface IntegrationConfirmed {
  proposalId: string; providerCode: string; kind: IntegrationKind; status: 'applied' | 'verify_failed';
  connectionStatus?: 'verified' | 'disconnected'; integrationId?: string | null; result?: IntegrationVerifyResult;
}

export class IntegrationsResource {
  constructor(private readonly http: HttpClient) {}

  /** The catalogue: every provider, ownable or platform-managed. */
  async providers(signal?: AbortSignal): Promise<IntegrationProvider[]> {
    return (await this.http.request<IntegrationProvider[]>('GET', 'integrations/providers', { signal })).data;
  }
  /** W187 — connections (masked), providers, open proposals, the count, platform defaults, direct settlement (refused). */
  async list(signal?: AbortSignal): Promise<IntegrationList> {
    return (await this.http.request<IntegrationList>('GET', 'integrations', { signal })).data;
  }
  /** W2644 — the review. Writes nothing, calls no provider. */
  async preview(input: Partial<IntegrationProposalInput>): Promise<IntegrationReview> {
    return (await this.http.request<IntegrationReview>('POST', 'integrations/preview', { body: input })).data;
  }
  /** W2645 — propose (keyed). The credential is verified in shadow now; on failure nothing is stored. */
  async propose(input: IntegrationProposalInput, idempotencyKey: string): Promise<IntegrationProposed> {
    return (await this.http.request<IntegrationProposed>('POST', 'integrations/proposals', { idempotencyKey, body: input })).data;
  }
  async proposals(q: { status?: IntegrationProposalStatus | 'open'; providerCode?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: IntegrationProposal[]; nextCursor: string | null }> {
    return (await this.http.request<{ items: IntegrationProposal[]; nextCursor: string | null }>('GET', 'integrations/proposals', { query: q, signal })).data;
  }
  async proposal(id: string, signal?: AbortSignal): Promise<IntegrationProposal> {
    return (await this.http.request<IntegrationProposal>('GET', `integrations/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** W2647/W2648 — confirm (a different tenant_admin; keyed): verify again → vault → write, or verify_failed with nothing stored. */
  async confirm(id: string, idempotencyKey: string): Promise<IntegrationConfirmed> {
    return (await this.http.request<IntegrationConfirmed>('POST', `integrations/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<{ proposalId: string; status: 'refused' }> {
    return (await this.http.request<{ proposalId: string; status: 'refused' }>('POST', `integrations/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }
}
