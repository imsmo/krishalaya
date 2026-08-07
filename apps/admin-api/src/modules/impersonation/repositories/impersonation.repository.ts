// apps/admin-api/src/modules/impersonation/repositories/impersonation.repository.ts · ALL SQL for impersonation.
// READS: target-user membership/privilege check (user_tenant_roles + roles.scope), grants (keyset list + single +
// FOR UPDATE), actions (keyset). WRITES (in the caller's tx): insert grant, close grant (end/revoke/expire), insert
// an action. impersonation_grants + impersonation_actions are GLOBAL/god-mode (target_tenant_id, not tenant_id) —
// operated only by kv_admin, every action audited. Parameterised; keyset (never OFFSET); bounded.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { ImpersonationGrant, GrantProps } from '../domain/grant.entity';
import { GrantStatus } from '../domain/grant.state';
import { ImpersonationScope } from '../domain/scope';
import { ActiveGrantExistsError } from '../domain/impersonation.errors';

function toGrant(r: any): ImpersonationGrant {
  const props: GrantProps = {
    id: r.id, adminUserId: r.admin_user_id, targetTenantId: r.target_tenant_id, targetUserId: r.target_user_id,
    reason: r.reason, scope: r.scope as ImpersonationScope, status: r.status as GrantStatus,
    expiresAt: r.expires_at, endedAt: r.ended_at ?? null, endedBy: r.ended_by ?? null, endReason: r.end_reason ?? null, createdAt: r.created_at ?? null,
  };
  return ImpersonationGrant.rehydrate(props);
}
const COLS = `id, admin_user_id, target_tenant_id, target_user_id, reason, scope, status, expires_at, ended_at, ended_by, end_reason, created_at`;

export interface GrantListQuery { adminUserId?: string; targetTenantId?: string; targetUserId?: string; status?: GrantStatus; cursor?: { c: string; id: string }; limit: number; }
export interface ActionListQuery { grantId: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ImpersonationRepository {
  constructor(private readonly pool: AdminPool) {}

  /** Is the user an active member of the tenant, and do they hold ANY platform-scoped (privileged) role? */
  async findTenantUser(tenantId: string, userId: string): Promise<{ isPrivileged: boolean } | null> {
    const m = await this.pool.query(`SELECT 1 FROM user_tenant_roles WHERE user_id=$1 AND tenant_id=$2 AND is_active LIMIT 1`, [userId, tenantId]);
    if ((m.rowCount ?? 0) === 0) return null;   // not a member of THAT tenant ⇒ 404 (no cross-tenant enumeration)
    const priv = await this.pool.query(
      `SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id WHERE utr.user_id=$1 AND r.scope='platform' LIMIT 1`, [userId]);
    return { isPrivileged: (priv.rowCount ?? 0) > 0 };
  }

  /** Insert an active grant. The partial-unique index (one active per admin+target) → typed 409. */
  async insertGrant(client: PoolClient, g: { id: string; adminUserId: string; targetTenantId: string; targetUserId: string; reason: string; scope: ImpersonationScope; expiresAt: Date }): Promise<ImpersonationGrant> {
    try {
      const r = await client.query(
        `INSERT INTO impersonation_grants (id, admin_user_id, target_tenant_id, target_user_id, reason, scope, status, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$2) RETURNING ${COLS}`,
        [g.id, g.adminUserId, g.targetTenantId, g.targetUserId, g.reason, g.scope, g.expiresAt.toISOString()]);
      return toGrant(r.rows[0]);
    } catch (e: any) {
      if (e?.code === '23505') throw new ActiveGrantExistsError();
      throw e;
    }
  }

  async getGrant(id: string): Promise<ImpersonationGrant | null> {
    const r = await this.pool.query(`SELECT ${COLS} FROM impersonation_grants WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toGrant(r.rows[0]) : null;
  }
  async getGrantForUpdate(client: PoolClient, id: string): Promise<ImpersonationGrant | null> {
    const r = await client.query(`SELECT ${COLS} FROM impersonation_grants WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toGrant(r.rows[0]) : null;
  }

  async closeGrant(client: PoolClient, id: string, status: GrantStatus, endedBy: string, endReason: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE impersonation_grants SET status=$2, ended_at=now(), ended_by=$3, end_reason=$4, updated_by=$5, updated_at=now() WHERE id=$1`,
      [id, status, endedBy, endReason, actorUserId]);
  }

  async listGrants(q: GrantListQuery): Promise<ImpersonationGrant[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.adminUserId) where += ` AND admin_user_id=${p(q.adminUserId)}`;
    if (q.targetTenantId) where += ` AND target_tenant_id=${p(q.targetTenantId)}`;
    if (q.targetUserId) where += ` AND target_user_id=${p(q.targetUserId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(`SELECT ${COLS} FROM impersonation_grants WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toGrant);
  }

  /* ---------------- impersonation_actions (append-only) ---------------- */
  async insertAction(client: PoolClient, a: { grantId: string; targetTenantId: string; method: string; path: string; action: string | null }): Promise<{ id: string; createdAt: Date }> {
    const r = await client.query(
      `INSERT INTO impersonation_actions (grant_id, target_tenant_id, method, path, action) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [a.grantId, a.targetTenantId, a.method, a.path, a.action]);
    return { id: r.rows[0].id, createdAt: r.rows[0].created_at };
  }
  async listActions(q: ActionListQuery): Promise<any[]> {
    const params: unknown[] = [q.grantId]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'grant_id=$1';
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, grant_id, method, path, action, created_at FROM impersonation_actions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, grantId: x.grant_id, method: x.method, path: x.path, action: x.action ?? null, createdAt: x.created_at }));
  }

  /* ------------------------------------------------------------------------------------------------ */
  /* PC-56 ADMIN-9b                                                                                    */
  /* ------------------------------------------------------------------------------------------------ */

  /**
   * **THE TARGET IS TOLD, ON THE SPINE EVERYTHING ELSE USES.** W008 states "tenants can see this too — transparency is
   * the policy" and its revoke dialog promises "the target tenant is notified of session end". Nothing emitted
   * anything: `grep -i impersonat` across the notification map, the outbox types and the templates returned zero.
   *
   * Written INSIDE the caller's transaction (Law 4): the grant, its audit row and the notification are one unit, so a
   * session can never exist without the notice having been queued. The payload carries `userId` because
   * `DomainEventFanoutHandler` resolves recipients from the payload — the ADMIN-6b lesson, where a map row pointed at a
   * payload with no recipient and the fix looked done and changed nothing.
   */
  async emitNotification(client: PoolClient, v: {
    eventType: 'impersonation.session_started' | 'impersonation.session_ended';
    grantId: string; targetTenantId: string; targetUserId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, 'impersonation_grant', $2, $3, $4::jsonb)`,
      [v.targetTenantId, v.grantId, v.eventType, JSON.stringify({ v: 1, userId: v.targetUserId, ...v.payload })],
    );
  }

  /** Flip elapsed grants to `expired`. The SQL lives in 0119 so admin-api, apps/api and any future reader cannot
   *  disagree about what expired means — and it runs on the READ path, because the two times this platform left a
   *  reconciliation to a scheduled job (0113, 0114) the job had silently stopped. */
  async reconcileExpired(grantId?: string): Promise<number> {
    const r = await this.pool.query('SELECT reconcile_expired_impersonation_grants($1) AS n', [grantId ?? null]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** Per-grant action counts, split by outcome. The console needs the split rather than a total: "12 pages opened" and
   *  "12 pages opened, 3 write attempts blocked" are different sessions. */
  async actionCounts(grantId: string): Promise<{ served: number; refusedWrite: number; refusedGrant: number }> {
    const r = await this.pool.query(
      `SELECT
         count(*) FILTER (WHERE outcome = 'served')::int         AS served,
         count(*) FILTER (WHERE outcome = 'refused_write')::int  AS refused_write,
         count(*) FILTER (WHERE outcome = 'refused_grant')::int  AS refused_grant
       FROM impersonation_actions WHERE grant_id = $1`, [grantId]);
    const x = r.rows[0] ?? {};
    return {
      served: Number(x.served ?? 0),
      refusedWrite: Number(x.refused_write ?? 0),
      refusedGrant: Number(x.refused_grant ?? 0),
    };
  }

  /** Grants whose window has elapsed and whose status has not caught up — the backlog `ck_imp_terminal_has_ended_at`
   *  was landed NOT VALID for. Shown on the console rather than silently reconciled, because the count IS the finding:
   *  every one of these has been reading `active` to every surface since it elapsed. */
  async staleActiveCount(): Promise<number> {
    const r = await this.pool.query(
      "SELECT count(*)::int AS n FROM impersonation_grants WHERE status = 'active' AND expires_at <= now() AND deleted_at IS NULL");
    return Number(r.rows[0]?.n ?? 0);
  }
}
