// @krishalaya/sdk-js · PC-56 TENANT-SW-e · logistics ops — closes F-19: every route the console's W228 / W230 / W232 / W234 / W239 /
// W240 pages (and the member's slot link, the keeper's handover, the buyer's breach decision) use has a typed method here.
//   carriers      logistics/partners (list · get · create · patch · active toggle WITH a reason)
//   pickupSlots   the seller's own windows (logistics/pickup-slots) · the desk read · suggestions · proposals · the member's answer ·
//                 the OTP link (anonymous)
//   villageRun    logistics/village-run (route page · runs · candidates · drop points · draft · acts · handovers)
//   coldChain     logistics/cold-chain (manual reading · trail · thresholds · subjects · subject · breaches + acts · loggers + keys ·
//                 exports) · the buyer's offers
// Every figure the API refuses arrives as `{ kind: 'refused', code }` — the console prints the code's sentence, never a number.
import { HttpClient } from '../http';
import type { ExportJob } from '../types';

export type Refused = { kind: 'refused'; code: string };
export interface Ratio { numerator: number; denominator: number; bps: number }

/* ─────────────── carriers (W228) ─────────────── */
/** What a write answers (create / patch / active): the carrier itself, without the read-side facts. */
export interface CarrierBase {
  id: string; scope: 'platform' | 'tenant' | string; partnerKind: '3pl' | 'tenant_fleet' | 'rider' | string; providerCode: string | null; defaultName: string;
  riderUserId: string | null; supportsColdChain: boolean; isActive: boolean; createdAt: string | null; contactMasked: string | null; statusReason: string | null;
}
/** W228's row: the carrier + its facts (list / get). */
export interface CarrierRow extends CarrierBase {
  capability: { vehicles: number; capacityKg: string; reefer: boolean; coldChain: boolean };
  shipments30d: number; onTime: Refused;
  rider: null | { name: string | null; phoneMasked: string | null; kycVerified: boolean; kyc: string; wageProtected: boolean; wageTerms: 'rider' | 'tenant_default' | 'none'; insured: Refused };
}
export interface CarrierPage { items: CarrierRow[]; nextCursor: string | null; onTime: Refused | null }
export interface CarrierCreateInput {
  partnerKind: '3pl' | 'tenant_fleet' | 'rider'; defaultName: string; providerCode?: string | null; riderUserId?: string | null; supportsColdChain?: boolean;
  contactPhone?: string | null; vehicle?: { regNo: string; capacityKg?: number | null; isRefrigerated?: boolean } | null;
}
export interface CarrierPatch { defaultName?: string; providerCode?: string | null; supportsColdChain?: boolean; contactPhone?: string | null }

export class CarriersResource {
  constructor(private readonly http: HttpClient) {}
  async list(params: { partnerKind?: string; activeOnly?: boolean; includePlatform?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<CarrierPage> {
    const r = await this.http.request<CarrierRow[]>('GET', 'logistics/partners', { query: { ...params }, signal });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; onTime?: Refused };
    return { items: r.data ?? [], nextCursor: meta.nextCursor ?? null, onTime: meta.onTime ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<CarrierRow> { return (await this.http.request<CarrierRow>('GET', `logistics/partners/${encodeURIComponent(id)}`, { signal })).data; }
  async create(input: CarrierCreateInput, idempotencyKey: string): Promise<CarrierBase & { vehicleId: string | null }> {
    return (await this.http.request<CarrierBase & { vehicleId: string | null }>('POST', 'logistics/partners', { body: input, idempotencyKey })).data;
  }
  async patch(id: string, patch: CarrierPatch): Promise<CarrierBase> { return (await this.http.request<CarrierBase>('PATCH', `logistics/partners/${encodeURIComponent(id)}`, { body: patch })).data; }
  /** W2382–W2384: activate / deactivate with a reason (≥ 10), audited with it. */
  async setActive(id: string, isActive: boolean, reason: string): Promise<CarrierBase> {
    return (await this.http.request<CarrierBase>('POST', `logistics/partners/${encodeURIComponent(id)}/active`, { body: { isActive, reason } })).data;
  }
}

/* ─────────────── pickup slots (W230) ─────────────── */
export interface SlotWindow { weekday: number; start: string; end: string }
export interface PickupSlotRow { id: string; weekday: number; startTime: string; endTime: string; isActive: boolean; createdAt: string | null }
export interface DeskSellerRow {
  sellerUserId: string; sellerName: string | null; sellerPhoneMasked: string | null; windows: SlotWindow[]; pickups30d: number;
  deliveryFirstAttempt: { kind: 'delivery'; attempted: number; firstAttempt: number; ratio: Ratio | null; method: string };
  pickupFirstAttempt: Refused; openProposal: { id: string; expiresAt: string | null } | null;
}
export interface SlotDesk { items: DeskSellerRow[]; nextCursor: string | null; totalSellers: number; proposalsOn: boolean; refused: { pickupFirstAttempt: string; voiceSlots: string } }
export interface SlotSuggestions {
  sellerUserId: string; windowDays: number; basis: 'own_pickup_history'; model: null; writes: 'none'; label: string; pickupsRead: number;
  cells: Array<{ weekday: number; start: string; end: string; pickups: number; attempted: number; firstAttempt: number; deliveryFirstAttempt: Ratio | null }>;
}
export interface SlotProposal {
  id: string; sellerUserId: string; sellerName: string | null; sellerPhoneMasked: string | null; proposedBy: string; windows: SlotWindow[]; reason: string;
  status: 'proposed' | 'accepted' | 'declined' | 'expired' | 'withdrawn'; expiresAt: string; decidedAt: string | null; channel: 'app' | 'otp_link' | null;
  declineReason: string | null; withdrawnAt: string | null; withdrawReason: string | null; windowsWritten: number; createdAt: string;
}
export interface SlotLinkView { id: string; status: string; windows: SlotWindow[]; expiresAt: string; phoneTail: string; organisation: string }

export class PickupSlotsResource {
  constructor(private readonly http: HttpClient) {}
  /* the seller's own windows (all five routes of logistics/pickup-slots — F-19) */
  async mine(params: { weekday?: number; activeOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: PickupSlotRow[]; nextCursor: string | null }> {
    const r = await this.http.request<PickupSlotRow[]>('GET', 'logistics/pickup-slots', { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<PickupSlotRow> { return (await this.http.request<PickupSlotRow>('GET', `logistics/pickup-slots/${encodeURIComponent(id)}`, { signal })).data; }
  async create(input: { weekday: number; startTime: string; endTime: string }, idempotencyKey: string): Promise<PickupSlotRow> {
    return (await this.http.request<PickupSlotRow>('POST', 'logistics/pickup-slots', { body: input, idempotencyKey })).data;
  }
  async update(id: string, patch: { weekday?: number; startTime?: string; endTime?: string }): Promise<PickupSlotRow> {
    return (await this.http.request<PickupSlotRow>('PATCH', `logistics/pickup-slots/${encodeURIComponent(id)}`, { body: patch })).data;
  }
  async setActive(id: string, isActive: boolean): Promise<PickupSlotRow> {
    return (await this.http.request<PickupSlotRow>('POST', `logistics/pickup-slots/${encodeURIComponent(id)}/active`, { body: { isActive } })).data;
  }
  /* the desk (logistics.manage) */
  async desk(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<SlotDesk> {
    return (await this.http.request<SlotDesk>('GET', 'logistics/slots/desk', { query: { ...params }, signal })).data;
  }
  async suggestions(sellerUserId: string, signal?: AbortSignal): Promise<SlotSuggestions> {
    return (await this.http.request<SlotSuggestions>('GET', `logistics/slots/suggestions/${encodeURIComponent(sellerUserId)}`, { signal })).data;
  }
  async proposals(params: { status?: SlotProposal['status']; sellerUserId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: SlotProposal[]; nextCursor: string | null }> {
    return (await this.http.request<{ items: SlotProposal[]; nextCursor: string | null }>('GET', 'logistics/slots/proposals', { query: { ...params }, signal })).data;
  }
  async proposal(id: string, signal?: AbortSignal): Promise<SlotProposal> {
    return (await this.http.request<SlotProposal>('GET', `logistics/slots/proposals/${encodeURIComponent(id)}`, { signal })).data;
  }
  async propose(input: { sellerUserId: string; slots: SlotWindow[]; reason: string }, idempotencyKey: string): Promise<{ id: string; status: 'proposed'; windows: number }> {
    return (await this.http.request<{ id: string; status: 'proposed'; windows: number }>('POST', 'logistics/slots/proposals', { body: input, idempotencyKey })).data;
  }
  async withdraw(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'withdrawn' }> {
    return (await this.http.request<{ id: string; status: 'withdrawn' }>('POST', `logistics/slots/proposals/${encodeURIComponent(id)}/withdraw`, { body: { reason }, idempotencyKey })).data;
  }
  /* the member, in the app */
  async myProposals(signal?: AbortSignal): Promise<{ items: SlotProposal[] }> {
    return (await this.http.request<{ items: SlotProposal[] }>('GET', 'me/pickup-slot-proposals', { signal })).data;
  }
  async accept(id: string, idempotencyKey: string): Promise<{ id: string; status: 'accepted'; channel: 'app'; windowsWritten: number }> {
    return (await this.http.request<{ id: string; status: 'accepted'; channel: 'app'; windowsWritten: number }>('POST', `me/pickup-slot-proposals/${encodeURIComponent(id)}/accept`, { body: {}, idempotencyKey })).data;
  }
  async decline(id: string, reason: string | null, idempotencyKey: string): Promise<{ id: string; status: 'declined' }> {
    return (await this.http.request<{ id: string; status: 'declined' }>('POST', `me/pickup-slot-proposals/${encodeURIComponent(id)}/decline`, { body: { reason }, idempotencyKey })).data;
  }
  /* the OTP link — anonymous (the code sent to the member's own phone is the proof) */
  async linkView(id: string, signal?: AbortSignal): Promise<SlotLinkView> {
    return (await this.http.request<SlotLinkView>('GET', `pickup-slot-proposals/${encodeURIComponent(id)}`, { signal, anonymous: true })).data;
  }
  async linkSendCode(id: string): Promise<{ sent: true; phoneTail: string; ttlSec: number }> {
    return (await this.http.request<{ sent: true; phoneTail: string; ttlSec: number }>('POST', `pickup-slot-proposals/${encodeURIComponent(id)}/code`, { body: {}, anonymous: true })).data;
  }
  async linkDecide(id: string, input: { code: string; decision: 'accept' | 'decline'; reason?: string | null }): Promise<{ id: string; status: 'accepted' | 'declined'; channel: 'otp_link'; windowsWritten: number }> {
    return (await this.http.request<{ id: string; status: 'accepted' | 'declined'; channel: 'otp_link'; windowsWritten: number }>('POST', `pickup-slot-proposals/${encodeURIComponent(id)}/decide`, { body: input, anonymous: true })).data;
  }
}

/* ─────────────── Village Run (W232) ─────────────── */
export type RunStatus = 'draft' | 'confirmed' | 'loading' | 'in_transit' | 'completed' | 'cancelled';
export type RunAct = 'confirm' | 'start_loading' | 'depart' | 'complete' | 'cancel';
export interface RunSummary {
  id: string; runDate: string; status: RunStatus; parcels: number; partnerId: string | null; vehicleId: string | null; draftedBy: string; draftedAt: string; draftReason: string;
  confirmedBy: string | null; confirmedAt: string | null; loadingAt: string | null; departedAt: string | null; completedAt: string | null; cancelledAt: string | null;
  cancelReason: string | null; acts: RunAct[]; youDrafted: boolean;
}
export interface RunFigures {
  consolidation: { onRun: number; boundForVillages: number; ratio: Ratio | null; plannedFromWeek: number; week: { from: string; to: string }; method: string };
  stops: number;
  freight: { kind: 'billed'; byCurrency: Array<{ currency: string; billedMinor: string; lines: number }>; method: string } | Refused;
}
export interface DropPointRow {
  id: string; sequence: number; regionId: string; regionName: string | null; name: string; keeper: { userId: string; name: string | null; phoneMasked: string | null };
  window: { start: string; end: string | null } | null; active: boolean; deactivateReason: string | null; parcelsIn: number;
}
export interface VillageRunPage {
  route: { id: string; name: string; runWeekday: number | null; status: string; currencyCode: string | null; villages: Array<{ id: string; name: string | null }> };
  dropPoints: DropPointRow[]; runs: RunSummary[]; current: (RunSummary & Partial<RunFigures>) | null;
  economics: { feeInForceMinor: string; platformFloorMinor: string; cooperativeValueMinor: string | null; currencyCode: string | null; method: string;
    keepers: Array<{ userId: string; name: string | null; phoneMasked: string | null; parcels: number; accruedMinor: string; paidMinor: string; unpaidMinor: string }> };
  refused: { freightVsAdHoc: string; returnLeg: string };
}
export interface RunDetail extends RunSummary {
  routeId: string;
  plan: Array<{ shipmentId: string; dropPointId: string; dropPoint: string | null; sequence: number | null; handover: string | null }>;
  handovers: Array<{ id: string; shipmentId: string; dropPointId: string; dropPoint: string | null; status: string; keeperOtpConfirmedAt: string; memberOtpConfirmedAt: string | null;
    collectedAt: string | null; returnedAt: string | null; returnReason: string | null; feeMinor: string | null; feeSource: string | null }>;
}

export class VillageRunResource {
  constructor(private readonly http: HttpClient) {}
  private p(path: string) { return `logistics/village-run/${path}`; }
  async route(routeId: string, signal?: AbortSignal): Promise<VillageRunPage> { return (await this.http.request<VillageRunPage>('GET', this.p(`routes/${encodeURIComponent(routeId)}`), { signal })).data; }
  async runs(routeId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: RunSummary[]; nextCursor: string | null }> {
    return (await this.http.request<{ items: RunSummary[]; nextCursor: string | null }>('GET', this.p(`routes/${encodeURIComponent(routeId)}/runs`), { query: { ...params }, signal })).data;
  }
  async candidates(routeId: string, signal?: AbortSignal): Promise<{ items: Array<{ shipmentId: string; awb: string | null; regionId: string; status: string; createdAt: string }> }> {
    return (await this.http.request<{ items: Array<{ shipmentId: string; awb: string | null; regionId: string; status: string; createdAt: string }> }>('GET', this.p(`routes/${encodeURIComponent(routeId)}/candidates`), { signal })).data;
  }
  async addDropPoint(routeId: string, input: { sequence: number; regionId: string; name: string; ambassadorUserId: string; windowStart?: string | null; windowEnd?: string | null }, idempotencyKey: string): Promise<{ id: string; routeId: string }> {
    return (await this.http.request<{ id: string; routeId: string }>('POST', this.p(`routes/${encodeURIComponent(routeId)}/drop-points`), { body: input, idempotencyKey })).data;
  }
  async deactivateDropPoint(id: string, reason: string, idempotencyKey: string): Promise<{ id: string; active: false }> {
    return (await this.http.request<{ id: string; active: false }>('POST', this.p(`drop-points/${encodeURIComponent(id)}/deactivate`), { body: { reason }, idempotencyKey })).data;
  }
  async draft(routeId: string, input: { runDate: string; plan: Array<{ shipmentId: string; dropPointId: string }>; partnerId?: string | null; vehicleId?: string | null; reason: string }, idempotencyKey: string): Promise<{ id: string; status: 'draft'; runDate: string; parcels: number }> {
    return (await this.http.request<{ id: string; status: 'draft'; runDate: string; parcels: number }>('POST', this.p(`routes/${encodeURIComponent(routeId)}/runs`), { body: input, idempotencyKey })).data;
  }
  async run(runId: string, signal?: AbortSignal): Promise<RunDetail> { return (await this.http.request<RunDetail>('GET', this.p(`runs/${encodeURIComponent(runId)}`), { signal })).data; }
  /** W2818–W2820: confirm (a second person — the database refuses the drafter) · start_loading · depart · complete · cancel (reason). */
  async act(runId: string, act: RunAct, reason: string | null, idempotencyKey: string): Promise<{ id: string; status: RunStatus }> {
    return (await this.http.request<{ id: string; status: RunStatus }>('POST', this.p(`runs/${encodeURIComponent(runId)}/acts/${act}`), { body: { reason }, idempotencyKey })).data;
  }
  /* the drop point: the driver asks for the keeper's code, records the handover; the keeper asks for the member's code, records the collection */
  async sendKeeperCode(runId: string, shipmentId: string): Promise<{ sent: true; to: 'keeper'; phoneMasked: string; ttlSec: number }> {
    return (await this.http.request<{ sent: true; to: 'keeper'; phoneMasked: string; ttlSec: number }>('POST', this.p(`runs/${encodeURIComponent(runId)}/handovers/code`), { body: { shipmentId } })).data;
  }
  async handOver(runId: string, input: { shipmentId: string; code: string }, idempotencyKey: string): Promise<{ id: string; status: 'at_drop_point' }> {
    return (await this.http.request<{ id: string; status: 'at_drop_point' }>('POST', this.p(`runs/${encodeURIComponent(runId)}/handovers`), { body: input, idempotencyKey })).data;
  }
  async keeperQueue(signal?: AbortSignal): Promise<{ items: Array<{ id: string; runId: string; shipmentId: string; status: string; dropPoint: string; at: string }>; today: string }> {
    return (await this.http.request<{ items: Array<{ id: string; runId: string; shipmentId: string; status: string; dropPoint: string; at: string }>; today: string }>('GET', this.p('me/drop-point'), { signal })).data;
  }
  async sendCollectCode(handoverId: string): Promise<{ sent: true; to: 'member'; phoneMasked: string; ttlSec: number }> {
    return (await this.http.request<{ sent: true; to: 'member'; phoneMasked: string; ttlSec: number }>('POST', this.p(`handovers/${encodeURIComponent(handoverId)}/collect-code`), { body: {} })).data;
  }
  async collect(handoverId: string, code: string, idempotencyKey: string): Promise<{ id: string; status: 'collected'; feeMinor: string | null; feeSource: string | null }> {
    return (await this.http.request<{ id: string; status: 'collected'; feeMinor: string | null; feeSource: string | null }>('POST', this.p(`handovers/${encodeURIComponent(handoverId)}/collect`), { body: { code }, idempotencyKey })).data;
  }
  async returnParcel(handoverId: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'returned' }> {
    return (await this.http.request<{ id: string; status: 'returned' }>('POST', this.p(`handovers/${encodeURIComponent(handoverId)}/return`), { body: { reason }, idempotencyKey })).data;
  }
}

/* ─────────────── cold chain (W234 · W239 · W240 · W2534–W2538) ─────────────── */
export type ColdSubjectType = 'shipment' | 'bmc_unit' | 'warehouse_chamber' | 'vaccine_box';
export type ColdStatus = 'breach_open' | 'silent' | 'no_threshold' | 'no_reading' | 'excursion' | 'in_range';
export interface ColdReading {
  id: string | null; subjectType: string; subjectId: string; tempC: number; humidityPct: number | null; deviceRef: string | null; isBreach: boolean; excursion: boolean | null;
  band: { minC: number; maxC: number } | null; source: 'device' | 'manual'; deviceId: string | null; recordedAt: string | null; serverRecordedAt: string | null; sequenceNo: string | null;
}
export interface ColdSubjectRow {
  subjectType: ColdSubjectType; subjectId: string; label: string; now: { tempC: string; at: string | null; source: string | null } | null;
  target: { minC: string; maxC: string | null } | null; device: { id: string; serial: string | null; lastReadingAt: string | null } | null; status: ColdStatus;
}
export interface ColdOverview { breaches7d: number; items: ColdSubjectRow[]; silenceMinutes: number; refused: { autoCall: string; signedExport: string } }
export interface ColdBreach {
  id: string; subjectType: ColdSubjectType; subjectId: string; subjectRef: string; device: { id: string; serial: string | null } | null; band: { minC: string; maxC: string };
  direction: 'above' | 'below'; peakC: string; readingsOut: number; firstOutAt: string; openedAt: string; closedAt: string | null; durationSeconds: number | null;
  alert: { state: 'alerted' | 'no_recipient'; recipients: number; id: string | null }; acknowledgedAt: string | null; actionAt: string | null; actionNote: string | null;
  outcome: string | null; outcomeAt: string | null; outcomeReason: string | null; loss: { minor: string; currency: string | null } | null;
  buyer: { offerState: 'none' | 'offered' | 'decided'; offeredAt: string | null; decision: string | null; decidedAt: string | null; reason: string | null; disputeId: string | null };
  playbookRun: Refused; acts: Array<'acknowledge' | 'record_action' | 'record_outcome'>;
}
export interface ColdThreshold { id: string; minC: string; maxC: string; setBy: string | null; reason: string; effectiveFrom: string; createdAt: string }
export interface ColdSubjectDetail {
  subjectType: ColdSubjectType; subjectId: string; label: string; status: ColdStatus; windowHours: number; band: ColdThreshold | null; bandHistory: ColdThreshold[];
  device: { id: string; serial: string | null; lastReadingAt: string | null } | null; trail: ColdReading[]; nextCursor: string | null; breaches: ColdBreach[];
  playbook: { rule: string; manualNeverOpens: boolean; buyerOfferAfterMinutes: number; silenceMinutes: number; alerted: string };
  refused: { bothTenants: string; autoCall: string; playbookRun: string; signedExport: string }; retentionMonths: number;
}
export interface ColdBreachPage {
  items: ColdBreach[]; nextCursor: string | null;
  window: { since: string; months: number | null; hours: number | null; count: number; open: number;
    medianAlertToAction: { kind: 'measured'; seconds: number; over: number; method: string } | { kind: 'refused'; code: string; over: number };
    loss: { kind: 'none_recorded'; breachesWithLoss: 0 } | { kind: 'recorded'; breachesWithLoss: number; totals: Array<{ currency: string; minor: string }> } } | null;
  refused: { playbookRun: string; signedExport: string } | null;
}
export interface ColdLogger {
  deviceId: string; serial: string; label: string | null; status: string; registeredAt: string; lastReadingAt: string | null;
  key: { id: string; hint: string; subjectType: string; subjectId: string; issuedAt: string; issuedBy: string } | null;
}

export class ColdChainResource {
  constructor(private readonly http: HttpClient) {}
  private p(path: string) { return `logistics/cold-chain/${path}`; }
  /** A MANUAL reading: no band, no time (the API refuses both by name) — labelled manual; it never opens a breach. */
  async recordReading(input: { subjectType: ColdSubjectType; subjectId: string; tempC: number; humidityPct?: number | null; deviceRef?: string | null }): Promise<{ id: string; band: { minC: number; maxC: number } | null; isBreach: boolean; label: 'manual'; opensBreach: false }> {
    return (await this.http.request<{ id: string; band: { minC: number; maxC: number } | null; isBreach: boolean; label: 'manual'; opensBreach: false }>('POST', this.p('readings'), { body: input })).data;
  }
  async readings(params: { subjectType: ColdSubjectType; subjectId: string; breachOnly?: boolean; since?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<{ items: ColdReading[]; nextCursor: string | null }> {
    const r = await this.http.request<ColdReading[]>('GET', this.p('readings'), { query: { ...params }, signal });
    return { items: r.data ?? [], nextCursor: ((r.meta ?? {}) as { nextCursor?: string | null }).nextCursor ?? null };
  }
  async setThreshold(input: { subjectType: ColdSubjectType; subjectId: string; minC: number; maxC: number; reason: string }, idempotencyKey: string): Promise<{ id: string; minC: number; maxC: number }> {
    return (await this.http.request<{ id: string; minC: number; maxC: number }>('POST', this.p('thresholds'), { body: input, idempotencyKey })).data;
  }
  async subjects(signal?: AbortSignal): Promise<ColdOverview> { return (await this.http.request<ColdOverview>('GET', this.p('subjects'), { signal })).data; }
  async subject(type: ColdSubjectType, id: string, params: { hours?: number; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ColdSubjectDetail> {
    return (await this.http.request<ColdSubjectDetail>('GET', this.p(`subjects/${type}/${encodeURIComponent(id)}`), { query: { ...params }, signal })).data;
  }
  async breaches(params: { hours?: number; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ColdBreachPage> {
    const r = await this.http.request<ColdBreach[]>('GET', this.p('breaches'), { query: { ...params }, signal });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; window?: ColdBreachPage['window']; refused?: ColdBreachPage['refused'] };
    return { items: r.data ?? [], nextCursor: meta.nextCursor ?? null, window: meta.window ?? null, refused: meta.refused ?? null };
  }
  async breach(id: string, signal?: AbortSignal): Promise<ColdBreach> { return (await this.http.request<ColdBreach>('GET', this.p(`breaches/${encodeURIComponent(id)}`), { signal })).data; }
  /** W2536–W2538: acknowledge · record_action (note ≥ 10) · record_outcome (reason ≥ 10; a loss names its amount + currency). */
  async breachAct(id: string, act: 'acknowledge' | 'record_action' | 'record_outcome', input: { note?: string; outcome?: string; reason?: string; lossMinor?: string | null; lossCurrency?: string | null }, idempotencyKey: string): Promise<{ id: string; act: string }> {
    return (await this.http.request<{ id: string; act: string }>('POST', this.p(`breaches/${encodeURIComponent(id)}/acts/${act}`), { body: input, idempotencyKey })).data;
  }
  async loggers(signal?: AbortSignal): Promise<{ items: ColdLogger[]; silences: Array<{ id: string; deviceId: string; subjectType: string; subjectId: string; lastReadingAt: string; flaggedAt: string; alertState: string; resolvedAt: string | null }>; silenceMinutes: number }> {
    return (await this.http.request<{ items: ColdLogger[]; silences: Array<{ id: string; deviceId: string; subjectType: string; subjectId: string; lastReadingAt: string; flaggedAt: string; alertState: string; resolvedAt: string | null }>; silenceMinutes: number }>('GET', this.p('loggers'), { signal })).data;
  }
  async registerLogger(input: { serial: string; label?: string | null }, idempotencyKey: string): Promise<{ id: string; status: 'registered' }> {
    return (await this.http.request<{ id: string; status: 'registered' }>('POST', this.p('loggers'), { body: input, idempotencyKey })).data;
  }
  /** The signing key is in THIS response only (`keyShown: true`); a replay of the same idempotency key answers `key: null`. */
  async issueKey(deviceId: string, input: { subjectType: ColdSubjectType; subjectId: string; reason: string }, idempotencyKey: string): Promise<{ id: string; deviceId: string; hint: string; key: string | null; keyShown: boolean; revokedKeyId: string | null }> {
    return (await this.http.request<{ id: string; deviceId: string; hint: string; key: string | null; keyShown: boolean; revokedKeyId: string | null }>('POST', this.p(`loggers/${encodeURIComponent(deviceId)}/keys`), { body: input, idempotencyKey })).data;
  }
  async revokeKey(deviceId: string, reason: string, idempotencyKey: string): Promise<{ id: string; status: 'revoked' }> {
    return (await this.http.request<{ id: string; status: 'revoked' }>('POST', this.p(`loggers/${encodeURIComponent(deviceId)}/keys/revoke`), { body: { reason }, idempotencyKey })).data;
  }
  /** W2534 — queued on the 6e-2 plane; the file is UNSIGNED and its receipt says so. Poll `exportsPlane.get(id)`. */
  async exportTrail(input: { subjectType: ColdSubjectType; subjectId: string; days?: number }, idempotencyKey: string): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('POST', this.p('exports/trail'), { body: input, idempotencyKey })).data;
  }
  async exportBreaches(input: { months?: number }, idempotencyKey: string): Promise<ExportJob> {
    return (await this.http.request<ExportJob>('POST', this.p('exports/breaches'), { body: input, idempotencyKey })).data;
  }
  /* the buyer */
  async myOffers(signal?: AbortSignal): Promise<{ items: Array<{ id: string; subjectRef: string; band: { minC: string; maxC: string }; peakC: string; firstOutAt: string; closedAt: string | null; offerState: string; decision: string | null; decidedAt: string | null; disputeId: string | null }> }> {
    return (await this.http.request<{ items: Array<{ id: string; subjectRef: string; band: { minC: string; maxC: string }; peakC: string; firstOutAt: string; closedAt: string | null; offerState: string; decision: string | null; decidedAt: string | null; disputeId: string | null }> }>('GET', 'me/cold-chain-offers', { signal })).data;
  }
  async decideOffer(breachId: string, input: { decision: 'accept' | 'accept_with_test' | 'reject'; reason?: string | null }, idempotencyKey: string): Promise<{ id: string; decision: string; disputeId: string | null; dispute: 'opened' | 'not_yet_eligible' | 'not_applicable' }> {
    return (await this.http.request<{ id: string; decision: string; disputeId: string | null; dispute: 'opened' | 'not_yet_eligible' | 'not_applicable' }>('POST', `me/cold-chain-offers/${encodeURIComponent(breachId)}/decision`, { body: input, idempotencyKey })).data;
  }
}
