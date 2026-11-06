// modules/warehousing/repositories/warehouse.repository.ts · all SQL for warehouses. tenant_id may be NULL
// (platform-global / independent WDRA, cross-tenant visible per the 0014 RLS policy). Writes are tenant-
// scoped; browse includes NULL-tenant rows. No version column → mutations lock FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Warehouse } from '../domain/warehouse.entity';

const COLS = `id, tenant_id, operator_user_id, default_name, wdra_reg_no, address_id, capacity_mt, storage_kinds, commodities_accepted, rate_per_qtl_month_minor, insurance_policy_ref, is_active, created_at`;
function toDomain(r: any): Warehouse {
  return Warehouse.rehydrate({ id: r.id, tenantId: r.tenant_id, operatorUserId: r.operator_user_id, defaultName: r.default_name, wdraRegNo: r.wdra_reg_no,
    addressId: r.address_id, capacityMt: r.capacity_mt != null ? String(r.capacity_mt) : null, storageKinds: r.storage_kinds ?? [], commoditiesAccepted: r.commodities_accepted ?? [],
    ratePerQtlMonthMinor: r.rate_per_qtl_month_minor != null ? BigInt(r.rate_per_qtl_month_minor) : null, insurancePolicyRef: r.insurance_policy_ref, isActive: r.is_active, createdAt: r.created_at });
}
export interface WarehouseListQuery { box: 'mine' | 'browse' | 'all'; ownerUserId?: string; activeOnly: boolean; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class WarehouseRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, w: Warehouse): Promise<void> {
    const p = w.toProps();
    await tx.query(
      `INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, wdra_reg_no, address_id, capacity_mt, storage_kinds, commodities_accepted, rate_per_qtl_month_minor, insurance_policy_ref, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$3)`,
      [p.id, p.tenantId, p.operatorUserId, p.defaultName, p.wdraRegNo, p.addressId, p.capacityMt, JSON.stringify(p.storageKinds), JSON.stringify(p.commoditiesAccepted), p.ratePerQtlMonthMinor?.toString() ?? null, p.insurancePolicyRef, p.isActive]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Warehouse | null> {
    const r = await tx.query(`SELECT ${COLS} FROM warehouses WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Read a warehouse usable for booking: the tenant's own OR a platform-global (NULL) one. */
  async getBookable(tenantId: string, id: string, tx?: TxContext): Promise<Warehouse | null> {
    const sql = `SELECT ${COLS} FROM warehouses WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, w: Warehouse): Promise<void> {
    const p = w.toProps();
    await tx.query(
      `UPDATE warehouses SET operator_user_id=$3, default_name=$4, wdra_reg_no=$5, address_id=$6, capacity_mt=$7,
         storage_kinds=$8::jsonb, commodities_accepted=$9::jsonb, rate_per_qtl_month_minor=$10, insurance_policy_ref=$11, is_active=$12, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.operatorUserId, p.defaultName, p.wdraRegNo, p.addressId, p.capacityMt, JSON.stringify(p.storageKinds), JSON.stringify(p.commoditiesAccepted), p.ratePerQtlMonthMinor?.toString() ?? null, p.insurancePolicyRef, p.isActive]);
  }

  /** PC-56 OPS-2c · OPS2-B6: is this user an ACTIVE member of the tenant (any active role, not deleted)? Read in the caller's transaction. */
  async isActiveTenantMember(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles utr JOIN users u ON u.id = utr.user_id
       WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND utr.is_active AND utr.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  async listFor(tenantId: string, q: WarehouseListQuery): Promise<Warehouse[]> {
    const params: unknown[] = [tenantId];
    let where = `deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.box === 'mine') { where += ` AND tenant_id=$1 AND operator_user_id=${p(q.ownerUserId)}`; }
    else if (q.box === 'all') { where += ` AND tenant_id=$1`; }
    else { where += ` AND (tenant_id=$1 OR tenant_id IS NULL)`; }   // browse: own + platform-global
    if (q.activeOnly) where += ` AND is_active=true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM warehouses WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
