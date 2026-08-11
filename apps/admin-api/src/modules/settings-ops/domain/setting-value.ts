// apps/admin-api/src/modules/settings-ops/domain/setting-value.ts · W103 (PC-56 ADMIN-11).
//
// **THE TYPED REGISTRY W103 DESCRIBES, AND NO SURFACE COULD REACH.** `setting_definitions` has carried a `scope` column
// with three values since 0002, and `scope='platform'` rows were readable by nothing: the monorepo's only listing query
// filters `WHERE d.scope = 'tenant'`, the tenant write path refuses a non-tenant scope by design, and
// `grep -rn setting_definitions apps/admin-api/src apps/web-admin/src` returned nothing at all.
//
// W103's sentence is the specification and every clause of it is buildable: "Typed registry (setting_definitions).
// Platform values are the defaults; tenant-scope keys can be overridden per tenant, locked keys are platform-scope. **A
// new setting is an INSERT, never a migration — every edit is dry-run + checker.**"
import { InvalidSettingError, SettingLockedError } from './settings-ops.errors';

export const VALUE_TYPES = ['string', 'int', 'decimal', 'bool', 'json'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export const SCOPES = ['platform', 'tenant', 'user'] as const;
export type SettingScope = (typeof SCOPES)[number];

export const RISK_CLASSES = ['ordinary', 'money_path', 'security'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/** Maximum sizes, matching the tenant-realm validator exactly (`tenant-settings.entity.ts`) so a value a tenant could
 *  store is a value the platform can store, and vice versa. Two validators with different bounds would mean a platform
 *  default no tenant could override. */
export const MAX_STRING = 4_000;
export const MAX_JSON_BYTES = 16_384;

/**
 * Validate a value against its declared type. **THE SAME RULES AS THE TENANT REALM, AND THAT IS THE POINT** — this is a
 * second implementation of one contract, so it is written to be diffable against `tenant-settings.entity.ts` rather
 * than cleverer than it.
 *
 * `int` rejects a non-integer rather than truncating: `order.auto_confirm_hours = 48.5` is a typo, and storing 48 would
 * be the platform silently deciding what the operator meant.
 *
 * **AND EVERY BRANCH REJECTS `undefined`**, which is load-bearing rather than incidental: zod infers `z.unknown()` as
 * optional, so a request with no value at all reaches here as `undefined`, and this is the only thing standing between
 * that and a setting being written as nothing.
 */
export function assertValue(type: ValueType, value: unknown): unknown {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') throw new InvalidSettingError('this setting is a string');
      if (value.length > MAX_STRING) throw new InvalidSettingError(`a string setting is at most ${MAX_STRING} characters`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') throw new InvalidSettingError('this setting is true or false');
      return value;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new InvalidSettingError('this setting is a whole number — 48.5 is refused rather than rounded, because '
          + 'rounding would be the platform deciding what you meant');
      }
      return value;
    case 'decimal':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidSettingError('this setting is a number');
      return value;
    default: {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new InvalidSettingError('this setting is a JSON object');
      }
      const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
      if (bytes > MAX_JSON_BYTES) throw new InvalidSettingError(`a JSON setting is at most ${MAX_JSON_BYTES} bytes`);
      return value;
    }
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* WHO MAY CHANGE WHAT                                                                               */
/* ------------------------------------------------------------------------------------------------ */

/**
 * **A MONEY-PATH OR SECURITY KEY NEEDS TWO PEOPLE.** W103: "money-path settings require founder-level checker", and its
 * pending-change panel shows exactly that — `payments.payout_hold_hours 24 → 12` awaiting a checker with a dry run
 * attached.
 *
 * `risk_class` and `scope` answer different questions and this is the place that distinction earns its keep: `scope`
 * says WHO can override a key, `risk_class` says how dangerous changing it is. `order.auto_confirm_hours` and
 * `payments.payout_hold_hours` are both tenant-scoped and only one of them moves money.
 */
export function requiresChecker(riskClass: string): boolean {
  return riskClass === 'money_path' || riskClass === 'security';
}

/** A tenant-overridable key's platform value is a DEFAULT that tenants may shadow; a platform-scoped key's value is the
 *  law. The console says which, because "312 tenants override this" changes what an operator should expect a change to
 *  do — and W103's own audit note reads "ripples to all 2,847 tenants (0 overrides — platform-locked key)". */
export function isTenantOverridable(scope: string): boolean {
  return scope === 'tenant';
}

/** Refuse a tenant-override write against a platform-locked key. The tenant realm already refuses this
 *  (`SettingNotTenantScopedError`); asserted here too because the admin plane can now create definitions, and a
 *  platform-scoped definition with tenant rows would be a lock that leaks. */
export function assertOverridable(scope: string, key: string): void {
  if (!isTenantOverridable(scope)) {
    throw new SettingLockedError(key, `'${key}' is platform-scoped: its value is the law for every tenant and cannot be `
      + 'overridden per tenant.');
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DRY RUN                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export interface BlastRadius {
  /** Every live tenant. The population a platform-scoped change reaches. */
  tenantsTotal: number;
  /** Tenants that have set their own value for this key — a change to the platform value does NOT reach them, and W103's
   *  panel says so ("0 overrides — platform-locked key"). */
  overridesShadowing: number;
  /** Reached by this change: total minus those already shadowing it. */
  tenantsAffected: number;
}

export function blastRadius(tenantsTotal: number, overridesShadowing: number): BlastRadius {
  const shadowed = Math.max(0, Math.min(overridesShadowing, tenantsTotal));
  return {
    tenantsTotal,
    overridesShadowing: shadowed,
    // **THE NUMBER THAT MATTERS IS NOT THE TENANT COUNT.** An operator changing `listing.approval_required` on a
    // platform with 2,847 tenants and 1,108 overrides is changing it for 1,739 of them, and reporting 2,847 would
    // overstate the reach by 39%. The subtraction is the whole content of this function.
    tenantsAffected: Math.max(0, tenantsTotal - shadowed),
  };
}

export type DryRunVerdict =
  | { kind: 'computed'; radius: BlastRadius }
  /** The counts could not be read. **NOT a zero radius** — approving a change believing it reaches nobody is the
   *  specific mistake this state exists to prevent. */
  | { kind: 'unavailable'; reason: string };

/**
 * **THE DRY RUN IS COMPUTED WHEN THE APPROVAL SCREEN IS OPENED, NEVER STORED.** W103 shows one ("Payouts released
 * earlier 4,182 · Value moved sooner ₹2,84,16,500") and storing that would be storing a number that ages: approving on
 * Thursday a dry run computed on Monday would show a blast radius that has since moved. What the PROPOSAL stores is the
 * observed value it was made against — so a stale proposal is refused rather than applied against a changed world.
 */
export const DRY_RUN_IS_COMPUTED_NOT_STORED =
  'a stored dry run is a number that ages; the proposal stores what it observed and the radius is recomputed on open';

/** The per-key impact figures W103 shows beyond the counts — "payouts released earlier", "value moved sooner" — need a
 *  simulation per setting key, which is a different engine from a count. Named rather than approximated. */
export const IMPACT_SIMULATION_OWNER = 'ADMIN-11-Q1' as const;
