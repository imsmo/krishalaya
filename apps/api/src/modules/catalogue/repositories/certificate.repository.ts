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
import { US_SQL } from '../../../shared/pagination/us-keyset';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

const COLS = `id, tenant_id, owner_user_id, cert_type_id, cert_no, issuing_body, subject_type, subject_id, media_id, valid_from, valid_until, status, blockchain_anchor, verified_by, verified_at, rejection_reason, created_at, ${US_SQL('created_at')} AS created_us`;
const toDomain = (r: any): Certificate => Certificate.rehydrate({
  id: r.id, tenantId: r.tenant_id, ownerUserId: r.owner_user_id ?? null, certTypeId: r.cert_type_id, certNo: r.cert_no ?? null,
  issuingBody: r.issuing_body ?? null, subjectType: r.subject_type as CertSubjectType, subjectId: r.subject_id ?? null, mediaId: r.media_id ?? null,
  validFrom: r.valid_from ? pgDate(r.valid_from) : null, validUntil: r.valid_until ? pgDate(r.valid_until) : null,
  status: r.status as CertificateStatus, blockchainAnchor: r.blockchain_anchor ?? null, verifiedBy: r.verified_by ?? null, createdAt: r.created_at ?? null, createdAtUs: r.created_us ?? null,
  verifiedAt: r.verified_at ?? null, rejectionReason: r.rejection_reason ?? null,
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
      `UPDATE certificates SET status=$3, verified_by=$4, valid_from=$5, valid_until=$6, verified_at=$7, rejection_reason=$8, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [v.id, v.tenantId, v.status, v.verifiedBy, v.validFrom, v.validUntil, v.verifiedAt ?? null, v.rejectionReason ?? null]);
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
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }   // PC-56 HOTFIX-7 · B24: the µs keyset
    const lp = p(q.limit);
    const r = await ex.query(`SELECT ${COLS} FROM certificates WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Worker job: verified certs whose valid_until has passed, claimed across tenants (SKIP LOCKED), bounded.
   *  PC-56 STORE-5b: "passed" is the DATABASE's calendar day of `asOf` (`$1::timestamptz::date` — the same clock the badge rule's
   *  `CURRENT_DATE` and the public read's `expired` use; it was the UTC day of a JS Date, a day behind between 00:00 and 05:30 IST). */
  async findDueToExpire(tx: TxContext, asOf: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id FROM certificates
        WHERE status='verified' AND valid_until IS NOT NULL AND valid_until < $1::timestamptz::date AND deleted_at IS NULL
        ORDER BY valid_until ASC LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [asOf.toISOString(), limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id }));
  }

  /** PC-56 STORE-5b · B17 (survey C-9 / F-28): is this id an ACTIVE value of the `cert_type` vocabulary (a platform value, or this
   *  organisation's own)? `certTypeId` was validated as a uuid only. */
  async isCertType(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM lookup_values WHERE id = $1 AND type_code = 'cert_type' AND is_active AND (tenant_id IS NULL OR tenant_id = $2) LIMIT 1`, [id, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** PC-56 STORE-5b · D1 — the PUBLIC certificate (SECURITY DEFINER `public_certificate` / `public_certificate_by_no`, migration 0219): NULL
   *  unless the organisation is live; never the owner, the verifier or the media. The service strips `tenantId`. */
  async publicById(tx: TxContext, id: string): Promise<Record<string, unknown> | null> {
    const r = await tx.query(`SELECT public_certificate($1::uuid) AS c`, [id]);
    return r.rows[0]?.c ?? null;
  }
  async publicByNo(tx: TxContext, tenantId: string, certNo: string): Promise<Record<string, unknown> | null> {
    const r = await tx.query(`SELECT public_certificate_by_no($1::uuid, $2) AS c`, [tenantId, certNo]);
    return r.rows[0]?.c ?? null;
  }
}
