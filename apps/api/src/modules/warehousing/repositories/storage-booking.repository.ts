// modules/warehousing/repositories/storage-booking.repository.ts · all SQL for storage_bookings. tenant_id
// in EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Reads on replica; keyset.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { parseQuantityMilli, formatQuantityMilli } from '../domain/quantity';
import { StorageBooking } from '../domain/storage-booking.entity';
import { BookingStatus } from '../domain/storage-booking.state';

const COLS = `id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, expected_arrival, status, stored_at, released_at, created_at`;
const d = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
// PC-56 OPS-2c · OPS2-B23 (F-13): the numeric(12,3) quantity is parsed from and printed to its STRING, digit by digit — never through a float.
const toMilli = (v: string): bigint => parseQuantityMilli(v);
const milliToNum = (m: bigint): string => formatQuantityMilli(m);
function toDomain(r: any): StorageBooking {
  return StorageBooking.rehydrate({ id: r.id, tenantId: r.tenant_id, warehouseId: r.warehouse_id, depositorUserId: r.depositor_user_id, productId: r.product_id,
    quantityMilli: toMilli(r.quantity), unitCode: r.unit_code, expectedArrival: d(r.expected_arrival), status: r.status as BookingStatus, storedAt: r.stored_at, releasedAt: r.released_at, createdAt: r.created_at });
}
export interface BookingListQuery { depositorUserId?: string; warehouseId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class StorageBookingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, b: StorageBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO storage_bookings (id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, expected_arrival, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$4)`,
      [p.id, p.tenantId, p.warehouseId, p.depositorUserId, p.productId, milliToNum(p.quantityMilli), p.unitCode, p.expectedArrival, p.status]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<StorageBooking | null> {
    const r = await tx.query(`SELECT ${COLS} FROM storage_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<StorageBooking | null> {
    const sql = `SELECT ${COLS} FROM storage_bookings WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, b: StorageBooking): Promise<void> {
    const p = b.toProps();
    await tx.query(`UPDATE storage_bookings SET status=$3, stored_at=$4, released_at=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.status, p.storedAt, p.releasedAt]);
  }
  async listFor(tenantId: string, q: BookingListQuery): Promise<StorageBooking[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.depositorUserId) where += ` AND depositor_user_id=${p(q.depositorUserId)}`;
    if (q.warehouseId) where += ` AND warehouse_id=${p(q.warehouseId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM storage_bookings WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
