// @krishalaya/sdk-js · organisation settings (W186) — PC-56 TENANT-13b. One typed method per route of `/v1/tenant-settings` (every one
// needs `tenant.settings`; the registry read too).
//
// Founder decision: TENANT MAKER-CHECKER WITH PLATFORM FLOORS, EFFECTIVE NEXT MIDNIGHT IST WITH MEMBER NOTICE.
//   • `registry()` — the table W186 prints AS BUILT: type, platform default, your value, risk class, the floor, the Effect (null
//     unless a consumer reads the key — never invent one), the pending proposal, the admin count, the language panel;
//   • `put()` writes an ORDINARY key only; a trust-affecting key answers 409 PROPOSAL_REQUIRED — call `propose()`;
//   • `propose()` → `confirm()` (a DIFFERENT tenant_admin; the database refuses the proposer) → applied by the platform at the next
//     00:00 Asia/Kolkata, with a member notice for member-notice keys; `refuse()` with a reason;
//   • `preview()` is W2755's review — every refusal against its field, before → after, the floor verdict. Writes nothing;
//   • `putLanguages()` writes the store every consumer reads (tenant_languages).
import { HttpClient } from '../http';

export type SettingRiskClass = 'ordinary' | 'money_path' | 'security';
export type SettingRoute = 'direct' | 'proposal' | 'none';
export type SettingUnwiredReason = 'no_consumer' | 'branding_13d' | 'deprecated_branding' | 'deprecated_languages';
export type SettingProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired' | 'applied';
export interface SettingRefusal { field: string | null; code: string; detail?: Record<string, unknown> }

export interface SettingProposalView {
  id: string; key: string; status: SettingProposalStatus; oldValue: unknown; newValue: unknown; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string;
  confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null; effectiveAt: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null; expireNote: string | null; appliedAt: string | null;
  youProposed: boolean; canConfirm: boolean; canRefuse: boolean;
}
export interface SettingProposalDetail extends SettingProposalView {
  riskClass: SettingRiskClass; memberNotice: boolean; floor: { min: number | string | null; max: number | string | null; note: string | null } | null;
  wouldTakeEffectAt: string; admins: number;
}
export interface OrgSettingRow {
  key: string; type: 'string' | 'int' | 'decimal' | 'bool' | 'json'; platformDefault: unknown; value: unknown; isDefault: boolean;
  riskClass: SettingRiskClass; memberNotice: boolean; trustAffecting: boolean;
  /** the registry description — ONLY when a consumer reads the key; null otherwise */
  effect: string | null; wired: boolean; unwiredReason: SettingUnwiredReason | null; deprecated: boolean; route: SettingRoute;
  floor: { min: number | string | null; max: number | string | null; locked: boolean; note: string | null };
  outsideFloor: boolean; lockNote: string | null; pendingProposal: SettingProposalView | null;
}
export interface TenantLanguage { code: string; isDefault: boolean; nameNative: string; nameEnglish: string; isActive: boolean }
export interface OrgSettingsRegistry {
  items: OrgSettingRow[];
  counts: { total: number; overridden: number; editable: number; pending: number };
  admins: { count: number; youAreAdmin: boolean };
  languages: { enabled: TenantLanguage[]; platform: Array<{ code: string; nameNative: string; nameEnglish: string }>; addOn: { built: false } };
  discipline: { effectiveAt: 'next_midnight_ist'; zone: string; proposalTtlDays: number; reasonMin: number };
}
export interface SettingInput { key: string; value: unknown; reason?: string | null }
export interface SettingReview {
  key: string; type: string; riskClass: SettingRiskClass; memberNotice: boolean; route: SettingRoute;
  before: unknown; beforeIsDefault: boolean; after: unknown;
  floor: { min: number | string | null; max: number | string | null; note: string | null; verdict: string };
  effect: string | null; takesEffect: { when: 'next_midnight_ist'; ifConfirmedNow: string } | { when: 'immediately' };
  confirmer: { rule: 'a_different_tenant_admin'; admins: number } | null;
  ready: boolean; refusals: SettingRefusal[];
}
export interface SettingHistoryRow {
  id: string; key: string; oldValue: unknown; newValue: unknown; source: 'direct' | 'proposal'; actorUserId: string | null;
  proposalId: string | null; proposedBy: string | null; confirmedBy: string | null; reason: string | null; appliedAt: string;
}

export class OrgSettingsResource {
  constructor(private readonly http: HttpClient) {}
  async registry(signal?: AbortSignal): Promise<OrgSettingsRegistry> {
    return (await this.http.request<OrgSettingsRegistry>('GET', 'tenant-settings', { signal })).data;
  }
  /** An ORDINARY key, directly (before/after recorded). Trust-affecting keys → 409 PROPOSAL_REQUIRED. */
  async put(input: SettingInput, idempotencyKey: string): Promise<{ key: string; value: unknown; before: unknown; historyId: string }> {
    return (await this.http.request<{ key: string; value: unknown; before: unknown; historyId: string }>('PUT', 'tenant-settings', { idempotencyKey, body: input })).data;
  }
  async preview(input: SettingInput, signal?: AbortSignal): Promise<SettingReview> {
    return (await this.http.request<SettingReview>('POST', 'tenant-settings/preview', { body: input, signal })).data;
  }
  async proposals(params: { status?: SettingProposalStatus; key?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: SettingProposalView[]; nextCursor: string | null }> {
    const r = await this.http.request<SettingProposalView[]>('GET', 'tenant-settings/proposals', { query: { status: params.status, key: params.key, cursor: params.cursor, limit: params.limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async proposal(id: string, signal?: AbortSignal): Promise<SettingProposalDetail> {
    return (await this.http.request<SettingProposalDetail>('GET', `tenant-settings/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  async propose(input: SettingInput, idempotencyKey: string): Promise<SettingProposalView> {
    return (await this.http.request<SettingProposalView>('POST', 'tenant-settings/proposals', { idempotencyKey, body: input })).data;
  }
  async confirm(id: string, idempotencyKey: string): Promise<SettingProposalView> {
    return (await this.http.request<SettingProposalView>('POST', `tenant-settings/proposals/${encodeURIComponent(id)}/confirm`, { idempotencyKey, body: {} })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<SettingProposalView> {
    return (await this.http.request<SettingProposalView>('POST', `tenant-settings/proposals/${encodeURIComponent(id)}/refuse`, { idempotencyKey, body: { reason } })).data;
  }
  async history(params: { key?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: SettingHistoryRow[]; nextCursor: string | null }> {
    const r = await this.http.request<SettingHistoryRow[]>('GET', 'tenant-settings/history', { query: { key: params.key, cursor: params.cursor, limit: params.limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async putLanguages(input: { enabled: string[]; primary: string; reason?: string | null }, idempotencyKey: string): Promise<{ enabled: TenantLanguage[]; primary: string }> {
    return (await this.http.request<{ enabled: TenantLanguage[]; primary: string }>('PUT', 'tenant-settings/languages', { idempotencyKey, body: input })).data;
  }
}
