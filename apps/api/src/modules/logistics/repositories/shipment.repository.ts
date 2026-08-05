// modules/logistics/repositories/shipment.repository.ts
// shipments + shipment_events are PARTITIONED by created_at (PK includes created_at). CRITICAL (Law 8):
// every point lookup derives created_at from the v7 id via uuid_v7_time() so PostgreSQL prunes to ONE
// partition. tenant_id in EVERY query (Law 1) + RLS (auto-applied by migration 0014). No version
// column → mutations LOCK the row with SELECT … FOR UPDATE. Reads on the replica; status changes append
// an immutable shipment_events tracking row.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Shipment, ShipmentProps } from '../domain/shipment.entity';
import { ShipmentStatus } from '../domain/shipment.state';

// PC-54 W54-2 `cod-recon` read-model row: delivered COD not yet remitted, grouped per rider.
export interface CodOutstandingRow { riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null; }

const COLS = `id, tenant_id, order_id, partner_id, vehicle_id, rider_user_id, status, awb_no, pickup_address_id,
  drop_address_id, scheduled_pickup_at, scheduled_window_mins, picked_up_at, delivered_at, pickup_otp_hash,
  delivery_otp_hash, pod_media_id, charge_minor, cod_minor, requires_cold_chain, created_at`;
const PRUNE = `created_at >= uuid_v7_time($1) - interval '5 seconds' AND created_at < uuid_v7_time($1) + interval '5 seconds'`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Shipment {
  return Shipment.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, partnerId: r.partner_id, vehicleId: r.vehicle_id, riderUserId: r.rider_user_id,
    status: r.status as ShipmentStatus, awbNo: r.awb_no, pickupAddressId: r.pickup_address_id, dropAddressId: r.drop_address_id,
    scheduledPickupAt: r.scheduled_pickup_at, scheduledWindowMins: r.scheduled_window_mins, pickedUpAt: r.picked_up_at, deliveredAt: r.delivered_at,
    pickupOtpHash: r.pickup_otp_hash, deliveryOtpHash: r.delivery_otp_hash, podMediaId: r.pod_media_id,
    chargeMinor: big(r.charge_minor), codMinor: big(r.cod_minor), requiresColdChain: r.requires_cold_chain, createdAt: r.created_at,
  });
}
export interface ShipmentListQuery { status?: string; orderId?: string; riderUserId?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ShipmentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, s: Shipment): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `INSERT INTO shipments (id, tenant_id, order_id, partner_id, vehicle_id, rider_user_id, status, awb_no,
         pickup_address_id, drop_address_id, scheduled_pickup_at, scheduled_window_mins, picked_up_at, delivered_at,
         pickup_otp_hash, delivery_otp_hash, pod_media_id, charge_minor, cod_minor, requires_cold_chain, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [p.id, p.tenantId, p.orderId, p.partnerId, p.vehicleId, p.riderUserId, p.status, p.awbNo, p.pickupAddressId,
       p.dropAddressId, p.scheduledPickupAt, p.scheduledWindowMins, p.pickedUpAt, p.deliveredAt, p.pickupOtpHash,
       p.deliveryOtpHash, p.podMediaId, p.chargeMinor?.toString() ?? null, p.codMinor?.toString() ?? null, p.requiresColdChain, p.createdAt]);
    await this.recordEvent(tx, p.tenantId, p.id, p.status, 'shipment created');
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Shipment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM shipments WHERE id=$1 AND tenant_id=$2 AND ${PRUNE} FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Shipment | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM shipments WHERE id=$1 AND tenant_id=$2 AND ${PRUNE}`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Idempotency guard for the order-confirmed handler: is there already a shipment for this order? */
  async existsForOrder(tx: TxContext, tenantId: string, orderId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM shipments WHERE tenant_id=$1 AND order_id=$2 LIMIT 1`, [tenantId, orderId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** No version column → unconditional update within the FOR UPDATE-locked tx; appends a tracking event. */
  async update(tx: TxContext, s: Shipment, fromStatus: ShipmentStatus): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `UPDATE shipments SET partner_id=$4, vehicle_id=$5, rider_user_id=$6, status=$7, awb_no=$8,
         scheduled_pickup_at=$9, scheduled_window_mins=$10, picked_up_at=$11, delivered_at=$12,
         delivery_otp_hash=$13, pod_media_id=$14, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND created_at=$3`,
      [p.id, p.tenantId, p.createdAt, p.partnerId, p.vehicleId, p.riderUserId, p.status, p.awbNo,
       p.scheduledPickupAt, p.scheduledWindowMins, p.pickedUpAt, p.deliveredAt, p.deliveryOtpHash, p.podMediaId]);
    if (fromStatus !== p.status) await this.recordEvent(tx, p.tenantId, p.id, p.status, null);
  }

  async recordEvent(tx: TxContext, tenantId: string, shipmentId: string, status: ShipmentStatus, note: string | null): Promise<void> {
    await tx.query(
      `INSERT INTO shipment_events (id, shipment_id, tenant_id, status, note) VALUES (uuid_generate_v7(),$1,$2,$3,$4)`,
      [shipmentId, tenantId, status, note]);
  }

  /** Append a rider LOCATION ping (lat/lng) at the shipment's CURRENT status — a tracking point, not a
   *  state change (status is unchanged; the event row carries the coordinates + optional note). */
  async insertLocationEvent(tx: TxContext, tenantId: string, shipmentId: string, status: ShipmentStatus, lat: number, lng: number, note: string | null): Promise<void> {
    await tx.query(
      `INSERT INTO shipment_events (id, shipment_id, tenant_id, status, lat, lng, note) VALUES (uuid_generate_v7(),$1,$2,$3,$4,$5,$6)`,
      [shipmentId, tenantId, status, lat, lng, note]);
  }

  async listFor(tenantId: string, q: ShipmentListQuery): Promise<Shipment[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.orderId) where += ` AND order_id=${p(q.orderId)}`;
    if (q.riderUserId) where += ` AND rider_user_id=${p(q.riderUserId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM shipments WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** PC-54 W54-2 `cod-recon`: outstanding cash per rider — DELIVERED shipments with COD > 0.
   *  PC-55 A2 CORRECTION (the honesty fix that makes this number true over time): shipments whose cash has
   *  already been remitted (linked in cod_remittance_shipments, 0082) are EXCLUDED — otherwise a rider who
   *  banked their cash would keep showing the same outstanding total forever and the worksheet would
   *  double-count every subsequent batch. Cancelling a remittance deletes its links, so that cash correctly
   *  reappears here. Still computed from ledgered rows only — never a fabricated total. */
  async codOutstanding(tenantId: string): Promise<CodOutstandingRow[]> {
    const r = await this.replica.forTenant(tenantId).query<{ rider_user_id: string | null; shipments: string; cod_minor: string; oldest: Date | null }>(
      `SELECT rider_user_id, COUNT(*)::text AS shipments, COALESCE(SUM(cod_minor),0)::text AS cod_minor, MIN(delivered_at) AS oldest
         FROM shipments s WHERE s.tenant_id=$1 AND s.status='delivered' AND s.cod_minor > 0 AND s.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM cod_remittance_shipments l WHERE l.shipment_id = s.id)
        GROUP BY rider_user_id ORDER BY cod_minor::numeric DESC LIMIT 200`, [tenantId]);
    return r.rows.map((row) => ({ riderUserId: row.rider_user_id, shipments: Number(row.shipments), codMinor: row.cod_minor, oldestDeliveredAt: row.oldest ? row.oldest.toISOString() : null }));
  }
}
