// modules/memberships/repositories/register-import.repository.ts · PC-56 TENANT-SW-d · W2626–W2628 — SQL over share_register_imports,
// share_register_import_rows (0200) and the register writes the APPLY makes. Own tenant only (RLS + `tenant_id = $1`). Member matching
// reads ONLY this cooperative's members (a phone that belongs to somebody elsewhere on the platform is MEMBER_NOT_FOUND, never a hint).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { MEMBER_ROLE_CODES } from './governance.repository';

export interface ImportRow {
  id: string; uploadedBy: string; fileMediaId: string; fileSha256: string; consentMediaId: string; consentKind: string; status: string;
  rowCount: number; validCount: number; errorCount: number; duplicateCount: number; appliedCount: number; skippedCount: number; failureCode: string | null;
  proposedBy: string | null; proposedAt: string | null; proposeReason: string | null; confirmedBy: string | null; confirmedAt: string | null;
  rejectedBy: string | null; rejectedAt: string | null; rejectReason: string | null; appliedAt: string | null; batchId: string; createdAt: string; cursorTs: string;
}
export interface ImportLineRow { lineNo: number; phoneMasked: string; folio: string | null; shares: number | null; paidUpMinor: string | null; status: string; errorCode: string | null; memberUserId: string | null }

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const COLS = `id, uploaded_by, file_media_id, file_sha256, consent_media_id, consent_kind, status, row_count, valid_count, error_count, duplicate_count, applied_count,
  skipped_count, failure_code, proposed_by, proposed_at, propose_reason, confirmed_by, confirmed_at, rejected_by, rejected_at, reject_reason, applied_at, batch_id,
  created_at, ${US_SQL('created_at')} AS cursor_ts`;
const rowOf = (x: any): ImportRow => ({
  id: x.id, uploadedBy: x.uploaded_by, fileMediaId: x.file_media_id, fileSha256: String(x.file_sha256).trim(), consentMediaId: x.consent_media_id, consentKind: x.consent_kind,
  status: x.status, rowCount: Number(x.row_count), validCount: Number(x.valid_count), errorCount: Number(x.error_count), duplicateCount: Number(x.duplicate_count),
  appliedCount: Number(x.applied_count), skippedCount: Number(x.skipped_count), failureCode: x.failure_code ?? null, proposedBy: x.proposed_by ?? null,
  proposedAt: iso(x.proposed_at), proposeReason: x.propose_reason ?? null, confirmedBy: x.confirmed_by ?? null, confirmedAt: iso(x.confirmed_at),
  rejectedBy: x.rejected_by ?? null, rejectedAt: iso(x.rejected_at), rejectReason: x.reject_reason ?? null, appliedAt: iso(x.applied_at), batchId: x.batch_id,
  createdAt: iso(x.created_at)!, cursorTs: x.cursor_ts,
});

@Injectable()
export class RegisterImportRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /** The cooperative's dialling prefix and currency scale — data (countries / currencies), never a constant. */
  async countryShape(tenantId: string, tx?: SqlExecutor | null): Promise<{ phonePrefix: string; minorUnits: number; currency: string | null } | null> {
    const r = await this.on(tenantId, tx).query(
      `SELECT c.phone_prefix, cu.minor_units, c.currency_code FROM tenants t JOIN countries c ON c.code = t.country_code
         LEFT JOIN currencies cu ON cu.code = c.currency_code WHERE t.id = $1`, [tenantId]);
    const x = r.rows[0];
    if (!x || !x.phone_prefix || x.minor_units === null || x.minor_units === undefined) return null;
    return { phonePrefix: String(x.phone_prefix), minorUnits: Number(x.minor_units), currency: x.currency_code ? String(x.currency_code).trim() : null };
  }
  async mediaOfTenant(tenantId: string, mediaId: string, tx?: SqlExecutor | null): Promise<boolean> {
    const r = await this.on(tenantId, tx).query(`SELECT 1 FROM media_assets WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [mediaId, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
  async activeAdmins(tenantId: string, tx?: SqlExecutor | null): Promise<number> {
    const r = await this.on(tenantId, tx).query(
      `SELECT COUNT(DISTINCT utr.user_id)::int AS n FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
        WHERE utr.tenant_id = $1 AND r.code = 'tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL`, [tenantId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** phone (E.164) → member user id, for THIS cooperative's members only. */
  async membersByPhone(tx: TxContext, tenantId: string, phones: string[]): Promise<Map<string, string>> {
    if (!phones.length) return new Map();
    const r = await tx.query(
      `SELECT DISTINCT u.phone, u.id FROM users u
         JOIN user_tenant_roles utr ON utr.user_id = u.id AND utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL
         JOIN roles ro ON ro.id = utr.role_id AND ro.code = ANY($3::text[])
        WHERE u.phone = ANY($2::text[]) AND u.deleted_at IS NULL`, [tenantId, phones, MEMBER_ROLE_CODES]);
    return new Map(r.rows.map((x: any) => [x.phone, x.id]));
  }
  /** Who is already on the register, and which folios are taken (live rows). */
  async registerState(tx: TxContext, tenantId: string): Promise<{ members: Set<string>; folios: Map<string, string> }> {
    const r = await tx.query(`SELECT member_user_id, folio FROM coop_share_registers WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    return { members: new Set(r.rows.map((x: any) => x.member_user_id)), folios: new Map(r.rows.filter((x: any) => x.folio).map((x: any) => [String(x.folio).toUpperCase(), x.member_user_id])) };
  }

  async insertImportTx(tx: TxContext, v: { id: string; tenantId: string; uploadedBy: string; fileMediaId: string; fileSha256: string; consentMediaId: string; consentKind: string }): Promise<void> {
    await tx.query(
      `INSERT INTO share_register_imports (id, tenant_id, uploaded_by, file_media_id, file_sha256, consent_media_id, consent_kind) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [v.id, v.tenantId, v.uploadedBy, v.fileMediaId, v.fileSha256, v.consentMediaId, v.consentKind]);
  }
  async insertLinesTx(tx: TxContext, tenantId: string, importId: string, lines: Array<{ lineNo: number; phoneMasked: string; folio: string | null; shares: number | null; paidUpMinor: string | null;
    memberUserId: string | null; status: string; errorCode: string | null; raw: Record<string, string> }>): Promise<void> {
    // one statement per 500 lines (≤ 5,000 lines → ≤ 10 statements)
    for (let i = 0; i < lines.length; i += 500) {
      const chunk = lines.slice(i, i + 500);
      const params: unknown[] = [tenantId, importId];
      const values = chunk.map((l) => {
        params.push(l.lineNo, JSON.stringify(l.raw), l.memberUserId, l.folio, l.shares, l.paidUpMinor, l.status, l.errorCode);
        const b = params.length - 8;
        return `($1, $2, $${b + 1}, $${b + 2}::jsonb, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
      });
      await tx.query(`INSERT INTO share_register_import_rows (tenant_id, import_id, line_no, raw, member_user_id, folio, shares, paid_up_minor, status, error_code) VALUES ${values.join(', ')}`, params);
    }
  }
  async get(tenantId: string, id: string, tx?: SqlExecutor | null, forUpdate = false): Promise<ImportRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM share_register_imports WHERE tenant_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [tenantId, id]);
    return r.rows[0] ? rowOf(r.rows[0]) : null;
  }
  async page(tenantId: string, limit: number, after?: KeysetCursor): Promise<ImportRow[]> {
    const params: unknown[] = [tenantId, limit];
    let keyset = '';
    if (after) { params.push(after.ts, after.id); keyset = ` AND (created_at, id) < ($3::timestamptz, $4::uuid)`; }
    const r = await this.on(tenantId).query(`SELECT ${COLS} FROM share_register_imports WHERE tenant_id = $1${keyset} ORDER BY created_at DESC, id DESC LIMIT $2`, params);
    return r.rows.map(rowOf);
  }
  async lines(tenantId: string, importId: string, limit: number, afterLine = 0, status?: string): Promise<ImportLineRow[]> {
    const params: unknown[] = [tenantId, importId, afterLine, limit];
    let where = '';
    if (status) { params.push(status); where = ` AND status = $5`; }
    const r = await this.on(tenantId).query(
      `SELECT line_no, raw->>'phoneMasked' AS phone_masked, folio, shares, paid_up_minor::text AS paid, status, error_code, member_user_id
         FROM share_register_import_rows WHERE tenant_id = $1 AND import_id = $2 AND line_no > $3${where} ORDER BY line_no LIMIT $4`, params);
    return r.rows.map((x: any) => ({ lineNo: Number(x.line_no), phoneMasked: x.phone_masked ?? '', folio: x.folio ?? null, shares: x.shares === null ? null : Number(x.shares),
      paidUpMinor: x.paid ?? null, status: x.status, errorCode: x.error_code ?? null, memberUserId: x.member_user_id ?? null }));
  }
  async moveTx(tx: TxContext, tenantId: string, id: string, from: string[], set: Record<string, unknown>): Promise<boolean> {
    const keys = Object.keys(set);
    const r = await tx.query(`UPDATE share_register_imports SET ${keys.map((k, i) => `${k} = $${i + 4}`).join(', ')} WHERE tenant_id = $1 AND id = $2 AND status = ANY($3::text[])`,
      [tenantId, id, from, ...keys.map((k) => set[k])]);
    return (r.rowCount ?? 0) === 1;
  }
  async confirmedImports(tenantId: string, tx?: SqlExecutor | null): Promise<string[]> {
    const r = await this.on(tenantId, tx).query(`SELECT id FROM share_register_imports WHERE tenant_id = $1 AND status = 'confirmed' ORDER BY confirmed_at, id LIMIT 10`, [tenantId]);
    return r.rows.map((x: any) => x.id);
  }
  /** The APPLY, one line at a time inside the import's transaction: insert the holding unless the member is on the register already or the
   *  folio was taken since validation — then the line is `skipped_duplicate`. Idempotent: only `valid` lines are visited. */
  async applyLinesTx(tx: TxContext, tenantId: string, importId: string, batchId: string, actor: string | null): Promise<{ applied: number; skipped: number }> {
    const r = await tx.query(`SELECT id, member_user_id, folio, shares, paid_up_minor FROM share_register_import_rows WHERE tenant_id = $1 AND import_id = $2 AND status = 'valid' ORDER BY line_no FOR UPDATE`, [tenantId, importId]);
    let applied = 0, skipped = 0;
    for (const l of r.rows as any[]) {
      const ins = await tx.query(
        `INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor, folio, source, import_batch_id, created_by)
         SELECT $1::uuid, $2::uuid, $3::int, $4::bigint, $5::varchar, 'import', $6::uuid, $7::uuid
          WHERE NOT EXISTS (SELECT 1 FROM coop_share_registers x WHERE x.tenant_id = $1::uuid AND x.folio = $5::varchar AND x.deleted_at IS NULL)
         ON CONFLICT (tenant_id, member_user_id) DO NOTHING RETURNING id`,
        [tenantId, l.member_user_id, l.shares, l.paid_up_minor, l.folio, batchId, actor]);
      const done = (ins.rowCount ?? 0) === 1;
      await tx.query(`UPDATE share_register_import_rows SET status = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, l.id, done ? 'applied' : 'skipped_duplicate']);
      if (done) applied++; else skipped++;
    }
    return { applied, skipped };
  }
}
