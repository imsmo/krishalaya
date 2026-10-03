// @krishalaya/sdk-js · tenant self-config resource (P1-10). The seller-facing surface for a tenant admin to
// self-serve their own commission rules, delivery zones, branding + language settings — every call is the tenant's
// OWN tenant (server re-resolves the subject from the token; no id-from-request → no IDOR) and is RBAC-gated +
// audited SERVER-SIDE. Money rules stay server-authoritative: this never computes a fee, it only reads/edits rule
// rows (Law 2/11). Platform-default commission rows are read-only here. Creates are idempotent (Law 3).
import { HttpClient } from '../http';
import {
  CommissionRule, CreateCommissionRuleInput, CommissionRuleProposal, CommissionProposalStatus, CommissionPolicy, CommissionResolution,
  DeliveryZone, CreateDeliveryZoneInput, UpdateDeliveryZoneInput, ProposeZoneInput, DeliveryZoneProposal, ZoneServiceability, ZoneFeeDefinition,
  TenantSetting, TenantFeature, Page,
} from '../types';

export class TenantConfigResource {
  constructor(private readonly http: HttpClient) {}

  // ---- commission rules (PC-56 TENANT-SW-a, W149): owner + checker proposals; the platform share is the plan's ----
  /** The tenant's commission rules (its own; optionally the inherited platform defaults, read-only). Microsecond keyset.
   *  `platformShareBps` = the plan floor every tenant rule carries ("set by your plan"). */
  async commissionRules(params: { activeOnly?: boolean; includePlatformDefaults?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CommissionRule> & { platformShareBps: number | null }> {
    const r = await this.http.request<CommissionRule[]>('GET', 'commission-rules', {
      query: { activeOnly: params.activeOnly, includePlatformDefaults: params.includePlatformDefaults, cursor: params.cursor, limit: params.limit }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, platformShareBps: (r.meta?.platformShareBps as number | undefined) ?? null };
  }
  /** The plan floor + the earliest date a change may carry (next IST midnight + 7 days). */
  async commissionPolicy(signal?: AbortSignal): Promise<CommissionPolicy> {
    return (await this.http.request<CommissionPolicy>('GET', 'commission-rules/policy', { signal })).data;
  }
  /** W149's resolution example: which rule an order with these facts is charged under on a date (and after a proposal applies). */
  async commissionResolution(q: { source?: string; categoryId?: string; sellerRoleId?: string; onDate?: string; proposalId?: string } = {}, signal?: AbortSignal): Promise<CommissionResolution> {
    return (await this.http.request<CommissionResolution>('GET', 'commission-rules/resolution', { query: q, signal })).data;
  }
  async commissionProposals(params: { status?: CommissionProposalStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CommissionRuleProposal>> {
    const r = await this.http.request<CommissionRuleProposal[]>('GET', 'commission-rules/proposals', { query: params, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async commissionProposal(id: string, signal?: AbortSignal): Promise<CommissionRuleProposal> {
    return (await this.http.request<CommissionRuleProposal>('GET', `commission-rules/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Propose a NEW effective-dated rule. Needs `commission.manage`; a second tenant_admin confirms. Idempotent (Law 3). */
  async proposeCommissionRule(input: CreateCommissionRuleInput, idempotencyKey: string): Promise<CommissionRuleProposal> {
    return (await this.http.request<CommissionRuleProposal>('POST', 'commission-rules/proposals', { idempotencyKey, body: input })).data;
  }
  /** Propose ending one of the tenant's own rules from an IST midnight ≥ 7 days out. */
  async proposeCommissionDeactivation(ruleId: string, input: { effectiveFrom: string; reason: string }, idempotencyKey: string): Promise<CommissionRuleProposal> {
    return (await this.http.request<CommissionRuleProposal>('POST', `commission-rules/${encodeURIComponent(ruleId)}/deactivate`, { idempotencyKey, body: input })).data;
  }
  async confirmCommissionProposal(id: string, idempotencyKey: string): Promise<CommissionRuleProposal> {
    return (await this.http.request<CommissionRuleProposal>('POST', `commission-rules/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuseCommissionProposal(id: string, reason: string, idempotencyKey: string): Promise<CommissionRuleProposal> {
    return (await this.http.request<CommissionRuleProposal>('POST', `commission-rules/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }

  // ---- delivery zones (PC-56 TENANT-SW-a, W233): lead + checker; `logistics` flag ----
  /** The tenant's delivery zones (microsecond keyset), each with its real "Orders 30d". */
  async deliveryZones(params: { pincode?: string; activeOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DeliveryZone>> {
    const r = await this.http.request<DeliveryZone[]>('GET', 'logistics/zones', {
      query: { pincode: params.pincode, activeOnly: params.activeOnly, cursor: params.cursor, limit: params.limit }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getDeliveryZone(id: string, signal?: AbortSignal): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('GET', `logistics/zones/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** "Does this pincode get delivery?" */
  async zoneServiceability(pincode: string, signal?: AbortSignal): Promise<ZoneServiceability> {
    return (await this.http.request<ZoneServiceability>('GET', 'logistics/zones/serviceability', { query: { pincode }, signal })).data;
  }
  /** The fee definitions a zone may point at (this tenant's, approved by a second person on W150). */
  async zoneFeeDefinitions(signal?: AbortSignal): Promise<ZoneFeeDefinition[]> {
    return (await this.http.request<ZoneFeeDefinition[]>('GET', 'logistics/zones/fee-definitions', { signal })).data;
  }
  async zoneProposals(params: { status?: 'proposed' | 'confirmed' | 'refused' | 'expired'; zoneId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DeliveryZoneProposal>> {
    const r = await this.http.request<DeliveryZoneProposal[]>('GET', 'logistics/zones/proposals', { query: params, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async zoneProposal(id: string, signal?: AbortSignal): Promise<DeliveryZoneProposal> {
    return (await this.http.request<DeliveryZoneProposal>('GET', `logistics/zones/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Propose a zone create / fee re-point / (de)activation. Needs `logistics.zones.manage`; a different tenant_admin confirms. */
  async proposeZone(input: ProposeZoneInput, idempotencyKey: string): Promise<DeliveryZoneProposal> {
    return (await this.http.request<DeliveryZoneProposal>('POST', 'logistics/zones/proposals', { idempotencyKey, body: input })).data;
  }
  /** "New zone (checker)" — a create proposal (kept under its old name for existing callers). */
  async createDeliveryZone(input: CreateDeliveryZoneInput, idempotencyKey: string): Promise<DeliveryZoneProposal> {
    return this.proposeZone({ kind: 'create', ...input }, idempotencyKey);
  }
  async confirmZoneProposal(id: string, idempotencyKey: string): Promise<DeliveryZoneProposal> {
    return (await this.http.request<DeliveryZoneProposal>('POST', `logistics/zones/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuseZoneProposal(id: string, reason: string, idempotencyKey: string): Promise<DeliveryZoneProposal> {
    return (await this.http.request<DeliveryZoneProposal>('POST', `logistics/zones/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }
  /** The direct coverage edit — name / pincodes / regions, with a reason. */
  async updateDeliveryZone(id: string, input: UpdateDeliveryZoneInput): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('PATCH', `logistics/zones/${encodeURIComponent(id)}`, { body: input })).data;
  }

  // ---- typed settings (branding + languages live here) + read-only feature overrides ----
  /** All of the tenant's typed settings (key→value). Branding lives here. PC-56 TENANT-13b: GET /tenant-settings now answers W186's
   *  registry (`orgSettings.registry()` has the full shape); this keeps the key→value view its existing callers read. Needs `tenant.settings`. */
  async settings(signal?: AbortSignal): Promise<TenantSetting[]> {
    const d = (await this.http.request<{ items: Array<{ key: string; value: unknown }> } | TenantSetting[]>('GET', 'tenant-settings', { signal })).data;
    return Array.isArray(d) ? d : d.items.map((i) => ({ key: i.key, value: i.value }));
  }
  /** Upsert one ORDINARY typed setting (validated server-side). Idempotent (Law 3). Needs `tenant.settings`. A trust-affecting key
   *  answers 409 PROPOSAL_REQUIRED (PC-56 TENANT-13b) — use `orgSettings.propose()`. */
  async putSetting(key: string, value: unknown, idempotencyKey: string, reason?: string | null): Promise<TenantSetting> {
    return (await this.http.request<TenantSetting>('PUT', 'tenant-settings', { idempotencyKey, body: reason ? { key, value, reason } : { key, value } })).data;
  }
  /** Read-only feature overrides the tenant inherits (cannot self-grant — Law 11). */
  async features(signal?: AbortSignal): Promise<TenantFeature[]> {
    return (await this.http.request<TenantFeature[]>('GET', 'tenant-settings/features', { signal })).data;
  }
}
