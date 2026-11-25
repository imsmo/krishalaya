// apps/admin-api/src/core/audit/admin-audit.writer.ts · append-only audit trail for god-mode actions. Writes to
// the SAME partitioned audit_log table the platform uses, with tenant_id NULL (platform action). write(client,…)
// runs INSIDE the business transaction so the action + its audit row commit atomically (§4 / Law 4). Audit rows
// are never updated/deleted. No PII/secrets in the payload.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../database/admin-pool';

export interface AdminAuditEntry {
  /** Null only for a refused sign-in attempt that never resolved to an operator (PC-56 ADMIN-AUTH-1); audit_log.actor_user_id is nullable. */
  actorUserId: string | null;
  actorRole?: string | null;
  action: string;                 // e.g. 'ai.model.registered','ai.model.promoted','ai.model.threshold_tuned'
  entityType?: string | null;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
  requestId?: string | null;
}
const COLS = `(tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason, ip, request_id, entity_key)`;
const VALS = `(NULL,$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`;
// PC-56 TEST-1 · audit_log.entity_id is a uuid. A flag, a provider, a lookup type, a country is named by a CODE, and writing
// that code into entity_id failed the INSERT — and, because the audit row commits with the action, rolled the action back (a
// kill-switch could not be pulled). A uuid goes to entity_id; any other key goes to entity_key (migration 0247).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => typeof v === 'string' && UUID_RE.test(v);
const params = (e: AdminAuditEntry) => [
  e.actorUserId, e.actorRole ?? null, e.action, e.entityType ?? null, isUuid(e.entityId) ? e.entityId : null,
  e.oldValue != null ? JSON.stringify(e.oldValue) : null,
  e.newValue != null ? JSON.stringify(e.newValue) : null,
  e.reason ?? null, e.ip ?? null, e.requestId ?? null,
  e.entityId != null && !isUuid(e.entityId) ? String(e.entityId).slice(0, 200) : null,
];

@Injectable()
export class AdminAuditWriter {
  constructor(private readonly pool: AdminPool) {}
  /** Audit within the caller's transaction (atomic with the god-mode change). */
  async write(client: PoolClient, entry: AdminAuditEntry): Promise<void> {
    await client.query(`INSERT INTO audit_log ${COLS} VALUES ${VALS}`, params(entry));
  }
  /** Standalone access audit (no business tx) — for read/list endpoints. */
  async log(entry: AdminAuditEntry): Promise<void> {
    await this.pool.query(`INSERT INTO audit_log ${COLS} VALUES ${VALS}`, params(entry));
  }
}
