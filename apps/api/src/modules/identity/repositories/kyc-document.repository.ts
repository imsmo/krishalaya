// modules/identity/repositories/kyc-document.repository.ts · KYC docs (tenant-scoped ⇒ RLS).
// [PC-56 TENANT-9a] Every read binds `tenant_id = $tenant` (never `IS NOT DISTINCT FROM`, never user-only — F-12: a
// NULL-tenant "platform" row is not a fact about a member of THIS tenant); the subject, maker, successor link and coded
// reason are read and written; the role map, the registry, the evidence facts and the cooperative's "today" are read
// here so the services can derive per-role status (F-1/F-2) inside one transaction.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { KycDocument, KycSubjectKind } from '../domain/kyc-document.entity';
import { KycStatus } from '../domain/kyc-document.state';
import { DocFact, DocTypeRoleMap, roleMapFrom } from '../domain/kyc-role-scope';
import { US_SQL } from '../domain/kyc-cursor';

const COLS = `id, tenant_id, subject_kind, user_id, organisation_id, role_id, doc_type_id, doc_type_code, media_id, doc_no_masked, issued_by,
  valid_from::text AS valid_from, valid_until::text AS valid_until, status, verify_method, reviewed_by, reviewed_at, reject_reason,
  reason_code, last_decision, submitted_by, supersedes_id`;
interface Row {
  id: string; tenant_id: string | null; subject_kind: string; user_id: string | null; organisation_id: string | null; role_id: string | null;
  doc_type_id: string; doc_type_code: string | null; media_id: string | null; doc_no_masked: string | null; issued_by: string | null;
  valid_from: string | null; valid_until: string | null; status: string; verify_method: string | null; reviewed_by: string | null;
  reviewed_at: Date | null; reject_reason: string | null; reason_code: string | null; last_decision: string; submitted_by: string; supersedes_id: string | null;
}
const toDomain = (r: Row): KycDocument => KycDocument.rehydrate({
  id: r.id, tenantId: r.tenant_id, subjectKind: r.subject_kind as KycSubjectKind, userId: r.user_id, organisationId: r.organisation_id,
  roleId: r.role_id, docTypeId: r.doc_type_id, docTypeCode: r.doc_type_code, mediaId: r.media_id, docNoMasked: r.doc_no_masked,
  issuedBy: r.issued_by, validFrom: r.valid_from, validUntil: r.valid_until, status: r.status as KycStatus, verifyMethod: r.verify_method,
  reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at, rejectReason: r.reject_reason, reasonCode: r.reason_code,
  lastDecision: r.last_decision, submittedBy: r.submitted_by, supersedesId: r.supersedes_id,
});

export interface DecisionRow {
  tenantId: string; documentId: string; act: 'submit' | 'verify' | 'reject' | 'request_more' | 'expire' | 'reveal';
  fromStatus: string | null; toStatus: string; reasonCode?: string | null; note?: string | null; decidedBy: string | null;
  via: 'desk' | 'submitter' | 'ekyc' | 'expiry_job'; idempotencyKey?: string | null;
}

@Injectable()
export class KycDocumentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, d: KycDocument): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `INSERT INTO kyc_documents (id, tenant_id, subject_kind, user_id, organisation_id, role_id, doc_type_id, media_id, doc_no_masked,
         issued_by, valid_from, valid_until, status, verify_method, reviewed_by, reviewed_at, submitted_by, supersedes_id, last_decision, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$17)`,
      [p.id, p.tenantId, p.subjectKind, p.userId, p.organisationId, p.roleId, p.docTypeId, p.mediaId, p.docNoMasked, p.issuedBy,
       p.validFrom, p.validUntil, p.status, p.verifyMethod, p.reviewedBy, p.reviewedAt, p.submittedBy, p.supersedesId, p.lastDecision]);
  }
  async update(tx: TxContext, d: KycDocument, actor: string | null = null): Promise<void> {
    const p = d.toProps();
    const r = await tx.query(
      `UPDATE kyc_documents SET status=$3, reviewed_by=$4, reviewed_at=$5, reject_reason=$6, reason_code=$7, last_decision=$8, updated_by=$9, updated_at=now()
       WHERE id=$1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.reviewedBy, p.reviewedAt, p.rejectReason, p.reasonCode, p.lastDecision, actor]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`kyc_documents ${p.id}: update matched ${r.rowCount} rows`);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<KycDocument | null> {
    const r = await tx.query<Row>(`SELECT ${COLS} FROM kyc_documents WHERE id=$1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The caller's OWN documents in THIS tenant (F-12: never a NULL-tenant row, never another tenant's). */
  async listByUser(tenantId: string, userId: string, status?: string): Promise<KycDocument[]> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM kyc_documents WHERE tenant_id = $1 AND subject_kind = 'user' AND user_id=$2
          AND ($3::text IS NULL OR status=$3::kyc_status) AND deleted_at IS NULL ORDER BY created_at DESC`,
      [tenantId, userId, status ?? null]);
    return r.rows.map(toDomain);
  }

  /** PC-54 W54-1 → PC-56 TENANT-9a: the reviewer queue, keyset on the MICROSECOND instant (F-7). */
  async listForReview(tenantId: string, q: { status: string; cursor?: { ts: string; id: string }; limit: number }): Promise<Array<{ doc: KycDocument; createdAt: string; cursorTs: string }>> {
    const r = await this.replica.forTenant(tenantId).query<Row & { created_at: Date; cursor_ts: string }>(
      `SELECT ${COLS}, created_at, ${US_SQL('created_at')} AS cursor_ts FROM kyc_documents
        WHERE tenant_id = $1 AND status=$2::kyc_status AND deleted_at IS NULL
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $5`,
      [tenantId, q.status, q.cursor?.ts ?? null, q.cursor?.id ?? '00000000-0000-0000-0000-000000000000', q.limit]);
    return r.rows.map((row) => ({ doc: toDomain(row), createdAt: row.created_at.toISOString(), cursorTs: row.cursor_ts }));
  }
  async getById(tenantId: string, id: string): Promise<KycDocument | null> {
    const r = await this.replica.forTenant(tenantId).query<Row>(`SELECT ${COLS} FROM kyc_documents WHERE id=$1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async listDocTypes(tenantId: string): Promise<{ id: string; code: string; name: string }[]> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string; code: string; default_name: string }>(
      `SELECT DISTINCT ON (code) id, code, default_name
         FROM lookup_values
        WHERE type_code = 'doc_type' AND is_active = true AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY code, (tenant_id IS NULL), sort_order`,
      [tenantId]);
    return r.rows.map((x) => ({ id: x.id, code: x.code, name: x.default_name }));
  }

  async resolveDocTypeId(tx: TxContext, tenantId: string, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM lookup_values
        WHERE type_code='doc_type' AND code=$2 AND is_active=true AND (tenant_id IS NULL OR tenant_id=$1)
        ORDER BY tenant_id NULLS LAST, created_at, id LIMIT 1`,
      [tenantId, code]);
    return r.rows[0]?.id ?? null;
  }
  async docTypeCodeOf(tx: TxContext, docTypeId: string): Promise<string | null> {
    const r = await tx.query<{ code: string }>(`SELECT code FROM lookup_values WHERE id=$1 AND type_code='doc_type'`, [docTypeId]);
    return r.rows[0]?.code ?? null;
  }

  async listExpiring(tenantId: string, userId: string, days: number): Promise<KycDocument[]> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM kyc_documents
        WHERE user_id=$1 AND tenant_id = $2 AND deleted_at IS NULL AND status='verified'
          AND valid_until IS NOT NULL AND valid_until <= kyc_tenant_today($2) + ($3 || ' days')::interval
        ORDER BY valid_until ASC LIMIT 50`, [userId, tenantId, String(Math.min(days, 365))]);
    return r.rows.map(toDomain);
  }

  // ---------------------------------------------------------------- TENANT-9a: the facts the derivations read

  /** 0180 `kyc_doc_type_roles` — which roles each document type evidences. */
  async roleMap(tx: TxContext): Promise<DocTypeRoleMap> {
    const r = await tx.query<{ doc_type_code: string; role_code: string }>(
      `SELECT doc_type_code, role_code FROM kyc_doc_type_roles WHERE deleted_at IS NULL ORDER BY doc_type_code, role_code`);
    return roleMapFrom(r.rows.map((x) => ({ docTypeCode: x.doc_type_code, roleCode: x.role_code })));
  }
  /** The cooperative's own date (0180 `kyc_tenant_today`). */
  async today(tx: TxContext, tenantId: string): Promise<string> {
    const r = await tx.query<{ d: string }>(`SELECT kyc_tenant_today($1)::text AS d`, [tenantId]);
    return r.rows[0].d;
  }
  /** Every document about this PERSON in this tenant, as the derivation reads them. */
  async personDocFacts(tx: TxContext, tenantId: string, userId: string): Promise<DocFact[]> {
    const r = await tx.query<{ doc_type_code: string; status: string; role_code: string | null; valid_until: string | null; decided_at: string }>(
      `SELECT k.doc_type_code, k.status::text AS status, ro.code AS role_code, k.valid_until::text AS valid_until,
              ${US_SQL('COALESCE(k.expired_at, k.reviewed_at, k.created_at)')} AS decided_at
         FROM kyc_documents k LEFT JOIN roles ro ON ro.id = k.role_id
        WHERE k.tenant_id = $1 AND k.subject_kind = 'user' AND k.user_id = $2 AND k.deleted_at IS NULL`,
      [tenantId, userId]);
    return r.rows.map((x) => ({ docTypeCode: x.doc_type_code, status: x.status, roleCode: x.role_code, validUntil: x.valid_until, decidedAt: x.decided_at }));
  }
  async registryRow(tx: TxContext, code: string, subjectKind: string): Promise<{ code: string; validity: 'required' | 'optional' } | null> {
    const r = await tx.query<{ code: string; validity: 'required' | 'optional' }>(
      `SELECT code, validity FROM kyc_doc_types WHERE code=$1 AND subject_kind=$2 AND deleted_at IS NULL`, [code, subjectKind]);
    return r.rows[0] ?? null;
  }
  /** The evidence: in THIS tenant's bucket (a foreign asset or a typo is "unknown", never a 22P02). */
  async mediaFacts(tx: TxContext, tenantId: string, mediaId: string): Promise<{ kind: string; scanStatus: string } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return null;
    const r = await tx.query<{ kind: string; scan_status: string }>(
      `SELECT kind, scan_status FROM media_assets WHERE id=$1::uuid AND tenant_id=$2 AND deleted_at IS NULL`, [mediaId, tenantId]);
    return r.rows[0] ? { kind: r.rows[0].kind, scanStatus: r.rows[0].scan_status } : null;
  }
  async openSubmission(tx: TxContext, tenantId: string, subjectKind: string, subjectRef: string, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM kyc_documents WHERE tenant_id=$1 AND subject_kind=$2 AND subject_ref=$3 AND doc_type_code=$4
          AND status='pending' AND deleted_at IS NULL LIMIT 1`, [tenantId, subjectKind, subjectRef, code]);
    return r.rows[0]?.id ?? null;
  }
  /** What a new document of this type FOLLOWS: the valid verified one (a renewal), else the latest rejected one. */
  async currentOfType(tx: TxContext, tenantId: string, subjectKind: string, subjectRef: string, code: string):
    Promise<{ id: string; status: string; validUntil: string | null; docNoMasked: string | null; issuedBy: string | null } | null> {
    const r = await tx.query<{ id: string; status: string; valid_until: string | null; doc_no_masked: string | null; issued_by: string | null }>(
      `SELECT id, status::text AS status, valid_until::text AS valid_until, doc_no_masked, issued_by FROM kyc_documents
        WHERE tenant_id=$1 AND subject_kind=$2 AND subject_ref=$3 AND doc_type_code=$4 AND deleted_at IS NULL
          AND ((status='verified' AND (valid_until IS NULL OR valid_until >= kyc_tenant_today($1))) OR status='rejected')
        ORDER BY (status='verified') DESC, created_at DESC, id DESC LIMIT 1`, [tenantId, subjectKind, subjectRef, code]);
    const x = r.rows[0];
    return x ? { id: x.id, status: x.status, validUntil: x.valid_until, docNoMasked: x.doc_no_masked, issuedBy: x.issued_by } : null;
  }
  async insertDecision(tx: TxContext, d: DecisionRow): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO kyc_document_decisions (tenant_id, document_id, act, from_status, to_status, reason_code, note, decided_by, via, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4::kyc_status,$5::kyc_status,$6,$7,$8,$9,$10,$8) RETURNING id`,
      [d.tenantId, d.documentId, d.act, d.fromStatus, d.toStatus, d.reasonCode ?? null, d.note ?? null, d.decidedBy, d.via, d.idempotencyKey ?? null]);
    return r.rows[0].id;
  }
  /** Has THIS person opened THIS document's evidence (a recorded reveal)? Evidence before decision. */
  async revealedBy(tx: TxContext, tenantId: string, documentId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM kyc_document_decisions WHERE tenant_id=$1 AND document_id=$2 AND act='reveal' AND decided_by=$3 LIMIT 1`, [tenantId, documentId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  /** The `kyc_decision_reason` vocabulary: code → which acts it grounds, and whether it needs the reviewer's words. */
  async reasonRules(tx: TxContext): Promise<Map<string, { acts: string[]; needsNote: boolean; name: string }>> {
    const r = await tx.query<{ code: string; meta: { acts?: string[]; needs_note?: boolean }; default_name: string }>(
      `SELECT code, meta, default_name FROM lookup_values WHERE type_code='kyc_decision_reason' AND tenant_id IS NULL AND is_active ORDER BY sort_order, code`);
    return new Map(r.rows.map((x) => [x.code, { acts: x.meta?.acts ?? [], needsNote: Boolean(x.meta?.needs_note), name: x.default_name }]));
  }
  /** Mark a verified document reminded (once — F-3's reminder re-emitted every tick). */
  async markReminded(tx: TxContext, tenantId: string, id: string): Promise<void> {
    await tx.query(`UPDATE kyc_documents SET expiry_reminded_at = now() WHERE id=$1 AND tenant_id=$2 AND expiry_reminded_at IS NULL`, [id, tenantId]);
  }
}
