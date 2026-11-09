// modules/equipment/repositories/equipment-booking.repository.ts · all SQL for equipment_bookings. tenant_id
// in EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE OF the booking row. The owner
// is not a column here — it is JOINed from equipment_assets (so authz/settlement know the payee). Keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { EquipmentBooking } from '../domain/equipment-booking.entity';
import { RateBasis } from '../domain/equipment.events';
import { RentalStatus } from '../domain/equipment-booking.state';

const SEL = `b.id, b.tenant_id, b.booking_no, b.renter_user_id, b.asset_id, a.owner_user_id, b.operator_user_id,
  b.task_desc, b.rate_basis, b.rate_minor, b.est_quantity, b.actual_quantity, b.scheduled_at, b.status,
  b.advance_minor, b.total_minor, b.start_otp_hash, b.started_at, b.completed_at, b.created_at,
  b.usage_confirmed_by, b.usage_confirmed_at
  FROM equipment_bookings b JOIN equipment_assets a ON a.id = b.asset_id`;
const toCenti = (v: any): bigint => BigInt(Math.round(Number(v) * 100));
function toDomain(r: any): EquipmentBooking {
  return EquipmentBooking.rehydrate({ id: r.id, tenantId: r.tenant_id, bookingNo: r.booking_no, renterUserId: r.renter_user_id, assetId: r.asset_id,
    ownerUserId: r.owner_user_id, operatorUserId: r.operator_user_id, taskDesc: r.task_desc, rateBasis: r.rate_basis as RateBasis, rateMinor: BigInt(r.rate_minor),
    estQuantityCenti: toCenti(r.est_quantity), actualQuantityCenti: r.actual_quantity != null ? toCenti(r.actual_quantity) : null, scheduledAt: r.scheduled_at,
    status: r.status as RentalStatus, advanceMinor: BigInt(r.advance_minor), totalMinor: r.total_minor != null ? BigInt(r.total_minor) : null,
    startOtpHash: r.start_otp_hash, startedAt: r.started_at, completedAt: r.completed_at, createdAt: r.created_at,
    usageConfirmedBy: r.usage_confirmed_by ?? null, usageConfirmedAt: r.usage_confirmed_at ?? null });
}
const centiToNum = (c: bigint) => (Number(c) / 100).toFixed(2);
export interface BookingListQuery { renterUserId?: string; ownerUserId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class EquipmentBookingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, b: EquipmentBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO equipment_bookings (id, tenant_id, booking_no, renter_user_id, asset_id, operator_user_id, task_desc, rate_basis, rate_minor, est_quantity, scheduled_at, status, advance_minor, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$4)`,
      [p.id, p.tenantId, p.bookingNo, p.renterUserId, p.assetId, p.operatorUserId, p.taskDesc, p.rateBasis, p.rateMinor.toString(), centiToNum(p.estQuantityCenti), p.scheduledAt, p.status, p.advanceMinor.toString()]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<EquipmentBooking | null> {
    const r = await tx.query(`SELECT ${SEL} WHERE b.id=$1 AND b.tenant_id=$2 AND b.deleted_at IS NULL FOR UPDATE OF b`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<EquipmentBooking | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${SEL} WHERE b.id=$1 AND b.tenant_id=$2 AND b.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, b: EquipmentBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `UPDATE equipment_bookings SET status=$3, advance_minor=$4, total_minor=$5, actual_quantity=$6, start_otp_hash=$7, started_at=$8, completed_at=$9, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.advanceMinor.toString(), p.totalMinor?.toString() ?? null, p.actualQuantityCenti != null ? centiToNum(p.actualQuantityCenti) : null, p.startOtpHash, p.startedAt, p.completedAt]);
  }
  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] Stamp the renter's confirmation of the hours. Its own statement, writing ONLY the two
   * columns, so the guard (0236) sees a confirmation that moves nothing else; `usage_confirmed_by IS NULL` makes a racing second
   * confirmation update no row. Returns whether a row was stamped.
   */
  async confirmUsage(tx: TxContext, tenantId: string, id: string, by: string, at: Date): Promise<boolean> {
    const r = await tx.query(
      `UPDATE equipment_bookings SET usage_confirmed_by=$3, usage_confirmed_at=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND usage_confirmed_by IS NULL AND status='completed'`,
      [id, tenantId, by, at]);
    return (r.rowCount ?? 0) === 1;
  }
  async listFor(tenantId: string, q: BookingListQuery): Promise<EquipmentBooking[]> {
    const params: unknown[] = [tenantId];
    let where = `b.tenant_id=$1 AND b.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.renterUserId) where += ` AND b.renter_user_id=${p(q.renterUserId)}`;
    if (q.ownerUserId) where += ` AND a.owner_user_id=${p(q.ownerUserId)}`;
    if (q.status) where += ` AND b.status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (b.created_at < ${cc} OR (b.created_at=${cc} AND b.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${SEL} WHERE ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** Worker job (cross-tenant; kv_relay): un-confirmed bookings past their scheduled time. Bounded + SKIP LOCKED. */
  async findDueToTimeout(tx: TxContext, now: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT b.id, b.tenant_id FROM equipment_bookings b
        WHERE b.status IN ('requested','quoted') AND b.scheduled_at < $1 AND b.deleted_at IS NULL
        ORDER BY b.scheduled_at LIMIT $2 FOR UPDATE OF b SKIP LOCKED`, [now, limit]);
    return r.rows.map((row: any) => ({ id: row.id, tenantId: row.tenant_id }));
  }
}
