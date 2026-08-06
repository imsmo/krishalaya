// apps/admin-api/src/modules/compliance-ops/repositories/compliance.repository.ts · ALL SQL for the god-mode
// DPDP/compliance plane. Reads are platform-wide (god-mode, Law 11) but parameterised + bounded + keyset (never
// OFFSET). Writes run in the caller's tx (PoolClient). The audit-log explorer keysets over (created_at,id) — the
// PARTITION KEY first — so PG prunes to one partition (Law 8). No PII is selected beyond what the schema already
// holds (audit payloads are PII-free by writer contract; DSR/breach store categories + uuids, not raw PII).
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { DataSubjectRequest } from '../domain/dsr.entity';
import { DsrStatus } from '../domain/dsr.state';
import { Breach } from '../domain/breach.entity';
import { BreachStatus } from '../domain/breach.state';

function toDsr(r: any): DataSubjectRequest {
  return DataSubjectRequest.rehydrate({ id: r.id, userId: r.user_id, requestType: r.request_type, status: r.status as DsrStatus,
    coolingEndsAt: r.cooling_ends_at ?? null, resolution: r.resolution ?? null, exportMediaId: r.export_media_id ?? null,
    acknowledgedAt: r.acknowledged_at ?? null, rejectionGround: r.rejection_ground ?? null,
    countersignedBy: r.countersigned_by ?? null, countersignedAt: r.countersigned_at ?? null,
    scopeComputedAt: r.scope_computed_at ?? null, updatedBy: r.updated_by ?? null,
    createdAt: r.created_at ?? null });
}
function toBreach(r: any): Breach {
  return Breach.rehydrate({ id: r.id, affectedTenantId: r.affected_tenant_id ?? null, status: r.status as BreachStatus, severity: r.severity,
    title: r.title, affectedCount: Number(r.affected_count ?? 0), detectedAt: r.detected_at, containedAt: r.contained_at ?? null,
    regulatorNotifiedAt: r.regulator_notified_at ?? null, principalsNotifiedAt: r.principals_notified_at ?? null,
    closedAt: r.closed_at ?? null, resolutionNote: r.resolution_note ?? null, createdAt: r.created_at ?? null });
}

export interface KeysetCursor { c: string; id: string }
export interface DsrListQuery { status?: DsrStatus; requestType?: string; cursor?: KeysetCursor; limit: number; }
export interface ExportListQuery { approvalStatus?: string; jobKind?: string; cursor?: KeysetCursor; limit: number; }
export interface AuditQuery { actorUserId?: string; entityType?: string; entityId?: string; action?: string; tenantId?: string; from?: string; to?: string; cursor?: { ts: string; id: string }; limit: number; }
export interface BreachListQuery { status?: BreachStatus; cursor?: KeysetCursor; limit: number; }

@Injectable()
export class ComplianceRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ---------------- data-subject requests (DPDP) ---------------- */
  async getDsrForUpdate(client: PoolClient, id: string): Promise<DataSubjectRequest | null> {
    const r = await client.query(`SELECT * FROM data_subject_requests WHERE id=$1 FOR UPDATE`, [id]);
    return r.rows[0] ? toDsr(r.rows[0]) : null;
  }
  async updateDsr(client: PoolClient, dsr: DataSubjectRequest, actorUserId: string): Promise<void> {
    const p = dsr.toJSON();
    await client.query(
      `UPDATE data_subject_requests
          SET status=$2, resolution=$3, export_media_id=$4, rejection_ground=$5, acknowledged_at=$6,
              scope_computed_at=$7, updated_by=$8, updated_at=now()
        WHERE id=$1`,
      [p.id, p.status, p.resolution, p.exportMediaId, p.rejectionGround, p.acknowledgedAt, p.scopeComputedAt, actorUserId]);
  }

  /** The countersign is a SEPARATE statement, not folded into `updateDsr`, and that is the point: it must be written by
   *  a DIFFERENT actor than `updated_by`, and `ck_dsr_countersign_ne_actor` compares the two columns. Writing both in
   *  one UPDATE would let a single statement set them to the same value and only fail at the constraint — the split
   *  makes the two-person rule visible in the code as well as in the schema. */
  async countersignDsr(client: PoolClient, id: string, countersignedBy: string): Promise<void> {
    await client.query(
      `UPDATE data_subject_requests SET countersigned_by=$2, countersigned_at=now() WHERE id=$1`,
      [id, countersignedBy]);
  }

  /* ---------------- the erasure scope + its evidence (0107) ---------------- */

  /** The retention policies the scope preview is computed from. ALL of them, active or not — `computeScope` needs to
   *  tell "no policy configured" apart from "every policy is switched off", and filtering here would erase that. */
  async retentionPoliciesForScope(): Promise<Array<{ tableName: string; action: string; legalBasis: string | null; activeMonths: number; archiveMonths: number | null; isActive: boolean }>> {
    const r = await this.pool.query(
      `SELECT table_name, action, legal_basis, active_months, archive_months, is_active
         FROM data_retention_policies WHERE deleted_at IS NULL ORDER BY table_name`);
    return r.rows.map((x: any) => ({
      tableName: x.table_name, action: x.action, legalBasis: x.legal_basis ?? null,
      activeMonths: Number(x.active_months ?? 0),
      archiveMonths: x.archive_months === null || x.archive_months === undefined ? null : Number(x.archive_months),
      isActive: x.is_active === true,
    }));
  }

  /** What an erasure has actually done, per data class. Read on the detail screen and by the completion guard. */
  async erasureActions(requestId: string): Promise<Array<{ dataClass: string; action: string; rowsAffected: number; legalBasis: string | null; executedBy: string; executedAt: Date; note: string | null }>> {
    const r = await this.pool.query(
      `SELECT data_class, action, rows_affected, legal_basis, executed_by, executed_at, note
         FROM dsr_erasure_actions WHERE request_id=$1 ORDER BY executed_at DESC, data_class`, [requestId]);
    return r.rows.map((x: any) => ({
      dataClass: x.data_class, action: x.action, rowsAffected: Number(x.rows_affected ?? 0),
      legalBasis: x.legal_basis ?? null, executedBy: x.executed_by, executedAt: x.executed_at, note: x.note ?? null,
    }));
  }

  /** Locked read inside the completion transaction. The guard must not race an executor writing the last class. */
  async erasureActionsForUpdate(client: PoolClient, requestId: string): Promise<Array<{ dataClass: string; action: string }>> {
    const r = await client.query(
      `SELECT data_class, action FROM dsr_erasure_actions WHERE request_id=$1 FOR SHARE`, [requestId]);
    return r.rows.map((x: any) => ({ dataClass: x.data_class, action: x.action }));
  }

  /** Record what was done to one data class. Append-only — there is no update path, by grant (0107). */
  async insertErasureAction(client: PoolClient, v: { requestId: string; dataClass: string; action: string; rowsAffected: number; legalBasis: string | null; executedBy: string; note: string | null }): Promise<void> {
    await client.query(
      `INSERT INTO dsr_erasure_actions (request_id, data_class, action, rows_affected, legal_basis, executed_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [v.requestId, v.dataClass, v.action, v.rowsAffected, v.legalBasis, v.executedBy, v.note]);
  }

  /** The SLA rollup for W041's tiles. Cross-request, bounded to the current financial year by the caller. */
  async dsrSlaRows(sinceIso: string): Promise<Array<{ id: string; status: string; requestType: string; createdAt: Date; acknowledgedAt: Date | null; coolingEndsAt: Date | null; decidedAt: Date | null }>> {
    const r = await this.pool.query(
      `SELECT id, status, request_type, created_at, acknowledged_at, cooling_ends_at,
              CASE WHEN status IN ('completed','rejected') THEN updated_at ELSE NULL END AS decided_at
         FROM data_subject_requests
        WHERE created_at >= $1::timestamptz AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 5000`, [sinceIso]);
    return r.rows.map((x: any) => ({
      id: x.id, status: x.status, requestType: x.request_type, createdAt: x.created_at,
      acknowledgedAt: x.acknowledged_at ?? null, coolingEndsAt: x.cooling_ends_at ?? null, decidedAt: x.decided_at ?? null,
    }));
  }
  async getDsr(id: string): Promise<DataSubjectRequest | null> {
    const r = await this.pool.query(`SELECT * FROM data_subject_requests WHERE id=$1`, [id]);
    return r.rows[0] ? toDsr(r.rows[0]) : null;
  }
  async listDsr(q: DsrListQuery): Promise<DataSubjectRequest[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.requestType) where += ` AND request_type=${p(q.requestType)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT * FROM data_subject_requests WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDsr);
  }

  /* ---------------- data export approvals ---------------- */
  async getExportForUpdate(client: PoolClient, id: string): Promise<{ id: string; approvalStatus: string; jobKind: string; tenantId: string | null } | null> {
    const r = await client.query(`SELECT id, approval_status, job_kind, tenant_id FROM data_export_jobs WHERE id=$1 FOR UPDATE`, [id]);
    const x = r.rows[0];
    return x ? { id: x.id, approvalStatus: x.approval_status, jobKind: x.job_kind, tenantId: x.tenant_id ?? null } : null;
  }
  async decideExport(client: PoolClient, id: string, next: 'approved' | 'rejected', actorUserId: string, reason: string): Promise<void> {
    await client.query(
      `UPDATE data_export_jobs SET approval_status=$2, approved_by=$3, approved_at=now(), rejected_reason=$4, updated_by=$3, updated_at=now() WHERE id=$1`,
      [id, next, actorUserId, next === 'rejected' ? reason : null]);
  }
  async listExports(q: ExportListQuery): Promise<any[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.approvalStatus) where += ` AND approval_status=${p(q.approvalStatus)}`;
    if (q.jobKind) where += ` AND job_kind=${p(q.jobKind)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, tenant_id, user_id, job_kind, status, approval_status, expires_at, created_at FROM data_export_jobs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, userId: x.user_id, jobKind: x.job_kind, status: x.status, approvalStatus: x.approval_status, expiresAt: x.expires_at, createdAt: x.created_at }));
  }

  /* ---------------- audit-log explorer (read-only, partition-pruned keyset) ---------------- */
  async explorerAudit(q: AuditQuery): Promise<any[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = '1=1';
    if (q.from) where += ` AND created_at >= ${p(q.from)}`;            // partition prune
    if (q.to) where += ` AND created_at <= ${p(q.to)}`;
    if (q.actorUserId) where += ` AND actor_user_id=${p(q.actorUserId)}`;
    if (q.entityType) where += ` AND entity_type=${p(q.entityType)}`;
    if (q.entityId) where += ` AND entity_id=${p(q.entityId)}`;
    if (q.action) where += ` AND action=${p(q.action)}`;
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id::text AS id, tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, reason, ip::text AS ip, request_id, created_at
         FROM audit_log WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, actorUserId: x.actor_user_id, actorRole: x.actor_role, action: x.action, entityType: x.entity_type, entityId: x.entity_id, reason: x.reason, ip: x.ip, requestId: x.request_id, createdAt: x.created_at }));
  }

  /* ---------------- retention policies (config) ---------------- */
  async upsertRetention(client: PoolClient, dto: { tableName: string; activeMonths: number; archiveMonths: number | null; legalBasis: string | null; action: string; isActive: boolean }, actorUserId: string): Promise<{ previous: any | null }> {
    const prev = await client.query(`SELECT active_months, archive_months, legal_basis, action, is_active FROM data_retention_policies WHERE table_name=$1`, [dto.tableName]);
    await client.query(
      `INSERT INTO data_retention_policies (table_name, active_months, archive_months, legal_basis, action, is_active, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (table_name) DO UPDATE
         SET active_months=EXCLUDED.active_months, archive_months=EXCLUDED.archive_months, legal_basis=EXCLUDED.legal_basis,
             action=EXCLUDED.action, is_active=EXCLUDED.is_active, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [dto.tableName, dto.activeMonths, dto.archiveMonths, dto.legalBasis, dto.action, dto.isActive, actorUserId]);
    return { previous: prev.rows[0] ?? null };
  }
  async listRetention(limit: number): Promise<any[]> {
    const r = await this.pool.query(`SELECT table_name, active_months, archive_months, legal_basis, action, is_active FROM data_retention_policies WHERE deleted_at IS NULL ORDER BY table_name LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({ tableName: x.table_name, activeMonths: x.active_months, archiveMonths: x.archive_months, legalBasis: x.legal_basis, action: x.action, isActive: x.is_active }));
  }

  /* ---------------- breach console ---------------- */
  async insertBreach(client: PoolClient, b: Breach, openedBy: string, description: string, affectedData: string, actorUserId: string): Promise<void> {
    const p = b.toJSON();
    await client.query(
      `INSERT INTO data_breaches (id, affected_tenant_id, status, severity, title, description, affected_data, affected_count, detected_at, opened_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [p.id, p.affectedTenantId, p.status, p.severity, p.title, description, affectedData, p.affectedCount, p.detectedAt, openedBy, actorUserId]);
  }
  async getBreachForUpdate(client: PoolClient, id: string): Promise<Breach | null> {
    const r = await client.query(`SELECT * FROM data_breaches WHERE id=$1 FOR UPDATE`, [id]);
    return r.rows[0] ? toBreach(r.rows[0]) : null;
  }
  async updateBreach(client: PoolClient, b: Breach, actorUserId: string): Promise<void> {
    const p = b.toJSON();
    await client.query(
      `UPDATE data_breaches SET status=$2, contained_at=$3, regulator_notified_at=$4, principals_notified_at=$5, closed_at=$6, resolution_note=$7, updated_by=$8, updated_at=now() WHERE id=$1`,
      [p.id, p.status, p.containedAt, p.regulatorNotifiedAt, p.principalsNotifiedAt, p.closedAt, p.resolutionNote, actorUserId]);
  }
  async getBreach(id: string): Promise<Breach | null> {
    const r = await this.pool.query(`SELECT * FROM data_breaches WHERE id=$1`, [id]);
    return r.rows[0] ? toBreach(r.rows[0]) : null;
  }
  async listBreaches(q: BreachListQuery): Promise<Breach[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT * FROM data_breaches WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toBreach);
  }
}
