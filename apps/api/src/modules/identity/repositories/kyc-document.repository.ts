// modules/identity/repositories/kyc-document.repository.ts · KYC docs (tenant-scoped ⇒ RLS).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { KycDocument } from '../domain/kyc-document.entity';
import { KycStatus } from '../domain/kyc-document.state';

const COLS = `id, tenant_id, user_id, role_id, doc_type_id, media_id, doc_no_masked, issued_by, valid_from, valid_until, status, verify_method, reviewed_by, reviewed_at, reject_reason`;
interface Row { id: string; tenant_id: string | null; user_id: string; role_id: string | null; doc_type_id: string; media_id: string; doc_no_masked: string | null; issued_by: string | null; valid_from: string | null; valid_until: string | null; status: string; verify_method: string | null; reviewed_by: string | null; reviewed_at: Date | null; reject_reason: string | null; }
const toDomain = (r: Row): KycDocument => KycDocument.rehydrate({ id: r.id, tenantId: r.tenant_id, userId: r.user_id, roleId: r.role_id, docTypeId: r.doc_type_id, mediaId: r.media_id, docNoMasked: r.doc_no_masked, issuedBy: r.issued_by, validFrom: r.valid_from, validUntil: r.valid_until, status: r.status as KycStatus, verifyMethod: r.verify_method, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, rejectReason: r.reject_reason });

@Injectable()
export class KycDocumentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, d: KycDocument): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `INSERT INTO kyc_documents (id, tenant_id, user_id, role_id, doc_type_id, media_id, doc_no_masked, issued_by, valid_from, valid_until, status, verify_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [p.id, p.tenantId, p.userId, p.roleId, p.docTypeId, p.mediaId, p.docNoMasked, p.issuedBy, p.validFrom, p.validUntil, p.status, p.verifyMethod]);
  }
  async update(tx: TxContext, d: KycDocument): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `UPDATE kyc_documents SET status=$3, reviewed_by=$4, reviewed_at=$5, reject_reason=$6, updated_at=now()
       WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.reviewedBy, p.reviewedAt, p.rejectReason]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<KycDocument | null> {
    const r = await tx.query<Row>(`SELECT ${COLS} FROM kyc_documents WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async listByUser(tenantId: string, userId: string, status?: string): Promise<KycDocument[]> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM kyc_documents WHERE user_id=$1 AND ($2::text IS NULL OR status=$2::kyc_status) AND deleted_at IS NULL ORDER BY created_at DESC`,
      [userId, status ?? null]);
    return r.rows.map(toDomain);
  }

  /** The 'doc_type' lookup catalogue (id + code + display name) so the client submits a real docTypeId
   *  and shows a name instead of a UUID. Platform values (tenant_id NULL) + any tenant overlay; active only. */
  /** PC-54 W54-1: the REVIEWER queue — cross-user, status-filtered, keyset (created_at,id). Read-only. */
  async listForReview(tenantId: string, q: { status: string; cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ doc: KycDocument; createdAt: string }>> {
    const r = await this.replica.forTenant(tenantId).query<Row & { created_at: Date }>(
      `SELECT ${COLS}, created_at FROM kyc_documents
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND status=$2::kyc_status AND deleted_at IS NULL
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $5`,
      [tenantId, q.status, q.cursor?.c ?? null, q.cursor?.id ?? '00000000-0000-0000-0000-000000000000', q.limit],
    );
    return r.rows.map((row) => ({ doc: toDomain(row), createdAt: row.created_at.toISOString() }));
  }
  /** PC-54 W54-1: non-locking case read for the reviewer. */
  async getById(tenantId: string, id: string): Promise<KycDocument | null> {
    const r = await this.replica.forTenant(tenantId).query<Row>(`SELECT ${COLS} FROM kyc_documents WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async listDocTypes(tenantId: string): Promise<{ id: string; code: string; name: string }[]> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string; code: string; default_name: string }>(
      `SELECT id, code, default_name
         FROM lookup_values
        WHERE type_code = 'doc_type' AND is_active = true AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY sort_order, default_name`,
      [tenantId]);
    return r.rows.map((x) => ({ id: x.id, code: x.code, name: x.default_name }));
  }

  /** Resolve a doc_type lookup id by its code ('aadhaar'|'pan'|…) so the eKYC flow can write a verified
   *  kyc_documents row pointing at the catalogue value. Platform value (tenant_id NULL) or tenant overlay. */
  async resolveDocTypeId(tx: TxContext, tenantId: string, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM lookup_values
        WHERE type_code='doc_type' AND code=$2 AND is_active=true AND (tenant_id IS NULL OR tenant_id=$1)
        ORDER BY tenant_id NULLS LAST LIMIT 1`,
      [tenantId, code]);
    return r.rows[0]?.id ?? null;
  }

  /** PC-54 W54-14 `store-licence-reminders`: the caller's OWN documents expiring within N days (or already
   *  expired) — the honest reminder feed; push fan-out is a scheduler concern later. */
  async listExpiring(tenantId: string, userId: string, days: number): Promise<KycDocument[]> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM kyc_documents
        WHERE user_id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL AND status='verified'
          AND valid_until IS NOT NULL AND valid_until <= CURRENT_DATE + ($3 || ' days')::interval
        ORDER BY valid_until ASC LIMIT 50`, [userId, tenantId, String(Math.min(days, 365))]);
    return r.rows.map(toDomain);
  }
}
