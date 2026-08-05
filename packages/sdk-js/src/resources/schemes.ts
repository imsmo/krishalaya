// @krishalaya/sdk-js · govt schemes resource. Read surface: browse the GLOBAL scheme catalogue + a scheme's
// detail (benefit/eligibility rules/required docs), check eligibility (server-evaluated, explainable). Write
// surface: apply (idempotent — Law 3), submit/resubmit/appeal the caller's OWN application. Reads of applications
// + DBT credits are owner-scoped server-side (no IDOR). Money is bigint minor strings (Law 2). Gated server-side
// by the `schemes` flag.
import { HttpClient } from '../http';
import { Scheme, SchemeAuthority, EligibilityResult, SchemeApplication, SchemeApplicationDocument, DbtTransfer, ApplicationStatus, Page } from '../types';

export class SchemesResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse the scheme catalogue (optionally by category; active-only by default). */
  async list(params: { categoryId?: string; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<Scheme[]> {
    return (await this.http.request<Scheme[]>('GET', 'schemes', { query: { categoryId: params.categoryId, activeOnly: params.activeOnly }, signal })).data;
  }
  async get(id: string, signal?: AbortSignal): Promise<Scheme> {
    return (await this.http.request<Scheme>('GET', `schemes/${encodeURIComponent(id)}`, { signal })).data;
  }
  async authorities(level?: string, signal?: AbortSignal): Promise<SchemeAuthority[]> {
    return (await this.http.request<SchemeAuthority[]>('GET', 'schemes/authorities', { query: { level }, signal })).data;
  }
  /** Explainable eligibility check (the server evaluates the applicant's attributes against the rules). */
  async checkEligibility(id: string, input: { roles?: string[]; landholdingAcres?: number; gender?: 'male' | 'female' | 'other'; age?: number }, signal?: AbortSignal): Promise<EligibilityResult> {
    return (await this.http.request<EligibilityResult>('POST', `schemes/${encodeURIComponent(id)}/eligibility`, { body: input, signal })).data;
  }

  // --- the caller's own applications ---
  /** Apply (creates a draft). `formData` carries the answers + attached document refs. Idempotent (Law 3). */
  async apply(input: { schemeId: string; formData?: Record<string, unknown>; assistedBy?: string }, idempotencyKey: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', 'schemes/applications', { idempotencyKey, body: { schemeId: input.schemeId, formData: input.formData ?? {}, assistedBy: input.assistedBy } })).data;
  }
  /** List the caller's own applications (box=mine), keyset. */
  async myApplications(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<SchemeApplication>> {
    const r = await this.http.request<SchemeApplication[]>('GET', 'schemes/applications', { query: { box: 'mine', status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getApplication(id: string, signal?: AbortSignal): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('GET', `schemes/applications/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Submit a draft for verification. Idempotent (Law 3). */
  async submitApplication(id: string, idempotencyKey: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/submit`, { idempotencyKey })).data;
  }
  async resubmit(id: string): Promise<SchemeApplication> { return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/resubmit`, {})).data; }
  async appeal(id: string): Promise<SchemeApplication> { return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/appeal`, {})).data; }
  /** Observed DBT/PFMS credits for an application (owner-scoped). Money is bigint minor (Law 2). */
  async dbtTransfers(id: string, signal?: AbortSignal): Promise<DbtTransfer[]> {
    return (await this.http.request<DbtTransfer[]>('GET', `schemes/applications/${encodeURIComponent(id)}/dbt`, { signal })).data;
  }

  // --- supporting documents (P1-16) — applicant attaches clean media against the scheme's required doc types ---
  /** The application's attached documents (owner or officer). */
  async listDocuments(id: string, signal?: AbortSignal): Promise<SchemeApplicationDocument[]> {
    return (await this.http.request<SchemeApplicationDocument[]>('GET', `schemes/applications/${encodeURIComponent(id)}/documents`, { signal })).data;
  }
  /** Attach a clean, caller-owned media asset (from the media pipeline). Editable only pre-decision. */
  async attachDocument(id: string, input: { mediaId: string; docTypeId?: string; note?: string }): Promise<SchemeApplicationDocument> {
    return (await this.http.request<SchemeApplicationDocument>('POST', `schemes/applications/${encodeURIComponent(id)}/documents`, { body: input })).data;
  }
  /** Detach (soft-delete) an attached document. Editable only pre-decision. */
  async detachDocument(id: string, documentId: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('DELETE', `schemes/applications/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`)).data;
  }

  // --- operator / officer (scheme.process; gated server-side — P1-12) ---
  /** List applications: `queue` = the officer's verification queue, `all` = admin, `mine` = applicant's own. */
  async listApplications(params: { box?: 'mine' | 'queue' | 'all'; status?: ApplicationStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<SchemeApplication>> {
    const r = await this.http.request<SchemeApplication[]>('GET', 'schemes/applications', { query: { box: params.box ?? 'queue', status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Move a submitted application into verification. */
  async verifyApplication(id: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/verify`, {})).data;
  }
  /** Ask the applicant for clarification (optionally with a note). */
  async requestClarification(id: string, note?: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/clarify`, { body: { note } })).data;
  }
  /** Approve an application (optionally stamping the government application reference). */
  async approveApplication(id: string, govtAppRef?: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/approve`, { body: { govtAppRef } })).data;
  }
  /** Reject an application with a reason. */
  async rejectApplication(id: string, reason?: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/reject`, { body: { reason } })).data;
  }
  /** Close a decided application. */
  async closeApplication(id: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/close`, {})).data;
  }
  /** Record an observed DBT/PFMS credit against an application. amountMinor is bigint minor (Law 2). */
  async recordDbt(id: string, input: { amountMinor: string; creditedOn: string; instalmentNo?: number; pfmsRef?: string }): Promise<DbtTransfer> {
    return (await this.http.request<DbtTransfer>('POST', `schemes/applications/${encodeURIComponent(id)}/dbt`, { body: input })).data;
  }

  // --- PC-54 W54-3 `scheme-field-visits` (0066) — evidence rides MEDIA IDS ---
  async scheduleFieldVisit(applicationId: string, scheduledFor?: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `schemes/applications/${encodeURIComponent(applicationId)}/field-visits`, { body: scheduledFor ? { scheduledFor } : {} })).data;
  }
  async fieldVisits(applicationId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `schemes/applications/${encodeURIComponent(applicationId)}/field-visits`, { signal })).data;
  }
  /** Officer-of-record only (server-enforced). geotag = [{mediaId,lat,lng,capturedAt}]. */
  async submitFieldVisit(visitId: string, dto: { geotag: Array<{ mediaId: string; lat: number; lng: number; capturedAt: string }>; measuredValues?: Record<string, unknown>; walkTraceMediaId?: string }): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `schemes/applications/field-visits/${encodeURIComponent(visitId)}/submit`, { body: { measuredValues: {}, ...dto } })).data;
  }

  // --- PC-54 W54-10: cross-application DBT read-models + audit-stamped exports (Process-gated) ---
  async dbtMonitor(signal?: AbortSignal): Promise<Array<{ schemeId: string; transfers: number; amountMinor: string; lastCreditedOn: string | null }>> {
    return (await this.http.request<Array<{ schemeId: string; transfers: number; amountMinor: string; lastCreditedOn: string | null }>>('GET', 'schemes/applications/dbt/monitor', { signal })).data;
  }
  async dbtRecent(params: { schemeId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'schemes/applications/dbt/recent', { query: { schemeId: params.schemeId, limit: params.limit ?? 100 }, signal })).data;
  }
  /** The Appendix-5 law: every export returns an AUDIT-STAMPED receipt with its rows. */
  async exportReport(input: { report: 'dbt_monitor' | 'dbt_recent'; schemeId?: string; limit?: number }): Promise<{ receipt: { id: string; report: string; generatedAt: string; generatedBy: string; rowCount: number }; rows: unknown[] }> {
    return (await this.http.request<{ receipt: { id: string; report: string; generatedAt: string; generatedBy: string; rowCount: number }; rows: unknown[] }>('POST', 'schemes/applications/exports', { body: input })).data;
  }
}
