// modules/orders/domain/tracking-view.ts · PC-56 HOTFIX-9 · A1 (survey F-1; founder Q3, 2026-10-17) — A BUYER SEES THE JOURNEY, NEVER THE
// DRIVER. PURE.
//
// `GET /v1/orders/:id/tracking` is party-scoped, so the BUYER calls it (the mobile app does, today) — and it answered the delivery rider's user
// uuid (`shipment.riderUserId`), every rider ping's full-precision `lat`/`lng` (numeric(9,6)), and every free-text `note` written by sellers,
// riders and staff on `order_events` / `shipment_events`. Founder Q3: a buyer gets the status milestones with their times, the attempt count and
// the partner's AWB — NO person's id, NO coordinate (not even rounded: no map in Phase 1), NO note. ONE read, TWO shapes, decided by the
// CALLER's role on THIS order (`viewerRoleOf`, the HOTFIX-5 `order-event-roles.ts` precedent):
//   • the buyer   → every note `null`, `riderUserId` `null`, every `lat`/`lng` `null` — the field names and their `T | null` nullability are
//                   KEPT (the mobile app and the SDK `OrderTracking` read them), a buyer simply always receives `null`. Built FIELD BY FIELD
//                   (an allow-list), never a spread, so a column added to the full row later cannot reach a buyer by default;
//   • the seller and staff (`moderator`) → the full row they had, unchanged.
// Both shapes gain two facts a buyer may know: `riderAssigned` (a rider is assigned — never who) and `deliveryAttempts`
// (`shipments.delivery_attempts`, the counter `Shipment.markFailed` keeps).
import type { OrderViewerRole } from './order-event-roles';

export interface OrderEventPoint { fromStatus: string | null; toStatus: string; at: string; note: string | null; }
export interface ShipmentEventPoint { status: string; at: string; lat: number | null; lng: number | null; note: string | null; }
/** The shipment as the read model loads it (before the viewer shape). */
export interface TrackingShipmentRow {
  id: string; status: string; riderUserId: string | null; awbNo: string | null;
  scheduledPickupAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  deliveryAttempts: number;
}
/** The shipment as a caller receives it. `riderUserId` is always `null` for a buyer (Q3). */
export interface TrackingShipment extends TrackingShipmentRow { riderAssigned: boolean; }
export interface OrderTrackingFull {
  orderId: string; status: string; createdAt: string; completedAt: string | null;
  orderEvents: OrderEventPoint[];
  shipment: TrackingShipmentRow | null;
  shipmentEvents: ShipmentEventPoint[];
}
export interface OrderTracking {
  orderId: string; status: string; createdAt: string; completedAt: string | null;
  orderEvents: OrderEventPoint[];
  shipment: TrackingShipment | null;
  shipmentEvents: ShipmentEventPoint[];
}

/** The tracking answer for `role`. Pure: no I/O, no clock. */
export function trackingFor(role: OrderViewerRole, full: OrderTrackingFull): OrderTracking {
  const s = full.shipment;
  if (role !== 'buyer') {
    return { ...full, shipment: s ? { ...s, riderAssigned: s.riderUserId != null } : null };
  }
  return {
    orderId: full.orderId, status: full.status, createdAt: full.createdAt, completedAt: full.completedAt,
    orderEvents: full.orderEvents.map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, at: e.at,
      note: null })),                                                   // HOTFIX-9 buyer: no order note
    shipment: s ? {
      id: s.id, status: s.status, awbNo: s.awbNo,
      riderUserId: null,                                                // HOTFIX-9 buyer: no rider id
      riderAssigned: s.riderUserId != null,
      scheduledPickupAt: s.scheduledPickupAt, pickedUpAt: s.pickedUpAt, deliveredAt: s.deliveredAt,
      deliveryAttempts: s.deliveryAttempts,
    } : null,
    shipmentEvents: full.shipmentEvents.map((e) => ({ status: e.status, at: e.at,
      lat: null, lng: null,                                             // HOTFIX-9 buyer: no coordinate, not even rounded
      note: null })),                                                   // HOTFIX-9 buyer: no shipment note
  };
}
