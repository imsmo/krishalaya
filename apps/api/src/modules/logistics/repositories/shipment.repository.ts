// modules/logistics/repositories/shipment.repository.ts
// shipments + shipment_events are PARTITIONED by created_at (PK includes created_at). CRITICAL (Law 8):
// every point lookup derives created_at from the v7 id via uuid_v7_time() so PostgreSQL prunes to ONE
// partition. tenant_id in EVERY query (Law 1) + RLS (auto-applied by migration 0014). No version
// column → mutations LOCK the row with SELECT … FOR UPDATE. Reads on the replica; status changes append
// an immutable shipment_events tracking row.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ShipmentUpdateLostError } from '../domain/logistics.errors';
import { Shipment } from '../domain/shipment.entity';
import { ShipmentStatus } from '../domain/shipment.state';

// PC-54 W54-2 `cod-recon` read-model row: delivered COD not yet remitted, grouped per rider.
export interface CodOutstandingRow { riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null; }

const COLS = `id, tenant_id, order_id, partner_id, vehicle_id, rider_user_id, status, awb_no, pickup_address_id,
  drop_address_id, scheduled_pickup_at, scheduled_window_mins, picked_up_at, delivered_at, pickup_otp_hash,
  delivery_otp_hash, pod_media_id, charge_minor, cod_minor, requires_cold_chain, created_at, delivery_attempts`;
const PRUNE = `created_at >= uuid_v7_time($1) - interval '5 seconds' AND created_at < uuid_v7_time($1) + interval '5 seconds'`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Shipment {
  return Shipment.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, partnerId: r.partner_id, vehicleId: r.vehicle_id, riderUserId: r.rider_user_id,
    status: r.status as ShipmentStatus, awbNo: r.awb_no, pickupAddressId: r.pickup_address_id, dropAddressId: r.drop_address_id,
    scheduledPickupAt: r.scheduled_pickup_at, scheduledWindowMins: r.scheduled_window_mins, pickedUpAt: r.picked_up_at, deliveredAt: r.delivered_at,
    pickupOtpHash: r.pickup_otp_hash, deliveryOtpHash: r.delivery_otp_hash, podMediaId: r.pod_media_id,
    chargeMinor: big(r.charge_minor), codMinor: big(r.cod_minor), requiresColdChain: r.requires_cold_chain, createdAt: r.created_at,
    deliveryAttempts: Number(r.delivery_attempts ?? 0),
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
         pickup_otp_hash, delivery_otp_hash, pod_media_id, charge_minor, cod_minor, requires_cold_chain, created_at,
         delivery_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [p.id, p.tenantId, p.orderId, p.partnerId, p.vehicleId, p.riderUserId, p.status, p.awbNo, p.pickupAddressId,
       p.dropAddressId, p.scheduledPickupAt, p.scheduledWindowMins, p.pickedUpAt, p.deliveredAt, p.pickupOtpHash,
       p.deliveryOtpHash, p.podMediaId, p.chargeMinor?.toString() ?? null, p.codMinor?.toString() ?? null, p.requiresColdChain, p.createdAt,
       p.deliveryAttempts]);
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

  /**
   * Persist a mutated shipment inside its FOR UPDATE-locked transaction, and append the tracking event for the hop.
   *
   * **(PC-56 TENANT-5d, FOUND LIVE) THIS STATEMENT COULD MATCH ZERO ROWS AND SAY NOTHING.** The predicate carries
   * `created_at=$3` — it is the partition key, so it must be there — and PostgreSQL keeps MICROSECONDS while JS reads
   * milliseconds. A shipment row created by SQL `now()` (a fixture, a backfill, an importer, a data fix) therefore has
   * a `created_at` the app can never match, the UPDATE affects nothing, and this method returned `void`: nobody could
   * tell. Worse, the event row below was written REGARDLESS, so `shipment_events` recorded a failed delivery attempt
   * while `shipments` still said `out_for_delivery` with zero attempts — the database contradicting its own history.
   *
   * TENANT-5a named exactly this shape one plane over (`OrderRepository.update` matching zero rows on microsecond
   * `created_at`, with `ShipmentDeliveredHandler` ignoring the false it returned) and escalated the lock predicate as
   * a founder decision, because widening it touches every write. This wave does not widen it either — but it refuses
   * to let the silent half stand: a zero-row update now THROWS, which rolls the transaction back, writes no event, and
   * emits no outbox row. Fail closed (Law 12): a write that moves twelve quintals of produce may fail loudly, and may
   * not vanish.
   */
  async update(tx: TxContext, s: Shipment, fromStatus: ShipmentStatus): Promise<void> {
    const p = s.toProps();
    const res = await tx.query(
      // **`pickup_otp_hash` WAS NOT IN THIS UPDATE (PC-56 TENANT-5a).** The column has existed since 0007 and
      // this statement wrote every other mutable field, so even if something HAD issued a pickup code the
      // very next update would have silently dropped it — a second reason the two-way possession proof could
      // never have worked, independent of nothing issuing one. `delivery_attempts` joins for the same reason:
      // a counter that is not persisted counts to one for ever.
      `UPDATE shipments SET partner_id=$4, vehicle_id=$5, rider_user_id=$6, status=$7, awb_no=$8,
         scheduled_pickup_at=$9, scheduled_window_mins=$10, picked_up_at=$11, delivered_at=$12,
         delivery_otp_hash=$13, pod_media_id=$14, pickup_otp_hash=$15, delivery_attempts=$16, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND created_at=$3`,
      [p.id, p.tenantId, p.createdAt, p.partnerId, p.vehicleId, p.riderUserId, p.status, p.awbNo,
       p.scheduledPickupAt, p.scheduledWindowMins, p.pickedUpAt, p.deliveredAt, p.deliveryOtpHash, p.podMediaId,
       p.pickupOtpHash, p.deliveryAttempts]);
    // `rowCount` is null for statements the driver cannot count; only a definite ZERO is treated as a lost update.
    if (res.rowCount === 0) throw new ShipmentUpdateLostError(p.id);
    if (fromStatus !== p.status) {
      // PC-56 TENANT-5d: the hop's own annotation, instead of the NULL this line passed since 0007. That NULL is why
      // the reason a delivery failed was recorded nowhere in this database.
      const ann = s.pendingEventAnnotation();
      await this.recordEvent(tx, p.tenantId, p.id, p.status, ann.note, ann.reasonCode);
    }
  }

  async recordEvent(tx: TxContext, tenantId: string, shipmentId: string, status: ShipmentStatus, note: string | null, reasonCode: string | null = null): Promise<void> {
    await tx.query(
      `INSERT INTO shipment_events (id, shipment_id, tenant_id, status, note, reason_code) VALUES (uuid_generate_v7(),$1,$2,$3,$4,$5)`,
      [shipmentId, tenantId, status, note, reasonCode]);
  }

  /** Append a rider LOCATION ping (lat/lng) at the shipment's CURRENT status — a tracking point, not a
   *  state change (status is unchanged; the event row carries the coordinates + optional note). */
  async insertLocationEvent(tx: TxContext, tenantId: string, shipmentId: string, status: ShipmentStatus, lat: number, lng: number, note: string | null): Promise<void> {
    await tx.query(
      `INSERT INTO shipment_events (id, shipment_id, tenant_id, status, lat, lng, note) VALUES (uuid_generate_v7(),$1,$2,$3,$4,$5,$6)`,
      [shipmentId, tenantId, status, lat, lng, note]);
  }

  /**
   * **THE PER-SHIPMENT TRAIL (PC-56 TENANT-5a) — the first read of `shipment_events` this module has ever
   * had.** Powers W227's journey plan and W235's live tracking. Ascending, because a trail is read forwards.
   *
   * Bounded: a shipment collecting a GPS breadcrumb every 90 seconds over a two-day inter-district run has
   * ~2,000 points, and a console that renders all of them has stopped being a console. `limit` is the
   * caller's and the read reports whether it truncated, so the view says "showing the last N" rather than
   * quietly drawing a shorter journey than the one that happened.
   *
   * PRUNED to the shipment's own partition via `uuid_v7_time` on its id (Law 8) — `shipment_events` is
   * partitioned by `created_at` and its events are written after the shipment row, so the window opens at
   * the shipment's creation instant and runs to now.
   */
  async trailFor(tenantId: string, shipmentId: string, limit = 500): Promise<Array<{ at: Date; status: string; lat: number | null; lng: number | null; note: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT created_at, status, lat, lng, note
         FROM shipment_events
        WHERE tenant_id=$1 AND shipment_id=$2
          -- BOTH BOUNDS, and the upper one is not decoration. With only the lower bound this pruned the
          -- partitions OLDER than the shipment and then scanned every partition from its creation forward —
          -- including every future month the partition runway has already created (16 of them on a fresh
          -- database, proven by EXPLAIN). An event cannot precede its shipment and cannot be in the future,
          -- so the window is [shipment created, now] and the planner prunes to the one or two partitions a
          -- live shipment's trail actually occupies.
          AND created_at >= uuid_v7_time($2) - interval '5 seconds'
          AND created_at <= now()
        ORDER BY created_at ASC, id ASC
        LIMIT $3`, [tenantId, shipmentId, limit + 1]);
    return r.rows.slice(0, limit).map((x: any) => ({
      at: x.created_at, status: x.status,
      lat: x.lat === null ? null : Number(x.lat), lng: x.lng === null ? null : Number(x.lng), note: x.note,
    }));
  }

  /**
   * **W236's EVENT EXPLORER — every hop of every shipment, in a window (PC-56 TENANT-5a).**
   *
   * Date-bounded by construction: the caller resolves the window (domain/shipment-event-explorer.ts) and it
   * is always present, which is both the canon's rule ("date-bounded queries only") and what prunes the
   * partitions. Keyset on `(created_at, id)` DESC — never OFFSET — served by 0151's new index.
   *
   * The FILTERS are applied in SQL rather than after the read, because a filter that runs in the
   * application over one page returns four rows out of twenty-five and calls it "4 of 312".
   */
  async explore(tenantId: string, q: { from: string; to: string; filter: string; shipmentId?: string; cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ id: string; at: Date; shipmentId: string; status: string; lat: number | null; lng: number | null; note: string | null }>> {
    const params: unknown[] = [tenantId, q.from, `${q.to} 23:59:59.999999+00`];
    let where = `tenant_id=$1 AND created_at >= $2::date AND created_at <= $3::timestamptz`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.shipmentId) where += ` AND shipment_id=${p(q.shipmentId)}`;
    // The four questions an operator actually asks at 09:00 — a fixed vocabulary, not a query builder.
    if (q.filter === 'failed') where += ` AND status='failed'`;
    else if (q.filter === 'at_hub') where += ` AND status='at_hub'`;
    // "door-open ≥60s" is written into the note by the cold-chain plane; matched on the recorded phrase
    // rather than a parsed number, because the number lives in prose and inventing a column for it here
    // would be this read deciding a schema.
    else if (q.filter === 'door_open') where += ` AND note ILIKE '%door-open%'`;
    // A GPS gap cannot be asked of ONE row — it is a property of consecutive points — so the filter narrows
    // to located events and `isGpsGap()` marks the segments. Stated here so the SQL is not mistaken for the
    // whole answer.
    else if (q.filter === 'gps_gap') where += ` AND lat IS NOT NULL`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, created_at, shipment_id, status, lat, lng, note
         FROM shipment_events WHERE ${where}
        ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, at: x.created_at, shipmentId: x.shipment_id, status: x.status,
      lat: x.lat === null ? null : Number(x.lat), lng: x.lng === null ? null : Number(x.lng), note: x.note,
    }));
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
