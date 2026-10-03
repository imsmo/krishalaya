// @krishalaya/sdk-js · THE DIGITAL TWIN (PC-56 TENANT-12): W420 the overview · W421 scenarios + cited assumptions · W422 results ·
// the field device registry · the Locked page's one ask. One typed method per route.
//
// READ THE STATE, NEVER GUESS A FIGURE. No twin model is registered (`model.registered` is false): `run()` ALWAYS rejects with an
// SdkError whose code is `TWIN_NO_MODEL_REGISTERED` (409) — the attempt is recorded server-side first — and every results cell is
// `{ state: 'too_few_runs_no_model' }`. A client that prints a P10/P50/P90, a run hash or an AI badge from this resource is printing
// something no model produced. Measured facts (parcels mapped of registered, soil tests, seasons, devices, feed as-ofs, actual yield)
// carry their source and as-of and NO AI disclosure. Writes carry the page's Idempotency-Key (Law 3).
import { HttpClient } from '../http';

export type TwinScenarioStatus = 'draft' | 'ready' | 'archived';
export type TwinScenarioAct = 'edit' | 'run' | 'archive';
export type TwinGateCode = 'TWIN_NO_MODEL_REGISTERED' | 'TWIN_NO_RUNNER';
export type TwinFeedState = 'live' | 'recorded' | 'none' | 'not_connected';
export interface TwinClock { zone: string; today: string; now: string }
export interface TwinModelState { code: string; registered: boolean }
export interface TwinRefusal { field: string | null; code: string }

export interface TwinAccess { enabled: boolean; request: { id: string; requestedAt: string; requestedBy: string | null } | null; canRequest: boolean }
export interface TwinAccessRequestResult { enabled: boolean; written: boolean; request: { id: string; requestedAt: string } | null }

export interface TwinFeed { code: string; sourceTables: string[]; state: TwinFeedState; asOf: string | null; detail: Record<string, string | number | boolean | null> }
export interface TwinOverview {
  clock: TwinClock;
  parcels: { registered: number; mapped: number; unmapped: number; asOf: string | null };
  soil: { tests: number; parcelsTested: number; latestSampledOn: string | null; asOf: string | null };
  seasons: { open: number; harvested: number; abandoned: number; lastClosed: { season: string; year: number; status: string; at: string } | null; asOf: string | null };
  devices: { soilPods: number; weatherMasts: number; retired: number; withReading: number; asOf: string | null; readings: 'none'; ingestion: 'not_built' };
  mandi: { platformRows: number; platformAsOf: string | null; tenantObservations: number; tenantAsOf: string | null };
  weather: { forecast: { live: boolean; provider: string | null }; alerts: { recent: number; lastIngestedAt: string | null; ingestion: 'none' } };
  herd: { linked: false; reason: 'no_bmc_link' };
  feeds: TwinFeed[];
  model: TwinModelState; canRun: boolean; canManageDevices: boolean; refusedByName: string[];
}
export interface TwinKeyDef { code: string; unit: 'pct' | 'hectare'; min: string; max: string }
export interface TwinCatalogue {
  keys: TwinKeyDef[]; templates: Array<{ code: string; keys: string[] }>; deviceKinds: string[]; minGroupSize: number;
  canRun: boolean; canManageDevices: boolean; model: TwinModelState;
  bounds: { minCitation: number; maxCitation: number; minName: number; maxName: number; minReason: number; maxReason: number };
}
export type TwinResultsCell = { state: 'band'; runId: string } | { state: 'too_few_runs_no_model' } | { state: 'too_few_runs' };
export interface TwinAttempt { id: string; status: string; refusalCode: string | null; createdAt: string; requestedBy: string | null; modelCode: string | null; modelVersion: string | null }
export interface TwinScenario {
  id: string; name: string; templateCode: string | null; productId: string | null; productName: string | null; status: TwinScenarioStatus;
  createdAt: string; updatedAt: string; archivedAt: string | null; archiveReason: string | null; acts: TwinScenarioAct[];
}
export interface TwinScenarioListItem extends TwinScenario { attempts: number; lastAttempt: TwinAttempt | null; cell: TwinResultsCell }
export interface TwinScenarioPage {
  items: TwinScenarioListItem[]; counts: Record<TwinScenarioStatus, number>; total: number; nextCursor: string | null; canRun: boolean; model: TwinModelState;
}
export interface TwinAssumption { key: string; value: string; unit: string; citation: string; asOf: string; setAt: string; setBy: string | null }
export interface TwinHistoryRow {
  id: string; key: string; oldValue: string | null; oldCitation: string | null; oldAsOf: string | null;
  newValue: string; newUnit: string; newCitation: string; newAsOf: string; setBy: string | null; setAt: string;
}
export interface TwinScenarioDetail {
  scenario: TwinScenario; templateKeys: string[]; assumptions: TwinAssumption[]; missingKeys: string[]; history: TwinHistoryRow[];
  attempts: TwinAttempt[]; cell: TwinResultsCell; canRun: boolean; model: TwinModelState;
}
export interface TwinScenarioInput { name?: string; templateCode?: string | null; productId?: string | null }
export interface TwinScenarioReview { ready: boolean; refusals: TwinRefusal[]; name: string; templateCode: string | null; productId: string | null; keys: string[] }
export interface TwinAssumptionInput { key: string; value?: string | null; unit?: string | null; citation?: string | null; asOf?: string | null }
export interface TwinAssumptionValue { key: string; value: string; unit: string; citation: string; asOf: string }
export interface TwinAssumptionReview {
  ready: boolean; refusals: TwinRefusal[];
  rows: Array<{ key: string; unit: 'pct' | 'hectare' | null; value: string | null; citation: string | null; asOf: string | null; changed: boolean }>;
  diff: Array<{ key: string; before: TwinAssumptionValue | null; after: TwinAssumptionValue }>;
  setKeys: string[]; statusAfter: TwinScenarioStatus;
}
export interface TwinActPreview {
  scenario: TwinScenario; act: 'run' | 'archive'; assumptions: number; allowed: boolean; refusals: string[];
  gate: { code: TwinGateCode | null; modelCode: string; willBeRefused: boolean } | null;
}
export type TwinYieldFact =
  | { state: 'shown'; qtlPerHa: string; year: number; season: string; seasons: number; members: number; notComparable: number }
  | { state: 'no_harvest' } | { state: 'no_crop' }
  | { state: 'not_comparable_unit_missing'; year: number; season: string; seasons: number }
  | { state: 'below_group_floor'; year: number; season: string; members: number; floor: number };
export interface TwinResults {
  clock: TwinClock; minGroupSize: number; model: TwinModelState;
  pair: Array<{ scenario: TwinScenario; attempts: number; cells: { yield: TwinResultsCell; income: TwinResultsCell }; fact: TwinYieldFact }>;
  proposal: { available: true; runId: string } | { available: false; reason: 'no_run_to_cite' };
  refusedByName: string[];
}
export interface TwinDevice {
  id: string; kind: string; serial: string; label: string | null; parcelId: string | null; status: 'registered' | 'retired';
  registeredAt: string; retiredAt: string | null; retireReason: string | null; lastReadingAt: string | null; readings: 'none';
}
export interface TwinDevicePage { items: TwinDevice[]; nextCursor: string | null; canManage: boolean; ingestion: 'not_built' }

const enc = encodeURIComponent;

export class TwinResource {
  constructor(private readonly http: HttpClient) {}

  /** The Locked page (NOT behind the flag): is the Twin licensed here, and has the account desk been asked (once, ever)? */
  async access(signal?: AbortSignal): Promise<TwinAccess> { return (await this.http.request<TwinAccess>('GET', 'twin/access', { signal })).data; }
  /** "Ask your account desk" — one row per tenant; asking again answers with the first (`written: false`). */
  async requestAccess(idempotencyKey: string): Promise<TwinAccessRequestResult> {
    return (await this.http.request<TwinAccessRequestResult>('POST', 'twin/access-request', { idempotencyKey, body: {} })).data;
  }

  /** W420. */
  async overview(signal?: AbortSignal): Promise<TwinOverview> { return (await this.http.request<TwinOverview>('GET', 'twin/overview', { signal })).data; }
  async catalogue(signal?: AbortSignal): Promise<TwinCatalogue> { return (await this.http.request<TwinCatalogue>('GET', 'twin/catalogue', { signal })).data; }

  /** W421 — µs keyset. */
  async scenarios(params: { status?: TwinScenarioStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<TwinScenarioPage> {
    return (await this.http.request<TwinScenarioPage>('GET', 'twin/scenarios', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 25 }, signal })).data;
  }
  async scenario(id: string, signal?: AbortSignal): Promise<TwinScenarioDetail> {
    return (await this.http.request<TwinScenarioDetail>('GET', `twin/scenarios/${enc(id)}`, { signal })).data;
  }
  async previewScenario(input: TwinScenarioInput): Promise<TwinScenarioReview> {
    return (await this.http.request<TwinScenarioReview>('POST', 'twin/scenarios/preview', { body: input })).data;
  }
  async createScenario(input: TwinScenarioInput, idempotencyKey: string): Promise<{ id: string; status: TwinScenarioStatus; templateKeys: string[] }> {
    return (await this.http.request<{ id: string; status: TwinScenarioStatus; templateKeys: string[] }>('POST', 'twin/scenarios', { idempotencyKey, body: input })).data;
  }
  async previewAssumptions(id: string, assumptions: TwinAssumptionInput[]): Promise<TwinAssumptionReview> {
    return (await this.http.request<TwinAssumptionReview>('POST', `twin/scenarios/${enc(id)}/assumptions/preview`, { body: { assumptions } })).data;
  }
  async saveAssumptions(id: string, assumptions: TwinAssumptionInput[], idempotencyKey: string): Promise<{ id: string; status: TwinScenarioStatus; changed: number }> {
    return (await this.http.request<{ id: string; status: TwinScenarioStatus; changed: number }>('PUT', `twin/scenarios/${enc(id)}/assumptions`, { idempotencyKey, body: { assumptions } })).data;
  }
  async previewAct(id: string, act: 'run' | 'archive', reason?: string): Promise<TwinActPreview> {
    return (await this.http.request<TwinActPreview>('POST', `twin/scenarios/${enc(id)}/acts/${enc(act)}/preview`, { body: reason ? { reason } : {} })).data;
  }
  /** THE RUN — always rejects today: SdkError `TWIN_NO_MODEL_REGISTERED` (409), `details.runId` = the recorded refused attempt. */
  async run(id: string, idempotencyKey: string): Promise<never> {
    await this.http.request<never>('POST', `twin/scenarios/${enc(id)}/run`, { idempotencyKey, body: {} });
    throw new Error('twin.run: the API answered 2xx — no registered model exists, so this is a contract break');
  }
  async archive(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'archived' }> {
    return (await this.http.request<{ id: string; status: 'archived' }>('POST', `twin/scenarios/${enc(id)}/archive`, { idempotencyKey, body: { reason } })).data;
  }

  /** W422 — a pair (or one). */
  async results(a: string, b?: string, signal?: AbortSignal): Promise<TwinResults> {
    return (await this.http.request<TwinResults>('GET', 'twin/results', { query: { a, b }, signal })).data;
  }

  /** The device registry (registry only — readings refused by name). */
  async devices(params: { kind?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<TwinDevicePage> {
    return (await this.http.request<TwinDevicePage>('GET', 'twin/devices', { query: { kind: params.kind, cursor: params.cursor, limit: params.limit ?? 50 }, signal })).data;
  }
  async registerDevice(input: { kind: string; serial: string; label?: string | null; parcelId?: string | null }, idempotencyKey: string): Promise<{ id: string; status: 'registered'; lastReadingAt: null }> {
    return (await this.http.request<{ id: string; status: 'registered'; lastReadingAt: null }>('POST', 'twin/devices', { idempotencyKey, body: input })).data;
  }
  async retireDevice(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'retired' }> {
    return (await this.http.request<{ id: string; status: 'retired' }>('POST', `twin/devices/${enc(id)}/retire`, { idempotencyKey, body: { reason } })).data;
  }
}
