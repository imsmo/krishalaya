// @krishalaya/sdk-js · logistics shipments resource (module 5). Tracks an order's shipment and captures
// PROOF-OF-DELIVERY: the buyer's OTP (issued server-side, 4–8 digits) + an optional signed PoD photo (mediaId).
// The OTP is verified SERVER-SIDE (we send the raw code; the server hashes + compares) — the client never trusts
// itself. `deliver` carries an Idempotency-Key (Law 3) so a retried delivery can't double-fire. Delivery is gated
// to the assigned rider / logistics manager server-side.
import { HttpClient } from '../http';
import {
  Shipment, Page, ShipmentTrail, ShipmentEventFilter, ShipmentEventPage,
  DeliveryRouteDto, FleetMechanisms, FleetRegisterPage, FleetSplit, FleetVehicle, FleetVehicleRow,
  LogisticsPartnerRow, RouteBoardPage, RouteBoardRow, RouteCorridor, RouteCounts,
} from '../types';

export interface RiderPayoutStatement {
  riderUserId: string;
  period: { from: string; to: string };
  currencyCode: string;
  activeTerms: { id: string; termsName: string; effectiveFrom: string; perDropMinor: string; pctOfChargeBps: number; codHandlingMinor: string; failedAttemptMinor: string; scope: string } | null;
  lines: Array<{ shipmentId: string; dateIso: string; termsId: string; outcome: 'delivered' | 'failed'; perDropMinor: string; shareMinor: string; codHandlingMinor: string; totalMinor: string }>;
  deliveredCount: number; failedCount: number; totalMinor: string;
  unpriced: Array<{ shipmentId: string; dateIso: string; reason: string }>;
  settlement: { paid: boolean; note: string };
}

export class ShipmentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Shipments, filterable by order (and `box=mine` for the calling rider's assigned shipments). Keyset-paged. */
  async list(params: { box?: 'all' | 'mine'; orderId?: string; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<Shipment>> {
    const r = await this.http.request<Shipment[]>('GET', 'shipments', {
      query: { box: params.box ?? 'mine', orderId: params.orderId, status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Shipment> {
    return (await this.http.request<Shipment>('GET', `shipments/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Mark delivered with proof-of-delivery: the buyer's OTP (required) + an optional uploaded PoD photo. */
  async deliver(id: string, input: { otp: string; podMediaId?: string }, idempotencyKey: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/deliver`, { idempotencyKey, body: input })).data;
  }
  /** Assigned rider (or manager) posts a live GPS ping (lat/lng + optional note) → appends a tracking point
   *  to the shipment timeline (no status change). Server enforces rider/manager authorization. */
  async postLocation(id: string, loc: { lat: number; lng: number; note?: string }): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `shipments/${encodeURIComponent(id)}/location`, { body: loc })).data;
  }

  /* ---- the dispatcher's three actions (PC-56 TENANT-5a) -------------------------------------------------
   * `POST :id/assign`, `:id/schedule-pickup` and `:id/cancel` have existed on the API since the module was
   * built and had NO SDK METHOD, so no screen could reach them — which is why W227's console is a page of
   * buttons that lead nowhere. Same shape of gap TENANT-4d-3 found on the tenant profile plane. */

  /** Assign a 3PL partner, a vehicle and/or a rider. Refused while the order is unpaid (the money gate). */
  async assign(id: string, input: { partnerId?: string; vehicleId?: string; riderUserId?: string; awbNo?: string }, idempotencyKey?: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/assign`, { idempotencyKey, body: input })).data;
  }
  /** Book the collection. Issues the SELLER's pickup OTP (behind `logistics_pickup_otp`) unless the goods
   *  are collected from the tenant's own premises, where there is nobody to hand over. */
  async schedulePickup(id: string, input: { scheduledPickupAt: string; windowMins?: number; fromOwnPremises?: boolean }, idempotencyKey?: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/schedule-pickup`, { idempotencyKey, body: input })).data;
  }
  /** Cancel the transport. W227 is explicit that this never cancels the SALE — the order stays confirmed. */
  async cancel(id: string, idempotencyKey?: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/cancel`, { idempotencyKey, body: {} })).data;
  }

  /** One shipment's journey (W227's plan, W235's tracking). Coordinates are rounded server-side by role. */
  async trail(id: string, signal?: AbortSignal): Promise<ShipmentTrail> {
    return (await this.http.request<ShipmentTrail>('GET', `shipments/${encodeURIComponent(id)}/trail`, { signal })).data;
  }
  /** W236's event explorer: every hop of every shipment in a date-bounded window, filtered, keyset-paged. */
  async events(params: { from?: string; to?: string; filter?: ShipmentEventFilter; shipmentId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<ShipmentEventPage> {
    return (await this.http.request<ShipmentEventPage>('GET', 'shipments/events', {
      query: { from: params.from, to: params.to, filter: params.filter, shipmentId: params.shipmentId, cursor: params.cursor, limit: params.limit ?? 25 }, signal,
    })).data;
  }

  // --- rider lifecycle (PC-50 W10-5; the server verifies the caller IS the assigned rider) ---
  /** Possession passes to the carrier. `otp` is the SELLER's handover code where one was issued — the
   *  pickup half of "possession changes hands with proof, both directions" (PC-56 TENANT-5a). */
  async markPickedUp(id: string, otp?: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/picked-up`, { body: otp ? { otp } : {} })).data;
  }
  async markInTransit(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/in-transit`, { body: {} })).data;
  }
  async markAtHub(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/at-hub`, { body: {} })).data;
  }
  async markOutForDelivery(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/out-for-delivery`, { body: {} })).data;
  }
  /** A failed attempt keeps the shipment re-attemptable; the reason is required and audited. */
  async fail(id: string, reason: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/fail`, { body: { reason } })).data;
  }

  /** PC-54 W54-2 `cod-recon`: outstanding delivered COD per rider (Manage-gated). Minor strings (Law 2). */
  async codOutstanding(signal?: AbortSignal): Promise<Array<{ riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null }>> {
    return (await this.http.request<Array<{ riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null }>>('GET', 'shipments/cod/outstanding', { signal })).data;
  }

  // --- PC-54 W54-12: iot-device-fleet + ops-alerting v1 (Manage-gated read-models) ---
  async coldChainDevices(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/devices', { signal })).data;
  }
  async coldChainBreaches(params: { hours?: number; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/breaches', { query: { hours: params.hours ?? 24, limit: params.limit ?? 100 }, signal })).data;
  }

  // --- PC-55 A2 `cod-remittance-ledger` (Manage-gated). The TOTAL is server-computed: you may send
  // expectedAmountMinor from the worksheet you were reading, and a stale figure is REFUSED (409) — never
  // silently banked. Create is Idempotency-Keyed; reconcile enforces maker≠checker server-side. ---
  async createCodRemittance(input: { riderUserId: string; shipmentIds?: string[]; expectedAmountMinor?: string; depositRef?: string; depositMethod?: 'bank_branch' | 'cash_office' | 'upi' | 'other'; currencyCode?: string }, idempotencyKey: string): Promise<{ id: string; status: string; amountMinor: string; shipmentCount: number }> {
    return (await this.http.request<{ id: string; status: string; amountMinor: string; shipmentCount: number }>('POST', 'shipments/cod/remittances', { body: input, idempotencyKey })).data;
  }
  async codRemittances(params: { riderUserId?: string; status?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'shipments/cod/remittances', { query: { riderUserId: params.riderUserId, status: params.status, limit: params.limit ?? 100 }, signal })).data;
  }
  async codRemittance(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `shipments/cod/remittances/${encodeURIComponent(id)}`, { signal })).data;
  }
  async depositCodRemittance(id: string, input: { depositRef: string; depositMethod: 'bank_branch' | 'cash_office' | 'upi' | 'other' }): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/deposit`, { body: input })).data;
  }
  async reconcileCodRemittance(id: string, note?: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/reconcile`, { body: note ? { note } : {} })).data;
  }
  async cancelCodRemittance(id: string, reason: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/cancel`, { body: { reason } })).data;
  }

  // --- PC-55 A6 `ops-alert-rules` (Manage-gated). Firing rides the EXISTING notification spine: recipients
  // are platform users whose own preferences and QUIET HOURS still apply — channelHint is a preference, never
  // a bypass. Thresholds are validated per kind server-side, so a typo cannot silently disable a rule. ---
  async createAlertRule(input: { kind: 'cold_chain_breach' | 'device_silent' | 'maintenance_due'; ruleName: string; threshold?: Record<string, unknown>; recipientUserIds: string[]; channelHint?: 'push' | 'sms' | 'whatsapp' | 'email' | 'inapp'; cooldownMinutes?: number }): Promise<{ id: string; kind: string; threshold: Record<string, unknown> }> {
    return (await this.http.request<{ id: string; kind: string; threshold: Record<string, unknown> }>('POST', 'logistics/cold-chain/alert-rules', { body: input })).data;
  }
  async alertRules(params: { kind?: string; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/alert-rules', { query: { kind: params.kind, activeOnly: params.activeOnly }, signal })).data;
  }
  async updateAlertRule(id: string, patch: Record<string, unknown>): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('PATCH', `logistics/cold-chain/alert-rules/${encodeURIComponent(id)}`, { body: patch })).data;
  }
  async alertFeed(params: { kind?: string; severity?: string; unacknowledgedOnly?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/alerts/feed', { query: { kind: params.kind, severity: params.severity, unacknowledgedOnly: params.unacknowledgedOnly, limit: params.limit ?? 100 }, signal })).data;
  }
  async acknowledgeAlert(id: string): Promise<{ id: string; acknowledged: boolean }> {
    return (await this.http.request<{ id: string; acknowledged: boolean }>('POST', `logistics/cold-chain/alerts/${encodeURIComponent(id)}/acknowledge`, { body: {} })).data;
  }
  /** Run the evaluator now (so a freshly written rule can be tested without waiting for the cadence). */
  async evaluateAlertRules(): Promise<{ evaluated: number; fired: number; suppressed: number }> {
    return (await this.http.request<{ evaluated: number; fired: number; suppressed: number }>('POST', 'logistics/cold-chain/alert-rules/evaluate', { body: {} })).data;
  }

  // --- PC-55 A7 `rider-payout-terms`. Terms are APPENDED, never edited: every delivery is priced with the
  // terms in force on ITS OWN date, so an operator cannot change what last week's riding earned. The statement
  // is LEDGERED ARITHMETIC — settlement.paid is always false until real payouts run. ---
  async createRiderPayoutTerms(input: { riderUserId?: string; termsName: string; perDropMinor?: string; pctOfChargeBps?: number; codHandlingMinor?: string; failedAttemptMinor?: string; currencyCode?: string; effectiveFrom: string; notes?: string }): Promise<{ id: string; effectiveFrom: string; scope: string }> {
    return (await this.http.request<{ id: string; effectiveFrom: string; scope: string }>('POST', 'shipments/rider-payout-terms', { body: input })).data;
  }
  async riderPayoutTerms(riderUserId?: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'shipments/rider-payout-terms', { query: { riderUserId }, signal })).data;
  }
  async retireRiderPayoutTerms(id: string): Promise<{ id: string; retired: boolean }> {
    return (await this.http.request<{ id: string; retired: boolean }>('POST', `shipments/rider-payout-terms/${encodeURIComponent(id)}/retire`, { body: {} })).data;
  }
  /** The rider's OWN statement (no Manage permission needed to read one's own pay). */
  async myRiderPayoutStatement(params: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<RiderPayoutStatement> {
    return (await this.http.request<RiderPayoutStatement>('GET', 'shipments/riders/me/payout-statement', { query: { from: params.from, to: params.to }, signal })).data;
  }
  /** An operator reading a specific rider's statement (Manage-gated server-side). */
  async riderPayoutStatement(riderUserId: string, params: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<RiderPayoutStatement> {
    return (await this.http.request<RiderPayoutStatement>('GET', `shipments/riders/${encodeURIComponent(riderUserId)}/payout-statement`, { query: { from: params.from, to: params.to }, signal })).data;
  }
}

/**
 * The FLEET REGISTER and the ROUTE BOARD (PC-56 TENANT-5b).
 *
 * **`POST/GET/PATCH /v1/logistics/vehicles` and `/v1/logistics/routes` have existed since the logistics module
 * was built and this SDK had NO METHOD FOR ANY OF THEM** — so W229 (the fleet register) and W231 (recurring
 * runs) could not be built at all, and the only console that ever reached those endpoints is the 3PL partner
 * app, through the untyped `request()` escape hatch. Same shape of gap TENANT-5a found on assign /
 * schedule-pickup / cancel, and TENANT-4d-3 on the tenant profile before that: an endpoint with no client.
 *
 * Both resources are typed against the api's own read models rather than the raw tables, because what W229 and
 * W231 need is the JUDGEMENT (is this vehicle fit, is this route approvable) and not the columns.
 */
export class FleetResource {
  constructor(private readonly http: HttpClient) {}

  /** W229's register: RC status per vehicle, masked plate, what it is doing today, and which mechanisms are on. */
  async register(params: { activeOnly?: boolean; partnerId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<FleetRegisterPage> {
    const r = await this.http.request<FleetVehicleRow[]>('GET', 'logistics/vehicles/register', { query: { ...params }, signal });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; split?: FleetSplit; mechanisms?: FleetMechanisms };
    return {
      items: r.data ?? [],
      nextCursor: meta.nextCursor ?? null,
      split: meta.split ?? { own: 0, partnered: 0, total: 0 },
      mechanisms: meta.mechanisms ?? { fitnessGate: false, rcParking: false, requireRc: false },
    };
  }

  /** Register a vehicle (W229's [Register vehicle] → W2421/W2422/W2423's confirm/success/failure chain). */
  async createVehicle(input: { partnerId: string; regNo: string; vehicleTypeId?: string; capacityKg?: number; isRefrigerated?: boolean; rcDocId?: string }, idempotencyKey: string): Promise<FleetVehicle> {
    const r = await this.http.request<FleetVehicle>('POST', 'logistics/vehicles', { body: input, idempotencyKey });
    return r.data as FleetVehicle;
  }

  /** Park or un-park a vehicle. The same verb W229's "an expired RC parks the vehicle automatically" uses when
   *  the job does it — one mechanism, whether a person or the clock pulls it. */
  async setVehicleActive(id: string, isActive: boolean): Promise<FleetVehicle> {
    const r = await this.http.request<FleetVehicle>('POST', `logistics/vehicles/${encodeURIComponent(id)}/active`, { body: { isActive } });
    return r.data as FleetVehicle;
  }

  async listPartners(params: { activeOnly?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<LogisticsPartnerRow[]> {
    const r = await this.http.request<LogisticsPartnerRow[]>('GET', 'logistics/partners', { query: { ...params }, signal });
    return r.data ?? [];
  }
}

export class RoutesResource {
  constructor(private readonly http: HttpClient) {}

  /** W231's board: villages by NAME, the consolidation point and their tier, measured parcels per run, and the
   *  economics with the route side named as unrecorded. */
  async board(params: { status?: 'proposed' | 'active' | 'inactive'; runWeekday?: number; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<RouteBoardPage> {
    const r = await this.http.request<RouteBoardRow[]>('GET', 'logistics/routes/board', { query: { ...params }, signal });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; counts?: RouteCounts; windowDays?: number };
    return {
      items: r.data ?? [],
      nextCursor: meta.nextCursor ?? null,
      counts: meta.counts ?? { active: 0, proposed: 0, inactive: 0, total: 0 },
      windowDays: meta.windowDays ?? 0,
    };
  }

  /** The corridors an FPO's parcels already travel — W231's "Suggest routes" honestly: a reading aid a person
   *  turns into a proposal, never a route this platform decided to create. */
  async corridors(signal?: AbortSignal): Promise<{ items: RouteCorridor[]; verdict: { kind: 'corridors_only'; windowDays: number } }> {
    const r = await this.http.request<RouteCorridor[]>('GET', 'logistics/routes/corridors', { signal });
    const meta = (r.meta ?? {}) as { verdict?: { kind: 'corridors_only'; windowDays: number } };
    return { items: r.data ?? [], verdict: meta.verdict ?? { kind: 'corridors_only', windowDays: 0 } };
  }

  /** Create a PROPOSAL (a new route is not a run until it is approved). */
  async create(input: { defaultName: string; runWeekday?: number | null; villageRegionIds: string[]; vehicleId?: string; consolidationUserId?: string }, idempotencyKey: string): Promise<DeliveryRouteDto> {
    const r = await this.http.request<DeliveryRouteDto>('POST', 'logistics/routes', { body: input, idempotencyKey });
    return r.data as DeliveryRouteDto;
  }

  async update(id: string, patch: { defaultName?: string; runWeekday?: number | null; villageRegionIds?: string[]; vehicleId?: string | null; consolidationUserId?: string | null }): Promise<DeliveryRouteDto> {
    const r = await this.http.request<DeliveryRouteDto>('PATCH', `logistics/routes/${encodeURIComponent(id)}`, { body: patch });
    return r.data as DeliveryRouteDto;
  }

  /** W231's [Approve route] — commits the vehicle and the consolidation point weekly, and records who did. */
  async approve(id: string, commit: { vehicleId?: string; consolidationUserId?: string } = {}, idempotencyKey?: string): Promise<DeliveryRouteDto> {
    const r = await this.http.request<DeliveryRouteDto>('POST', `logistics/routes/${encodeURIComponent(id)}/approve`, { body: commit, idempotencyKey });
    return r.data as DeliveryRouteDto;
  }

  /** Suspend a run, or restart one that was approved before. */
  async setActive(id: string, isActive: boolean): Promise<DeliveryRouteDto> {
    const r = await this.http.request<DeliveryRouteDto>('POST', `logistics/routes/${encodeURIComponent(id)}/active`, { body: { isActive } });
    return r.data as DeliveryRouteDto;
  }
}
