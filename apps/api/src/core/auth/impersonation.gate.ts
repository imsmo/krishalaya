// apps/api/src/core/auth/impersonation.gate.ts · PC-56 ADMIN-9b.
//
// **THE DATABASE DECIDES WHETHER THE SESSION IS STILL LIVE, AND THAT IS WHAT MAKES "REVOKE" MEAN "NOW".** A signature
// proves the token was minted; only the grant row knows it was revoked thirty seconds ago. Without this read, W008's
// revoke dialog — "PO-STAFF-114's session ends immediately; their token (jti IMP-2214) is invalidated" — would mean
// "within thirty minutes", because that is the token's remaining TTL.
//
// EXPIRY IS RECONCILED HERE TOO, at the door, for the same reason 0118 put dormancy in the guard: the reconciliation
// this platform tried to leave to a job twice (0113, 0114) is a reconciliation nobody noticed had stopped. `expires_at`
// is authoritative in the WHERE clause regardless — a grant that has elapsed is refused even if nothing has flipped its
// status yet, so the status flip is bookkeeping and never the control.
//
// FAIL-CLOSED, WITHOUT EXCEPTION. A read failure refuses the request. Law 12's degrade-never-die protects a farmer whose
// price chart should still render when a recommender is down; this is a platform operator reading somebody else's
// account, and "we could not check whether this session was revoked, so we allowed it" is not a degraded service.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { ShardRouter } from '../sharding/shard-router';
/** What the gate needs to identify a session. Deliberately NOT `ImpersonationClaims`: by the time this runs the claims
 *  have become the request context, and asking a caller to reconstruct a token shape it no longer holds is how a
 *  reconstruction starts differing from the original. */
export interface GrantIdentity {
  grantId: string;
  targetUserId: string;
  targetTenantId: string;
  actorAdminId: string;
}

export type GrantVerdict =
  | { live: true; reason: string | null; expiresAt: Date }
  | { live: false; code: GrantRefusal; detail: string };

export const GRANT_REFUSALS = ['not_found', 'ended', 'revoked', 'expired', 'mismatch'] as const;
export type GrantRefusal = (typeof GRANT_REFUSALS)[number];

@Injectable()
export class ImpersonationGate {
  constructor(
    private readonly pools: PgPoolProvider,
    private readonly shards: ShardRouter,
  ) {}

  /**
   * Is this grant live, and does it describe the session the token claims?
   *
   * THE WRITER POOL, not the replica: a grant revoked two seconds ago must not be honoured because replication lagged.
   * This is the one read on the impersonated path where staleness is a security property rather than a performance one.
   */
  async check(claims: GrantIdentity, now = new Date()): Promise<GrantVerdict> {
    const pool = this.pools.writer(this.shards.shardFor(claims.targetTenantId));
    const client = await pool.connect();
    try {
      // Reconcile first, scoped to this grant. `reconcile_expired_impersonation_grants` lives in 0119 rather than here
      // so admin-api, apps/api and any future reader cannot disagree about what "expired" means.
      await client.query('SELECT reconcile_expired_impersonation_grants($1)', [claims.grantId]);
      const r = await client.query(
        `SELECT status, expires_at, target_user_id, target_tenant_id, admin_user_id, reason, ended_at, end_reason
           FROM impersonation_grants WHERE id = $1 AND deleted_at IS NULL`,
        [claims.grantId],
      );
      const g = r.rows[0];
      if (!g) {
        return { live: false, code: 'not_found', detail: 'this act-as grant does not exist' };
      }
      // **THE TOKEN'S OWN CLAIMS ARE CHECKED AGAINST THE ROW, not trusted.** A signed token is proof the platform minted
      // it, not proof it describes this grant: without this, a valid token for grant X could be replayed with X's id
      // while claiming a different target, and the reads would run in a tenant the grant never authorised.
      if (String(g.target_user_id) !== claims.targetUserId
        || String(g.target_tenant_id) !== claims.targetTenantId
        || String(g.admin_user_id) !== claims.actorAdminId) {
        return { live: false, code: 'mismatch', detail: 'this token does not match its grant' };
      }
      const status = String(g.status);
      if (status === 'revoked') {
        return { live: false, code: 'revoked', detail: 'this act-as session was revoked' };
      }
      if (status === 'ended') {
        return { live: false, code: 'ended', detail: 'this act-as session has ended' };
      }
      const expiresAt = new Date(String(g.expires_at));
      if (status === 'expired' || expiresAt.getTime() <= now.getTime()) {
        return { live: false, code: 'expired', detail: 'this act-as session has expired' };
      }
      if (status !== 'active') {
        // An unrecognised status refuses. A new state added by a future migration must arrive DENIED here rather than
        // silently honoured — the same rule ADMIN-8's `needsChecker` had to be corrected to follow.
        return { live: false, code: 'ended', detail: `unrecognised grant status '${status}'` };
      }
      return { live: true, reason: (g.reason as string | null) ?? null, expiresAt };
    } finally {
      client.release();
    }
  }

  /**
   * Append one action row. Called for EVERY impersonated request — served or refused.
   *
   * NOT best-effort. W008 promises "every page view during impersonation is recorded", and ADMIN-8b's lesson was that a
   * control whose work leaves no trace is a control nobody can prove held. So a failure to log propagates and the
   * request fails: an unlogged impersonated read does not happen. That is a deliberate inversion of the usual
   * "logging must never break the request" rule, and it is safe in exactly one direction — the operator loses a read
   * they can retry, rather than the farmer losing the record that somebody looked.
   */
  async recordAction(v: {
    grantId: string; targetTenantId: string; actorAdminId: string;
    method: string; path: string; action: string | null;
    outcome: 'served' | 'refused_write' | 'refused_grant';
    statusCode: number | null; detail: string | null; requestId: string | null;
  }): Promise<void> {
    const pool = this.pools.writer(this.shards.shardFor(v.targetTenantId));
    const client = await pool.connect();
    try {
      // The RLS INSERT policy (0119) checks `target_tenant_id = current_tenant_id()`, so the session variable has to be
      // set on THIS connection. Set locally without a transaction wrapper would not persist across the pool checkout,
      // hence the explicit transaction: the set and the insert must be the same unit.
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [v.targetTenantId]);
      await client.query(
        `INSERT INTO impersonation_actions
           (grant_id, target_tenant_id, method, path, action, outcome, status_code, detail, actor_admin_id, request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [v.grantId, v.targetTenantId, v.method.slice(0, 10), v.path.slice(0, 300), v.action,
          v.outcome, v.statusCode, v.detail?.slice(0, 300) ?? null, v.actorAdminId, v.requestId],
      );
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw e;
    } finally {
      client.release();
    }
  }
}
