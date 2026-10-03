// @krishalaya/sdk-js · tenant API keys — PC-56 TENANT-13c (W190 + W2488–W2494). One typed method per route of `/v1/api-keys` (all need
// `api.manage`; behind the `tenant_api` flag; issuing needs the `api_access` plan feature).
//
//   • the full key (`kv_live_<8>_<32>`) is returned by `create` ONLY, in the response body, ONCE (`keyShown: true`). A replayed
//     Idempotency-Key answers `key: null, keyShown: false` — the platform stores sha256(secret) and nothing it could re-read;
//     a caller must NEVER put the key in a URL, a log line or a cookie;
//   • a key carrying a checker scope (`members.read.pii`) is issued WAITING with a proposal; it works only after a DIFFERENT
//     administrator confirms (`confirm`), and a refusal / 7 days unconfirmed revokes it;
//   • revocation is permanent and takes effect on the next call (`contract.revocationBoundSeconds` is the printed ceiling);
//   • `list()` returns the scope catalogue and the issuing contract AS BUILT — print them, do not retype them.
import { HttpClient } from '../http';

export type ApiKeyStatus = 'waiting_checker' | 'active' | 'revoked' | 'expired';
export type ApiKeyProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired';
export interface ApiKeyRefusal { field: string | null; code: string; detail?: string }
export interface ApiScopeEntry { code: string; kind: 'read' | 'write'; checker: boolean; description: string; routes: string[] }
export interface ApiKeyContract {
  keyFormat: string; sandbox: false; storedAs: 'sha256'; shownOnce: true; rate: { default: number; min: number; max: number };
  revocationBoundSeconds: number; idempotencyRequiredOnWrites: true; proposalTtlDays: number;
}
export interface ApiAccess { enabled: boolean; source: 'override' | 'plan' | 'none'; planCode: string | null }
export interface ApiKeyView {
  id: string; name: string; keyPrefix: string; scopes: string[]; ratePerHour: number; lastUsedAt: string | null; status: ApiKeyStatus;
  createdAt: string; createdBy: string | null; createdByName: string | null; expiresAt: string | null; activatedAt: string | null;
  checker: { userId: string; name: string | null } | null; revokedAt: string | null; revokedReason: string | null; revokedByPlatform: boolean;
  proposal: { id: string; status: string | null } | null; canRevoke: boolean;
}
export interface ApiKeyProposal {
  id: string; apiKeyId: string; keyPrefix: string; keyName: string; scopes: string[]; reason: string; proposedBy: string; proposedByName: string | null;
  proposedAt: string; expiresAt: string; status: ApiKeyProposalStatus; confirmedBy: string | null; confirmedAt: string | null; refusedBy: string | null;
  refuseReason: string | null; canConfirm: boolean; canRefuse: boolean; youProposed: boolean; routes?: string[];
}
export interface ApiKeyList {
  items: ApiKeyView[]; total: number; active: number; nextCursor: string | null; access: ApiAccess; catalogue: ApiScopeEntry[];
  contract: ApiKeyContract; proposals: ApiKeyProposal[];
}
export interface ApiKeyDraft { name: string; scopes: string[]; ratePerHour?: number; expiresAt?: string | null; reason?: string }
export interface ApiKeyReview {
  ready: boolean; refusals: ApiKeyRefusal[]; checker: boolean; access: ApiAccess; routes: string[];
  draft: { name: string; scopes: string[]; ratePerHour: number; expiresAt: string | null; reason: string };
  scopes: { code: string; kind: 'read' | 'write'; checker: boolean }[];
}
export interface ApiKeyCreated {
  id: string; name: string; keyPrefix: string; scopes: string[]; ratePerHour: number; expiresAt: string | null; status: ApiKeyStatus; proposalId: string | null;
  /** shown ONCE; null on a replayed key */
  key: string | null; keyShown: boolean;
}
export interface ApiKeyRevoked { id: string; keyPrefix: string; status: 'revoked'; revokedAt: string | null; effectiveWithinSeconds: number }

export class ApiKeysResource {
  constructor(private readonly http: HttpClient) {}

  /** W190 — keys (never a hash or a secret), the count, plan access, the catalogue, waiting proposals, the contract. µs keyset. */
  async list(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ApiKeyList> {
    return (await this.http.request<ApiKeyList>('GET', 'api-keys', { query: q, signal })).data;
  }
  async scopes(signal?: AbortSignal): Promise<{ scopes: ApiScopeEntry[]; contract: ApiKeyContract }> {
    return (await this.http.request<{ scopes: ApiScopeEntry[]; contract: ApiKeyContract }>('GET', 'api-keys/scopes', { signal })).data;
  }
  /** W2489 — the review: refusals per field, the exact routes unlocked, whether a checker is needed. Writes nothing. */
  async preview(draft: Partial<ApiKeyDraft>): Promise<ApiKeyReview> {
    return (await this.http.request<ApiKeyReview>('POST', 'api-keys/preview', { body: draft })).data;
  }
  /** W2490 — issue (keyed). The key is in THIS response, once. */
  async create(draft: ApiKeyDraft, idempotencyKey: string): Promise<ApiKeyCreated> {
    return (await this.http.request<ApiKeyCreated>('POST', 'api-keys', { idempotencyKey, body: draft })).data;
  }
  /** W2493 — revoke (keyed, reason required, permanent). */
  async revoke(id: string, reason: string, idempotencyKey: string): Promise<ApiKeyRevoked> {
    return (await this.http.request<ApiKeyRevoked>('POST', `api-keys/${encodeURIComponent(id)}/revoke`, { idempotencyKey, body: { reason } })).data;
  }
  async proposals(q: { status?: ApiKeyProposalStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ApiKeyProposal[]; nextCursor: string | null }> {
    return (await this.http.request<{ items: ApiKeyProposal[]; nextCursor: string | null }>('GET', 'api-keys/proposals', { query: q, signal })).data;
  }
  async proposal(id: string, signal?: AbortSignal): Promise<ApiKeyProposal> {
    return (await this.http.request<ApiKeyProposal>('GET', `api-keys/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** A DIFFERENT tenant_admin confirms a waiting key (keyed). */
  async confirm(id: string, idempotencyKey: string): Promise<{ proposalId: string; apiKeyId: string; keyPrefix: string; status: 'active' }> {
    return (await this.http.request<{ proposalId: string; apiKeyId: string; keyPrefix: string; status: 'active' }>('POST', `api-keys/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<{ proposalId: string; apiKeyId: string; status: 'refused' }> {
    return (await this.http.request<{ proposalId: string; apiKeyId: string; status: 'refused' }>('POST', `api-keys/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }
}
