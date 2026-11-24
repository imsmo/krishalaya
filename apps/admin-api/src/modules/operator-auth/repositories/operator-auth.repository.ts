// apps/admin-api/src/modules/operator-auth/repositories/operator-auth.repository.ts · PC-56 ADMIN-AUTH-1 (migration 0244).
//
// kv_admin only (0244 revokes every other realm). Every "single use" in this module is a CONDITIONAL UPDATE … RETURNING
// here — the database decides who won a race, not a read-then-write in the service. Nothing here can grant a role: roles
// come from ADMIN_OPERATOR_BINDINGS config; this file stores identities, keys, codes and ceremony state only.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { EnrollmentCodeRow, TicketRow } from '../domain/operator-auth.rules';

type Q = Pick<PoolClient, 'query'>;

export interface IdentityRow { adminUserId: string; issuer: string; subject: string; email: string; firstLoginAt: Date | null; lastLoginAt: Date | null }
export interface CredentialRow {
  id: string; adminUserId: string; credentialId: string; publicKey: Buffer; signCount: number; transports: string[];
  aaguid: string | null; label: string; enrolledVia: string; createdAt: Date; lastUsedAt: Date | null;
  revokedAt: Date | null; revokedByAdminId: string | null; revokeReason: string | null;
}
export interface CodeListRow {
  id: string; email: string; issuedByAdminId: string; issuedByEmail: string; reason: string; issuedAt: Date; expiresAt: Date;
  consumedAt: Date | null; revokedAt: Date | null;
}

const d = (v: unknown): Date | null => (v ? new Date(String(v)) : null);
function toIdentity(r: Record<string, unknown>): IdentityRow {
  return { adminUserId: String(r.admin_user_id), issuer: String(r.issuer), subject: String(r.subject), email: String(r.email),
    firstLoginAt: d(r.first_login_at), lastLoginAt: d(r.last_login_at) };
}
function toCredential(r: Record<string, unknown>): CredentialRow {
  return {
    id: String(r.id), adminUserId: String(r.admin_user_id), credentialId: String(r.credential_id),
    publicKey: Buffer.isBuffer(r.public_key) ? r.public_key : Buffer.from(r.public_key as Uint8Array),
    signCount: Number(r.sign_count ?? 0), transports: Array.isArray(r.transports) ? (r.transports as unknown[]).map(String) : [],
    aaguid: (r.aaguid as string | null) ?? null, label: String(r.label), enrolledVia: String(r.enrolled_via),
    createdAt: new Date(String(r.created_at)), lastUsedAt: d(r.last_used_at), revokedAt: d(r.revoked_at),
    revokedByAdminId: (r.revoked_by_admin_id as string | null) ?? null, revokeReason: (r.revoke_reason as string | null) ?? null,
  };
}
function toCode(r: Record<string, unknown>): CodeListRow & EnrollmentCodeRow {
  return {
    id: String(r.id), email: String(r.email), issuedByAdminId: String(r.issued_by_admin_id), issuedByEmail: String(r.issued_by_email),
    reason: String(r.reason), issuedAt: new Date(String(r.issued_at)), expiresAt: new Date(String(r.expires_at)),
    consumedAt: d(r.consumed_at), revokedAt: d(r.revoked_at),
  };
}

@Injectable()
export class OperatorAuthRepository {
  constructor(readonly db: AdminPool) {}

  /* ---------------- identities ---------------- */

  /** (issuer, subject) → admin_user_id, minted on first sight. The email is OBSERVED from the verified id_token and refreshed. */
  async upsertIdentity(c: Q, v: { issuer: string; subject: string; email: string }): Promise<{ identity: IdentityRow; created: boolean }> {
    const r = await c.query(
      `INSERT INTO platform_operator_identities (issuer, subject, email) VALUES ($1, $2, $3)
       ON CONFLICT (issuer, subject) DO UPDATE SET email = EXCLUDED.email, email_observed_at = now()
       RETURNING *, (xmax = 0) AS created`, [v.issuer, v.subject, v.email]);
    return { identity: toIdentity(r.rows[0]), created: Boolean(r.rows[0].created) };
  }

  async getIdentity(adminUserId: string, c: Q = this.db): Promise<IdentityRow | null> {
    const r = await c.query('SELECT * FROM platform_operator_identities WHERE admin_user_id = $1', [adminUserId]);
    return r.rows[0] ? toIdentity(r.rows[0]) : null;
  }

  async markLogin(c: Q, adminUserId: string): Promise<void> {
    await c.query(
      `UPDATE platform_operator_identities SET last_login_at = now(), first_login_at = coalesce(first_login_at, now())
        WHERE admin_user_id = $1`, [adminUserId]);
  }

  /** platform_operators.status (0118) — null when the realm has never seen this operator make a request. */
  async operatorStatus(adminUserId: string, c: Q = this.db): Promise<{ status: string; lastSeenAt: Date; suspendKind: string | null } | null> {
    const r = await c.query(
      `SELECT status, last_seen_at, suspend_kind FROM platform_operators WHERE admin_user_id = $1 AND deleted_at IS NULL`, [adminUserId]);
    return r.rows[0] ? { status: String(r.rows[0].status), lastSeenAt: new Date(String(r.rows[0].last_seen_at)), suspendKind: r.rows[0].suspend_kind ?? null } : null;
  }

  /* ---------------- SSO flows ---------------- */

  async createFlow(v: { stateSha256: string; bindingSha256: string; nonce: string; codeVerifier: string; ip: string | null; ttlSec: number }): Promise<void> {
    // Opportunistic purge of long-dead flows (bounded by the expiry index) so an unauthenticated endpoint cannot grow the table forever.
    await this.db.query(`DELETE FROM platform_operator_sso_flows WHERE expires_at < now() - interval '1 hour'`);
    await this.db.query(
      `INSERT INTO platform_operator_sso_flows (state_sha256, binding_sha256, nonce, code_verifier, ip, expires_at)
       VALUES ($1, $2, $3, $4, $5::inet, now() + ($6 || ' seconds')::interval)`,
      [v.stateSha256, v.bindingSha256, v.nonce, v.codeVerifier, v.ip, String(v.ttlSec)]);
  }

  /** Single use: the first callback with this state wins; every later one (or an expired one) gets null. */
  async consumeFlow(stateSha256: string): Promise<{ bindingSha256: string; nonce: string; codeVerifier: string } | null> {
    const r = await this.db.query(
      `UPDATE platform_operator_sso_flows SET consumed_at = now()
        WHERE state_sha256 = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING binding_sha256, nonce, code_verifier`, [stateSha256]);
    const x = r.rows[0];
    return x ? { bindingSha256: String(x.binding_sha256), nonce: String(x.nonce), codeVerifier: String(x.code_verifier) } : null;
  }

  /* ---------------- login tickets ---------------- */

  async createTicket(c: Q, v: { ticketSha256: string; adminUserId: string; email: string; ip: string | null; ttlSec: number }): Promise<void> {
    await c.query(`DELETE FROM platform_operator_login_tickets WHERE expires_at < now() - interval '1 day'`);
    await c.query(
      `INSERT INTO platform_operator_login_tickets (ticket_sha256, admin_user_id, email, ip, expires_at)
       VALUES ($1, $2, $3, $4::inet, now() + ($5 || ' seconds')::interval)`,
      [v.ticketSha256, v.adminUserId, v.email, v.ip, String(v.ttlSec)]);
  }

  async getTicket(ticketSha256: string, c: Q = this.db): Promise<TicketRow | null> {
    const r = await c.query(
      `SELECT admin_user_id, email, expires_at, consumed_at, failed_attempts FROM platform_operator_login_tickets WHERE ticket_sha256 = $1`,
      [ticketSha256]);
    const x = r.rows[0];
    return x ? { adminUserId: String(x.admin_user_id), email: String(x.email), expiresAt: new Date(String(x.expires_at)),
      consumedAt: d(x.consumed_at), failedAttempts: Number(x.failed_attempts) } : null;
  }

  async recordTicketFailure(ticketSha256: string): Promise<void> {
    await this.db.query(
      `UPDATE platform_operator_login_tickets SET failed_attempts = failed_attempts + 1 WHERE ticket_sha256 = $1 AND consumed_at IS NULL`,
      [ticketSha256]);
  }

  /** Single use, inside the login transaction: false if somebody else already consumed it, or it expired meanwhile. */
  async consumeTicket(c: Q, ticketSha256: string, sessionId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_login_tickets SET consumed_at = now(), consumed_session_id = $2
        WHERE ticket_sha256 = $1 AND consumed_at IS NULL AND expires_at > now() AND failed_attempts < 5`,
      [ticketSha256, sessionId]);
    return (r.rowCount ?? 0) === 1;
  }

  /* ---------------- WebAuthn challenges ---------------- */

  async createChallenge(v: { challenge: string; challengeSha256: string; adminUserId: string; purpose: string; ttlSec: number }): Promise<void> {
    await this.db.query(`DELETE FROM platform_operator_webauthn_challenges WHERE expires_at < now() - interval '1 hour'`);
    await this.db.query(
      `INSERT INTO platform_operator_webauthn_challenges (challenge_sha256, challenge, admin_user_id, purpose, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
      [v.challengeSha256, v.challenge, v.adminUserId, v.purpose, String(v.ttlSec)]);
  }

  /** Single use, bound to the operator AND the purpose — a login challenge cannot be spent on an enrollment or a step-up. */
  async consumeChallenge(challengeSha256: string, adminUserId: string, purpose: string): Promise<string | null> {
    const r = await this.db.query(
      `UPDATE platform_operator_webauthn_challenges SET consumed_at = now()
        WHERE challenge_sha256 = $1 AND admin_user_id = $2 AND purpose = $3 AND consumed_at IS NULL AND expires_at > now()
        RETURNING challenge`, [challengeSha256, adminUserId, purpose]);
    return r.rows[0] ? String(r.rows[0].challenge) : null;
  }

  /* ---------------- credentials ---------------- */

  async activeCredentialsOf(adminUserId: string, c: Q = this.db): Promise<CredentialRow[]> {
    const r = await c.query(
      `SELECT * FROM platform_operator_credentials WHERE admin_user_id = $1 AND revoked_at IS NULL ORDER BY created_at`, [adminUserId]);
    return r.rows.map(toCredential);
  }

  async credentialsOf(adminUserId: string): Promise<CredentialRow[]> {
    const r = await this.db.query(
      `SELECT * FROM platform_operator_credentials WHERE admin_user_id = $1 ORDER BY revoked_at NULLS FIRST, created_at`, [adminUserId]);
    return r.rows.map(toCredential);
  }

  async getCredentialForUpdate(c: Q, id: string): Promise<CredentialRow | null> {
    const r = await c.query('SELECT * FROM platform_operator_credentials WHERE id = $1 FOR UPDATE', [id]);
    return r.rows[0] ? toCredential(r.rows[0]) : null;
  }

  async countActiveCredentialsPlatformWide(c: Q = this.db): Promise<number> {
    const r = await c.query('SELECT count(*)::int AS n FROM platform_operator_credentials WHERE revoked_at IS NULL');
    return Number(r.rows[0]?.n ?? 0);
  }

  async insertCredential(c: Q, v: {
    adminUserId: string; credentialId: string; publicKey: Buffer; signCount: number; transports: string[]; aaguid: string | null;
    label: string; enrolledVia: 'bootstrap' | 'enrollment_code' | 'self_with_key'; enrollmentCodeId: string | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO platform_operator_credentials
         (admin_user_id, credential_id, public_key, sign_count, transports, aaguid, label, enrolled_via, enrollment_code_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id`,
      [v.adminUserId, v.credentialId, v.publicKey, v.signCount, JSON.stringify(v.transports), v.aaguid, v.label, v.enrolledVia, v.enrollmentCodeId]);
    return String(r.rows[0].id);
  }

  /** The counter rule, enforced by the WHERE clause too: two concurrent assertions with one counter value cannot both win. */
  async advanceSignCount(c: Q, id: string, presented: number): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_credentials SET sign_count = $2, last_used_at = now()
        WHERE id = $1 AND revoked_at IS NULL AND (sign_count < $2 OR (sign_count = 0 AND $2 = 0))`, [id, presented]);
    return (r.rowCount ?? 0) === 1;
  }

  async revokeCredential(c: Q, v: { id: string; byAdminId: string; reason: string }): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_credentials SET revoked_at = now(), revoked_by_admin_id = $2, revoke_reason = $3
        WHERE id = $1 AND revoked_at IS NULL`, [v.id, v.byAdminId, v.reason]);
    return (r.rowCount ?? 0) === 1;
  }

  /* ---------------- enrollment codes + bootstrap ---------------- */

  /** Serialises every enrollment (bootstrap included): "zero credentials exist" must still be true when the row lands. */
  async lockEnrollment(c: Q): Promise<void> {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('platform_operator_enrollment'))`);
  }

  async codeBySha(c: Q, codeSha256: string): Promise<(CodeListRow & EnrollmentCodeRow) | null> {
    const r = await c.query('SELECT * FROM platform_operator_enrollment_codes WHERE code_sha256 = $1 FOR UPDATE', [codeSha256]);
    return r.rows[0] ? toCode(r.rows[0]) : null;
  }

  async consumeCode(c: Q, id: string, byAdminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_enrollment_codes SET consumed_at = now(), consumed_by_admin_id = $2
        WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [id, byAdminId]);
    return (r.rowCount ?? 0) === 1;
  }

  async bootstrapUsed(c: Q, codeSha256: string): Promise<boolean> {
    const r = await c.query('SELECT 1 FROM platform_operator_bootstrap_uses WHERE code_sha256 = $1', [codeSha256]);
    return (r.rowCount ?? 0) > 0;
  }

  async recordBootstrap(c: Q, v: { codeSha256: string; adminUserId: string; credentialRowId: string }): Promise<void> {
    await c.query(
      `INSERT INTO platform_operator_bootstrap_uses (code_sha256, admin_user_id, credential_id) VALUES ($1, $2, $3)`,
      [v.codeSha256, v.adminUserId, v.credentialRowId]);
  }

  async insertCode(c: Q, v: { codeSha256: string; email: string; issuedByAdminId: string; issuedByEmail: string; reason: string; ttlSec: number }): Promise<{ id: string; expiresAt: Date }> {
    const r = await c.query(
      `INSERT INTO platform_operator_enrollment_codes (code_sha256, email, issued_by_admin_id, issued_by_email, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval) RETURNING id, expires_at`,
      [v.codeSha256, v.email, v.issuedByAdminId, v.issuedByEmail, v.reason, String(v.ttlSec)]);
    return { id: String(r.rows[0].id), expiresAt: new Date(String(r.rows[0].expires_at)) };
  }

  async listCodes(limit = 100): Promise<CodeListRow[]> {
    const r = await this.db.query(
      `SELECT id, email, issued_by_admin_id, issued_by_email, reason, issued_at, expires_at, consumed_at, revoked_at
         FROM platform_operator_enrollment_codes ORDER BY issued_at DESC LIMIT $1`, [limit]);
    return r.rows.map(toCode);
  }

  async revokeCode(c: Q, id: string, byAdminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_enrollment_codes SET revoked_at = now(), revoked_by_admin_id = $2
        WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`, [id, byAdminId]);
    return (r.rowCount ?? 0) === 1;
  }

  /* ---------------- sessions (0118's table, written inside the login transaction) ---------------- */

  /** The session the minted token's `sid` names, and the operator row, created atomically with the login — so the guard
   *  finds both on the very first request and sign-out has a row to revoke. Same columns observe() writes. */
  async openSession(c: Q, v: { sessionId: string; adminUserId: string; ip: string | null; userAgent: string | null;
    roles: string[]; amr: string[]; authTime: Date; expiresAt: Date }): Promise<void> {
    await c.query(
      `INSERT INTO platform_operators (admin_user_id, last_seen_ip, last_roles, last_amr, request_count)
         VALUES ($1, $2::inet, $3::jsonb, $4::jsonb, 0)
       ON CONFLICT (admin_user_id) DO UPDATE SET last_seen_at = now(), last_seen_ip = EXCLUDED.last_seen_ip,
         last_roles = EXCLUDED.last_roles, last_amr = EXCLUDED.last_amr`,
      [v.adminUserId, v.ip, JSON.stringify(v.roles), JSON.stringify(v.amr)]);
    await c.query(
      `INSERT INTO platform_operator_sessions (session_id, admin_user_id, ip, user_agent, auth_time_at, amr, token_expires_at)
       VALUES ($1, $2, $3::inet, $4, $5, $6::jsonb, $7)`,
      [v.sessionId, v.adminUserId, v.ip, v.userAgent?.slice(0, 300) ?? null, v.authTime, JSON.stringify(v.amr), v.expiresAt]);
  }

  async stepUpSession(c: Q, v: { sessionId: string; adminUserId: string; authTime: Date }): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_operator_sessions SET auth_time_at = $3, last_seen_at = now()
        WHERE session_id = $1 AND admin_user_id = $2 AND revoked_at IS NULL`, [v.sessionId, v.adminUserId, v.authTime]);
    return (r.rowCount ?? 0) === 1;
  }

  /** Sign-out. An UPSERT so the sid is dead even if its row was somehow never written. */
  async revokeOwnSession(c: Q, v: { sessionId: string; adminUserId: string }): Promise<void> {
    await c.query(
      `INSERT INTO platform_operator_sessions (session_id, admin_user_id, revoked_at, revoked_by_admin_id, revoke_reason)
       VALUES ($1, $2, now(), $2, 'signed out by the operator')
       ON CONFLICT (session_id) DO UPDATE SET revoked_at = coalesce(platform_operator_sessions.revoked_at, now()),
         revoked_by_admin_id = coalesce(platform_operator_sessions.revoked_by_admin_id, EXCLUDED.revoked_by_admin_id),
         revoke_reason = coalesce(platform_operator_sessions.revoke_reason, EXCLUDED.revoke_reason)
       WHERE platform_operator_sessions.admin_user_id = EXCLUDED.admin_user_id`, [v.sessionId, v.adminUserId]);
  }
}
