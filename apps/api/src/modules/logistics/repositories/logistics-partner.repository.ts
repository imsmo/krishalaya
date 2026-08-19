// modules/logistics/repositories/logistics-partner.repository.ts · SQL for logistics_partners (0007). NOT partitioned.
// HYBRID-tenant: tenant_id NULL = platform 3PL (admin-api-written, read-only here); tenant_id set = tenant-owned.
// tenant_id in EVERY query (Law 1) + RLS (0014). Mutations lock the row (no version col). Reads on the replica;
// keyset pagination on (created_at, id). Writes are always scoped to the caller's tenant (never touch NULL rows).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { LogisticsPartner } from '../domain/logistics-partner.entity';

const COLS = `id, tenant_id, partner_kind, provider_code, default_name, rider_user_id, supports_cold_chain, is_active, created_at`;

function toDomain(r: any): LogisticsPartner {
  return LogisticsPartner.rehydrate({
    id: r.id, tenantId: r.tenant_id, partnerKind: r.partner_kind, providerCode: r.provider_code,
    defaultName: r.default_name, riderUserId: r.rider_user_id, supportsColdChain: r.supports_cold_chain,
    isActive: r.is_active, createdAt: r.created_at,
  });
}

export interface PartnerListQuery {
  partnerKind?: string; activeOnly: boolean; includePlatform: boolean;
  cursor?: { c: string; id: string }; limit: number;
}

@Injectable()
export class LogisticsPartnerRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, e: LogisticsPartner): Promise<void> {
    const p = e.toProps();
    await tx.query(
      `INSERT INTO logistics_partners (id, tenant_id, partner_kind, provider_code, default_name, rider_user_id, supports_cold_chain, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [p.id, p.tenantId, p.partnerKind, p.providerCode, p.defaultName, p.riderUserId, p.supportsColdChain, p.isActive]);
  }

  /** Lock a TENANT-OWNED partner for mutation; platform (NULL) rows are never returned (write-protected here). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<LogisticsPartner | null> {
    const r = await tx.query(`SELECT ${COLS} FROM logistics_partners WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Read a partner the tenant may USE: own rows OR platform 3PLs (tenant_id NULL). */
  async getById(tenantId: string, id: string): Promise<LogisticsPartner | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM logistics_partners WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL)`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async update(tx: TxContext, e: LogisticsPartner): Promise<void> {
    const p = e.toProps();
    await tx.query(
      `UPDATE logistics_partners SET default_name=$3, provider_code=$4, supports_cold_chain=$5, is_active=$6, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.defaultName, p.providerCode, p.supportsColdChain, p.isActive]);
  }

  async list(tenantId: string, q: PartnerListQuery): Promise<LogisticsPartner[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = q.includePlatform ? `(tenant_id=$1 OR tenant_id IS NULL)` : `tenant_id=$1`;
    if (q.partnerKind) where += ` AND partner_kind=${p(q.partnerKind)}`;
    if (q.activeOnly) where += ` AND is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM logistics_partners WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
