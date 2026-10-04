// @krishalaya/sdk-js · PC-56 TENANT-SW-f · the tenant insights — W193 mandi pulse, W194 demand map, W195 wastage, W196 the report builder,
// W417 learner insights. Every figure arrives WITH its method code (sentences in `methods`, en / hi / gu from the platform's catalogue) or
// as `{ kind: 'refused', code }` (sentence in `refusals`) — the console prints the sentence, never a number the API did not give.
//   insights        insights/mandi-pulse · demand-map · wastage (+ events, export, the facts re-run; a typed loss is refused by name)
//   reports         insights/reports (catalogue · definitions · runs · schedules) — the run's file is on the 6e-2 plane (exportsPlane)
//   studioInsights  education/studio/insights (courses · a course's funnel, quiz-miss heatmap and IST-hour curve, each behind the 50 floor)
import { HttpClient } from '../http';
import type { ExportJob } from '../types';

export type InsightsRefused = { kind: 'refused'; code: string };
export type Words = Record<string, { en: string; hi?: string; gu?: string; [lang: string]: string | undefined }>;
export interface ModalChange { previousDate: string; previousModalMinor: string; changeMinor: string; changeBps: number }

/* ─────────────── W193 ─────────────── */
export interface MemberCrop {
  productId: string; crop: string; listed: boolean; declared: boolean;
  listedStock: Array<{ unit: string; quantity: string; listings: number }>;
  mandis: Array<{ mandiId: string; mandi: string; priceDate: string; modalMinor: string; currency: string; unit: string; change: ModalChange | null }>;
}
export interface MemberPulse {
  asOf: string; zone: string;
  cropsTracked: { count: number; fromListings: number; fromSeasons: number; method: string };
  alerts: { active: number; firedThisWeek: number; weekStart: string; methods: string[] };
  storedStock: InsightsRefused; soldOnAlert: InsightsRefused; band: InsightsRefused;
  crops: { items: MemberCrop[]; nextCursor: string | null };
  methods: Words; refusals: Words;
}

/* ─────────────── W194 ─────────────── */
export type StockFit = 'covers' | 'partial' | 'none';
export type Reach = 'in_reach' | 'out_of_reach' | 'unknown';
export interface DemandRow {
  id: string; reqNo: string | null; title: string; crop: string | null; basis: 'product' | 'category'; needBy: string | null; status: string;
  wanted: { quantity: string; unit: string };
  stock: { quantity: string; unit: string; fit: StockFit; sellers: number };
  value: { kind: 'value'; upToMinor: string; fromMinor: string | null; currency: string } | InsightsRefused;
  reach: Reach | InsightsRefused;
  consented: Array<{ memberName: string | null; quantity: string | null; priceMinor: string | null; unit: string | null; recordedAt: string }>;
}
export interface DemandMap {
  asOf: string; items: DemandRow[]; nextCursor: string | null;
  reach: { kind: 'filter'; districts: number; applied: boolean } | InsightsRefused;
  unmetDemand: InsightsRefused; privacy: 'aggregates_until_consent'; methods: Words; refusals: Words;
}

/* ─────────────── W195 ─────────────── */
export interface MeasuredLoss {
  windowDays: number; events: number; withoutValueOrQuantity: number;
  byCurrency: Array<{ currency: string; valueMinor: string; events: number }>;
  byUnit: Array<{ unit: string; quantity: string; events: number }>;
  split: Array<{ kind: string; events: number; byCurrency: Array<{ currency: string; valueMinor: string }>; byUnit: Array<{ unit: string; quantity: string }> }>;
}
export interface Wastage {
  asOf: string; window: { days: number; from: string }; loss: MeasuredLoss;
  share: { kind: 'share'; bps: number; currency: string; lossMinor: string; gmvMinor: string } | InsightsRefused;
  gmv: Array<{ currency: string; goodsMinor: string; orders: number }>; sources: Array<{ sourceKind: string; events: number }>;
  refused: { externalStatistic: InsightsRefused; savedMoney: InsightsRefused; weighbridge: InsightsRefused; manualEntry: InsightsRefused };
  methods: Words; refusals: Words;
}
export interface WastageEvent {
  id: string; occurredAt: string; occurredUs: string; kind: string; sourceKind: string; sourceTable: string; sourceId: string; chainKey: string | null; productId: string | null;
  crop: string | null; subjectType: string | null; subjectId: string | null; quantity: string | null; unit: string | null; valueMinor: string | null; currency: string | null;
  valueReason: string | null; methodCode: string; recordedAt: string;
}
export interface WastageRerun { counts: Array<{ source: string; written: number; existing: number }>; written: number; existing: number }

export class InsightsResource {
  constructor(private readonly http: HttpClient) {}
  async memberPulse(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<MemberPulse> {
    return (await this.http.request<MemberPulse>('GET', 'insights/mandi-pulse', { query: { ...params }, signal })).data;
  }
  async exportMemberPulse(idempotencyKey: string): Promise<ExportJob> { return (await this.http.request<ExportJob>('POST', 'insights/mandi-pulse/export', { body: {}, idempotencyKey })).data; }
  async demandMap(params: { cursor?: string; limit?: number; reach?: 'all' | 'districts' } = {}, signal?: AbortSignal): Promise<DemandMap> {
    return (await this.http.request<DemandMap>('GET', 'insights/demand-map', { query: { ...params }, signal })).data;
  }
  async exportDemandMap(reach: 'all' | 'districts', idempotencyKey: string): Promise<ExportJob> { return (await this.http.request<ExportJob>('POST', 'insights/demand-map/export', { body: { reach }, idempotencyKey })).data; }
  async wastage(signal?: AbortSignal): Promise<Wastage> { return (await this.http.request<Wastage>('GET', 'insights/wastage', { signal })).data; }
  async wastageEvents(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: WastageEvent[]; nextCursor: string | null }> {
    const r = await this.http.request<WastageEvent[]>('GET', 'insights/wastage/events', { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async exportWastage(idempotencyKey: string): Promise<ExportJob> { return (await this.http.request<ExportJob>('POST', 'insights/wastage/export', { body: {}, idempotencyKey })).data; }
  /** W2826–W2828: re-run the backfill from recorded facts (idempotent), with a reason (≥ 10). */
  async rerunWastage(reason: string, idempotencyKey: string): Promise<WastageRerun> { return (await this.http.request<WastageRerun>('POST', 'insights/wastage/rerun', { body: { reason }, idempotencyKey })).data; }
  /** A typed loss — the API REFUSES it by name (MANUAL_WASTAGE_REFUSED). Present so the refusal is a sentence on the page, not a guess. */
  async recordManualWastage(body: Record<string, unknown>, idempotencyKey: string): Promise<never> {
    return (await this.http.request<never>('POST', 'insights/wastage/events', { body, idempotencyKey })).data;
  }
}

/* ─────────────── W196 ─────────────── */
export interface ReportCatalogue {
  datasets: Array<{ code: string; dimensions: string[]; measures: Array<{ key: string; kind: 'count' | 'money' | 'qty' | 'number' }>; currencyDimension: string | null; unitDimension: string | null;
    auditorRealm: boolean; permitted: boolean; refusal: string | null; planeDataset: string | null }>;
  bounds: { maxRangeDays: number; rowCap: number; statementTimeout: string; maxDimensions: number; maxMeasures: number };
  replica: InsightsRefused; memberDimension: InsightsRefused; signed: InsightsRefused; watermarked: boolean; audited: boolean; recipientRoles: string[]; planeRegistry: string[];
}
export interface ReportDefinition {
  id: string; tenantId: string | null; scope: 'tenant' | 'platform'; slug: string; title: string; datasetCode: string | null; metric: string | null; dimensions: string[]; measures: string[];
  rangeDays: number | null; createdBy: string | null; archivedAt: string | null; archiveReason: string | null; createdAt: string; updatedAt: string; readOnly: boolean; runnable: boolean;
}
export interface ReportRun {
  id: string; definitionId: string | null; scheduleId: string | null; datasetCode: string; dimensions: string[]; measures: string[]; fromDay: string; toDay: string; requestedBy: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'refused'; rowCount: number | null; exportJobId: string | null; statementMs: number | null; statementTimeout: string | null;
  watermark: string | null; errorCode: string | null; errorDetail: string | null; queuedAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ReportSchedule {
  id: string; definitionId: string; cadence: 'daily' | 'weekly' | 'monthly'; weekdayIso: number | null; monthDay: number | null; timeIst: string; recipientRoles: string[]; active: boolean;
  nextRunAt: string; lastRunAt: string | null; lastRunId: string | null; createdBy: string; deactivatedAt: string | null; deactivateReason: string | null; createdAt: string;
}
export interface RunRequest { definitionId?: string; datasetCode?: string; dimensions?: string[]; measures?: string[]; from?: string; to?: string }

export class ReportsResource {
  constructor(private readonly http: HttpClient) {}
  async catalogue(signal?: AbortSignal): Promise<ReportCatalogue> { return (await this.http.request<ReportCatalogue>('GET', 'insights/reports/catalogue', { signal })).data; }
  async definitions(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ReportDefinition[]; nextCursor: string | null }> {
    const r = await this.http.request<ReportDefinition[]>('GET', 'insights/reports/definitions', { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async definition(id: string, signal?: AbortSignal): Promise<ReportDefinition> { return (await this.http.request<ReportDefinition>('GET', `insights/reports/definitions/${encodeURIComponent(id)}`, { signal })).data; }
  async saveDefinition(input: { title: string; datasetCode: string; dimensions: string[]; measures: string[]; rangeDays: number }, idempotencyKey: string): Promise<{ id: string; slug: string }> {
    return (await this.http.request<{ id: string; slug: string }>('POST', 'insights/reports/definitions', { body: input, idempotencyKey })).data;
  }
  async archiveDefinition(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; archived: true }> {
    return (await this.http.request<{ id: string; archived: true }>('POST', `insights/reports/definitions/${encodeURIComponent(id)}/archive`, { body: { reason }, idempotencyKey })).data;
  }
  async requestRun(input: RunRequest, idempotencyKey: string): Promise<{ id: string; status: 'queued'; datasetCode: string; dimensions: string[]; measures: string[]; from: string; to: string; implied: string[] }> {
    return (await this.http.request<{ id: string; status: 'queued'; datasetCode: string; dimensions: string[]; measures: string[]; from: string; to: string; implied: string[] }>('POST', 'insights/reports/runs', { body: input, idempotencyKey })).data;
  }
  async runs(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ReportRun[]; nextCursor: string | null }> {
    const r = await this.http.request<ReportRun[]>('GET', 'insights/reports/runs', { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async run(id: string, signal?: AbortSignal): Promise<ReportRun> { return (await this.http.request<ReportRun>('GET', `insights/reports/runs/${encodeURIComponent(id)}`, { signal })).data; }
  async schedules(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: ReportSchedule[]; nextCursor: string | null }> {
    const r = await this.http.request<ReportSchedule[]>('GET', 'insights/reports/schedules', { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async createSchedule(input: { definitionId: string; cadence: 'daily' | 'weekly' | 'monthly'; weekdayIso?: number | null; monthDay?: number | null; timeIst: string; recipientRoles: string[] }, idempotencyKey: string): Promise<{ id: string; nextRunAt: string }> {
    return (await this.http.request<{ id: string; nextRunAt: string }>('POST', 'insights/reports/schedules', { body: input, idempotencyKey })).data;
  }
  async deactivateSchedule(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; active: false }> {
    return (await this.http.request<{ id: string; active: false }>('POST', `insights/reports/schedules/${encodeURIComponent(id)}/deactivate`, { body: { reason }, idempotencyKey })).data;
  }
}

/* ─────────────── W417 ─────────────── */
export type FloorVerdict = { kind: 'refused'; code: 'BELOW_LEARNER_FLOOR' | 'NO_CAPTURE_YET'; learners: number; floor: number };
export interface StudioCourse { id: string; title: string; status: string; instructorUserId: string | null; enrolled: number; completed: number; createdUs: string }
export interface StudioLesson {
  lessonId: string; moduleNo: number; lessonNo: number; title: string; kind: string; started: number; completed: number;
  quizMiss: null | FloorVerdict | { kind: 'shown'; learners: number; floor: number; questions: Array<{ questionNo: number; total: number; missed: number; missBps: number | null }> };
  watchCurve: FloorVerdict | { kind: 'shown'; learners: number; floor: number; hours: Array<{ hour: number; seconds: number }> };
}
export interface StudioCourseInsights {
  asOf: string; course: StudioCourse; floor: number; captureBegan: string | null; lessons: StudioLesson[]; advisory: InsightsRefused; methods: Words; refusals: Words;
}
export class StudioInsightsResource {
  constructor(private readonly http: HttpClient) {}
  async courses(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: StudioCourse[]; nextCursor: string | null; scope: 'tenant' | 'own' | null }> {
    const r = await this.http.request<StudioCourse[]>('GET', 'education/studio/insights', { query: { ...params }, signal });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; scope?: 'tenant' | 'own' };
    return { items: r.data ?? [], nextCursor: meta.nextCursor ?? null, scope: meta.scope ?? null };
  }
  async course(courseId: string, signal?: AbortSignal): Promise<StudioCourseInsights> {
    return (await this.http.request<StudioCourseInsights>('GET', `education/studio/insights/${encodeURIComponent(courseId)}`, { signal })).data;
  }
}
