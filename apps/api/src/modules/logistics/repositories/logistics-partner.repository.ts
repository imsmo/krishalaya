// modules/logistics/repositories/logistics-partner.repository.ts · SQL for logistics_partners (0007). NOT partitioned.
// HYBRID-tenant: tenant_id NULL = platform 3PL (admin-api-written, read-only here); tenant_id set = tenant-owned.
// tenant_id in EVERY query (Law 1) + RLS (0014). Mutations lock the row (no version col). Reads on the replica;
// keyset pagination on (created_at, id) — MICROSECOND-exact since PC-56 TENANT-SW-e (F-14): the cursor carries the instant as the
// database printed it and SQL compares it as timestamptz, so rows written in one millisecond are never skipped.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { LogisticsPartner } from '../domain/logistics-partner.entity';

const COLS = `id, tenant_id, partner_kind, provider_code, default_name, rider_user_id, supports_cold_chain, is_active, created_at,
  contact_phone, status_reason, ${US_SQL('created_at')} AS created_us`;

function toDomain(r: any): LogisticsPartner {
  return LogisticsPartner.rehydrate({
    id: r.id, tenantId: r.tenant_id, partnerKind: r.partner_kind, providerCode: r.provider_code,
    defaultName: r.default_name, riderUserId: r.rider_user_id, supportsColdChain: r.supports_cold_chain,
    isActive: r.is_active, createdAt: r.created_at, contactPhone: r.contact_phone ?? null, statusReason: r.status_reason ?? null, createdUs: r.created_us ?? null,
  });
}

export interface PartnerListQuery {
  partnerKind?: string; activeOnly: boolean; includePlatform: boolean;
  cursor?: { c: string; id: string }; limit: number;
}

/** W228's facts per carrier, each from its own table (never computed in the console). */
export interface CarrierFacts {
  partnerId: string; shipments30d: number; vehicles: number; capacityKg: string; reefer: boolean;
  riderPhone: string | null; riderName: string | null; riderKyc: string | null; riderTerms: boolean; defaultTerms: boolean;
}

@Injectable()
export class LogisticsPartnerRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, e: LogisticsPartner): Promise<void> {
    const p = e.toProps();
    await tx.query(
      `INSERT INTO logistics_partners (id, tenant_id, partner_kind, provider_code, default_name, rider_user_id, supports_cold_chain, is_active, contact_phone, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, nullif(current_setting('app.user_id', true), '')::uuid, now())`,
      [p.id, p.tenantId, p.partnerKind, p.providerCode, p.defaultName, p.riderUserId, p.supportsColdChain, p.isActive, p.contactPhone ?? null]);
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
      `UPDATE logistics_partners SET default_name=$3, provider_code=$4, supports_cold_chain=$5, is_active=$6, contact_phone=$7, status_reason=$8,
              updated_by = nullif(current_setting('app.user_id', true), '')::uuid, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.defaultName, p.providerCode, p.supportsColdChain, p.isActive, p.contactPhone ?? null, p.statusReason ?? null]);
  }

  async list(tenantId: string, q: PartnerListQuery): Promise<LogisticsPartner[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = q.includePlatform ? `(tenant_id=$1 OR tenant_id IS NULL)` : `tenant_id=$1`;
    if (q.partnerKind) where += ` AND partner_kind=${p(q.partnerKind)}`;
    if (q.activeOnly) where += ` AND is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at=${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM logistics_partners WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** PC-56 TENANT-SW-e (W228): shipments assigned in 30 days (to the carrier, or to the rider a rider carrier is), the active
   *  vehicles and their capacity, the rider's KYC on the delivery-partner role (9a projection), the rider's own payout terms or
   *  the organisation's default (wage protection). Pruned on shipments.created_at (Law 8). */
  async carrierFacts(tenantId: string, ids: readonly string[]): Promise<Map<string, CarrierFacts>> {
    const out = new Map<string, CarrierFacts>();
    if (ids.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT p.id,
              (SELECT count(*) FROM shipments s WHERE s.tenant_id=$1 AND s.created_at >= now() - interval '30 days'
                  AND (s.partner_id = p.id OR (p.partner_kind = 'rider' AND p.rider_user_id IS NOT NULL AND s.rider_user_id = p.rider_user_id)))::int AS shipments_30d,
              (SELECT count(*) FROM vehicles v WHERE v.partner_id = p.id AND v.tenant_id=$1 AND v.is_active AND v.deleted_at IS NULL)::int AS vehicles,
              (SELECT coalesce(sum(v.capacity_kg), 0)::text FROM vehicles v WHERE v.partner_id = p.id AND v.tenant_id=$1 AND v.is_active AND v.deleted_at IS NULL) AS capacity_kg,
              (SELECT coalesce(bool_or(v.is_refrigerated), false) FROM vehicles v WHERE v.partner_id = p.id AND v.tenant_id=$1 AND v.is_active AND v.deleted_at IS NULL) AS reefer,
              u.phone AS rider_phone, u.full_name AS rider_name,
              (SELECT utr.kyc_status::text FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                 WHERE utr.tenant_id=$1 AND utr.user_id = p.rider_user_id AND ro.code = 'delivery_partner' AND utr.is_active AND utr.deleted_at IS NULL
                 ORDER BY utr.created_at DESC LIMIT 1) AS rider_kyc,
              EXISTS (SELECT 1 FROM rider_payout_terms t WHERE t.tenant_id=$1 AND t.rider_user_id = p.rider_user_id AND t.deleted_at IS NULL AND t.effective_from <= kv_ist_today()) AS rider_terms,
              EXISTS (SELECT 1 FROM rider_payout_terms t WHERE t.tenant_id=$1 AND t.rider_user_id IS NULL AND t.deleted_at IS NULL AND t.effective_from <= kv_ist_today()) AS default_terms
         FROM logistics_partners p LEFT JOIN users u ON u.id = p.rider_user_id
        WHERE p.id = ANY($2::uuid[]) AND (p.tenant_id=$1 OR p.tenant_id IS NULL)`, [tenantId, [...ids]]);
    for (const x of r.rows as any[]) {
      out.set(x.id, { partnerId: x.id, shipments30d: Number(x.shipments_30d ?? 0), vehicles: Number(x.vehicles ?? 0), capacityKg: String(x.capacity_kg ?? '0'),
        reefer: !!x.reefer, riderPhone: x.rider_phone ?? null, riderName: x.rider_name ?? null, riderKyc: x.rider_kyc ?? null,
        riderTerms: !!x.rider_terms, defaultTerms: !!x.default_terms });
    }
    return out;
  }

  /** Does this person hold the delivery-partner role here (W2378: a rider is a user with the delivery-partner role)? */
  async isDeliveryPartner(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND ro.code='delivery_partner' AND utr.is_active AND utr.deleted_at IS NULL LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** W2378's vehicle line for a tenant fleet / rider carrier, written in the carrier's own transaction. */
  async insertVehicle(tx: TxContext, v: { tenantId: string; partnerId: string; regNo: string; capacityKg: number | null; isRefrigerated: boolean }): Promise<string> {
    const r = await tx.query(
      `INSERT INTO vehicles (tenant_id, partner_id, reg_no, capacity_kg, is_refrigerated, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,true, nullif(current_setting('app.user_id', true), '')::uuid) RETURNING id`,
      [v.tenantId, v.partnerId, v.regNo, v.capacityKg, v.isRefrigerated]);
    return (r.rows[0] as { id: string }).id;
  }
}
