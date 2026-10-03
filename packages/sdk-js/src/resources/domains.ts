// @krishalaya/sdk-js · domains — PC-56 TENANT-13d (W192 + W2591–W2597). One typed method per route of `/v1/tenants/me/domains` (every one
// needs `tenant.settings`, reads included; behind the `tenant_domains` flag). Founder decision: DOMAIN BY PLAN (custom_domain); CNAME + TXT
// PROOF; PLATFORM EDGE; HOST ROUTING; ACME LATER.
//   • the included subdomain is on every plan, verified by construction, permanent; its TLS is `issued` only when the platform wildcard
//     certificate is configured — print `tls.note` when it is not;
//   • a custom domain is a CLAIM: add the exact `verification.records`; the platform checks every 5 minutes (`recheck()` once a minute);
//     unproven after 7 days it is released. Custom-domain TLS stays `pending` — issuance is not built (`tls.note` says so);
//   • make primary / remove are PROPOSALS a second administrator confirms; removing the primary needs a verified successor.
import { HttpClient } from '../http';

export interface DnsRecord { type: 'CNAME' | 'TXT'; name: string; value: string }
export interface TenantDomainView {
  id: string; domain: string; kind: 'included' | 'custom'; isPrimary: boolean;
  tls: { status: 'pending' | 'issued' | 'failed'; note: string | null };
  verification: { status: 'pending' | 'verified' | 'failed' | 'expired'; verifiedAt: string | null; lastCheckedAt: string | null; error: string | null;
                  expiresAt: string | null; token: string | null; records: DnsRecord[]; checksEvery: string; recheckAvailableInMs: number };
  createdAt: string;
}
export interface DomainProposalView {
  id: string; kind: 'make_primary' | 'remove'; domainId: string; domain: string; successorDomainId: string | null; successorDomain: string | null;
  reason: string; status: 'proposed' | 'confirmed' | 'refused' | 'expired'; proposedBy: string; proposedByName: string | null; proposedAt: string;
  expiresAt: string; confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null; refusedBy: string | null; refusedAt: string | null;
  refuseReason: string | null; expiredAt: string | null; youProposed: boolean; canConfirm: boolean; canRefuse: boolean; admins?: number;
}
export interface DomainList {
  items: TenantDomainView[]; counts: { total: number; custom: number; verified: number };
  plan: { customDomain: boolean; planCode: string | null; plansWith: string[] };
  platform: { edgeHostname: string; includedSuffix: string; wildcardTlsReady: boolean };
  tls: { customIssuance: 'not_built'; note: string };
  steps: Array<{ n: number; code: string; built: unknown; note?: string }>;
  proposals: DomainProposalView[]; admins: { count: number; youAreAdmin: boolean };
}
export interface DomainAddReview {
  domain: string | null; ready: boolean; refusals: Array<{ field: string | null; code: string; detail?: Record<string, unknown> }>;
  records: DnsRecord[]; edgeHostname: string; claimWindowDays: number; checksEvery: string; tls: { note: string };
}
export interface DomainProposalInput { kind: 'make_primary' | 'remove'; domainId: string; successorDomainId?: string | null; reason: string }

export class DomainsResource {
  constructor(private readonly http: HttpClient) {}
  async list(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<DomainList & { nextCursor: string | null }> {
    const r = await this.http.request<DomainList>('GET', 'tenants/me/domains', { query: q, signal });
    return { ...r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null };
  }
  /** W2592 — plan first, reserved, claimed elsewhere, the exact records (writes nothing). */
  async preview(input: { domain: string; reason?: string | null }): Promise<DomainAddReview> {
    return (await this.http.request<DomainAddReview>('POST', 'tenants/me/domains/preview', { body: input })).data;
  }
  /** W2593 — add a custom claim (keyed). */
  async add(input: { domain: string; reason: string }, idempotencyKey: string): Promise<TenantDomainView & { audit: { entityType: string; entityId: string; action: string } }> {
    return (await this.http.request<TenantDomainView & { audit: { entityType: string; entityId: string; action: string } }>('POST', 'tenants/me/domains', { body: input, idempotencyKey })).data;
  }
  async recheck(id: string): Promise<{ outcome: 'verified' | 'failed' | 'expired' | 'skipped'; domain: TenantDomainView | null }> {
    return (await this.http.request<{ outcome: 'verified' | 'failed' | 'expired' | 'skipped'; domain: TenantDomainView | null }>('POST', `tenants/me/domains/${encodeURIComponent(id)}/recheck`, { body: {} })).data;
  }
  async proposals(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: DomainProposalView[]; nextCursor: string | null }> {
    const r = await this.http.request<DomainProposalView[]>('GET', 'tenants/me/domains/proposals', { query: q, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null };
  }
  async proposal(id: string, signal?: AbortSignal): Promise<DomainProposalView> {
    return (await this.http.request<DomainProposalView>('GET', `tenants/me/domains/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** W2595 — propose make primary / remove (keyed). */
  async propose(input: DomainProposalInput, idempotencyKey: string): Promise<DomainProposalView> {
    return (await this.http.request<DomainProposalView>('POST', 'tenants/me/domains/proposals', { body: input, idempotencyKey })).data;
  }
  /** W2596 — a DIFFERENT administrator confirms; applied in the same transaction (keyed). */
  async confirm(id: string, idempotencyKey: string): Promise<{ id: string; kind: string; domain: string; successorDomain: string | null; status: 'confirmed'; audit: { entityType: string; entityId: string; action: string } }> {
    return (await this.http.request<{ id: string; kind: string; domain: string; successorDomain: string | null; status: 'confirmed'; audit: { entityType: string; entityId: string; action: string } }>(
      'POST', `tenants/me/domains/proposals/${encodeURIComponent(id)}/confirm`, { body: {}, idempotencyKey })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'refused' }> {
    return (await this.http.request<{ id: string; status: 'refused' }>('POST', `tenants/me/domains/proposals/${encodeURIComponent(id)}/refuse`, { body: { reason }, idempotencyKey })).data;
  }
}
