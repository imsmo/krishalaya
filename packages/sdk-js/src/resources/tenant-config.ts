// @krishalaya/sdk-js · tenant self-config resource (P1-10). The seller-facing surface for a tenant admin to
// self-serve their own commission rules, delivery zones, branding + language settings — every call is the tenant's
// OWN tenant (server re-resolves the subject from the token; no id-from-request → no IDOR) and is RBAC-gated +
// audited SERVER-SIDE. Money rules stay server-authoritative: this never computes a fee, it only reads/edits rule
// rows (Law 2/11). Platform-default commission rows are read-only here. Creates are idempotent (Law 3).
import { HttpClient } from '../http';
import {
  CommissionRule, CreateCommissionRuleInput,
  DeliveryZone, CreateDeliveryZoneInput, UpdateDeliveryZoneInput,
  TenantSetting, TenantFeature, Page,
} from '../types';

export class TenantConfigResource {
  constructor(private readonly http: HttpClient) {}

  // ---- commission rules (server-authoritative money rules; platform rows read-only) ----
  /** The tenant's commission rules (its own; optionally including inherited platform defaults, read-only). */
  async commissionRules(params: { activeOnly?: boolean; includePlatformDefaults?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<CommissionRule>> {
    const r = await this.http.request<CommissionRule[]>('GET', 'commission-rules', {
      query: { activeOnly: params.activeOnly, includePlatformDefaults: params.includePlatformDefaults, cursor: params.cursor, limit: params.limit }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Create a tenant commission rule. Idempotent (Law 3). Needs `payout.approve` server-side. */
  async createCommissionRule(input: CreateCommissionRuleInput, idempotencyKey: string): Promise<CommissionRule> {
    return (await this.http.request<CommissionRule>('POST', 'commission-rules', { idempotencyKey, body: input })).data;
  }
  /** Deactivate one of the tenant's own commission rules. Needs `payout.approve` server-side. */
  async deactivateCommissionRule(id: string): Promise<CommissionRule> {
    return (await this.http.request<CommissionRule>('POST', `commission-rules/${encodeURIComponent(id)}/deactivate`, {})).data;
  }

  // ---- delivery zones (logistics flag, ShipmentPermissions.Manage) ----
  /** The tenant's delivery zones (keyset). */
  async deliveryZones(params: { pincode?: string; activeOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DeliveryZone>> {
    const r = await this.http.request<DeliveryZone[]>('GET', 'logistics/zones', {
      query: { pincode: params.pincode, activeOnly: params.activeOnly, cursor: params.cursor, limit: params.limit }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getDeliveryZone(id: string, signal?: AbortSignal): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('GET', `logistics/zones/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Create a delivery zone. Idempotent (Law 3). */
  async createDeliveryZone(input: CreateDeliveryZoneInput, idempotencyKey: string): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('POST', 'logistics/zones', { idempotencyKey, body: input })).data;
  }
  /** Patch a delivery zone (name / pincodes / regions / charge). */
  async updateDeliveryZone(id: string, input: UpdateDeliveryZoneInput): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('PATCH', `logistics/zones/${encodeURIComponent(id)}`, { body: input })).data;
  }
  /** Activate / deactivate a delivery zone. */
  async setDeliveryZoneActive(id: string, isActive: boolean): Promise<DeliveryZone> {
    return (await this.http.request<DeliveryZone>('POST', `logistics/zones/${encodeURIComponent(id)}/active`, { body: { isActive } })).data;
  }

  // ---- typed settings (branding + languages live here) + read-only feature overrides ----
  /** All of the tenant's typed settings (key→value). Branding + language selections are stored here. */
  async settings(signal?: AbortSignal): Promise<TenantSetting[]> {
    return (await this.http.request<TenantSetting[]>('GET', 'tenant-settings', { signal })).data;
  }
  /** Upsert one typed setting (validated server-side against its definition). Idempotent (Law 3). Needs `tenant.settings`. */
  async putSetting(key: string, value: unknown, idempotencyKey: string): Promise<TenantSetting> {
    return (await this.http.request<TenantSetting>('PUT', 'tenant-settings', { idempotencyKey, body: { key, value } })).data;
  }
  /** Read-only feature overrides the tenant inherits (cannot self-grant — Law 11). */
  async features(signal?: AbortSignal): Promise<TenantFeature[]> {
    return (await this.http.request<TenantFeature[]>('GET', 'tenant-settings/features', { signal })).data;
  }
}
