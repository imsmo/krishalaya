// apps/admin-api/src/modules/settings-ops/__tests__/admin11-config-plane.spec.ts · PC-56 ADMIN-11.
//
// The configuration control plane: targeting that targets, and a registry with a checker. Four assertions carry the
// weight, and each is a control that did not exist:
//
//   1. `rules.countries` EXCLUDES — the defect Rule Zero exists to catch, since a flag naming a country bounded nothing.
//   2. AN UNKNOWN PLAN OR COUNTRY EXCLUDES, never matches.
//   3. WIDENING NEEDS TWO PEOPLE AND NARROWING NEEDS ONE — including the counter-intuitive case, where REMOVING a rule
//      is a widening.
//   4. A MONEY-PATH SETTING REFUSES A SINGLE OPERATOR, and de-classifying one needs two people because it disables that.
import { matches, passesTargeting, allowlistBeatsRollout } from '../../../../../api/src/core/feature-flags/targeting';
import {
  FLAG_TIERS, isEnabledFor, isWideningRollout, isWideningTargeting, needsSecondPerson,
} from '../../flags-ops/domain/rollout';
import {
  MAX_JSON_BYTES, MAX_STRING, assertOverridable, assertValue, blastRadius, isTenantOverridable, requiresChecker,
  DRY_RUN_IS_COMPUTED_NOT_STORED, IMPACT_SIMULATION_OWNER,
} from '../domain/setting-value';
import { InvalidSettingError, SettingLockedError } from '../domain/settings-ops.errors';
import { ownerPermissionCodes, resolveOwnerPermissions } from '../../../core/rbac/owner-roles';

const TEN = '11111111-1111-4111-8111-111111111111';

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-11 · targeting that actually targets', () => {
  // **THE DEFECT THIS WAVE EXISTS FOR.** `rules.plans` and `rules.countries` were validated, stored, rendered — and read
  // by nothing. A flag scoped to India served every country while the console listed it as bounded.
  it('EXCLUDES a caller whose country is not named', () => {
    expect(matches({ countries: ['IN'] }, { tenantId: TEN, countryCode: 'BD' }))
      .toEqual({ kind: 'excluded', by: 'country' });
    expect(passesTargeting({ countries: ['IN'] }, { tenantId: TEN, countryCode: 'BD' })).toBe(false);
    expect(passesTargeting({ countries: ['IN'] }, { tenantId: TEN, countryCode: 'IN' })).toBe(true);
  });

  it('EXCLUDES a caller whose plan is not named', () => {
    expect(matches({ plans: ['professional'] }, { tenantId: TEN, planCode: 'starter' }))
      .toEqual({ kind: 'excluded', by: 'plan' });
    expect(passesTargeting({ plans: ['professional'] }, { tenantId: TEN, planCode: 'professional' })).toBe(true);
  });

  // **UNKNOWN IS NOT A MATCH** — the ADMIN-8b preflight rule, applied to targeting. A tenant between subscriptions has
  // no plan, and a flag limited to `professional` must not serve them.
  it('EXCLUDES an unknown plan or country, and says which', () => {
    expect(matches({ plans: ['pro'] }, { tenantId: TEN })).toEqual({ kind: 'excluded_unknown', by: 'plan' });
    expect(matches({ countries: ['IN'] }, { tenantId: TEN })).toEqual({ kind: 'excluded_unknown', by: 'country' });
    expect(passesTargeting({ countries: ['IN'] }, { tenantId: TEN })).toBe(false);
  });

  // A named pilot tenant must not be dropped by somebody later adding a plan rule — otherwise adding `plans` silently
  // removes the one cooperative that agreed to try the feature, and nobody sees it happen.
  it('lets the ALLOWLIST beat every other rule', () => {
    expect(matches({ tenant_ids: [TEN], plans: ['pro'], countries: ['IN'] }, { tenantId: TEN, planCode: 'starter', countryCode: 'BD' }))
      .toEqual({ kind: 'allowlisted' });
    expect(allowlistBeatsRollout()).toBe(true);
  });

  // AND / not OR: `plans` + `countries` means "on that plan AND in that country". Under OR, adding a rule could WIDEN
  // the audience, and a targeting control whose every edit can only narrow is the one an operator can reason about.
  it('treats plan and country as conjunctive', () => {
    const rules = { plans: ['pro'], countries: ['IN'] };
    expect(passesTargeting(rules, { tenantId: TEN, planCode: 'pro', countryCode: 'IN' })).toBe(true);
    expect(passesTargeting(rules, { tenantId: TEN, planCode: 'pro', countryCode: 'BD' })).toBe(false);
    expect(passesTargeting(rules, { tenantId: TEN, planCode: 'starter', countryCode: 'IN' })).toBe(false);
  });

  it('is case-insensitive on country codes, in both directions', () => {
    expect(passesTargeting({ countries: ['in'] }, { tenantId: TEN, countryCode: 'IN' })).toBe(true);
    expect(passesTargeting({ countries: ['IN'] }, { tenantId: TEN, countryCode: 'in' })).toBe(true);
  });

  it('ignores empty rule arrays rather than excluding everybody', () => {
    // A flag with `{plans: []}` is untargeted, not targeted-at-nothing. Reading an empty array as an exclusion would
    // turn every flag the console had ever saved a blank rule on into a flag that serves no one.
    expect(passesTargeting({ plans: [], countries: [] }, { tenantId: TEN })).toBe(true);
    expect(passesTargeting(null, { tenantId: TEN })).toBe(true);
  });
});

describe('ADMIN-11 · the admin preview matches the runtime, and both are now right', () => {
  const flag = { isEnabled: true, rolloutPct: 100, rules: { countries: ['IN'] } };

  it('previews the country rule the runtime now enforces', () => {
    expect(isEnabledFor('k', flag, { tenantId: TEN, countryCode: 'IN' })).toBe(true);
    expect(isEnabledFor('k', flag, { tenantId: TEN, countryCode: 'BD' })).toBe(false);
    // Unknown country: off, matching the runtime.
    expect(isEnabledFor('k', flag, { tenantId: TEN })).toBe(false);
  });

  it('keeps the allowlist ahead of the percentage — a 0% flag is still ON for a named tenant', () => {
    expect(isEnabledFor('k', { isEnabled: true, rolloutPct: 0, rules: { tenant_ids: [TEN] } }, { tenantId: TEN }))
      .toBe(true);
  });

  it('is still OFF for everyone when the kill switch is down', () => {
    expect(isEnabledFor('k', { isEnabled: false, rolloutPct: 100, rules: { tenant_ids: [TEN] } }, { tenantId: TEN }))
      .toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-11 · the fifteenth maker-checker site, on the permissive direction', () => {
  // Removing access is the emergency direction. A platform that needs a checker to STOP something has a kill switch
  // that does not work at 2 a.m.
  it.each(['module', 'kill_switch', 'experiment'])('lets ONE person disable or kill a %s flag', (tier) => {
    expect(needsSecondPerson(tier, 'disable', false)).toBe(false);
    expect(needsSecondPerson(tier, 'kill', false)).toBe(false);
  });

  it('needs TWO people to widen a module flag or release a kill switch', () => {
    expect(needsSecondPerson('module', 'enable', true)).toBe(true);
    expect(needsSecondPerson('module', 'set_rollout', true)).toBe(true);
    expect(needsSecondPerson('kill_switch', 'unlock', true)).toBe(true);
  });

  // An experiment that needed two people to move from 10% to 25% is a percentage rollout nobody uses.
  it('lets one person widen an EXPERIMENT', () => {
    expect(needsSecondPerson('experiment', 'set_rollout', true)).toBe(false);
    expect(needsSecondPerson('experiment', 'enable', true)).toBe(false);
  });

  it('needs one person to NARROW anything', () => {
    expect(needsSecondPerson('module', 'set_rollout', false)).toBe(false);
    expect(needsSecondPerson('module', 'set_targeting', false)).toBe(false);
  });

  // **AN UNRECOGNISED TIER ARRIVES GATED.** This is the ADMIN-8 correction learned once: a tier added by a future
  // migration must default to the strictest rule, not the loosest.
  it('gates an unknown tier', () => {
    expect(needsSecondPerson('vip_only', 'enable', true)).toBe(true);
    expect([...FLAG_TIERS]).toEqual(['module', 'experiment', 'kill_switch']);
  });

  it('knows a rollout widening from a narrowing, and treats equal as neither', () => {
    expect(isWideningRollout(10, 25)).toBe(true);
    expect(isWideningRollout(25, 10)).toBe(false);
    expect(isWideningRollout(25, 25)).toBe(false);   // a no-op needs no checker to confirm nothing happened
  });

  // **THE COUNTER-INTUITIVE HALF, AND THE ONE THAT MATTERS.** Deleting `countries: ['IN']` takes a flag from one country
  // to every country — a removal that widens.
  it('treats a REMOVED restriction as a widening', () => {
    expect(isWideningTargeting({ countries: ['IN'] }, {})).toBe(true);
    expect(isWideningTargeting({ plans: ['pro'] }, { plans: [] })).toBe(true);
    // A restriction that now names MORE values is also wider.
    expect(isWideningTargeting({ countries: ['IN'] }, { countries: ['IN', 'BD'] })).toBe(true);
    // A restriction ADDED where there was none narrows.
    expect(isWideningTargeting({}, { countries: ['IN'] })).toBe(false);
    // A restriction that now names FEWER values narrows.
    expect(isWideningTargeting({ countries: ['IN', 'BD'] }, { countries: ['IN'] })).toBe(false);
    // A longer allowlist is wider.
    expect(isWideningTargeting({ tenant_ids: [] }, { tenant_ids: [TEN] })).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-11 · W103 · the typed registry', () => {
  it('validates each type, and refuses undefined for all five', () => {
    expect(assertValue('int', 48)).toBe(48);
    expect(assertValue('bool', false)).toBe(false);
    expect(assertValue('string', 'x')).toBe('x');
    expect(assertValue('decimal', 1.5)).toBe(1.5);
    expect(assertValue('json', { a: 1 })).toEqual({ a: 1 });
    // Load-bearing: zod infers `z.unknown()` as optional, so this is the only thing between a request with no value and
    // a setting written as nothing.
    for (const t of ['int', 'bool', 'string', 'decimal', 'json'] as const) {
      expect(() => assertValue(t, undefined)).toThrow(InvalidSettingError);
    }
  });

  it('refuses a non-integer int rather than rounding it', () => {
    expect(() => assertValue('int', 48.5)).toThrow(/refused rather than rounded/);
  });

  it('bounds strings and JSON exactly as the tenant realm does', () => {
    expect(() => assertValue('string', 'x'.repeat(MAX_STRING + 1))).toThrow(InvalidSettingError);
    expect(() => assertValue('json', { a: 'x'.repeat(MAX_JSON_BYTES) })).toThrow(InvalidSettingError);
    // An ARRAY is not a JSON object — the tenant validator says so too, and two validators disagreeing would mean a
    // platform default no tenant could override.
    expect(() => assertValue('json', [1, 2])).toThrow(InvalidSettingError);
    expect(() => assertValue('json', null)).toThrow(InvalidSettingError);
  });

  it('separates WHO may override from HOW DANGEROUS a change is', () => {
    // The distinction the risk class exists for: both are tenant-scoped and only one moves money.
    expect(isTenantOverridable('tenant')).toBe(true);
    expect(isTenantOverridable('platform')).toBe(false);
    expect(requiresChecker('money_path')).toBe(true);
    expect(requiresChecker('security')).toBe(true);
    expect(requiresChecker('ordinary')).toBe(false);
  });

  it('refuses a tenant override on a platform-locked key', () => {
    expect(() => assertOverridable('platform', 'payments.payout_hold_hours')).toThrow(SettingLockedError);
    expect(() => assertOverridable('tenant', 'order.auto_confirm_hours')).not.toThrow();
  });
});

describe('ADMIN-11 · the blast radius', () => {
  // **THE SUBTRACTION IS THE WHOLE POINT.** 2,847 tenants with 1,108 overrides means a change reaches 1,739 — reporting
  // 2,847 would overstate the reach by 39%, on the screen where somebody decides whether to approve it.
  it('excludes tenants that already shadow the key', () => {
    expect(blastRadius(2847, 1108)).toEqual({ tenantsTotal: 2847, overridesShadowing: 1108, tenantsAffected: 1739 });
    expect(blastRadius(2847, 0).tenantsAffected).toBe(2847);
  });

  it('never reports a negative reach, however odd the inputs', () => {
    expect(blastRadius(10, 99).tenantsAffected).toBe(0);
    expect(blastRadius(0, 0).tenantsAffected).toBe(0);
    expect(blastRadius(10, -5).overridesShadowing).toBe(0);
  });

  it('states why the dry run is not stored', () => {
    expect(DRY_RUN_IS_COMPUTED_NOT_STORED).toMatch(/ages/);
    expect(IMPACT_SIMULATION_OWNER).toBe('ADMIN-11-Q1');
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-11 · the permissions the canon names and nothing had', () => {
  it('exists in the catalogue', () => {
    const codes = ownerPermissionCodes();
    expect(codes).toContain('settings.read');
    expect(codes).toContain('settings.manage');
    expect(codes).toContain('flags.approve');
  });

  it('keeps the flag checker in a different role from the flag operator', () => {
    const ops = resolveOwnerPermissions(['platform_config_ops']);
    expect(ops.has('flags.manage')).toBe(true);
    // The two halves of the rule live in two roles rather than relying on two people who could each do both.
    expect(ops.has('flags.approve')).toBe(false);
    const checker = resolveOwnerPermissions(['platform_config_checker']);
    expect(checker.has('flags.approve')).toBe(true);
    expect(checker.has('flags.manage')).toBe(false);
    expect(checker.has('settings.manage')).toBe(false);
  });

  it('gives the viewer reads and nothing else', () => {
    const v = resolveOwnerPermissions(['platform_config_viewer']);
    expect(v.has('settings.read')).toBe(true);
    expect(v.has('settings.manage')).toBe(false);
    expect(v.has('flags.manage')).toBe(false);
  });
});
