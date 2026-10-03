// modules/tenant-api-keys/repositories/api-key.repository.ts · PC-56 TENANT-13c · SQL for api_keys + api_key_proposals (0002 / 0193).
//   • the guard's ONE lookup runs through `api_key_for_prefix(prefix)` (definer rights: the tenant is not known until the key is) on
//     the writer pool as kv_app — never a scan, never a list; `touch` through `api_key_touch(id)` (debounced >= 60 s in the database);
//   • every tenant read / write carries tenant_id AND runs under RLS (replica forTenant / the unit of work);
//   • NO QUERY HERE RETURNS `key_hash` TO A CALLER OUTSIDE THE GUARD, and none ever selects a secret (none is stored);
//   • lists page on a microsecond keyset (created_at DESC, id DESC) — `to_char(... 'US')`, never a JS Date.
import { Inject, Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';

export interface KeyLookupRow {
  id: string; tenantId: string; keyHash: string; scopes: string[]; ratePerHour: number; activatedAt: string | null;
  revokedAt: string | null; revokedReason: string | null; expiresAt: string | null; createdBy: string | null; tenantStatus: string;
}
export interface KeyRow {
  id: string; name: string; keyPrefix: string; scopes: string[]; ratePerHour: number; lastUsedAt: string | null;
  activatedAt: string | null; revokedAt: string | null; revokedReason: string | null; revokedBy: string | null; revokedByAdmin: boolean;
  expiresAt: string | null; createdAt: string; createdBy: string | null; createdByName: string | null; checkerUserId: string | null;
  checkerName: string | null; cursorTs: string; proposalId: string | null; proposalStatus: string | null;
}
export interface KeyProposalRow {
  id: string; apiKeyId: string; keyPrefix: string; keyName: string; scopes: string[]; reason: string; proposedBy: string;
  proposedByName: string | null; proposedAt: string; expiresAt: string; status: 'proposed' | 'confirmed' | 'refused' | 'expired';
  confirmedBy: string | null; confirmedAt: string | null; refusedBy: string | null; refuseReason: string | null; cursorTs: string;
}
export interface ApiAccess { enabled: boolean; source: 'override' | 'plan' | 'none'; planCode: string | null }

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

const KEY_COLS = `k.id, k.name, k.key_prefix, k.scopes, k.rate_per_hour, k.last_used_at, k.activated_at, k.revoked_at, k.revoked_reason,
  k.revoked_by, k.revoked_by_admin_id, k.expires_at, k.created_at, k.created_by, cu.full_name AS created_by_name, k.checker_user_id,
  ch.full_name AS checker_name, ${US_SQL('k.created_at')} AS cursor_ts, p.id AS proposal_id, p.status AS proposal_status`;
const KEY_FROM = `api_keys k
  LEFT JOIN users cu ON cu.id = k.created_by
  LEFT JOIN users ch ON ch.id = k.checker_user_id
  LEFT JOIN api_key_proposals p ON p.api_key_id = k.id`;

const toKey = (x: any): KeyRow => ({
  id: String(x.id), name: String(x.name), keyPrefix: String(x.key_prefix), scopes: arr(x.scopes), ratePerHour: Number(x.rate_per_hour),
  lastUsedAt: iso(x.last_used_at), activatedAt: iso(x.activated_at), revokedAt: iso(x.revoked_at), revokedReason: x.revoked_reason ?? null,
  revokedBy: x.revoked_by ?? null, revokedByAdmin: Boolean(x.revoked_by_admin_id), expiresAt: iso(x.expires_at), createdAt: iso(x.created_at)!,
  createdBy: x.created_by ?? null, createdByName: x.created_by_name ?? null, checkerUserId: x.checker_user_id ?? null, checkerName: x.checker_name ?? null,
  cursorTs: String(x.cursor_ts), proposalId: x.proposal_id ?? null, proposalStatus: x.proposal_status ?? null,
});
const toProposal = (x: any): KeyProposalRow => ({
  id: String(x.id), apiKeyId: String(x.api_key_id), keyPrefix: String(x.key_prefix), keyName: String(x.key_name), scopes: arr(x.scopes),
  reason: String(x.reason), proposedBy: String(x.proposed_by), proposedByName: x.proposed_by_name ?? null, proposedAt: iso(x.proposed_at)!,
  expiresAt: iso(x.expires_at)!, status: x.status, confirmedBy: x.confirmed_by ?? null, confirmedAt: iso(x.confirmed_at),
  refusedBy: x.refused_by ?? null, refuseReason: x.refuse_reason ?? null, cursorTs: String(x.cursor_ts),
});
const PROPOSAL_SQL = `SELECT p.id, p.api_key_id, k.key_prefix, k.name AS key_name, k.scopes, p.reason, p.proposed_by, u.full_name AS proposed_by_name,
       p.proposed_at, p.expires_at, p.status, p.confirmed_by, p.confirmed_at, p.refused_by, p.refuse_reason, ${US_SQL('p.created_at')} AS cursor_ts
  FROM api_key_proposals p JOIN api_keys k ON k.id = p.api_key_id LEFT JOIN users u ON u.id = p.proposed_by`;

@Injectable()
export class ApiKeyRepository {
  constructor(private readonly pools: PgPoolProvider, @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- the guard ----
  async findByPrefix(prefix: string): Promise<KeyLookupRow | null> {
    const r = await this.pools.writer(0).query(`SELECT * FROM api_key_for_prefix($1)`, [prefix]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      id: String(x.id), tenantId: String(x.tenant_id), keyHash: String(x.key_hash), scopes: arr(x.scopes), ratePerHour: Number(x.rate_per_hour),
      activatedAt: iso(x.activated_at), revokedAt: iso(x.revoked_at), revokedReason: x.revoked_reason ?? null, expiresAt: iso(x.expires_at),
      createdBy: x.created_by ?? null, tenantStatus: String(x.tenant_status),
    };
  }
  async touch(keyId: string): Promise<boolean> {
    const r = await this.pools.writer(0).query(`SELECT api_key_touch($1) AS moved`, [keyId]);
    return Boolean(r.rows[0]?.moved);
  }

  /** The `api_access` plan feature, read for real: an unexpired tenant override wins; else the current subscription's plan. */
  async apiAccess(db: SqlExecutor, tenantId: string): Promise<ApiAccess> {
    const r = await db.query<any>(
      `SELECT (SELECT tf.is_enabled FROM tenant_features tf
                WHERE tf.tenant_id = $1 AND tf.feature_code = 'api_access' AND tf.deleted_at IS NULL
                  AND (tf.expires_at IS NULL OR tf.expires_at > now())) AS override,
              (SELECT row_to_json(x) FROM (
                 SELECT p.code AS plan_code, COALESCE(pf.is_included, false) AS included
                   FROM subscriptions s JOIN plans p ON p.id = s.plan_id
                   LEFT JOIN plan_features pf ON pf.plan_id = s.plan_id AND pf.feature_code = 'api_access'
                  WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.status IN ('trialing', 'active', 'past_due')
                  ORDER BY s.created_at DESC LIMIT 1) x) AS plan`, [tenantId]);
    const row = r.rows[0] ?? {};
    const plan = row.plan as { plan_code: string; included: boolean } | null;
    if (row.override !== null && row.override !== undefined) return { enabled: Boolean(row.override), source: 'override', planCode: plan?.plan_code ?? null };
    if (plan) return { enabled: Boolean(plan.included), source: plan.included ? 'plan' : 'none', planCode: plan.plan_code };
    return { enabled: false, source: 'none', planCode: null };
  }
  apiAccessRead(tenantId: string): Promise<ApiAccess> { return this.apiAccess(this.replica.forTenant(tenantId), tenantId); }

  // ---- the console ----
  async list(tenantId: string, cursor: KeysetCursor | undefined, limit: number): Promise<{ rows: KeyRow[]; total: number; active: number }> {
    const db = this.replica.forTenant(tenantId);
    const params: unknown[] = [tenantId];
    let where = `k.tenant_id = $1 AND k.deleted_at IS NULL`;
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (k.created_at, k.id) < ($2::timestamptz, $3::uuid)`; }
    params.push(limit);
    const [rows, counts] = await Promise.all([
      db.query<any>(`SELECT ${KEY_COLS} FROM ${KEY_FROM} WHERE ${where} ORDER BY k.created_at DESC, k.id DESC LIMIT $${params.length}`, params),
      db.query<any>(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE revoked_at IS NULL AND activated_at IS NOT NULL AND (expires_at IS NULL OR expires_at > now()))::int AS active
                       FROM api_keys WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]),
    ]);
    return { rows: rows.rows.map(toKey), total: Number(counts.rows[0]?.total ?? 0), active: Number(counts.rows[0]?.active ?? 0) };
  }
  async getTx(tx: TxContext, tenantId: string, id: string, lock = false): Promise<KeyRow | null> {
    const r = await tx.query<any>(`SELECT ${KEY_COLS} FROM ${KEY_FROM} WHERE k.tenant_id = $1 AND k.id = $2 AND k.deleted_at IS NULL${lock ? ' FOR UPDATE OF k' : ''}`, [tenantId, id]);
    return r.rows[0] ? toKey(r.rows[0]) : null;
  }
  async insertTx(tx: TxContext, k: { id: string; tenantId: string; name: string; prefix: string; hash: string; scopes: string[]; ratePerHour: number; expiresAt: string | null; activate: boolean; createdBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_prefix, key_hash, scopes, rate_per_hour, expires_at, activated_at, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::timestamptz, CASE WHEN $9 THEN now() END, $10, now(), now())`,
      [k.id, k.tenantId, k.name, k.prefix, k.hash, JSON.stringify(k.scopes), k.ratePerHour, k.expiresAt, k.activate, k.createdBy]);
  }
  async revokeTx(tx: TxContext, tenantId: string, id: string, by: string | null, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE api_keys SET revoked_at = now(), revoked_reason = $3, revoked_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`, [tenantId, id, reason.slice(0, 300), by]);
    return (r.rowCount ?? 0) === 1;
  }
  async activateTx(tx: TxContext, tenantId: string, id: string, checker: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE api_keys SET activated_at = now(), checker_user_id = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND activated_at IS NULL AND revoked_at IS NULL`, [tenantId, id, checker]);
    return (r.rowCount ?? 0) === 1;
  }

  // ---- proposals ----
  async insertProposalTx(tx: TxContext, p: { id: string; tenantId: string; apiKeyId: string; reason: string; proposedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO api_key_proposals (id, tenant_id, api_key_id, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, now(), now() + interval '7 days')`, [p.id, p.tenantId, p.apiKeyId, p.reason, p.proposedBy]);
  }
  async proposals(tenantId: string, opts: { status?: string; cursor?: KeysetCursor; limit: number }): Promise<KeyProposalRow[]> {
    const params: unknown[] = [tenantId];
    let where = `p.tenant_id = $1`;
    if (opts.status) { params.push(opts.status); where += ` AND p.status = $${params.length}`; }
    if (opts.cursor) { params.push(opts.cursor.ts, opts.cursor.id); where += ` AND (p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
    params.push(opts.limit);
    const r = await this.replica.forTenant(tenantId).query<any>(`${PROPOSAL_SQL} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`, params);
    return r.rows.map(toProposal);
  }
  async proposalTx(tx: TxContext, tenantId: string, id: string, lock = false): Promise<KeyProposalRow | null> {
    const r = await tx.query<any>(`${PROPOSAL_SQL} WHERE p.tenant_id = $1 AND p.id = $2${lock ? ' FOR UPDATE OF p' : ''}`, [tenantId, id]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }
  async confirmProposalTx(tx: TxContext, tenantId: string, id: string, by: string): Promise<boolean> {
    const r = await tx.query(`UPDATE api_key_proposals SET status = 'confirmed', confirmed_by = $3, confirmed_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'`, [tenantId, id, by]);
    return (r.rowCount ?? 0) === 1;
  }
  async refuseProposalTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(`UPDATE api_key_proposals SET status = 'refused', refused_by = $3, refused_at = now(), refuse_reason = $4 WHERE tenant_id = $1 AND id = $2 AND status = 'proposed'`, [tenantId, id, by, reason]);
    return (r.rowCount ?? 0) === 1;
  }
  async expireProposalTx(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(`UPDATE api_key_proposals SET status = 'expired', expired_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'proposed' AND expires_at <= now()`, [tenantId, id]);
    return (r.rowCount ?? 0) === 1;
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<any>(`SELECT id FROM api_key_proposals WHERE tenant_id = $1 AND status = 'proposed' AND expires_at <= now() ORDER BY expires_at LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: { id: string }) => String(x.id));
  }
}
