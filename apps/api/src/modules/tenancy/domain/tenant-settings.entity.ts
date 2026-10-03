// modules/tenancy/domain/tenant-settings.entity.ts · a typed per-tenant setting value (0002 tenant_settings +
// setting_definitions). Pure TS. A setting value must satisfy its definition's value_type; only definitions with
// scope='tenant' are self-serve writable (platform/user-scoped keys are refused — fail closed). Tenant-scoped.
import { InvalidSettingError, SettingNotTenantScopedError } from './tenancy.errors';

export const SETTING_VALUE_TYPES = ['string', 'int', 'decimal', 'bool', 'json'] as const;
export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];
export const SETTING_SCOPES = ['platform', 'tenant', 'user'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export const SETTING_RISK_CLASSES = ['ordinary', 'money_path', 'security'] as const;
export type SettingRiskClass = (typeof SETTING_RISK_CLASSES)[number];

/**
 * A registry row. PC-56 TENANT-13b (0192): `riskClass` is READ on every tenant write (it was not even selected before — F-4);
 * `memberNotice`, the platform floor (`tenantMin` / `tenantMax`, with `floorNote`) and deprecation travel with it.
 */
export interface SettingDefinition {
  key: string; valueType: SettingValueType; scope: SettingScope;
  riskClass?: SettingRiskClass; memberNotice?: boolean;
  tenantMin?: number | string | null; tenantMax?: number | string | null; floorNote?: string | null;
  defaultValue?: unknown; description?: string | null; lockNote?: string | null; deprecatedAt?: string | null;
}

/** Validate (and normalise) a value against its definition; throws on type/scope violation. Returns a JSON-safe value. */
export function validateSettingValue(def: SettingDefinition, value: unknown): unknown {
  if (def.scope !== 'tenant') throw new SettingNotTenantScopedError(def.key, def.scope);
  switch (def.valueType) {
    case 'string': if (typeof value !== 'string' || value.length > 4000) throw new InvalidSettingError(def.key, 'expected string (≤4000)'); return value;
    case 'bool': if (typeof value !== 'boolean') throw new InvalidSettingError(def.key, 'expected boolean'); return value;
    case 'int': if (typeof value !== 'number' || !Number.isInteger(value)) throw new InvalidSettingError(def.key, 'expected integer'); return value;
    case 'decimal': if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidSettingError(def.key, 'expected number'); return value;
    case 'json': {
      if (value === null || typeof value !== 'object') throw new InvalidSettingError(def.key, 'expected json object/array');
      let bytes: number;
      try { bytes = JSON.stringify(value).length; } catch { throw new InvalidSettingError(def.key, 'value is not serialisable'); }
      if (bytes > 16000) throw new InvalidSettingError(def.key, 'json value too large (≤16KB)');
      return value;
    }
    default: throw new InvalidSettingError(def.key, `unknown value_type ${def.valueType}`);
  }
}

export interface TenantSettingProps { tenantId: string; key: string; value: unknown; }
export class TenantSetting {
  private constructor(private p: TenantSettingProps) {}
  static rehydrate(p: TenantSettingProps): TenantSetting { return new TenantSetting(p); }
  /** Build a validated setting for upsert. */
  static of(tenantId: string, def: SettingDefinition, value: unknown): TenantSetting {
    return new TenantSetting({ tenantId, key: def.key, value: validateSettingValue(def, value) });
  }
  toProps(): Readonly<TenantSettingProps> { return Object.freeze({ ...this.p }); }
}
