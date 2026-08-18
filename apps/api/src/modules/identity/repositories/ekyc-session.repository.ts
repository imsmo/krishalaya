// modules/identity/repositories/ekyc-session.repository.ts
// All SQL for the ekyc_sessions aggregate (tenant_id in EVERY query — Law 1; RLS is the net). Writes are
// optimistic-locked on `version`. NEVER stores/returns a raw id, OTP, or vault ref — masked + last-4 only.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { EkycSession, EkycDoc } from '../domain/ekyc-session.entity';
import { EkycSessionStatus } from '../domain/ekyc-session.state';
import { ConcurrencyError } from '../domain/identity.errors';

const COLS = `id, tenant_id, user_id, doc_type, provider_code, provider_ref, masked_id, last4, name_match,
  otp_required, attempts, status, failure_reason, valid_until, expires_at, verified_at, version`;

function toDomain(r: any): EkycSession {
  return EkycSession.rehydrate({
    id: r.id, tenantId: r.tenant_id, userId: r.user_id, docType: r.doc_type as EkycDoc, providerCode: r.provider_code,
    providerRef: r.provider_ref, maskedId: r.masked_id, last4: r.last4, nameMatch: r.name_match, otpRequired: r.otp_required,
    attempts: r.attempts, status: r.status as EkycSessionStatus, failureReason: r.failure_reason, validUntil: r.valid_until,
    expiresAt: r.expires_at, verifiedAt: r.verified_at, version: r.version,
  });
}

@Injectable()
export class EkycSessionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, s: EkycSession): Promise<void> {
    const v = s.toProps();
    await tx.query(
      `INSERT INTO ekyc_sessions (id, tenant_id, user_id, doc_type, provider_code, provider_ref, masked_id, last4,
         otp_required, attempts, status, expires_at, version, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$3)`,
      [v.id, v.tenantId, v.userId, v.docType, v.providerCode, v.providerRef, v.maskedId, v.last4,
       v.otpRequired, v.attempts, v.status, v.expiresAt, v.version]);
  }

  /** A live (pending) session for the user+docType, if any — enforces the one-in-flight rule in-app. */
  async findPending(tx: TxContext, tenantId: string, userId: string, docType: string): Promise<EkycSession | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM ekyc_sessions WHERE tenant_id=$1 AND user_id=$2 AND doc_type=$3 AND status='pending' FOR UPDATE`,
      [tenantId, userId, docType]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Anti-IDOR: lock the session by id AND the calling user — another user (or tenant) gets null → 404. */
  async getOwnedForUpdate(tx: TxContext, tenantId: string, id: string, userId: string): Promise<EkycSession | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM ekyc_sessions WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE`, [id, tenantId, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist state/attempts/verify stamp, bumping version (optimistic lock). */
  async update(tx: TxContext, s: EkycSession): Promise<void> {
    const v = s.toProps();
    const r = await tx.query(
      `UPDATE ekyc_sessions SET status=$3, attempts=$4, name_match=$5, failure_reason=$6, valid_until=$7,
         verified_at=$8, version=version+1, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND version=$9`,
      [v.id, v.tenantId, v.status, v.attempts, v.nameMatch, v.failureReason, v.validUntil, v.verifiedAt, v.version]);
    if (r.rowCount === 0) throw new ConcurrencyError('ekyc_session', v.id);
  }

  /** Owner's recent sessions (keyset on created_at,id — never OFFSET). Masked-only fields. */
  async listForUser(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<EkycSession[]> {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id=$1 AND user_id=$2 AND deleted_at IS NULL`;
    const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS}, created_at FROM ekyc_sessions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
