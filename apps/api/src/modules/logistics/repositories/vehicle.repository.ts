// modules/logistics/repositories/vehicle.repository.ts · SQL for vehicles (0007). NOT partitioned. HYBRID-tenant
// (NULL = platform-3PL vehicle, read-only here). UNIQUE(partner_id, reg_no) → a duplicate plate maps to a typed 409.
// tenant_id in EVERY query (Law 1) + RLS. Mutations lock the row. Reads on the replica; keyset on (created_at, id).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Vehicle } from '../domain/vehicle.entity';
import { DuplicateVehicleRegError } from '../domain/logistics.errors';

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
