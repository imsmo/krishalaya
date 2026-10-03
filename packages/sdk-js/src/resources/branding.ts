// @krishalaya/sdk-js · white-label branding — PC-56 TENANT-13d (W191 + W2793–W2799). One typed method per route of `/v1/tenant-branding`
// (every one needs `tenant.settings`; behind the `tenant_branding` flag). Founder decision: BRAND FOR ALL (no plan gate on branding —
// only hiding "Powered by Krishalaya" needs `white_label_unbranded`); PUBLISH NEEDS A CHECKER; THE CONTRAST LAW.
//   • `console()` prints the draft, the published version, the contrast panel (every pair, AA / AAA honest), the plan facts read for
//     real, the coverage list (real or named), the live proposal — print them, do not retype them;
//   • `saveDraft()` is direct (one tenant_admin, audited before → after) and may save a failing pair (the work is never lost);
//   • `uploadLogo()` sends the RAW file (image/png | image/svg+xml, ≤ 512 KB) — judged, sanitised, born pending the antivirus scan;
//   • `propose()` / `rollback()` → `confirm()` by a DIFFERENT administrator (the database refuses the proposer) publishes in the same
//     transaction; members see it at their next app open, with a one-time "same organisation, new look" note.
import { HttpClient } from '../http';

export interface BrandColours { primary: string; accent: string; ink: string; surface: string }
export interface BrandValues { displayName: string; appShortName: string; logoMediaId: string | null; colours: BrandColours; poweredByHidden: boolean }
export interface BrandRefusal { field: string | null; code: string; detail?: Record<string, unknown> }
export type BrandPairCode = 'primary_on_surface' | 'accent_on_ink' | 'ink_on_surface' | 'surface_on_primary';
export interface BrandPairVerdict { code: BrandPairCode; fg: string; bg: string; ratio: number; display: string; aa: boolean; aaLarge: boolean; aaa: boolean; aaaLarge: boolean }
export interface BrandContrastView { passes: boolean; minRatio: number; gate: number; pairs: BrandPairVerdict[]; seniorMode: { typeScale: number; changesContrast: false } }
export type BrandLogoState = 'none' | 'pending_scan' | 'clean' | 'infected' | 'failed' | 'missing';
export interface BrandHistoryEntry {
  id: string; version: number; kind: 'publish' | 'rollback'; rolledBackTo: number | null; values: BrandValues & { logoMime: string };
  contrastMin: number; proposalId: string; proposedBy: string; proposedByName: string | null; confirmedBy: string; confirmedByName: string | null;
  reason: string; publishedAt: string; current?: boolean;
}
export interface BrandProposal {
  id: string; kind: 'publish' | 'rollback'; status: 'proposed' | 'confirmed' | 'refused' | 'expired'; publishesVersion: number; rollbackTo: number | null;
  values: BrandValues & { logoMime: string }; contrast: unknown; contrastMin: number; reason: string;
  proposedBy: string; proposedByName: string | null; proposedAt: string; expiresAt: string; confirmedBy: string | null; confirmedByName: string | null;
  confirmedAt: string | null; refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null;
  youProposed: boolean; canConfirm: boolean; canRefuse: boolean; admins?: number; currentVersion?: number;
}
export interface BrandCoverageLine { code: string; state: string; detail: string }
export interface BrandPlanFacts {
  planCode: string | null; branding: { includedOnEveryPlan: true };
  customDomain: { enabled: boolean; plansWith: string[] }; removePoweredBy: { enabled: boolean; plansWith: string[] };
}
export interface BrandConsole {
  exists: boolean;
  draft: { values: BrandValues; status: 'draft' | 'published'; draftRevision: number; updatedAt: string | null;
           logo: { mediaId: string | null; state: BrandLogoState; mime: string | null }; contrast: BrandContrastView; publishChecks: BrandRefusal[] };
  published: BrandHistoryEntry | null;
  membersSee: 'published_brand' | 'platform_brand_with_your_name';
  plan: BrandPlanFacts; coverage: BrandCoverageLine[]; admins: { count: number; youAreAdmin: boolean }; liveProposal: BrandProposal | null;
  discipline: { reasonMin: number; proposalTtlDays: number; logo: { maxBytes: number; types: string[]; shape: string } };
}
export interface BrandDraftInput {
  displayName?: string; appShortName?: string; logoMediaId?: string | null; primaryColor?: string; accentColor?: string; inkColor?: string;
  surfaceColor?: string; poweredByHidden?: boolean; reason?: string | null;
}
export interface BrandReview {
  before: BrandValues; after: BrandValues; diff: Array<{ field: string; before: unknown; after: unknown }>; refusals: BrandRefusal[]; ready: boolean;
  contrast: BrandContrastView; publishChecks: BrandRefusal[];
}
export interface BrandSaved { brandId: string; values: BrandValues; draftRevision: number; status: 'draft'; diff: BrandReview['diff']; contrast: BrandContrastView }
export interface BrandLogoUploaded { mediaId: string; mime: string; bytes: number; width: number; height: number; stripped: string[]; state: 'pending_scan'; draftRevision: number }
export interface BrandPublished {
  version: number; kind: 'publish' | 'rollback'; publishedAt: string; historyId: string; brandId: string; logoUrl: string | null;
  audit: { entityType: string; entityId: string; action: string }; membersSeeIt: 'next_app_open'; noticeRecipients: number;
}

export class BrandingResource {
  constructor(private readonly http: HttpClient) {}
  async console(signal?: AbortSignal): Promise<BrandConsole> { return (await this.http.request<BrandConsole>('GET', 'tenant-branding', { signal })).data; }
  /** W2794 — the review of a draft edit (writes nothing). */
  async preview(input: BrandDraftInput): Promise<BrandReview> { return (await this.http.request<BrandReview>('POST', 'tenant-branding/preview', { body: input })).data; }
  /** W2795 — save the draft (keyed). */
  async saveDraft(input: BrandDraftInput, idempotencyKey: string): Promise<BrandSaved> {
    return (await this.http.request<BrandSaved>('PUT', 'tenant-branding/draft', { body: input, idempotencyKey })).data;
  }
  /** The logo UPLOAD: the raw file, its own content type (keyed). */
  async uploadLogo(bytes: Uint8Array, contentType: 'image/png' | 'image/svg+xml', idempotencyKey: string): Promise<BrandLogoUploaded> {
    return (await this.http.request<BrandLogoUploaded>('POST', 'tenant-branding/logo', { rawBody: { bytes, contentType }, idempotencyKey })).data;
  }
  /** The draft logo's bytes for the console preview (only once the antivirus scan cleared it) — a raw Response. */
  async draftLogo(mediaId: string): Promise<Response> { return this.http.requestRaw('GET', `tenant-branding/logo/${encodeURIComponent(mediaId)}`); }
  async history(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: BrandHistoryEntry[]; nextCursor: string | null }> {
    const r = await this.http.request<BrandHistoryEntry[]>('GET', 'tenant-branding/history', { query: q, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null };
  }
  async proposals(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: BrandProposal[]; nextCursor: string | null }> {
    const r = await this.http.request<BrandProposal[]>('GET', 'tenant-branding/proposals', { query: q, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null | undefined) ?? null };
  }
  async proposal(id: string, signal?: AbortSignal): Promise<BrandProposal> {
    return (await this.http.request<BrandProposal>('GET', `tenant-branding/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** W2797 — propose publishing the draft as it stands (keyed; contrast + logo checks blocking). */
  async propose(reason: string, idempotencyKey: string): Promise<BrandProposal> {
    return (await this.http.request<BrandProposal>('POST', 'tenant-branding/proposals', { body: { reason }, idempotencyKey })).data;
  }
  /** "Reversible with history" — propose re-publishing a history version (keyed; same checker path). */
  async rollback(version: number, reason: string, idempotencyKey: string): Promise<BrandProposal> {
    return (await this.http.request<BrandProposal>('POST', 'tenant-branding/rollback', { body: { version, reason }, idempotencyKey })).data;
  }
  /** W2798 — a DIFFERENT administrator confirms; this call publishes (keyed). */
  async confirm(id: string, idempotencyKey: string): Promise<BrandPublished> {
    return (await this.http.request<BrandPublished>('POST', `tenant-branding/proposals/${encodeURIComponent(id)}/confirm`, { body: {}, idempotencyKey })).data;
  }
  async refuse(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'refused' }> {
    return (await this.http.request<{ id: string; status: 'refused' }>('POST', `tenant-branding/proposals/${encodeURIComponent(id)}/refuse`, { body: { reason }, idempotencyKey })).data;
  }
}
