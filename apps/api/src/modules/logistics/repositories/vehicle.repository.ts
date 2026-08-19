// modules/logistics/repositories/vehicle.repository.ts · SQL for vehicles (0007). NOT partitioned. HYBRID-tenant
// (NULL = platform-3PL vehicle, read-only here). UNIQUE(partner_id, reg_no) → a duplicate plate maps to a typed 409.
// tenant_id in EVERY query (Law 1) + RLS. Mutations lock the row. Reads on the replica; keyset on (created_at, id).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { Vehicle } from '../domain/vehicle.entity';
import { DuplicateVehicleRegError } from '../domain/logistics.errors';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

const COLS = `id, tenant_id, partner_id, reg_no, vehicle_type_id, capacity_kg, is_refrigerated, rc_doc_id, is_active, created_at`;
const num = (v: any) => (v == null ? null : Number(v));

function toDomain(r: any): Vehicle {
  return Vehicle.rehydrate({
    id: r.id, tenantId: r.tenant_id, partnerId: r.partner_id, regNo: r.reg_no, vehicleTypeId: r.vehicle_type_id,
    capacityKg: num(r.capacity_kg), isRefrigerated: r.is_refrigerated, rcDocId: r.rc_doc_id,
    isActive: r.is_active, createdAt: r.created_at,
  });
}

export interface VehicleListQuery { partnerId?: string; activeOnly: boolean; cursor?: { c: string; id: string }; limit: number; }

/** W229's register row, straight from SQL (PC-56 TENANT-5b). The RC fields are the FIRST READ of
 *  `vehicles.rc_doc_id` anywhere in the monorepo — from 0007 to this wave it was written, echoed back as a uuid
 *  and never joined to the `kyc_documents` row it points at. */
export interface RegisterRow {
  id: string; scope: 'tenant' | 'platform'; partnerId: string; partnerName: string | null; partnerKind: string | null;
  regNo: string; typeCode: string | null; capacityKg: number | null; isRefrigerated: boolean; isActive: boolean;
  rcDocId: string | null; rcStatus: string | null; rcValidUntil: string | null; createdAt: Date | null;
}
export interface VehicleTodayRow { vehicleId: string; onRoad: number; deliveredToday: number; assignedToday: number }
export interface VehicleRunRow { vehicleId: string; routeName: string; weekday: number }
export interface VehicleReeferRow { vehicleId: string; tempC: number; isBreach: boolean }
/** A vehicle the RC-parking job may park, with the evidence of WHY (cross-tenant; kv_relay). */
export interface RcExpiredRow { id: string; tenantId: string | null; regNo: string; rcStatus: string; rcValidUntil: string | null }

@Injectable()
export class VehicleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, v: Vehicle): Promise<void> {
    const p = v.toProps();
    try {
      await tx.query(
        `INSERT INTO vehicles (id, tenant_id, partner_id, reg_no, vehicle_type_id, capacity_kg, is_refrigerated, rc_doc_id, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
        [p.id, p.tenantId, p.partnerId, p.regNo, p.vehicleTypeId, p.capacityKg, p.isRefrigerated, p.rcDocId, p.isActive]);
    } catch (e: any) {
      if (e?.code === '23505') throw new DuplicateVehicleRegError(p.regNo);
      throw e;
    }
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Vehicle | null> {
    const r = await tx.query(`SELECT ${COLS} FROM vehicles WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<Vehicle | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM vehicles WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async update(tx: TxContext, v: Vehicle): Promise<void> {
    const p = v.toProps();
    await tx.query(
      `UPDATE vehicles SET vehicle_type_id=$3, capacity_kg=$4, is_refrigerated=$5, rc_doc_id=$6, is_active=$7, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.vehicleTypeId, p.capacityKg, p.isRefrigerated, p.rcDocId, p.isActive]);
  }

  /**
   * **W229's fleet register — one query, and the first join to a vehicle's RC (PC-56 TENANT-5b).**
   *
   * `lookup_values` gives the type its CODE (`tempo`, `reefer_7mt`) which the console translates; the seeded
   * English label never reaches a screen that ships in three languages. `kyc_documents` gives the RC its status
   * and expiry — the two facts "an expired RC parks the vehicle" needs and nothing had ever read.
   *
   * A PLATFORM vehicle (`tenant_id IS NULL`, a 3PL's own lorry browsed here under Law 11) will usually show a
   * null RC even when the document exists, because that row belongs to the partner's realm and RLS is doing its
   * job. That is not "no RC on file" and the read model must not report it as one — it is W229's own fourth
   * row, which prints **"3PL-held"** against the Shadowfax reefer.
   */
  async registerRows(tenantId: string, q: VehicleListQuery): Promise<RegisterRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `(v.tenant_id=$1 OR v.tenant_id IS NULL) AND v.deleted_at IS NULL`;
    if (q.partnerId) where += ` AND v.partner_id=${p(q.partnerId)}`;
    if (q.activeOnly) where += ` AND v.is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (v.created_at < ${cc} OR (v.created_at=${cc} AND v.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT v.id, v.tenant_id, v.partner_id, v.reg_no, v.capacity_kg, v.is_refrigerated, v.is_active, v.created_at,
              v.rc_doc_id, lv.code AS type_code, d.status AS rc_status, d.valid_until AS rc_valid_until,
              lp2.default_name AS partner_name, lp2.partner_kind
         FROM vehicles v
         LEFT JOIN lookup_values lv ON lv.id = v.vehicle_type_id
         LEFT JOIN kyc_documents d ON d.id = v.rc_doc_id AND d.deleted_at IS NULL
         LEFT JOIN logistics_partners lp2 ON lp2.id = v.partner_id
        WHERE ${where}
        ORDER BY v.created_at DESC, v.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, scope: x.tenant_id == null ? 'platform' : 'tenant', partnerId: x.partner_id,
      partnerName: x.partner_name ?? null, partnerKind: x.partner_kind ?? null,
      regNo: x.reg_no, typeCode: x.type_code ?? null, capacityKg: num(x.capacity_kg),
      isRefrigerated: x.is_refrigerated, isActive: x.is_active, rcDocId: x.rc_doc_id ?? null,
      rcStatus: x.rc_status ?? null,
      rcValidUntil: x.rc_valid_until ? pgDate(x.rc_valid_until) : null,
      createdAt: x.created_at ?? null,
    }));
  }

  /**
   * W229's "Today" column, counted (PC-56 TENANT-5b).
   *
   * BOUNDED to 90 days of `created_at` so the partitioned `shipments` table prunes (Law 8) — a shipment still
   * on the road after three months is a data problem, not a run, and the register says "idle" rather than
   * scanning every partition since launch to find it. `delivered_today` is counted on the delivery DATE, which
   * is what "2 runs done" means on a dispatcher's morning.
   */
  async todayFor(tenantId: string, vehicleIds: readonly string[]): Promise<VehicleTodayRow[]> {
    if (vehicleIds.length === 0) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT vehicle_id,
              count(*) FILTER (WHERE status IN ('picked_up','in_transit','at_hub','out_for_delivery'))::int AS on_road,
              count(*) FILTER (WHERE status = 'delivered' AND delivered_at::date = (now())::date)::int AS delivered_today,
              count(*) FILTER (WHERE status = 'assigned')::int AS assigned_today
         FROM shipments
        WHERE tenant_id=$1 AND vehicle_id = ANY($2::uuid[])
          AND created_at >= now() - interval '90 days' AND created_at <= now()
        GROUP BY vehicle_id`, [tenantId, [...vehicleIds]]);
    return r.rows.map((x: any) => ({ vehicleId: x.vehicle_id, onRoad: Number(x.on_road), deliveredToday: Number(x.delivered_today), assignedToday: Number(x.assigned_today) }));
  }

  /** The recurring run a vehicle is committed to — W229's "Village Run — loads Sat 05:00", minus the 05:00,
   *  which no column holds (`delivery_routes` carries a WEEKDAY and no time of day). Approved routes only: a
   *  proposal commits nothing. */
  async nextRunFor(tenantId: string, vehicleIds: readonly string[]): Promise<VehicleRunRow[]> {
    if (vehicleIds.length === 0) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT DISTINCT ON (vehicle_id) vehicle_id, default_name, run_weekday
         FROM delivery_routes
        WHERE tenant_id=$1 AND vehicle_id = ANY($2::uuid[]) AND status = 'active'
          AND run_weekday IS NOT NULL AND deleted_at IS NULL
        ORDER BY vehicle_id, run_weekday, id`, [tenantId, [...vehicleIds]]);
    return r.rows.map((x: any) => ({ vehicleId: x.vehicle_id, routeName: x.default_name, weekday: Number(x.run_weekday) }));
  }

  /**
   * W229's "ghee run · 4.2°C" — the latest cold-chain reading for the consignment a vehicle is CARRYING.
   *
   * `cold_chain_logs.subject_type` is one of 'shipment','bmc_unit','warehouse_chamber','vaccine_box' — there is
   * no 'vehicle' subject, and inventing one would be a second place to record the same temperature. So the
   * reading is the shipment's, read through the vehicle carrying it, which is also the truth: a reefer parked
   * empty overnight has no temperature worth showing a dispatcher.
   *
   * The `recorded_at` bound is what prunes the partitioned log table (Law 8).
   */
  async reeferFor(tenantId: string, vehicleIds: readonly string[]): Promise<VehicleReeferRow[]> {
    if (vehicleIds.length === 0) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, c.temp_c, c.is_breach
         FROM shipments s
         JOIN cold_chain_logs c ON c.subject_type = 'shipment' AND c.subject_id = s.id
        WHERE s.tenant_id=$1 AND s.vehicle_id = ANY($2::uuid[])
          AND s.status IN ('picked_up','in_transit','at_hub','out_for_delivery')
          AND s.created_at >= now() - interval '90 days' AND s.created_at <= now()
          AND c.recorded_at >= now() - interval '24 hours' AND c.recorded_at <= now()
        ORDER BY s.vehicle_id, c.recorded_at DESC`, [tenantId, [...vehicleIds]]);
    return r.rows.map((x: any) => ({ vehicleId: x.vehicle_id, tempC: Number(x.temp_c), isBreach: x.is_breach === true }));
  }

  /** ONE vehicle's fitness inputs, inside the caller's transaction — the money gate's neighbour on the write
   *  path of every assignment. Tenant-scoped OR platform-visible, exactly as `getById`. */
  async fitnessOf(tx: TxContext, tenantId: string, vehicleId: string): Promise<{ id: string; scope: 'tenant' | 'platform'; isActive: boolean; isRefrigerated: boolean; capacityKg: number | null; rcStatus: string | null; rcValidUntil: string | null } | null> {
    const r = await tx.query(
      `SELECT v.id, v.tenant_id, v.is_active, v.is_refrigerated, v.capacity_kg,
              d.status AS rc_status, d.valid_until AS rc_valid_until
         FROM vehicles v
         LEFT JOIN kyc_documents d ON d.id = v.rc_doc_id AND d.deleted_at IS NULL
        WHERE v.id=$1 AND (v.tenant_id=$2 OR v.tenant_id IS NULL) AND v.deleted_at IS NULL`, [vehicleId, tenantId]);
    const x: any = r.rows[0];
    if (!x) return null;
    return { id: x.id, scope: x.tenant_id == null ? 'platform' : 'tenant', isActive: x.is_active, isRefrigerated: x.is_refrigerated,
      capacityKg: num(x.capacity_kg), rcStatus: x.rc_status ?? null, rcValidUntil: x.rc_valid_until ? pgDate(x.rc_valid_until) : null };
  }

  /**
   * The RC-parking job's finder (PC-56 TENANT-5b): active vehicles whose registration certificate is
   * verified-but-expired, or rejected. Cross-tenant (kv_relay), bounded, ordered by id so a partial batch
   * resumes deterministically.
   *
   * A PLATFORM vehicle (`tenant_id IS NULL`) is deliberately included: an expired RC on a 3PL's lorry is the
   * same lorry on the same road. Its partner is told through the event; the platform does not silently keep it
   * moving because the paperwork belongs to somebody else.
   */
  async rcInvalidActive(exec: SqlExecutor, limit: number): Promise<RcExpiredRow[]> {
    const r = await exec.query(
      `SELECT v.id, v.tenant_id, v.reg_no, d.status AS rc_status, d.valid_until
         FROM vehicles v
         JOIN kyc_documents d ON d.id = v.rc_doc_id AND d.deleted_at IS NULL
        WHERE v.is_active = true AND v.deleted_at IS NULL
          AND ( (d.status = 'verified' AND d.valid_until IS NOT NULL AND d.valid_until < current_date)
                OR d.status = 'rejected' )
        ORDER BY v.id LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id ?? null, regNo: x.reg_no, rcStatus: x.rc_status,
      rcValidUntil: x.valid_until ? pgDate(x.valid_until) : null }));
  }

  /** Park one vehicle (the job's write). Conditional on it still being active, so two racing ticks park it
   *  once and the second reports zero rather than double-auditing. */
  async park(exec: SqlExecutor, vehicleId: string): Promise<boolean> {
    const r = await exec.query(`UPDATE vehicles SET is_active=false, updated_at=now() WHERE id=$1 AND is_active=true`, [vehicleId]);
    return (r.rowCount ?? 0) > 0;
  }

  async list(tenantId: string, q: VehicleListQuery): Promise<Vehicle[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `(tenant_id=$1 OR tenant_id IS NULL)`;
    if (q.partnerId) where += ` AND partner_id=${p(q.partnerId)}`;
    if (q.activeOnly) where += ` AND is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM vehicles WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
