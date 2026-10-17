// modules/identity/repositories/session.repository.ts · auth sessions (only refresh HASH stored).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Session } from '../domain/session.entity';

const COLS = `id, user_id, device_id, refresh_token_hash, host(ip) AS ip, expires_at, revoked_at, last_seen_at, partner_id`;
const toDomain = (r: any): Session => Session.rehydrate({ id: r.id, userId: r.user_id, deviceId: r.device_id, refreshTokenHash: r.refresh_token_hash, ip: r.ip, expiresAt: r.expires_at, revokedAt: r.revoked_at, lastSeenAt: r.last_seen_at, partnerId: r.partner_id ?? null });

@Injectable()
export class SessionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, s: Session): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, ip, expires_at, last_seen_at, realm, partner_id)
       VALUES ($1,$2,$3,$4,$5::inet,$6, now(), $7, $8)`,
      [p.id, p.userId, p.deviceId, p.refreshTokenHash, p.ip, p.expiresAt, p.partnerId ? 'partner' : 'tenant', p.partnerId ?? null]);
  }
  /** PC-56 PARTNER-0: a refresh token rotates only inside ITS realm — a partner session's token is never a tenant refresh (and vice versa). */
  async getByRefreshHashForUpdate(tx: TxContext, hash: string, realm: 'tenant' | 'partner' = 'tenant'): Promise<Session | null> {
    const r = await tx.query(`SELECT ${COLS} FROM sessions WHERE refresh_token_hash=$1 AND realm=$2 FOR UPDATE`, [hash, realm]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** PC-56 PARTNER-0: end every live PARTNER session of one person for one partner (a removal from that partner's team). */
  async revokePartnerSessions(tx: TxContext, userId: string, partnerId: string): Promise<number> {
    const r = await tx.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND partner_id=$2 AND realm='partner' AND revoked_at IS NULL`, [userId, partnerId]);
    return r.rowCount;
  }
  async rotate(tx: TxContext, s: Session): Promise<void> {
    const p = s.toProps();
    await tx.query(`UPDATE sessions SET refresh_token_hash=$2, expires_at=$3, last_seen_at=now() WHERE id=$1`, [p.id, p.refreshTokenHash, p.expiresAt]);
  }
  async revoke(tx: TxContext, sessionId: string, userId: string): Promise<void> {
    await tx.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`, [sessionId, userId]);
  }
  async revokeAllForUser(tx: TxContext, userId: string): Promise<void> {
    await tx.query(`UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [userId]);
  }
  /**
   * PC-56 STORE-1a · A4 — the caller's sessions as a PERSON may see them: a coarse device family (from the bound device row's
   * platform — sessions store no user-agent), whether it is THIS session, and when it was last active. Never the IP (it used to be
   * returned) and never a place: the founder refused a city on the "new device" notice (D5) and no geolocation provider exists.
   */
  async listForUser(tenantId: string, userId: string, currentSessionId = ''): Promise<SessionSummary[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT s.id, d.platform, s.expires_at, s.revoked_at, s.last_seen_at, s.created_at
         FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
        WHERE s.user_id=$1 ORDER BY s.last_seen_at DESC LIMIT 50`, [userId]);
    return r.rows.map((x: any) => ({
      id: x.id, deviceFamily: deviceFamilyOf(x.platform), current: !!currentSessionId && x.id === currentSessionId,
      lastSeenAt: new Date(x.last_seen_at).toISOString(), createdAt: new Date(x.created_at).toISOString(),
      expiresAt: new Date(x.expires_at).toISOString(), revokedAt: x.revoked_at ? new Date(x.revoked_at).toISOString() : null,
    }));
  }
}

/** PC-56 STORE-1a · A4: what a session list may say about a device. */
export interface SessionSummary {
  id: string; deviceFamily: DeviceFamily; current: boolean; lastSeenAt: string; createdAt: string; expiresAt: string; revokedAt: string | null;
}
export type DeviceFamily = 'android' | 'ios' | 'web' | null;
/** Coarse family from the device row's platform (DeviceSchema: android|ios|web). Anything else — or no device — is null ("another session"). */
export function deviceFamilyOf(platform: unknown): DeviceFamily {
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
  return p === 'android' || p === 'ios' || p === 'web' ? p : null;
}
