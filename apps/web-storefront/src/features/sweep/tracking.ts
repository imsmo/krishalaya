// apps/web-storefront/src/features/sweep/tracking.ts · PC-56 STORE-SWEEP-b · C1 (founder D1 — HOTFIX-9 Q3) — WHAT A BUYER SEES OF A DELIVERY. PURE.
//
// The order page's section `#tracking` (canon W292 is a SECTION of `/<slug>/orders/[id]`, DELTA `tracking_route`) over `api.orders.tracking(id)`,
// the buyer shape of HOTFIX-9 (apps/api orders/domain/tracking-view.ts): the shipment's status, the milestones with their times (status + `at`
// from `shipmentEvents`), "a delivery partner is assigned" from `riderAssigned` (never who), the count of attempts that did not succeed
// (`deliveryAttempts` — a plain count), the partner's reference only when `awbNo` is set. NOTHING ELSE reaches the page, even when a read carries it:
// the rows below are built FIELD BY FIELD (status, at) — a note, a coordinate or a rider id in the answer has no way out of this module.
//
// Behind the ORDER's organisation's `logistics` flag (the 17th allow-listed key — tenant-scoped, fail-closed): OFF → "this organisation does not
// record deliveries here"; unreadable → said; ON → the read, which may fail on its own (its own sentence, never the page — Law 12).

/** The shipment statuses the API knows (apps/api logistics/domain/shipment.state.ts SHIPMENT_STATUSES, in its order). */
export const SHIPMENT_STATUSES = Object.freeze([
  'pending', 'assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'delivered', 'failed', 'returned', 'cancelled',
] as const);
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
const KNOWN: ReadonlySet<string> = new Set(SHIPMENT_STATUSES);
export const isShipmentStatus = (s: unknown): s is ShipmentStatus => typeof s === 'string' && KNOWN.has(s);

/** The read as the section consumes it — the SDK's `OrderTracking` is wider (notes, coordinates, a rider id); only these fields are ever read. */
export interface TrackingRead {
  shipment: { status: string; awbNo?: string | null; riderAssigned?: boolean; deliveryAttempts?: number } | null;
  shipmentEvents: ReadonlyArray<{ status: string; at: string }>;
}
export interface JourneyRow { status: ShipmentStatus; at: string }

/** The milestones in time order. A location ping is a shipment event carrying the CURRENT status again — it is not a milestone: a run of the same
 *  status keeps its first time. Unknown statuses and unparseable times are dropped (never invented, never guessed). */
export function journeyRows(read: TrackingRead | null | undefined): JourneyRow[] {
  const events = (read?.shipmentEvents ?? [])
    .filter((e) => isShipmentStatus(e?.status) && typeof e?.at === 'string' && !Number.isNaN(Date.parse(e.at)))
    .map((e, i) => ({ status: e.status as ShipmentStatus, at: e.at, i }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.i - b.i);
  const rows: JourneyRow[] = [];
  for (const e of events) if (rows.length === 0 || rows[rows.length - 1].status !== e.status) rows.push({ status: e.status, at: e.at });
  return rows;
}

export type FlagState = 'on' | 'off' | 'unknown';
/** The order's organisation's `logistics` flag from the public flags read: no read (it failed) or an answer without the key → unknown. */
export function logisticsFlag(flags: { logistics?: boolean } | null | undefined): FlagState {
  if (!flags || typeof flags.logistics !== 'boolean') return 'unknown';
  return flags.logistics ? 'on' : 'off';
}

/** The read's outcome as the page fetched it: not asked (flag not ON), answered, or failed. */
export type TrackingLoad = { ok: true; data: TrackingRead } | { ok: false } | null;
export type TrackingState = 'off' | 'unknown' | 'error' | 'pending' | 'journey';
/** Which sentence the section prints. `pending` = no shipment yet, or a shipment still `pending` — "no journey updates yet". */
export function trackingState(flag: FlagState, load: TrackingLoad): TrackingState {
  if (flag === 'off') return 'off';
  if (flag === 'unknown') return 'unknown';
  if (!load || !load.ok) return 'error';
  const s = load.data.shipment;
  if (!s || s.status === 'pending') return 'pending';
  return 'journey';
}

/** The facts beside the milestones — each only when the read says so. The assigned line NEVER names who; the attempts are a plain count (no
 *  price, no "free", no ladder); the reference is the partner's own (`awbNo`), never a made-up shipment number. */
export interface PartnerLine { assigned: boolean; attempts: number | null; awb: string | null }
export function partnerLine(shipment: TrackingRead['shipment'] | null | undefined): PartnerLine {
  if (!shipment) return { assigned: false, attempts: null, awb: null };
  const n = shipment.deliveryAttempts;
  const awb = typeof shipment.awbNo === 'string' ? shipment.awbNo.trim() : '';
  return {
    assigned: shipment.riderAssigned === true,
    attempts: typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null,
    awb: awb.length > 0 && awb.length <= 64 ? awb : null,
  };
}

/** The canon W292 claims the section refuses by name (features/sweep/refusals.ts, surface `tracking`). */
export const TRACKING_REFUSED = Object.freeze([
  'map_position', 'delivery_person', 'vehicle_plate', 'eta_slot', 'otp_handover', 'transit_sms', 'reattempt_price', 'returned_refund', 'stop_reasons',
  'store_settings', 'loading',
] as const);
