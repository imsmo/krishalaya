// modules/logistics/repositories/delivery-zone-proposal.repository.ts · PC-56 TENANT-SW-a · B2 — SQL for delivery_zone_proposals (0196)
// and the gated zone writes a confirmation makes. tenant_id in every query + RLS (FORCE). The writes to delivery_zones below run ONLY in
// the confirming transaction with app.zone_proposal_id set (0196 trg_delivery_zones_gate admits nothing else).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export type ZoneProposalKind = 'create' | 'repoint_fee' | 'deactivate' | 'activate';
export type ZoneProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired';
export interface ZoneProposalRow {
  id: string; tenantId: string; kind: ZoneProposalKind; zoneId: string; defaultName: string | null; pincodes: string[] | null; regionIds: string[] | null;
  chargeDefinitionId: string | null; reason: string; proposedBy: string; proposedAt: string; expiresAt: string; status: ZoneProposalStatus;
  confirmedBy: string | null; confirmedAt: string | null; refusedBy: string | null; refusedAt: string | null; refuseReason: string | null; expiredAt: string | null; createdAt: string;
}
const COLS = `id, tenant_id, kind, zone_id, default_name, pincodes, region_ids, charge_definition_id, reason, proposed_by, proposed_at, expires_at, status,
  confirmed_by, confirmed_at, refused_by, refused_at, refuse_reason, expired_at, ${US_SQL('created_at')} AS created_us`;
const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
const arr = (v: any): string[] | null => (Array.isArray(v) ? v.map(String) : null);
function toRow(r: any): ZoneProposalRow {
  return { id: r.id, tenantId: r.tenant_id, kind: r.kind, zoneId: r.zone_id, defaultName: r.default_name, pincodes: arr(r.pincodes), regionIds: arr(r.region_ids),
    chargeDefinitionId: r.charge_definition_id, reason: r.reason, proposedBy: r.proposed_by, proposedAt: iso(r.proposed_at)!, expiresAt: iso(r.expires_at)!,
    status: r.status, confirmedBy: r.confirmed_by, confirmedAt: iso(r.confirmed_at), refusedBy: r.refused_by, refusedAt: iso(r.refused_at),
    refuseReason: r.refuse_reason, expiredAt: iso(r.expired_at), createdAt: r.created_us };
}

@Injectable()
export class DeliveryZoneProposalRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertTx(tx: TxContext, p: { id: string; tenantId: string; kind: ZoneProposalKind; zoneId: string; defaultName: string | null; pincodes: string[] | null;
    regionIds: string[] | null; chargeDefinitionId: string | null; reason: string; proposedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO delivery_zone_proposals (id, tenant_id, kind, zone_id, default_name, pincodes, region_ids, charge_definition_id, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10, now(), now() + interval '7 days')`,
      [p.id, p.tenantId, p.kind, p.zoneId, p.defaultName, p.pincodes ? JSON.stringify(p.pincodes) : null, p.regionIds ? JSON.stringify(p.regionIds) : null,
       p.chargeDefinitionId, p.reason, p.proposedBy]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ZoneProposalRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM delivery_zone_proposals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<ZoneProposalRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM delivery_zone_proposals WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async confirmTx(tx: TxContext, tenantId: string, id: string, by: string): Promise<void> {
    await tx.query(`UPDATE delivery_zone_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by]);
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE delivery_zone_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, reason]);
  }
  async markExpiredTx(tx: TxContext, tenantId: string, id: string): Promise<number> {
    const r = await tx.query(`UPDATE delivery_zone_proposals SET status='expired', expired_at=now() WHERE id=$1 AND tenant_id=$2 AND status='proposed' AND expires_at <= now()`, [id, tenantId]);
    return r.rowCount ?? 0;
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM delivery_zone_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x) => x.id);
  }
  async list(tenantId: string, q: { status?: ZoneProposalStatus; zoneId?: string; cursor?: { ts: string; id: string }; limit: number }): Promise<ZoneProposalRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.zoneId) where += ` AND zone_id=${p(q.zoneId)}::uuid`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM delivery_zone_proposals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toRow);
  }

  /* ── the gated zone writes (inside the confirming transaction, app.zone_proposal_id set) ── */
  async insertZoneTx(tx: TxContext, z: { id: string; tenantId: string; defaultName: string; pincodes: string[]; regionIds: string[]; chargeDefinitionId: string | null; proposalId: string; createdBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO delivery_zones (id, tenant_id, default_name, pincodes, region_ids, charge_definition_id, is_active, proposal_id, created_by, created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,true,$7,$8, now())`,
      [z.id, z.tenantId, z.defaultName, JSON.stringify(z.pincodes), JSON.stringify(z.regionIds), z.chargeDefinitionId, z.proposalId, z.createdBy]);
  }
  async repointTx(tx: TxContext, tenantId: string, zoneId: string, chargeDefinitionId: string | null, proposalId: string): Promise<number> {
    const r = await tx.query(`UPDATE delivery_zones SET charge_definition_id=$3, proposal_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [zoneId, tenantId, chargeDefinitionId, proposalId]);
    return r.rowCount ?? 0;
  }
  async setActiveTx(tx: TxContext, tenantId: string, zoneId: string, isActive: boolean, proposalId: string): Promise<number> {
    const r = await tx.query(`UPDATE delivery_zones SET is_active=$3, proposal_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [zoneId, tenantId, isActive, proposalId]);
    return r.rowCount ?? 0;
  }
  /** Name / pincodes / regions — the direct, audited act (serviceability, not money). */
  async updateCoverageTx(tx: TxContext, tenantId: string, zoneId: string, c: { defaultName: string; pincodes: string[]; regionIds: string[] }): Promise<number> {
    const r = await tx.query(`UPDATE delivery_zones SET default_name=$3, pincodes=$4::jsonb, region_ids=$5::jsonb, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [zoneId, tenantId, c.defaultName, JSON.stringify(c.pincodes), JSON.stringify(c.regionIds)]);
    return r.rowCount ?? 0;
  }
  /** Is this definition one a zone fee may point at (a W150-approved definition of this tenant)? The trigger re-checks. */
  async definitionApprovedTx(tx: TxContext, tenantId: string, defId: string): Promise<boolean> {
    const r = await tx.query<{ ok: boolean }>(`SELECT kv_charge_definition_checker_passed($1, $2) ok`, [tenantId, defId]);
    return r.rows[0]?.ok === true;
  }
  /** The fee definitions a zone may point at, for the console's picker. */
  async approvedDefinitions(tenantId: string): Promise<Array<{ id: string; chargeCode: string; label: string | null; calcMethod: string; effectiveFrom: string; effectiveTo: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.id, d.charge_code, d.label, d.calc_method, d.effective_from::text ef, d.effective_to::text et FROM charge_definitions d
        WHERE d.tenant_id=$1 AND d.is_active AND d.deleted_at IS NULL AND kv_charge_definition_checker_passed($1, d.id) ORDER BY d.charge_code, d.effective_from DESC LIMIT 200`, [tenantId]);
    return r.rows.map((x: any) => ({ id: x.id, chargeCode: x.charge_code, label: x.label, calcMethod: x.calc_method, effectiveFrom: x.ef, effectiveTo: x.et ?? null }));
  }
}
