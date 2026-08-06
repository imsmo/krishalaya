// modules/schemes/repositories/scheme-application.repository.ts · all SQL for scheme_applications + the
// partitioned scheme_application_events audit trail. tenant_id in EVERY query (Law 1) + RLS. No version
// column → mutations lock FOR UPDATE. Keyset lists. Event rows are append-only (Law 4-adjacent audit).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { SchemeApplication } from '../domain/scheme-application.entity';
import { ApplicationStatus } from '../domain/scheme-application.state';

const COLS = `id, tenant_id, scheme_id, scheme_version, scheme_version_id, applicant_user_id, assisted_by, status, form_data, govt_app_ref, eligibility_check, submitted_at, decided_at, rejection_reason, created_at`;
function toDomain(r: any): SchemeApplication {
  return SchemeApplication.rehydrate({ id: r.id, tenantId: r.tenant_id, schemeId: r.scheme_id, schemeVersion: r.scheme_version, schemeVersionId: r.scheme_version_id ?? null, applicantUserId: r.applicant_user_id, assistedBy: r.assisted_by,
    status: r.status as ApplicationStatus, formData: r.form_data ?? {}, govtAppRef: r.govt_app_ref, eligibilityCheck: r.eligibility_check, submittedAt: r.submitted_at, decidedAt: r.decided_at, rejectionReason: r.rejection_reason, createdAt: r.created_at });
}
export interface AppListQuery { applicantUserId?: string; queue?: boolean; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class SchemeApplicationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, a: SchemeApplication): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `INSERT INTO scheme_applications (id, tenant_id, scheme_id, scheme_version, scheme_version_id, applicant_user_id, assisted_by, status, form_data, eligibility_check, submitted_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$6)`,
      [p.id, p.tenantId, p.schemeId, p.schemeVersion, p.schemeVersionId, p.applicantUserId, p.assistedBy, p.status, JSON.stringify(p.formData), p.eligibilityCheck ? JSON.stringify(p.eligibilityCheck) : null, p.submittedAt]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<SchemeApplication | null> {
    const r = await tx.query(`SELECT ${COLS} FROM scheme_applications WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<SchemeApplication | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM scheme_applications WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, a: SchemeApplication): Promise<void> {
    const p = a.toProps();
    await tx.query(`UPDATE scheme_applications SET status=$3, form_data=$4::jsonb, govt_app_ref=$5, eligibility_check=$6::jsonb, submitted_at=$7, decided_at=$8, rejection_reason=$9, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, JSON.stringify(p.formData), p.govtAppRef, p.eligibilityCheck ? JSON.stringify(p.eligibilityCheck) : null, p.submittedAt, p.decidedAt, p.rejectionReason]);
  }
  /** Append a status-transition row to the partitioned audit trail (within the same tx). */
  async appendEvent(tx: TxContext, tenantId: string, applicationId: string, fromStatus: string | null, toStatus: string, note: string | null, actorUserId: string): Promise<void> {
    await tx.query(`INSERT INTO scheme_application_events (application_id, tenant_id, from_status, to_status, note, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`, [applicationId, tenantId, fromStatus, toStatus, note, actorUserId]);
  }
  async listFor(tenantId: string, q: AppListQuery): Promise<SchemeApplication[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.applicantUserId) where += ` AND applicant_user_id=${p(q.applicantUserId)}`;
    if (q.queue) where += ` AND status NOT IN ('closed','rejected','disbursed','draft')`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM scheme_applications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
