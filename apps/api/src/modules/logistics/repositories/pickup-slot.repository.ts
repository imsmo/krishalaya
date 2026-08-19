// modules/logistics/repositories/pickup-slot.repository.ts · SQL for pickup_slots (0007). NOT partitioned. Tenant-
// scoped (tenant_id NOT NULL) and owned by seller_user_id — a seller only ever sees/edits its OWN slots. tenant_id
// in EVERY query (Law 1) + RLS. Mutations lock the row. Reads on the replica; keyset on (created_at, id).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { PickupSlot } from '../domain/pickup-slot.entity';

const COLS = `id, tenant_id, seller_user_id, weekday, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, is_active, created_at`;

function toDomain(r: any): PickupSlot {
  return PickupSlot.rehydrate({
    id: r.id, tenantId: r.tenant_id, sellerUserId: r.seller_user_id, weekday: r.weekday,
    startTime: r.start_time, endTime: r.end_time, isActive: r.is_active, createdAt: r.created_at,
  });
}

export interface PickupSlotListQuery { sellerUserId: string; weekday?: number; activeOnly: boolean; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class PickupSlotRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, s: PickupSlot): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `INSERT INTO pickup_slots (id, tenant_id, seller_user_id, weekday, start_time, end_time, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5::time,$6::time,$7, now())`,
      [p.id, p.tenantId, p.sellerUserId, p.weekday, p.startTime, p.endTime, p.isActive]);
  }

  /** Lock the slot, scoped to tenant AND owning seller — a seller can never mutate another seller's slot. */
  async getForUpdate(tx: TxContext, tenantId: string, sellerUserId: string, id: string): Promise<PickupSlot | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM pickup_slots WHERE id=$1 AND tenant_id=$2 AND seller_user_id=$3 FOR UPDATE`, [id, tenantId, sellerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getById(tenantId: string, sellerUserId: string, id: string): Promise<PickupSlot | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM pickup_slots WHERE id=$1 AND tenant_id=$2 AND seller_user_id=$3`, [id, tenantId, sellerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async update(tx: TxContext, s: PickupSlot): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `UPDATE pickup_slots SET weekday=$4, start_time=$5::time, end_time=$6::time, is_active=$7, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND seller_user_id=$3`,
      [p.id, p.tenantId, p.sellerUserId, p.weekday, p.startTime, p.endTime, p.isActive]);
  }

  async list(tenantId: string, q: PickupSlotListQuery): Promise<PickupSlot[]> {
    const params: unknown[] = [tenantId, q.sellerUserId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND seller_user_id=$2`;
    if (q.weekday !== undefined) where += ` AND weekday=${p(q.weekday)}`;
    if (q.activeOnly) where += ` AND is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM pickup_slots WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
