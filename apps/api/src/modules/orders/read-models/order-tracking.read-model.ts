// modules/orders/read-models/order-tracking.read-model.ts
// CQRS read path (Law 12) for the buyer/seller order-TRACKING view (mobile screen 131, order-detail 23).
// Party-authorised: the caller must be the order's buyer or seller (or a moderator) — reuses
// OrderRepository.getVisible (not-yours ⇒ not-found, no enumeration). Returns the REAL stamped timelines:
//   • order_events   — every order-status transition (from→to) with its timestamp + note (per-step times).
//   • shipment (+ shipment_events) — the delivery status timeline with each transition's timestamp and, when
//     a rider has posted one, a lat/lng ping (logistics tracking feed).
// This is a read-only cross-table projection over the SAME DB (like DeliveryZoneRepository already used here) —
// tenant_id in every query (Law 1) + RLS via the replica GUC is the net. No ETA field exists in any contract,
// so the caller (screen) shows ETA as "—" rather than a fabricated one (§13). lat/lng are geo coordinates (not
// money) so plain numbers are fine (Law 2 governs money only). Reads on the replica; degrade-never-die upstream.
//
// PC-56 HOTFIX-9 · A1 (survey F-1; founder Q3, 2026-10-17) — A BUYER SEES THE JOURNEY, NEVER THE DRIVER. This read handed the BUYER the
// delivery rider's user uuid, every rider ping's full-precision lat/lng and every free-text note sellers, riders and staff wrote on the order
// and the shipment. It is now VIEWER-SHAPED, the HOTFIX-5 `order-event-roles.ts` precedent: after `getVisible`, the caller's role on THIS order
// (`viewerRoleOf`) picks the shape in the pure `domain/tracking-view.ts` `trackingFor` — the buyer gets the milestones and their times, the
// attempt count (`shipments.delivery_attempts`), the partner's AWB and `riderAssigned` (a rider is assigned — never who); `riderUserId`, every
// `lat`/`lng` (null, NOT rounded — no coordinates in Phase 1) and every `note` reach a buyer as `null`. The seller and staff keep the full row
// (plus the same two fields). Enforced HERE, in the API — never "the UI hides it".
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { OrderNotFoundError } from '../domain/orders.errors';
import { OrderRepository } from '../repositories/order.repository';
import { viewerRoleOf } from '../domain/order-event-roles';
import { OrderEventPoint, OrderTracking, ShipmentEventPoint, TrackingShipmentRow, trackingFor } from '../domain/tracking-view';

export type { OrderEventPoint, OrderTracking, ShipmentEventPoint, TrackingShipment } from '../domain/tracking-view';
export interface OrderActorRef { userId: string; canModerate: boolean; }

const num = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

@Injectable()
export class OrderTrackingReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly orders: OrderRepository,
  ) {}

  async tracking(tenantId: string, actor: OrderActorRef, orderId: string): Promise<OrderTracking> {
    // 1) party authorisation — buyer/seller/moderator only (not-yours ⇒ not-found).
    const order = await this.orders.getVisible(tenantId, orderId, actor.userId, actor.canModerate);
    if (!order) throw new OrderNotFoundError(orderId);
    const o = order.toProps();
    const db = this.replica.forTenant(tenantId);

    // 2) order-status transition timeline (real per-step timestamps). Bounded (few rows/order).
    const oe = await db.query(
      `SELECT from_status, to_status, note, created_at FROM order_events
         WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at ASC`, [tenantId, orderId]);
    const orderEvents: OrderEventPoint[] = oe.rows.map((r: any) => ({ fromStatus: r.from_status ?? null, toStatus: r.to_status, at: iso(r.created_at), note: r.note ?? null }));

    // 3) the order's shipment (latest) + its status/location timeline.
    const sh = await db.query(
      `SELECT id, status, rider_user_id, awb_no, scheduled_pickup_at, picked_up_at, delivered_at, delivery_attempts
         FROM shipments WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, orderId]);
    let shipment: TrackingShipmentRow | null = null;
    let shipmentEvents: ShipmentEventPoint[] = [];
    if (sh.rows[0]) {
      const s = sh.rows[0];
      shipment = { id: s.id, status: s.status, riderUserId: s.rider_user_id ?? null, awbNo: s.awb_no ?? null,
        scheduledPickupAt: s.scheduled_pickup_at ? iso(s.scheduled_pickup_at) : null,
        pickedUpAt: s.picked_up_at ? iso(s.picked_up_at) : null, deliveredAt: s.delivered_at ? iso(s.delivered_at) : null,
        deliveryAttempts: Number(s.delivery_attempts ?? 0) };
      const se = await db.query(
        `SELECT status, lat, lng, note, created_at FROM shipment_events
           WHERE tenant_id=$1 AND shipment_id=$2 ORDER BY created_at ASC`, [tenantId, shipment.id]);
      shipmentEvents = se.rows.map((r: any) => ({ status: r.status, at: iso(r.created_at), lat: num(r.lat), lng: num(r.lng), note: r.note ?? null }));
    }

    // 4) PC-56 HOTFIX-9: the caller's role on THIS order picks the shape (buyer: milestones and times only — founder Q3).
    return trackingFor(viewerRoleOf(actor, { buyerUserId: o.buyerUserId, sellerUserId: o.sellerUserId }),
      { orderId, status: o.status, createdAt: iso(o.createdAt), completedAt: o.completedAt ? iso(o.completedAt) : null, orderEvents, shipment, shipmentEvents });
  }
}
