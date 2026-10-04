// modules/identity/read-models/kyc-desk.read-model.ts · PC-56 TENANT-9a · W121 / W122's reads, from facts.
//
// Every number on the desk is a live query over `kyc_documents`, `user_tenant_roles` and 0180's registry — never a stored
// counter. The organisation's verification is COMPUTED (`organisationVerdict` over the country's declared requirements).
// Keysets carry the microsecond instant as the database printed it (F-7). Every query binds `tenant_id = $1` (Law 1).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { US_SQL, KeysetCursor } from '../domain/kyc-cursor';
import { OrgRequirement, OrgDocFact } from '../domain/kyc-org-status';

export interface QueueFilter {
  subjectKind?: 'user' | 'organisation'; roleCode?: string; status?: string; docTypeCode?: string; expiringWithin?: number;
  cursor?: KeysetCursor; limit: number;
}

export interface QueueRow {
  id: string; subjectKind: string; userId: string | null; subjectName: string | null; docTypeCode: string; docTypeName: string;
  docNoMasked: string | null; status: string; lastDecision: string; reasonCode: string | null; validUntil: string | null;
  submittedBy: string; submittedByName: string | null; createdAt: string; cursorTs: string; hasMedia: boolean; scanStatus: string | null;
  /** PC-56 TENANT-SW-c: the live take-next claim (unreleased, unexpired), if any — the service masks the name for anyone but the holder. */
  claimedBy: string | null; claimedByName: string | null; claimExpiresAt: string | null;
}

const ROW_SQL = `k.id, k.subject_kind, k.user_id, u.full_name AS subject_name, k.doc_type_code,
  COALESCE((SELECT lv.default_name FROM lookup_values lv WHERE lv.id = k.doc_type_id), k.doc_type_code) AS doc_type_name,
  k.doc_no_masked, k.status::text AS status, k.last_decision, k.reason_code, k.valid_until::text AS valid_until,
  k.submitted_by, sb.full_name AS submitted_by_name, k.created_at, ${US_SQL('k.created_at')} AS cursor_ts,
  (k.media_id IS NOT NULL) AS has_media, m.scan_status,
  lc.claimed_by AS claim_by, lcu.full_name AS claim_by_name, to_char(lc.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS claim_expires_at`;
const FROM_SQL = `FROM kyc_documents k
  LEFT JOIN users u ON u.id = k.user_id
  LEFT JOIN users sb ON sb.id = k.submitted_by
  LEFT JOIN media_assets m ON m.id = k.media_id AND m.tenant_id = k.tenant_id
  LEFT JOIN LATERAL (SELECT c.claimed_by, c.expires_at FROM kyc_claims c WHERE c.document_id = k.id AND c.tenant_id = k.tenant_id AND c.released_at IS NULL AND c.expires_at > now() LIMIT 1) lc ON true
  LEFT JOIN users lcu ON lcu.id = lc.claimed_by`;

const toQueueRow = (x: any): QueueRow => ({
  id: x.id, subjectKind: x.subject_kind, userId: x.user_id ?? null, subjectName: x.subject_name ?? null, docTypeCode: x.doc_type_code,
  docTypeName: x.doc_type_name, docNoMasked: x.doc_no_masked ?? null, status: x.status, lastDecision: x.last_decision, reasonCode: x.reason_code ?? null,
  validUntil: x.valid_until ?? null, submittedBy: x.submitted_by, submittedByName: x.submitted_by_name ?? null,
  createdAt: new Date(x.created_at).toISOString(), cursorTs: x.cursor_ts, hasMedia: Boolean(x.has_media), scanStatus: x.scan_status ?? null,
  claimedBy: x.claim_by ?? null, claimedByName: x.claim_by_name ?? null, claimExpiresAt: x.claim_expires_at ?? null,
});

@Injectable()
export class KycDeskReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** W121's queue: members' and the organisation's documents, filtered by GET-form fields, keyset on (created_at, id). */
  async queue(tenantId: string, f: QueueFilter): Promise<QueueRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where: string[] = ['k.tenant_id = $1', 'k.deleted_at IS NULL'];
    if (f.subjectKind) where.push(`k.subject_kind = ${p(f.subjectKind)}`);
    if (f.status) where.push(`k.status = ${p(f.status)}::kyc_status`);
    if (f.docTypeCode) where.push(`k.doc_type_code = ${p(f.docTypeCode)}`);
    if (f.roleCode) where.push(`k.subject_kind = 'user' AND EXISTS (SELECT 1 FROM kyc_doc_type_roles mr WHERE mr.doc_type_code = k.doc_type_code AND mr.role_code = ${p(f.roleCode)} AND mr.deleted_at IS NULL)`);
    if (f.expiringWithin !== undefined) where.push(`k.status = 'verified' AND k.valid_until IS NOT NULL AND k.valid_until >= kyc_tenant_today($1) AND k.valid_until <= kyc_tenant_today($1) + ${p(f.expiringWithin)}::int`);
    if (f.cursor) { const ts = p(f.cursor.ts); const id = p(f.cursor.id); where.push(`(k.created_at, k.id) < (${ts}::timestamptz, ${id}::uuid)`); }
    const lim = p(Math.min(Math.max(f.limit, 1), 100));
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${ROW_SQL} ${FROM_SQL} WHERE ${where.join(' AND ')} ORDER BY k.created_at DESC, k.id DESC LIMIT ${lim}`, params);
    return r.rows.map(toQueueRow);
  }

  /** The organisation's documents (newest first) and its country's declared requirements. */
  async organisation(tenantId: string): Promise<{ requirements: OrgRequirement[]; docs: Array<OrgDocFact & { docNoMasked: string | null; issuedBy: string | null; createdAt: string; docTypeName: string }>; countryCode: string | null; today: string }> {
    const db = this.replica.forTenant(tenantId);
    const [req, docs, meta] = await Promise.all([
      db.query<{ doc_type_code: string; is_required: boolean }>(
        `SELECT r.doc_type_code, r.is_required FROM kyc_org_requirements r JOIN tenants t ON t.country_code = r.country_code
          WHERE t.id = $1 AND r.deleted_at IS NULL ORDER BY r.is_required DESC, r.doc_type_code`, [tenantId]),
      db.query<any>(
        `SELECT k.id, k.doc_type_code, k.status::text AS status, k.valid_until::text AS valid_until, k.reviewed_at, k.doc_no_masked, k.issued_by, k.created_at,
                COALESCE((SELECT lv.default_name FROM lookup_values lv WHERE lv.id = k.doc_type_id), k.doc_type_code) AS doc_type_name
           FROM kyc_documents k WHERE k.tenant_id = $1 AND k.subject_kind = 'organisation' AND k.organisation_id = $1 AND k.deleted_at IS NULL
          ORDER BY k.created_at DESC, k.id DESC LIMIT 200`, [tenantId]),
      db.query<{ country_code: string | null; today: string }>(`SELECT t.country_code, kyc_tenant_today(t.id)::text AS today FROM tenants t WHERE t.id = $1`, [tenantId]),
    ]);
    return {
      requirements: req.rows.map((x) => ({ docTypeCode: x.doc_type_code, isRequired: Boolean(x.is_required) })),
      docs: docs.rows.map((x) => ({ id: x.id, docTypeCode: x.doc_type_code, status: x.status, validUntil: x.valid_until ?? null,
        reviewedAt: x.reviewed_at ? new Date(x.reviewed_at).toISOString() : null, docNoMasked: x.doc_no_masked ?? null,
        issuedBy: x.issued_by ?? null, createdAt: new Date(x.created_at).toISOString(), docTypeName: x.doc_type_name })),
      countryCode: meta.rows[0]?.country_code ?? null, today: meta.rows[0]?.today ?? '',
    };
  }

  /** The SQL twin of `organisationVerdict` (go-live reads it). */
  async organisationStatusSql(tenantId: string): Promise<{ verified: boolean; verifiedAt: string | null; required: number; satisfied: number }> {
    const r = await this.replica.forTenant(tenantId).query<any>(`SELECT * FROM kyc_organisation_status($1)`, [tenantId]);
    const x = r.rows[0];
    return { verified: Boolean(x.verified), verifiedAt: x.verified_at ? new Date(x.verified_at).toISOString() : null, required: Number(x.required_count), satisfied: Number(x.satisfied_count) };
  }

  /**
   * The member verification desk's tiles (W121), every one a live count:
   *   • people with at least one role that requires KYC, and of them how many have EVERY such active role verified
   *     (effective — a lapsed verification reads expired); staff roles that do not require KYC are not counted (the
   *     roster census counted them — survey §1);
   *   • open submissions, and the oldest one's age in the cooperative's days;
   *   • rejected documents nothing has superseded yet ("fixable"), with the commonest coded reason;
   *   • expired documents nothing has superseded yet; documents lapsing within 30 days; reminders sent (once each).
   */
  async memberTiles(tenantId: string): Promise<{
    people: number; fullyVerified: number; pending: number; oldestPendingDays: number | null; rejectedOpen: number;
    topRejectReason: string | null; expiredOpen: number; expiringSoon: number; remindersSent: number;
  }> {
    const db = this.replica.forTenant(tenantId);
    const [people, docs, top] = await Promise.all([
      db.query<{ people: number; fully: number }>(
        `SELECT count(*)::int AS people, count(*) FILTER (WHERE all_ok)::int AS fully FROM (
           SELECT utr.user_id, bool_and(kyc_role_effective_status(utr.tenant_id, utr.user_id, r.code, utr.kyc_status::text) = 'verified') AS all_ok
             FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
            WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND r.requires_kyc
            GROUP BY utr.user_id) x`, [tenantId]),
      db.query<any>(
        `SELECT count(*) FILTER (WHERE k.status = 'pending')::int AS pending,
                (kyc_tenant_today($1) - min((k.created_at AT TIME ZONE COALESCE(c.timezone, 'UTC'))::date) FILTER (WHERE k.status = 'pending'))::int AS oldest_days,
                count(*) FILTER (WHERE k.status = 'rejected' AND NOT EXISTS (SELECT 1 FROM kyc_documents s WHERE s.supersedes_id = k.id AND s.deleted_at IS NULL))::int AS rejected_open,
                count(*) FILTER (WHERE k.status = 'expired' AND NOT EXISTS (SELECT 1 FROM kyc_documents s WHERE s.supersedes_id = k.id AND s.deleted_at IS NULL))::int AS expired_open,
                count(*) FILTER (WHERE k.status = 'verified' AND k.valid_until IS NOT NULL AND k.valid_until >= kyc_tenant_today($1) AND k.valid_until <= kyc_tenant_today($1) + 30)::int AS expiring_soon,
                count(*) FILTER (WHERE k.expiry_reminded_at IS NOT NULL)::int AS reminders
           FROM kyc_documents k JOIN tenants t ON t.id = k.tenant_id LEFT JOIN countries c ON c.code = t.country_code
          WHERE k.tenant_id = $1 AND k.subject_kind = 'user' AND k.deleted_at IS NULL`, [tenantId]),
      db.query<{ reason_code: string }>(
        `SELECT k.reason_code FROM kyc_documents k
          WHERE k.tenant_id = $1 AND k.subject_kind = 'user' AND k.status = 'rejected' AND k.deleted_at IS NULL AND k.reason_code IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM kyc_documents s WHERE s.supersedes_id = k.id AND s.deleted_at IS NULL)
          GROUP BY k.reason_code ORDER BY count(*) DESC, k.reason_code LIMIT 1`, [tenantId]),
    ]);
    const d = docs.rows[0] ?? {};
    return {
      people: Number(people.rows[0]?.people ?? 0), fullyVerified: Number(people.rows[0]?.fully ?? 0),
      pending: Number(d.pending ?? 0), oldestPendingDays: d.oldest_days === null || d.oldest_days === undefined ? null : Number(d.oldest_days),
      rejectedOpen: Number(d.rejected_open ?? 0), topRejectReason: top.rows[0]?.reason_code ?? null,
      expiredOpen: Number(d.expired_open ?? 0), expiringSoon: Number(d.expiring_soon ?? 0), remindersSent: Number(d.reminders ?? 0),
    };
  }

  /** W122's record: the document, its subject, the roles it evidences and their current status, and its whole history. */
  async record(tenantId: string, id: string): Promise<null | {
    doc: QueueRow & { validFrom: string | null; issuedBy: string | null; verifyMethod: string | null; reviewedBy: string | null; reviewedByName: string | null;
      reviewedAt: string | null; rejectReason: string | null; supersedesId: string | null; supersededById: string | null; mediaMime: string | null; mediaBytes: string | null; roleId: string | null };
    roles: Array<{ roleCode: string; recorded: string; effective: string; evidenced: boolean }>;
    history: Array<{ act: string; fromStatus: string | null; toStatus: string; reasonCode: string | null; note: string | null; decidedBy: string | null; decidedByName: string | null; via: string; decidedAt: string }>;
    today: string;
  }> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `SELECT ${ROW_SQL}, k.valid_from::text AS valid_from, k.issued_by, k.verify_method, k.reviewed_by, rb.full_name AS reviewed_by_name, k.reviewed_at,
              k.reject_reason, k.supersedes_id, k.role_id,
              (SELECT s.id FROM kyc_documents s WHERE s.supersedes_id = k.id AND s.deleted_at IS NULL ORDER BY s.created_at DESC LIMIT 1) AS superseded_by_id,
              m.mime_type, m.bytes::text AS bytes, kyc_tenant_today($1)::text AS today
         ${FROM_SQL} LEFT JOIN users rb ON rb.id = k.reviewed_by
        WHERE k.tenant_id = $1 AND k.id = $2 AND k.deleted_at IS NULL`, [tenantId, id]);
    const x = r.rows[0];
    if (!x) return null;
    const [roles, hist] = await Promise.all([
      x.user_id ? db.query<any>(
        `SELECT r.code AS role_code, utr.kyc_status::text AS recorded,
                kyc_role_effective_status(utr.tenant_id, utr.user_id, r.code, utr.kyc_status::text) AS effective,
                EXISTS (SELECT 1 FROM kyc_doc_type_roles m WHERE m.doc_type_code = $3 AND m.role_code = r.code AND m.deleted_at IS NULL)
                  AND ($4::uuid IS NULL OR utr.role_id = $4::uuid) AS evidenced
           FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
          WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active AND utr.deleted_at IS NULL ORDER BY r.code`, [tenantId, x.user_id, x.doc_type_code, x.role_id ?? null])
        : Promise.resolve({ rows: [] as any[] }),
      db.query<any>(
        `SELECT d.act, d.from_status::text AS from_status, d.to_status::text AS to_status, d.reason_code, d.note, d.decided_by, u.full_name AS decided_by_name, d.via, d.decided_at
           FROM kyc_document_decisions d LEFT JOIN users u ON u.id = d.decided_by
          WHERE d.tenant_id = $1 AND d.document_id = $2 ORDER BY d.decided_at DESC, d.id DESC LIMIT 100`, [tenantId, id]),
    ]);
    return {
      doc: { ...toQueueRow(x), validFrom: x.valid_from ?? null, issuedBy: x.issued_by ?? null, verifyMethod: x.verify_method ?? null,
        reviewedBy: x.reviewed_by ?? null, reviewedByName: x.reviewed_by_name ?? null, reviewedAt: x.reviewed_at ? new Date(x.reviewed_at).toISOString() : null,
        rejectReason: x.reject_reason ?? null, supersedesId: x.supersedes_id ?? null, supersededById: x.superseded_by_id ?? null,
        mediaMime: x.mime_type ?? null, mediaBytes: x.bytes ?? null, roleId: x.role_id ?? null },
      roles: roles.rows.map((y: any) => ({ roleCode: y.role_code, recorded: y.recorded, effective: y.effective, evidenced: Boolean(y.evidenced) })),
      history: hist.rows.map((h: any) => ({ act: h.act, fromStatus: h.from_status ?? null, toStatus: h.to_status, reasonCode: h.reason_code ?? null,
        note: h.act === 'reveal' ? null : (h.note ?? null), decidedBy: h.decided_by ?? null, decidedByName: h.decided_by_name ?? null, via: h.via,
        decidedAt: new Date(h.decided_at).toISOString() })),
      today: x.today,
    };
  }

  /** The submit form's catalogue: document types per subject (registry ∩ lookup), the member roles a person holds. */
  async formCatalogue(tenantId: string, userId: string | null): Promise<{
    docTypes: Array<{ code: string; name: string; subjectKind: string; validity: string; evidences: string[] }>;
    heldRoles: string[] | null; subjectName: string | null;
  }> {
    const db = this.replica.forTenant(tenantId);
    const [types, held] = await Promise.all([
      db.query<any>(
        `SELECT t.code, t.subject_kind, t.validity,
                COALESCE((SELECT lv.default_name FROM lookup_values lv WHERE lv.type_code = 'doc_type' AND lv.code = t.code AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1), t.code) AS name,
                COALESCE((SELECT array_agg(m.role_code ORDER BY m.role_code) FROM kyc_doc_type_roles m WHERE m.doc_type_code = t.code AND t.subject_kind = 'user' AND m.deleted_at IS NULL), '{}') AS evidences
           FROM kyc_doc_types t WHERE t.deleted_at IS NULL ORDER BY t.subject_kind, t.code`),
      userId ? db.query<any>(
        `SELECT u.full_name, COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
           FROM users u LEFT JOIN user_tenant_roles utr ON utr.user_id = u.id AND utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL
           LEFT JOIN roles r ON r.id = utr.role_id
          WHERE u.id = $2::uuid AND EXISTS (SELECT 1 FROM user_tenant_roles x WHERE x.user_id = u.id AND x.tenant_id = $1 AND x.is_active AND x.deleted_at IS NULL)
          GROUP BY u.full_name`, [tenantId, userId]) : Promise.resolve({ rows: [] as any[] }),
    ]);
    return {
      docTypes: types.rows.map((t: any) => ({ code: t.code, name: t.name, subjectKind: t.subject_kind, validity: t.validity, evidences: t.evidences ?? [] })),
      heldRoles: userId ? (held.rows[0] ? held.rows[0].roles : null) : null,
      subjectName: held.rows[0]?.full_name ?? null,
    };
  }
}
