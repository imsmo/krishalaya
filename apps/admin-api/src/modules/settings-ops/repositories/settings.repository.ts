// apps/admin-api/src/modules/settings-ops/repositories/settings.repository.ts · PC-56 ADMIN-11.
//
// kv_admin only for the writes; 0121 grants kv_app SELECT on `platform_setting_values` so the runtime resolver can read
// the platform layer and can never write one.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';

export interface SettingRow {
  key: string;
  valueType: string;
  scope: string;
  riskClass: string;
  description: string | null;
  lockNote: string | null;
  /** What was SHIPPED. Never overwritten by an operator setting a value — that is the whole reason
   *  `platform_setting_values` exists (0121). */
  defaultValue: unknown;
  /** What is SET, or null when the platform is still on the shipped default. */
  platformValue: unknown;
  platformSetAt: string | null;
  platformSetByAdminId: string | null;
  platformReason: string | null;
  requiresChecker: boolean;
  proposedByAdminId: string | null;
  approvedByAdminId: string | null;
  overrideCount: number;
}

const SELECT_ROWS = `
  SELECT d.key, d.value_type, d.scope, d.risk_class, d.description, d.lock_note, d.default_value,
         v.value AS platform_value, v.updated_at AS platform_set_at, v.set_by_admin_id, v.reason AS platform_reason,
         COALESCE(v.requires_checker, false) AS requires_checker,
         v.proposed_by_admin_id, v.approved_by_admin_id,
         COALESCE(o.n, 0)::int AS override_count
    FROM setting_definitions d
    LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL
    LEFT JOIN (SELECT key, COUNT(*) AS n FROM tenant_settings WHERE deleted_at IS NULL GROUP BY key) o ON o.key = d.key`;

function toRow(r: Record<string, unknown>): SettingRow {
  return {
    key: String(r.key),
    valueType: String(r.value_type),
    scope: String(r.scope),
    riskClass: String(r.risk_class),
    description: (r.description as string | null) ?? null,
    lockNote: (r.lock_note as string | null) ?? null,
    defaultValue: r.default_value,
    platformValue: r.platform_value ?? null,
    platformSetAt: r.platform_set_at ? new Date(String(r.platform_set_at)).toISOString() : null,
    platformSetByAdminId: (r.set_by_admin_id as string | null) ?? null,
    platformReason: (r.platform_reason as string | null) ?? null,
    requiresChecker: Boolean(r.requires_checker),
    proposedByAdminId: (r.proposed_by_admin_id as string | null) ?? null,
    approvedByAdminId: (r.approved_by_admin_id as string | null) ?? null,
    overrideCount: Number(r.override_count ?? 0),
  };
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: AdminPool) {}

  /** Keyset on the primary key. `prefix` is W103's group filter ("Groups filter by key prefix"), LIKE-escaped so a key
   *  containing `%` cannot widen somebody else's filter. */
  async list(q: { prefix?: string; riskClass?: string; cursor?: string; limit: number }): Promise<SettingRow[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.prefix) {
      params.push(`${q.prefix.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`d.key LIKE $${params.length}`);
    }
    if (q.riskClass) { params.push(q.riskClass); where.push(`d.risk_class = $${params.length}`); }
    if (q.cursor) { params.push(q.cursor); where.push(`d.key > $${params.length}`); }
    params.push(q.limit);
    const sql = `${SELECT_ROWS} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY d.key LIMIT $${params.length}`;
    const r = await this.db.query(sql, params);
    return r.rows.map(toRow);
  }

  async get(key: string): Promise<SettingRow | null> {
    const r = await this.db.query(`${SELECT_ROWS} WHERE d.key = $1`, [key]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async getForUpdate(c: PoolClient, key: string): Promise<SettingRow | null> {
    // The DEFINITION is locked, not the value row: a value row may not exist yet, and `FOR UPDATE` on a LEFT JOIN's
    // null side locks nothing. Locking the definition serialises two operators setting the same key.
    const r = await c.query('SELECT key, value_type, scope, risk_class FROM setting_definitions WHERE key = $1 FOR UPDATE', [key]);
    if (!r.rows[0]) return null;
    return this.get(key);
  }

  async define(c: PoolClient, v: {
    key: string; valueType: string; scope: string; riskClass: string; defaultValue: unknown;
    description: string | null; lockNote: string | null;
  }): Promise<void> {
    await c.query(
      `INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class, lock_note)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [v.key, v.valueType, JSON.stringify(v.defaultValue), v.scope, v.description, v.riskClass, v.lockNote]);
  }

  /** **A RETYPE NEVER TOUCHES `default_value`.** The shipped default is a historical fact; if the type changes and the
   *  old default no longer satisfies it, that is a finding the console shows rather than a value this rewrites. */
  async retype(c: PoolClient, key: string, valueType: string): Promise<void> {
    await c.query('UPDATE setting_definitions SET value_type = $2 WHERE key = $1', [key, valueType]);
  }

  async setRiskClass(c: PoolClient, key: string, riskClass: string, lockNote: string | null): Promise<void> {
    await c.query('UPDATE setting_definitions SET risk_class = $2, lock_note = $3 WHERE key = $1',
      [key, riskClass, lockNote]);
  }

  async setPlatformValue(c: PoolClient, v: {
    key: string; value: unknown; setByAdminId: string; reason: string;
    requiresChecker: boolean; proposedByAdminId: string | null; approvedByAdminId: string | null;
  }): Promise<void> {
    await c.query(
      `INSERT INTO platform_setting_values
         (key, value, set_by_admin_id, reason, requires_checker, proposed_by_admin_id, approved_by_admin_id, created_by)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $3)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value, set_by_admin_id = EXCLUDED.set_by_admin_id, reason = EXCLUDED.reason,
         requires_checker = EXCLUDED.requires_checker,
         proposed_by_admin_id = EXCLUDED.proposed_by_admin_id, approved_by_admin_id = EXCLUDED.approved_by_admin_id,
         deleted_at = NULL, updated_at = now(), updated_by = EXCLUDED.set_by_admin_id`,
      [v.key, JSON.stringify(v.value), v.setByAdminId, v.reason, v.requiresChecker,
        v.proposedByAdminId, v.approvedByAdminId]);
  }

  /** Revert to the shipped default by soft-deleting the platform value. **NOT by writing the default into the value
   *  row**: that would make "reverted" and "deliberately set to the same number as the default" the same state, and only
   *  one of those tells a later reader that nobody has an opinion here. */
  async revertPlatformValue(c: PoolClient, key: string, byAdminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE platform_setting_values SET deleted_at = now(), updated_at = now(), updated_by = $2
        WHERE key = $1 AND deleted_at IS NULL`, [key, byAdminId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** The dry-run counts: how many tenants exist, and how many already shadow this key. */
  async radius(key: string): Promise<{ tenantsTotal: number; overridesShadowing: number }> {
    const r = await this.db.query(
      `SELECT (SELECT COUNT(*)::int FROM tenants WHERE deleted_at IS NULL) AS total,
              (SELECT COUNT(*)::int FROM tenant_settings WHERE key = $1 AND deleted_at IS NULL) AS shadowing`, [key]);
    const x = r.rows[0] ?? {};
    return { tenantsTotal: Number(x.total ?? 0), overridesShadowing: Number(x.shadowing ?? 0) };
  }

  /** How many stored tenant values would FAIL the proposed new type. Counted in SQL by jsonb type so the check does not
   *  depend on pulling every row into the API. */
  async retypeCasualties(key: string, newType: string): Promise<number> {
    const wanted = newType === 'bool' ? 'boolean'
      : newType === 'json' ? 'object'
        : newType === 'string' ? 'string' : 'number';
    const extra = newType === 'int'
      // An int must also be whole: `48.5` is jsonb type `number` and is not an int.
      ? " OR (jsonb_typeof(value) = 'number' AND (value::text ~ '\\.'))"
      : '';
    const r = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM tenant_settings
        WHERE key = $1 AND deleted_at IS NULL AND (jsonb_typeof(value) <> $2${extra})`,
      [key, wanted]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async recordChange(c: PoolClient, v: {
    key: string; action: string; oldValue: unknown; newValue: unknown; reason: string;
    actorAdminId: string; checkerAdminId: string | null;
    tenantsAffected: number | null; overridesShadowing: number | null;
  }): Promise<void> {
    await c.query(
      `INSERT INTO platform_config_changes
         (setting_key, action, old_value, new_value, reason, actor_admin_id, checker_admin_id,
          tenants_affected, overrides_shadowing)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9)`,
      [v.key, v.action, JSON.stringify(v.oldValue ?? null), JSON.stringify(v.newValue ?? null), v.reason,
        v.actorAdminId, v.checkerAdminId, v.tenantsAffected, v.overridesShadowing]);
  }

  async history(key: string, limit = 50): Promise<{
    action: string; oldValue: unknown; newValue: unknown; reason: string;
    actorAdminId: string; checkerAdminId: string | null; tenantsAffected: number | null; createdAt: string;
  }[]> {
    const r = await this.db.query(
      `SELECT action, old_value, new_value, reason, actor_admin_id, checker_admin_id, tenants_affected, created_at
         FROM platform_config_changes WHERE setting_key = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, [key, limit]);
    return r.rows.map((x) => ({
      action: String(x.action), oldValue: x.old_value, newValue: x.new_value, reason: String(x.reason),
      actorAdminId: String(x.actor_admin_id), checkerAdminId: (x.checker_admin_id as string | null) ?? null,
      tenantsAffected: x.tenants_affected === null ? null : Number(x.tenants_affected),
      createdAt: new Date(String(x.created_at)).toISOString(),
    }));
  }
}
