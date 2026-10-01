// modules/audit/repositories/audit.repository.ts · read-only access to the append-only audit_log.
// CQRS (Law 12): all reads run on the tenant's shard REPLICA inside a tenant-scoped READ ONLY tx, so RLS
// guarantees a tenant can only ever see its OWN audit rows (audit_log has tenant_id → RLS auto-applied by 0014).
// Keyset pagination on (created_at DESC, id DESC). id is bigint → returned as a string (bigint-safe).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';

export interface AuditRow {
  id: string; actorUserId: string | null; actorRole: string | null; action: string;
  entityType: string | null; entityId: string | null; oldValue: unknown; newValue: unknown;
  reason: string | null; requestId: string | null; createdAt: Date;
  /** [PC-56 TENANT-9a · F-7] the instant to the microsecond, as the cursor carries it. */
  cursorTs: string;
}

// NB: ip + user_agent are deliberately NOT projected — they are operational metadata, not part of the
// tenant-facing trail, and keep the read clear of incidental network PII.
const COLS = `id::text AS "id", actor_user_id AS "actorUserId", actor_role AS "actorRole", action,
  entity_type AS "entityType", entity_id AS "entityId", old_value AS "oldValue", new_value AS "newValue",
  reason, request_id AS "requestId", created_at AS "createdAt",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTs"`;

export interface AuditFilter {
  action?: string; entityType?: string; entityId?: string; actorUserId?: string;
  from?: string; to?: string; cursor?: { ts: string; id: string }; limit: number;
}

@Injectable()
export class AuditRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async listFor(tenantId: string, f: AuditFilter): Promise<AuditRow[]> {
    const where: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    const add = (clause: string, val: unknown) => { params.push(val); where.push(clause.replace('$N', `$${params.length}`)); };
    if (f.action) add('action = $N', f.action);
    if (f.entityType) add('entity_type = $N', f.entityType);
    if (f.entityId) add('entity_id = $N', f.entityId);
    if (f.actorUserId) add('actor_user_id = $N', f.actorUserId);
    if (f.from) add('created_at >= $N', f.from);
    if (f.to) add('created_at < $N', f.to);
    if (f.cursor) {
      // keyset: rows strictly older than the cursor (created_at DESC, id DESC)
      params.push(f.cursor.ts); const tsp = params.length;
      params.push(f.cursor.id); const idp = params.length;
      where.push(`(created_at < $${tsp}::timestamptz OR (created_at = $${tsp}::timestamptz AND id < $${idp}::bigint))`);
    }
    const lp = Math.min(Math.max(f.limit, 1), 100);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM audit_log WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${lp}`,
      params,
    );
    return r.rows as AuditRow[];
  }

  async getById(tenantId: string, id: string): Promise<AuditRow | null> {
    if (!/^\d{1,19}$/.test(id)) return null; // id is bigint
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM audit_log WHERE tenant_id = $1 AND id = $2::bigint LIMIT 1`,
      [tenantId, id],
    );
    return (r.rows[0] as AuditRow) ?? null;
  }
}
