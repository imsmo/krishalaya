// modules/catalogue/repositories/certificate.repository.ts · all SQL for certificates (tenant-scoped, RLS:
// tenant_id IS NULL OR = current_tenant_id()). Writes in the caller's tx (insert/update + FOR UPDATE); reads on
// the replica (CQRS); keyset pagination. findDueToExpire claims verified-but-past-validity certs for the worker
// job (FOR UPDATE SKIP LOCKED, bounded). Parameterised only.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Certificate, CertSubjectType } from '../domain/certificate.entity';
import { CertificateStatus } from '../domain/certificate.state';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

const COLS = `id, tenant_id, owner_user_id, cert_type_id, cert_no, issuing_body, subject_type, subject_id, media_id, valid_from, valid_until, status, blockchain_anchor, verified_by, created_at`;
const toDomain = (r: any): Certificate => Certificate.rehydrate({
  id: r.id, tenantId: r.tenant_id, ownerUserId: r.owner_user_id ?? null, certTypeId: r.cert_type_id, certNo: r.cert_no ?? null,
  issuingBody: r.issuing_body ?? null, subjectType: r.subject_type as CertSubjectType, subjectId: r.subject_id ?? null, mediaId: r.media_id ?? null,
  validFrom: r.valid_from ? pgDate(r.valid_from) : null, validUntil: r.valid_until ? pgDate(r.valid_until) : null,
  status: r.status as CertificateStatus, blockchainAnchor: r.blockchain_anchor ?? null, verifiedBy: r.verified_by ?? null, createdAt: r.created_at ?? null,
});

export interface CertListQuery { subjectType?: string; subjectId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class CertificateRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, c: Certificate): Promise<void> {
    const v = c.toProps();
    await tx.query(
      `INSERT INTO certificates (id, tenant_id, owner_user_id, cert_type_id, cert_no, issuing_body, subject_type, subject_id, media_id, valid_from, valid_until, status, blockchain_anchor, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [v.id, v.tenantId, v.ownerUserId, v.certTypeId, v.certNo, v.issuingBody, v.subjectType, v.subjectId, v.mediaId, v.validFrom, v.validUntil, v.status, v.blockchainAnchor, v.verifiedBy]);
  }
  async update(tx: TxContext, c: Certificate): Promise<void> {
    const v = c.toProps();
    await tx.query(
      `UPDATE certificates SET status=$3, verified_by=$4, valid_from=$5, valid_until=$6, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [v.id, v.tenantId, v.status, v.verifiedBy, v.validFrom, v.validUntil]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Certificate | null> {
    const r = await tx.query(`SELECT ${COLS} FROM certificates WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Certificate | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM certificates WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async list(tenantId: string, q: CertListQuery): Promise<Certificate[]> {
    const ex = this.replica.forTenant(tenantId);
    const params: unknown[] = [tenantId]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'tenant_id=$1 AND deleted_at IS NULL';
    if (q.subjectType) where += ` AND subject_type=${p(q.subjectType)}`;
    if (q.subjectId) where += ` AND subject_id=${p(q.subjectId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await ex.query(`SELECT ${COLS} FROM certificates WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Worker job: verified certs whose valid_until has passed, claimed across tenants (SKIP LOCKED), bounded. */
  async findDueToExpire(tx: TxContext, asOf: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id FROM certificates
        WHERE status='verified' AND valid_until IS NOT NULL AND valid_until < $1::date AND deleted_at IS NULL
        ORDER BY valid_until ASC LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [asOf.toISOString().slice(0, 10), limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id }));
  }
}
