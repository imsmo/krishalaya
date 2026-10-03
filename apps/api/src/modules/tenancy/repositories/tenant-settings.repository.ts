// modules/tenancy/repositories/tenant-settings.repository.ts · SQL for tenant_settings + the setting_definitions
// registry (0002). tenant_id in EVERY tenant_settings query (Law 1) + RLS. Values are jsonb (stringified on write).
// setting_definitions is a GLOBAL registry (no tenant_id) — read-only here, used to type/scope-check writes.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { SettingDefinition, SettingRiskClass, SettingScope, SettingValueType } from '../domain/tenant-settings.entity';

/** One registry row → the domain shape (0192 columns included). */
export function definitionOf(x: any): SettingDefinition {
  return {
    key: x.key, valueType: x.value_type as SettingValueType, scope: x.scope as SettingScope,
    riskClass: (x.risk_class ?? 'ordinary') as SettingRiskClass, memberNotice: x.member_notice === true,
    tenantMin: x.tenant_min ?? null, tenantMax: x.tenant_max ?? null, floorNote: x.floor_note ?? null,
    defaultValue: x.default_value, description: x.description ?? null, lockNote: x.lock_note ?? null, deprecatedAt: x.deprecated_at ?? null,
  };
}

@Injectable()
export class TenantSettingsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Look up a setting definition (global registry). Read on the replica. */
  // PC-56 TENANT-13b (F-4): `risk_class` is SELECTED and read on every tenant write — before this wave it was not even fetched, so
  // the write path could not have refused a money key if it had wanted to. The floor, member notice and deprecation travel with it.
  async findDefinition(tenantId: string, key: string, tx?: TxContext): Promise<SettingDefinition | null> {
    const sql = `SELECT key, value_type, scope, risk_class, member_notice, tenant_min, tenant_max, floor_note, default_value, description, lock_note,
                        to_char(deprecated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deprecated_at
                   FROM setting_definitions WHERE key=$1`;
    const r = tx ? await tx.query(sql, [key]) : await this.replica.forTenant(tenantId).query(sql, [key]);
    const x = r.rows[0]; if (!x) return null;
    return definitionOf(x);
  }

  // PC-56 TENANT-13b: the ungated `upsert` that lived here is gone — every tenant_settings write is in SettingGovernanceRepository,
  // called only by TenantSettingsService (gate, floor, history, audit), and 0192's trg_tenant_settings_gate stands under it.

  /**
   * ONE effective setting value for a tenant: the tenant's override if it has one, the registry default
   * otherwise. PC-56 TENANT-4d-4 needs `billing.grace_days` per tenant inside a cross-tenant sweep, and
   * `listEffective` would have fetched every setting the tenant has to read one of them.
   *
   * Returns undefined only when the KEY IS NOT IN THE REGISTRY — i.e. the migration that defines it has not
   * run. That is a different thing from "the tenant has no override", and the caller must be able to tell:
   * a missing definition means fall back to the code default and say so, never treat it as zero.
   */
  async effectiveValue(tenantId: string, key: string): Promise<unknown | undefined> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT COALESCE(ts.value, d.default_value) AS value
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.key = $2`, [tenantId, key]);
    return r.rows[0] ? (r.rows[0] as { value: unknown }).value : undefined;
  }

  /** Effective settings for the tenant = definition defaults overlaid with tenant overrides (bounded). */
  async listEffective(tenantId: string, limit: number): Promise<Array<{ key: string; value: unknown; isDefault: boolean }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.key,
              COALESCE(ts.value, d.default_value) AS value,
              (ts.value IS NULL) AS is_default
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.scope = 'tenant'
        ORDER BY d.key LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => ({ key: x.key, value: x.value, isDefault: x.is_default }));
  }
}
