// @krishalaya/sdk-js · govt schemes resource. Read surface: browse the GLOBAL scheme catalogue + a scheme's
// detail (benefit/eligibility rules/required docs), check eligibility (server-evaluated, explainable). Write
// surface: apply (idempotent — Law 3), submit/resubmit/appeal the caller's OWN application. Reads of applications
// + DBT credits are owner-scoped server-side (no IDOR). Money is bigint minor strings (Law 2). Gated server-side
// by the `schemes` flag.
import { HttpClient } from '../http';
import { Scheme, SchemeAuthority, EligibilityResult, SchemeApplication, SchemeApplicationDocument, DbtTransfer, ApplicationStatus, Page , SchemeRejectionCode,
  SchemeDeskSummary, SchemeDeskRow, SchemePipeline, SchemePipelineGroup, SchemeSweepView } from '../types';

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
  /**
   * Move a submitted application into verification.
   * @deprecated PC-56 GOV-2a (GOV-2 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code
   * `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403). The government authority that runs the scheme checks and decides
   * (`gov.applications.act`, a second person decides). Kept so existing callers compile and surface the refusal.
   */
  async verifyApplication(id: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/verify`, {})).data;
  }
  /**
   * Ask the applicant for clarification (optionally with a note).
   * @deprecated PC-56 GOV-2c (the lead's conservative call carried from GOV-2a): CLOSED — the API refuses it by name for every caller:
   * `SdkError` code `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403). The government authority that runs the scheme asks for a clarification
   * (`gov.applications.act` with `act: 'clarify'` and a sentence of 10–500 characters). Kept so existing callers compile and surface the refusal.
   */
  async requestClarification(id: string, note?: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/clarify`, { body: { note } })).data;
  }
  /**
   * Approve an application (optionally stamping the government application reference).
   * @deprecated PC-56 GOV-2a (GOV-2 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code
   * `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403). The government authority that runs the scheme checks and decides
   * (`gov.applications.act`, a second person decides). Kept so existing callers compile and surface the refusal.
   */
  async approveApplication(id: string, govtAppRef?: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/approve`, { body: { govtAppRef } })).data;
  }
  /**
   * Reject an application with a reason, and OPTIONALLY a machine-countable reason code (ADMIN-4b, migration 0106).
   *
   * The code is what W078's fixable-rejection breakdown counts, and the prose is still where the officer says what
   * actually happened — the code never replaces it. Optional rather than required on purpose: a mandatory code pushes
   * an officer toward whichever value is first in a dropdown, and an optional code that is usually filled beats a
   * mandatory one that is usually wrong. The console reports the UNCODED share prominently, which is the pressure that
   * actually raises coverage.
   *
   * The parameter is added as an options object rather than a third positional argument so that adding the next field
   * does not shuffle a caller's arguments — and existing `rejectApplication(id, reason)` calls keep working unchanged.
   * @deprecated PC-56 GOV-2a (GOV-2 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code
   * `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403). The government authority that runs the scheme checks and decides
   * (`gov.applications.act`, a second person decides). Kept so existing callers compile and surface the refusal.
   */
  async rejectApplication(id: string, reason?: string, opts?: { reasonCode?: SchemeRejectionCode }): Promise<SchemeApplication> {
    const body: Record<string, unknown> = {};
    if (reason !== undefined) body.reason = reason;
    // Omitted, not sent as null: the DTO is `.strict()` and an explicit null would be a validation failure rather
    // than "no code given".
    if (opts?.reasonCode !== undefined) body.reasonCode = opts.reasonCode;
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/reject`, { body })).data;
  }
  /**
   * Close a decided application.
   * @deprecated PC-56 GOV-2a (GOV-2 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code
   * `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403). The government authority that runs the scheme checks and decides
   * (`gov.applications.act`, a second person decides). Kept so existing callers compile and surface the refusal.
   */
  async closeApplication(id: string): Promise<SchemeApplication> {
    return (await this.http.request<SchemeApplication>('POST', `schemes/applications/${encodeURIComponent(id)}/close`, {})).data;
  }
  /**
   * Record a DBT credit against an application.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
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

  // --- PC-54 W54-10: cross-application DBT read-models + exports — CLOSED (PC-56 GOV-3a) ---
  /**
   * The per-scheme DBT monitor.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async dbtMonitor(signal?: AbortSignal): Promise<Array<{ schemeId: string; transfers: number; amountMinor: string; lastCreditedOn: string | null }>> {
    return (await this.http.request<Array<{ schemeId: string; transfers: number; amountMinor: string; lastCreditedOn: string | null }>>('GET', 'schemes/applications/dbt/monitor', { signal })).data;
  }
  /**
   * The recent DBT credit records.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async dbtRecent(params: { schemeId?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'schemes/applications/dbt/recent', { query: { schemeId: params.schemeId, limit: params.limit ?? 100 }, signal })).data;
  }
  /**
   * A DBT report export (Q4-A: payment records cannot be downloaded).
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async exportReport(input: { report: 'dbt_monitor' | 'dbt_recent'; schemeId?: string; limit?: number }): Promise<{ receipt: { id: string; report: string; generatedAt: string; generatedBy: string; rowCount: number }; rows: unknown[] }> {
    return (await this.http.request<{ receipt: { id: string; report: string; generatedAt: string; generatedBy: string; rowCount: number }; rows: unknown[] }>('POST', 'schemes/applications/exports', { body: input })).data;
  }

  // --- PC-55 A3 `dbt-bounce-ledger` — CLOSED (PC-56 GOV-3a, Q2-A: returned payments are not recorded on this platform) ---
  /**
   * Record a returned DBT credit.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async recordDbtBounce(transferId: string, input: { reasonCode: string; reasonNote?: string; bouncedOn: string; bankRef?: string }, idempotencyKey: string): Promise<{ id: string; transferId: string; amountMinor: string; resolution: string }> {
    return (await this.http.request<{ id: string; transferId: string; amountMinor: string; resolution: string }>('POST', `schemes/applications/dbt/${encodeURIComponent(transferId)}/bounce`, { body: input, idempotencyKey })).data;
  }
  /**
   * Resolve a returned DBT credit.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async resolveDbtBounce(id: string, input: { resolution: 'recredited' | 'abandoned'; note?: string; recreditTransferId?: string }): Promise<{ id: string; resolution: string }> {
    return (await this.http.request<{ id: string; resolution: string }>('POST', `schemes/applications/dbt/bounces/${encodeURIComponent(id)}/resolve`, { body: input })).data;
  }
  /**
   * List returned DBT credits.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async dbtBounces(params: { resolution?: string; schemeId?: string; reasonCode?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'schemes/applications/dbt/bounces', { query: { resolution: params.resolution, schemeId: params.schemeId, reasonCode: params.reasonCode, limit: params.limit ?? 100 }, signal })).data;
  }
  /**
   * The returns desk header.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async dbtBounceDesk(signal?: AbortSignal): Promise<{ byScheme: Array<Record<string, unknown>>; pfms: { provider: string; available: boolean; note: string; fetchedAt: string; pulledRecords: number } }> {
    return (await this.http.request<{ byScheme: Array<Record<string, unknown>>; pfms: { provider: string; available: boolean; note: string; fetchedAt: string; pulledRecords: number } }>('GET', 'schemes/applications/dbt/bounce-desk', { signal })).data;
  }
  /**
   * One application's returned DBT credits.
   * @deprecated PC-56 GOV-3a (GOV-3 Q2-A): CLOSED — the API refuses it by name for every caller: `SdkError` code `DBT_IS_NOT_RECORDED_HERE`
   * (403). Payments and returned payments are not recorded on this platform; benefits are paid by PFMS and the banks, outside it. Kept so
   * existing callers compile and surface the refusal.
   */
  async applicationDbtBounces(applicationId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `schemes/applications/${encodeURIComponent(applicationId)}/dbt-bounces`, { signal })).data;
  }

  // --- PC-56 TENANT-SW-b · W202 / W203 the tenant SCHEMES DESK (`scheme.desk`) ---
  /** Tiles: open applications, rejection rate FY, benefits landed FY (a FACT with its method, else `no_transfers_recorded`), eligible-not-applied. */
  async deskSummary(signal?: AbortSignal): Promise<SchemeDeskSummary> {
    return (await this.http.request<SchemeDeskSummary>('GET', 'schemes/desk/summary', { signal })).data;
  }
  async deskSchemes(signal?: AbortSignal): Promise<SchemeDeskRow[]> {
    return (await this.http.request<SchemeDeskRow[]>('GET', 'schemes/desk/schemes', { signal })).data;
  }
  /** One scheme's pipeline tab (real counts for every tab; masked applicant; derived blocker; rejection + its fix). */
  async deskPipeline(code: string, params: { group?: SchemePipelineGroup; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<SchemePipeline> {
    return (await this.http.request<SchemePipeline>('GET', `schemes/desk/pipeline/${encodeURIComponent(code)}`, { query: { group: params.group, cursor: params.cursor, limit: params.limit ?? 50 }, signal })).data;
  }
  /** "Run eligibility sweep" — queued; the job evaluates every member → a CALL LIST, never an application. Once per scheme per day. */
  async runSweep(schemeCode: string, reason: string, idempotencyKey: string): Promise<{ id: string; schemeId: string; schemeCode: string; status: 'queued' }> {
    return (await this.http.request<{ id: string; schemeId: string; schemeCode: string; status: 'queued' }>('POST', 'schemes/desk/sweeps', { body: { schemeCode, reason }, idempotencyKey })).data;
  }
  async sweep(id: string, params: { cursor?: string; all?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<SchemeSweepView> {
    return (await this.http.request<SchemeSweepView>('GET', `schemes/desk/sweeps/${encodeURIComponent(id)}`, { query: { cursor: params.cursor, all: params.all ? 'true' : undefined, limit: params.limit ?? 50 }, signal })).data;
  }
  /** Reveal ONE form_data field (reason ≥ 20; the audit row names the field, never the value). */
  async revealFormField(applicationId: string, field: string, reason: string): Promise<{ applicationId: string; field: string; value: unknown }> {
    return (await this.http.request<{ applicationId: string; field: string; value: unknown }>('POST', `schemes/desk/applications/${encodeURIComponent(applicationId)}/reveal`, { body: { field, reason } })).data;
  }
}
