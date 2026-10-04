// @krishalaya/sdk-js · PC-56 TENANT-SW-d — signup step 2 (W114), "Book a setup call" (W2619–W2625), the AGM pack (W199 + W2473–W2477)
// and the share-register import (W2626–W2628).
//
// Founder decisions: PROFILE = SIGNUP STEP 2 WITH SAVE-AND-EXIT · SETUP CALL = A PLATFORM-STAFFED REQUEST OBJECT · AGM PACK = IMMUTABLE
// PACK FROM FACTS ONLY · REGISTER IMPORT UNDER A CHECKER + CONSENT EVIDENCE. Every write takes an Idempotency-Key where the API asks for
// one; every refusal is an SdkError whose `code` names it (the console's `swd.code.<CODE>` sentences).
import { HttpClient } from '../http';

/* ─────────────────────────────── signup step 2 ─────────────────────────────── */
export type GstStateAdvisory =
  | { kind: 'silent' }
  | { kind: 'confirm'; gstCode: string; gstStateName: string | null; districtName: string; districtStateName: string; districtStateCode: string }
  | { kind: 'not_checkable'; reason: 'no_district' | 'state_code_unknown' | 'not_india' };
export interface ProfileStepValues {
  legalName?: string | null; displayName?: string | null; regionId?: string | null; cinOrRegNo?: string | null; pan?: string | null; gstin?: string | null; fssaiLicense?: string | null;
}
export interface DistrictOption { id: string; name: string; stateId: string; stateName: string; stateGstCode: string | null }
export interface OnboardingState {
  step: 'profile' | 'done' | null; profileCompletedAt: string | null; countryCode: string;
  current: Required<{ [K in keyof ProfileStepValues]: string | null }>;
  displayNameLocked: boolean; draft: { payload: Record<string, string>; savedAt: string; expiresAt: string } | null; draftOwnedByOther: boolean;
  savedUpToStep: number; districts: DistrictOption[];
  fields: Array<{ fieldCode: string; labelKey: string; maxLength: number; example: string | null; isRequired: boolean; checksum: 'verified' | 'not_applicable' | 'not_verifiable' }>;
  browserStore: 'refused';
}
export interface ProfileStepPreview {
  writable: boolean; step: 'profile' | 'done' | null; errors: Array<{ field: string; reason: string; detail?: string }>;
  verdicts: Record<string, unknown>; diff: Array<{ field: string; from: string | null; to: string | null }>; advisory: GstStateAdvisory; displayNameLocked: boolean; reasonRequired: boolean;
}
export type ProfileStepResult =
  | { status: 'needs_confirm'; advisory: GstStateAdvisory; saved: false }
  | { status: 'saved'; advisory: GstStateAdvisory; saved: true; fields: string[]; profileCompletedAt: string | null };

export class OrgOnboardingResource {
  constructor(private readonly http: HttpClient) {}
  async state(signal?: AbortSignal): Promise<OnboardingState> { return (await this.http.request<OnboardingState>('GET', 'tenancy/onboarding', { signal })).data; }
  /** "Save & exit (resume later by OTP)" — a SERVER draft, owner-only, 30 days. Nothing is kept in the browser. */
  async saveDraft(payload: Record<string, string | null>): Promise<{ step: 'profile'; savedAt: string; expiresAt: string; fields: string[] }> {
    return (await this.http.request<{ step: 'profile'; savedAt: string; expiresAt: string; fields: string[] }>('PUT', 'tenancy/onboarding/draft', { body: { payload } })).data;
  }
  async preview(values: ProfileStepValues & { reason?: string }): Promise<ProfileStepPreview> {
    return (await this.http.request<ProfileStepPreview>('POST', 'tenancy/onboarding/profile/preview', { body: values })).data;
  }
  /** Complete the step. `needs_confirm` = the GSTIN state advisory: nothing was written; send again with `confirmGstState: true`. */
  async save(values: ProfileStepValues & { confirmGstState?: boolean; reason?: string }, idempotencyKey: string): Promise<ProfileStepResult> {
    return (await this.http.request<ProfileStepResult>('POST', 'tenancy/onboarding/profile', { body: values, idempotencyKey })).data;
  }
}

/* ─────────────────────────────── setup calls ─────────────────────────────── */
export interface SetupCallRequest {
  id: string; slotStart: string; slotEnd: string; zone: string; languageCode: 'en' | 'hi' | 'gu'; phoneMasked: string; notes: string | null;
  status: 'requested' | 'scheduled' | 'done' | 'cancelled'; scheduledAt: string | null; outcomeNote: string | null; doneAt: string | null;
  cancelReason: string | null; cancelledAt: string | null; teamNotified: boolean; createdAt: string;
}
export class SetupCallsResource {
  constructor(private readonly http: HttpClient) {}
  async list(cursor?: string, signal?: AbortSignal): Promise<{ items: SetupCallRequest[]; nextCursor: string | null; zone: string }> {
    const r = await this.http.request<SetupCallRequest[]>('GET', 'tenancy/setup-calls', { query: { cursor }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, zone: String(r.meta?.zone ?? 'Asia/Kolkata') };
  }
  /** One open request per organisation (`SETUP_CALL_ALREADY_OPEN`). Date and times are IST civil ("2026-10-12", "10:30", "11:30"). */
  async request(input: { date: string; from: string; to: string; languageCode: 'en' | 'hi' | 'gu'; notes?: string }, idempotencyKey: string): Promise<SetupCallRequest> {
    return (await this.http.request<SetupCallRequest>('POST', 'tenancy/setup-calls', { body: input, idempotencyKey })).data;
  }
  async cancel(id: string, reason: string): Promise<SetupCallRequest> {
    return (await this.http.request<SetupCallRequest>('POST', `tenancy/setup-calls/${encodeURIComponent(id)}/cancel`, { body: { reason } })).data;
  }
}

/* ─────────────────────────────── the AGM pack ─────────────────────────────── */
export type AgmSectionCode = 'income_expenditure' | 'member_statements' | 'share_register' | 'resolutions' | 'auditor_annexure' | 'bylaws';
export interface AgmSection { section: AgmSectionCode; item: string; status: 'included' | 'refused'; method: string; refusalCode: string | null; figures: Record<string, unknown>; sourceRefs: string[] }
export interface AgmPack {
  id: string; fiscalYearLabel: string; fyStart: string; fyEnd: string; fyStartMonth: number; fyBasisSource: 'tenant_setting' | 'country_default'; zone: string;
  secondLanguage: 'hi' | 'gu'; status: 'draft' | 'proposed' | 'issuing' | 'issued' | 'withdrawn'; draftedBy: string; draftedByName: string | null; assembledAt: string;
  issuedBy: string | null; issuedByName: string | null; issueRequestedAt: string | null; confirmedBy: string | null; confirmedByName: string | null; confirmedAt: string | null;
  issuedAt: string | null; documentId: string | null; pdfSha256: string | null; contentSha256: string | null; pdfMediaId: string | null; exportJobId: string | null;
  exportNote: string | null; parentPackId: string | null; parentDocumentId: string | null; addendumNo: number; reason: string | null; supersededBy: string | null;
  auditorMediaId: string | null; renderAttempts: number; renderError: string | null; withdrawnAt: string | null; withdrawReason: string | null; createdAt: string;
  verifyPath: string | null; sections: AgmSection[]; qr: 'refused';
}
export interface AgmOverview {
  fyBasis: { startMonth: number; source: 'tenant_setting' | 'country_default' } | null; zone: string;
  endedYears: Array<{ startYear: number; label: string; start: string; endInclusive: string }>; defaultSecondLanguage: 'hi' | 'gu' | null;
  items: Array<{ id: string; fiscalYearLabel: string; status: AgmPack['status']; documentId: string | null; addendumNo: number; parentPackId: string | null; supersededBy: string | null; issuedAt: string | null; createdAt: string; exportJobId: string | null }>;
  nextCursor: string | null;
}
export interface AgmVerification {
  documentId: string; organisation: string; fiscalYearLabel: string; issuedAt: string; pdfSha256: string; contentSha256: string | null; addendumNo: number;
  parentDocumentId: string | null; supersededByDocumentId: string | null;
}
export class AgmPacksResource {
  constructor(private readonly http: HttpClient) {}
  async overview(cursor?: string, signal?: AbortSignal): Promise<AgmOverview> { return (await this.http.request<AgmOverview>('GET', 'governance/agm-packs', { query: { cursor }, signal })).data; }
  async get(id: string, signal?: AbortSignal): Promise<AgmPack> { return (await this.http.request<AgmPack>('GET', `governance/agm-packs/${encodeURIComponent(id)}`, { signal })).data; }
  async draft(input: { fyStartYear: number; secondLanguage: 'hi' | 'gu'; auditorMediaId?: string | null }, idempotencyKey: string): Promise<AgmPack> {
    return (await this.http.request<AgmPack>('POST', 'governance/agm-packs', { body: input, idempotencyKey })).data;
  }
  async reassemble(id: string): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/reassemble`, { body: {} })).data; }
  async annexure(id: string, mediaId: string | null): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/annexure`, { body: { mediaId } })).data; }
  async issue(id: string, idempotencyKey: string): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/issue`, { body: {}, idempotencyKey })).data; }
  async confirm(id: string, idempotencyKey: string): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/confirm`, { body: {}, idempotencyKey })).data; }
  async sendBack(id: string, reason: string, idempotencyKey: string): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/send-back`, { body: { reason }, idempotencyKey })).data; }
  async withdraw(id: string, reason: string, idempotencyKey: string): Promise<AgmPack> { return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/withdraw`, { body: { reason }, idempotencyKey })).data; }
  async addendum(id: string, input: { reason: string; auditorMediaId?: string | null }, idempotencyKey: string): Promise<AgmPack> {
    return (await this.http.request<AgmPack>('POST', `governance/agm-packs/${encodeURIComponent(id)}/addendum`, { body: input, idempotencyKey })).data;
  }
  /** PUBLIC — no session: issue time, FY, the two sha256s, the addendum chain. Never a figure. */
  async verify(documentId: string, signal?: AbortSignal): Promise<AgmVerification> {
    return (await this.http.request<AgmVerification>('GET', `verify/agm/${encodeURIComponent(documentId)}`, { anonymous: true, signal })).data;
  }
}

/* ─────────────────────────────── the register import ─────────────────────────────── */
export interface RegisterImport {
  id: string; uploadedBy: string; fileMediaId: string; fileSha256: string; consentMediaId: string; consentKind: 'board_resolution' | 'attestation';
  status: 'staged' | 'validated' | 'proposed' | 'confirmed' | 'applied' | 'rejected' | 'failed'; rowCount: number; validCount: number; errorCount: number; duplicateCount: number;
  appliedCount: number; skippedCount: number; failureCode: string | null; proposedBy: string | null; proposedAt: string | null; proposeReason: string | null;
  confirmedBy: string | null; confirmedAt: string | null; rejectedBy: string | null; rejectedAt: string | null; rejectReason: string | null; appliedAt: string | null;
  batchId: string; createdAt: string;
}
export interface RegisterImportLine { lineNo: number; phoneMasked: string; folio: string | null; shares: number | null; paidUpMinor: string | null; status: 'valid' | 'error' | 'applied' | 'skipped_duplicate'; errorCode: string | null; memberUserId: string | null }
export class RegisterImportsResource {
  constructor(private readonly http: HttpClient) {}
  async list(cursor?: string, signal?: AbortSignal): Promise<{ items: RegisterImport[]; nextCursor: string | null }> {
    const r = await this.http.request<RegisterImport[]>('GET', 'governance/register/imports', { query: { cursor }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The CSV (phone, folio, shares, paid_up — ≤ 5,000 rows) + the consent document this cooperative uploaded (REQUIRED). */
  async upload(input: { csv: string; consentMediaId: string; consentKind: 'board_resolution' | 'attestation' }, idempotencyKey: string): Promise<RegisterImport> {
    return (await this.http.request<RegisterImport>('POST', 'governance/register/imports', { body: input, idempotencyKey })).data;
  }
  async get(id: string, signal?: AbortSignal): Promise<RegisterImport> { return (await this.http.request<RegisterImport>('GET', `governance/register/imports/${encodeURIComponent(id)}`, { signal })).data; }
  async lines(id: string, params: { after?: number; status?: RegisterImportLine['status'] } = {}, signal?: AbortSignal): Promise<{ items: RegisterImportLine[]; nextAfterLine: number | null; currency: string | null }> {
    const r = await this.http.request<RegisterImportLine[]>('GET', `governance/register/imports/${encodeURIComponent(id)}/lines`, { query: { after: params.after, status: params.status }, signal });
    return { items: r.data, nextAfterLine: (r.meta?.nextAfterLine as number | null) ?? null, currency: (r.meta?.currency as string | null) ?? null };
  }
  async propose(id: string, reason: string, idempotencyKey: string): Promise<RegisterImport> {
    return (await this.http.request<RegisterImport>('POST', `governance/register/imports/${encodeURIComponent(id)}/propose`, { body: { reason }, idempotencyKey })).data;
  }
  async confirm(id: string, idempotencyKey: string): Promise<RegisterImport> {
    return (await this.http.request<RegisterImport>('POST', `governance/register/imports/${encodeURIComponent(id)}/confirm`, { body: {}, idempotencyKey })).data;
  }
  async reject(id: string, reason: string): Promise<RegisterImport> {
    return (await this.http.request<RegisterImport>('POST', `governance/register/imports/${encodeURIComponent(id)}/reject`, { body: { reason } })).data;
  }
}
