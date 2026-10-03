// core/audit/audit.writer.ts
// Append-only audit trail (Definition of Done: "audit_log entries for admin actions").
// Writes to the immutable, partitioned audit_log. Two modes:
//  • write(tx, …)  — inside the business transaction, so the action and its audit
//    record commit atomically (the preferred path for state changes);
//  • log(…)        — its own connection, for read-side/sensitive-access auditing
//    (e.g. impersonation, data export view) where there is no business tx.
// Audit rows are NEVER updated/deleted (the DB role grants forbid it).
//
// [PC-56 TENANT-9c · F-9] `actor_role` WAS WRITTEN BY 0 OF 246 CALL SITES, so W200's "every one has actor + reason" had
// half its subject missing on every row. The writer now records it AT WRITE TIME, once, for every caller: an explicit
// `actorRole` wins; otherwise, when the row's actor IS the request's caller, the caller's role set in this tenant
// (sorted, `+`-joined — `auditor`, `farmer+tenant_admin`; an act-as session is prefixed `act_as:`); a row written with no
// request in scope (a job, the outbox relay) is `system`; a row whose actor is somebody other than the caller is
// `not_the_caller` rather than a guess at a role nobody resolved. Rows written before 0181 stay NULL and the console
// prints "not recorded". `actorRoleFor` is pure and pinned by the 9c spec.
//
// [PC-56 TENANT-9c · found on the way] `log()` RAN ON A BARE POOL CONNECTION WITH NO `app.tenant_id`, so under FORCE'd RLS
// every tenant row it wrote was refused (`tenant_id = current_tenant_id()` is NULL = false) — the 1b reveal and farmer-360
// audits could not be recorded at all (proven as kv_app at 640d41e: `new row violates row-level security policy for table
// "audit_log"`). It now opens its own one-statement transaction with the row's tenant set, exactly as the unit of work does.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { TxContext } from '../database/unit-of-work';
import { tryGetRequestContext, RequestContext } from '../tenancy-context/request-context';

const ROLE_MAX = 200;

/** PURE: the role the trail records for this row (see the header). */
export function actorRoleFor(entry: { actorUserId?: string | null; actorRole?: string | null }, rc: Pick<RequestContext, 'userId' | 'roles' | 'impersonation' | 'apiKey'> | undefined): string {
  if (entry.actorRole) return entry.actorRole.slice(0, ROLE_MAX);
  if (!rc || !rc.userId) return 'system';
  if (entry.actorUserId && entry.actorUserId !== rc.userId) return 'not_the_caller';
  const set = [...new Set(rc.roles ?? [])].sort().join('+') || 'no_role';
  // PC-56 TENANT-13c: a key-authenticated act is recorded as the synthetic principal, ON BEHALF OF its creator (the row's
  // actor_user_id) — `api_key:<id> on_behalf_of:<their roles>` — never as if the person had done it by hand.
  if (rc.apiKey) return `api_key:${rc.apiKey.keyId} on_behalf_of:${set}`.slice(0, ROLE_MAX);
  return `${rc.impersonation ? 'act_as:' : ''}${set}`.slice(0, ROLE_MAX);
}

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;                 // e.g. 'user.role_assigned','kyc.approved','user.impersonated'
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const COLS = `(tenant_id, actor_user_id, actor_role, action, entity_type, entity_id,
  old_value, new_value, reason, ip, user_agent, request_id)`;
const VALS = `($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`;
const params = (e: AuditEntry) => [
  e.tenantId ?? null, e.actorUserId ?? null, actorRoleFor(e, tryGetRequestContext()), e.action,
  e.entityType ?? null, e.entityId ?? null,
  e.oldValue != null ? JSON.stringify(e.oldValue) : null,
  e.newValue != null ? JSON.stringify(e.newValue) : null,
  e.reason ?? null, e.ip ?? null, e.userAgent ?? null, e.requestId ?? null,
];

@Injectable()
export class AuditWriter {
  constructor(private readonly pools: PgPoolProvider) {}

  /** Audit within the caller's transaction (atomic with the business change). */
  async write(tx: TxContext, entry: AuditEntry): Promise<void> {
    await tx.query(`INSERT INTO audit_log ${COLS} VALUES ${VALS}`, params(entry));
  }

  /** Standalone audit (no business tx) — e.g. read/impersonation events. */
  async log(entry: AuditEntry): Promise<void> {
    const client = await this.pools.writer(0).connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [entry.tenantId ?? '']);
      await client.query(`INSERT INTO audit_log ${COLS} VALUES ${VALS}`, params(entry));
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
