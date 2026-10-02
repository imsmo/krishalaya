// @krishalaya/sdk-js · ESG (PC-56 TENANT-9d): W423 the dashboard · the method pages · W424 the report checklist + the UNSIGNED
// export (6e-2 plane, dataset `esg.metrics`) · W2598–W2601 the cooperative's disclosure (words, never a number) · W2602–W2604
// publish / withdraw.
//
// READ THE VERDICT, NEVER GUESS A FIGURE. Each row carries `verdict` — `published_with_fact` (a figure, `fact`, behind a
// published method), `published_no_fact` (method published, nothing recorded yet — never 0), `no_method`, `no_programme`
// (carbon). `fact` is null for every verdict but the first; a client that prints a number where `fact` is null is the
// defect this API exists to refuse. Reads are keyless; writes carry the page's Idempotency-Key (Law 3).
import { HttpClient } from '../http';
import { ExportJob } from '../types';

export type EsgLangMap = { en: string; [lang: string]: string | undefined };
export type EsgVerdict = 'published_with_fact' | 'published_no_fact' | 'no_method' | 'no_programme';
export const ESG_VERDICTS: readonly EsgVerdict[] = ['published_with_fact', 'published_no_fact', 'no_method', 'no_programme'];
export type EsgFact =
  | { kind: 'omov'; closedWithSnapshot: number; ballots: number; eligibleAtClose: number; maxBallotsPerMember: number | null; overRoll: number; notRecordedCloses: number; asOf: string | null }
  | { kind: 'adulteration'; windowDays: number; from: string; to: string; pours: number; flaggedPours: number; waterFlagged: number; reviewsOpened: number; retested: number; lastFlaggedDay: string | null; asOf: string | null }
  | { kind: 'audit_trail'; appendOnly: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean; canTruncate: boolean; hashColumns: string[]; ledgerChained: boolean; asOf: string | null };
export interface EsgFreshness { rule: string; zone: string; today: string; asOf: string | null; asOfDay: string | null; ageDays: number | null; staleAfterDays: number | null; stale: boolean }
export interface EsgMethodView { status: 'published' | 'not_published'; ref: string | null; version: number | null; publishedAt: string | null; text: EsgLangMap | null; sourceTables: string[]; freshnessRule: string; staleAfterDays: number | null; windowDays: number | null }
export type EsgDisclosureStatus = 'draft' | 'published' | 'withdrawn';
export type EsgDisclosureAct = 'publish' | 'withdraw';
export const ESG_DISCLOSURE_ACTS: readonly EsgDisclosureAct[] = ['publish', 'withdraw'];
export interface EsgDisclosure { id: string; metricCode: string; status: EsgDisclosureStatus; texts: Record<string, string>; createdAt: string; updatedAt: string; publishedAt: string | null; withdrawnAt: string | null; withdrawReason: string | null; acts: EsgDisclosureAct[] }
export interface EsgRow {
  metricCode: string; pillar: 'E' | 'S' | 'G'; sortOrder: number; name: EsgLangMap; verdict: EsgVerdict;
  method: EsgMethodView; fact: EsgFact | null; freshness: EsgFreshness | null; needs: EsgLangMap | null;
}
export interface EsgClock { zone: string; today: string; now: string }
export interface EsgDashboard {
  clock: EsgClock; canDisclose: boolean; counts: Record<EsgVerdict, number>;
  rows: Array<EsgRow & { disclosure: EsgDisclosure | null; drafts: EsgDisclosure[] }>;
  refusedByName: string[];
}
export interface EsgReport {
  clock: EsgClock; dataset: 'esg.metrics'; included: number; excluded: number; disclosures: number; canGenerate: boolean; languages: string[];
  checklist: Array<{ metricCode: string; pillar: 'E' | 'S' | 'G'; name: EsgLangMap; verdict: EsgVerdict; included: boolean; methodRef: string | null; methodVersion: number | null }>;
  unsignedNote: string; refusedByName: string[];
}
export interface EsgDisclosureCatalogue {
  metrics: Array<{ code: string; pillar: 'E' | 'S' | 'G'; name: EsgLangMap; methodStatus: 'published' | 'not_published' }>;
  languages: string[]; withdrawReasons: string[]; bounds: { minText: number; maxText: number; minNote: number; maxNote: number }; canDisclose: boolean;
}
export interface EsgDisclosureInput { metricCode?: string; texts: Record<string, string> }
export interface EsgDisclosureReview {
  ready: boolean; refusals: Array<{ field: string | null; code: string }>;
  fields: Array<{ name: string; entered: string | null; stored: string | null; normalised: boolean }>;
  metricCode: string | null; texts: Record<string, string>; diff: Array<{ field: string; before: string | null; after: string | null }> | null;
}
export interface EsgActPreview { disclosure: EsgDisclosure; allowed: boolean; refusals: string[]; to: EsgDisclosureStatus | null; reasons: string[] }

export class EsgResource {
  constructor(private readonly http: HttpClient) {}

  /** W423. */
  async dashboard(signal?: AbortSignal): Promise<EsgDashboard> {
    return (await this.http.request<EsgDashboard>('GET', 'esg/dashboard', { signal })).data;
  }
  /** One metric's method page. */
  async method(code: string, signal?: AbortSignal): Promise<{ clock: EsgClock; row: EsgRow }> {
    return (await this.http.request<{ clock: EsgClock; row: EsgRow }>('GET', `esg/methods/${encodeURIComponent(code)}`, { signal })).data;
  }
  /** W424 — the guard over every metric. */
  async report(signal?: AbortSignal): Promise<EsgReport> {
    return (await this.http.request<EsgReport>('GET', 'esg/report', { signal })).data;
  }
  /** W424 "Generate report" — the UNSIGNED file (the key is the report page's). */
  async enqueueReport(params: { lang?: string }, idempotencyKey: string): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('POST', 'esg/report/exports', { idempotencyKey, body: params })).data;
  }
  async disclosureCatalogue(signal?: AbortSignal): Promise<EsgDisclosureCatalogue> {
    return (await this.http.request<EsgDisclosureCatalogue>('GET', 'esg/disclosures/catalogue', { signal })).data;
  }
  /** W2599 — the review (keyless; read-only). */
  async previewDisclosure(input: EsgDisclosureInput, id?: string): Promise<EsgDisclosureReview> {
    return (await this.http.request<EsgDisclosureReview>('POST', 'esg/disclosures/preview', { body: id ? { ...input, id } : input })).data;
  }
  /** W2600 — create a draft (keyed). */
  async createDisclosure(input: EsgDisclosureInput, idempotencyKey: string): Promise<{ id: string; status: EsgDisclosureStatus }> {
    return (await this.http.request<{ id: string; status: EsgDisclosureStatus }>('POST', 'esg/disclosures', { idempotencyKey, body: input })).data;
  }
  async disclosure(id: string, signal?: AbortSignal): Promise<EsgDisclosure> {
    return (await this.http.request<EsgDisclosure>('GET', `esg/disclosures/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Edit a draft's words (keyed). */
  async updateDisclosure(id: string, input: EsgDisclosureInput, idempotencyKey: string): Promise<{ id: string; status: EsgDisclosureStatus }> {
    return (await this.http.request<{ id: string; status: EsgDisclosureStatus }>('PATCH', `esg/disclosures/${encodeURIComponent(id)}`, { idempotencyKey, body: input })).data;
  }
  /** W2602 — the verdict at confirm (keyless). */
  async previewDisclosureAct(id: string, act: EsgDisclosureAct, input: { reasonCode?: string; note?: string }): Promise<EsgActPreview> {
    return (await this.http.request<EsgActPreview>('POST', `esg/disclosures/${encodeURIComponent(id)}/acts/${act}/preview`, { body: input })).data;
  }
  /** W2603 — publish · withdraw (keyed). */
  async disclosureAct(id: string, act: EsgDisclosureAct, input: { reasonCode?: string; note?: string }, idempotencyKey: string): Promise<{ id: string; status: EsgDisclosureStatus }> {
    return (await this.http.request<{ id: string; status: EsgDisclosureStatus }>('POST', `esg/disclosures/${encodeURIComponent(id)}/acts/${act}`, { idempotencyKey, body: input })).data;
  }
}
