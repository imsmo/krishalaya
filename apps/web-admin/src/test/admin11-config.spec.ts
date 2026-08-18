// apps/web-admin/src/test/admin11-config.spec.ts · PC-56 ADMIN-11 console spec.
//
// The console's job on this plane is to keep three pairs apart, and each pair used to render identically:
//
//   * the SHIPPED default and the SET value (one column until 0121);
//   * "no tenant has overridden this yet" and "no tenant CAN" (a zero versus a lock);
//   * "this reaches every tenant" and "this reaches every tenant that has not overridden it".
import {
  canNarrowDirectly, canRevert, canSetDirectly, canWidenDirectly, checkerNoticeKey, effectiveValue, excludesUnknowns,
  overridesKey, provenanceTone, provenanceKey, radiusClass, radiusKey, riskTone, riskKey, targetingSummaryKey,
  tierTone, tierKey, widenNoticeKey,
} from '../features/settings/setting';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;

describe('ADMIN-11 · the shipped default and the set value are different facts', () => {
  it('serves the platform value when one is set, and the shipped default otherwise', () => {
    expect(effectiveValue({ platformValue: 12, defaultValue: 24 })).toBe(12);
    expect(effectiveValue({ platformValue: null, defaultValue: 24 })).toBe(24);
    // `false` is a VALUE, not an absence — `??` on a boolean setting is the classic way to lose a deliberate false.
    expect(effectiveValue({ platformValue: false, defaultValue: true })).toBe(false);
    expect(effectiveValue({ platformValue: 0, defaultValue: 48 })).toBe(0);
  });

  // **THREE STATES, NOT TWO.** A value set to the same number as the shipped default is still a decision somebody made,
  // and collapsing it into "default" erases the fact that a person looked at this key.
  it('distinguishes shipped, set, and set-to-the-same-value', () => {
    expect(provenanceKey({ platformValue: null, defaultValue: 24, onShippedDefault: true })).toBe('st11.prov.shipped');
    expect(provenanceKey({ platformValue: 12, defaultValue: 24, onShippedDefault: false })).toBe('st11.prov.set');
    expect(provenanceKey({ platformValue: 24, defaultValue: 24, onShippedDefault: false }))
      .toBe('st11.prov.setSameAsShipped');
    for (const k of ['st11.prov.shipped', 'st11.prov.set', 'st11.prov.setSameAsShipped']) expect(dict[k]).toBeTruthy();
  });

  it('marks a set value as distinct from a shipped one', () => {
    expect(provenanceTone({ onShippedDefault: false })).toBe('info');
    expect(provenanceTone({ onShippedDefault: true })).not.toBe('info');
  });

  it('only offers a revert when something is set', () => {
    // A revert button on a key already on its default would report a change that did not happen.
    expect(canRevert({ onShippedDefault: false })).toBe(true);
    expect(canRevert({ onShippedDefault: true })).toBe(false);
    expect(dict['st11.alreadyShipped']).toMatch(/nothing to revert/);
  });
});

describe('ADMIN-11 · risk class and scope answer different questions', () => {
  it('draws money-path loudest and an unknown class as a warning', () => {
    expect(riskTone('money_path')).toBe('danger');
    expect(riskTone('security')).toBe('warning');
    expect(riskTone('ordinary')).not.toBe('warning');
    // A class this console cannot describe must not be drawn as harmless.
    expect(riskTone('founder_only')).toBe('warning');
    expect(riskKey('founder_only')).toBe('st11.risk.other');
    expect(dict['st11.risk.other']).toBeTruthy();
  });

  // **A ZERO AND A LOCK ARE DIFFERENT.** "0 tenants override this" invites the reader to think none has bothered yet;
  // "0 — platform-locked" says none ever can.
  it('separates "none yet" from "none possible"', () => {
    expect(overridesKey({ tenantOverridable: true, overrideCount: 0 })).toBe('st11.over.noneYet');
    expect(overridesKey({ tenantOverridable: false, overrideCount: 0 })).toBe('st11.over.locked');
    expect(overridesKey({ tenantOverridable: true, overrideCount: 312 })).toBe('st11.over.count');
    expect(dict['st11.over.locked']).toMatch(/platform-locked/);
  });

  // The direct form is ABSENT where a second person is required, not disabled: a control that always 403s teaches an
  // operator that the rule is a UI preference.
  it('withholds the direct set form on a money-path or security key, with the reason', () => {
    expect(canSetDirectly({ needsChecker: false })).toBe(true);
    expect(canSetDirectly({ needsChecker: true })).toBe(false);
    expect(checkerNoticeKey({ needsChecker: true, riskClass: 'money_path' })).toBe('st11.checker.money');
    expect(checkerNoticeKey({ needsChecker: true, riskClass: 'security' })).toBe('st11.checker.security');
    expect(checkerNoticeKey({ needsChecker: false, riskClass: 'ordinary' })).toBeNull();
    expect(dict['st11.checker.money']).toMatch(/cannot be you/);
  });
});

describe('ADMIN-11 · the blast radius sentence', () => {
  const r = (affected: number, total: number, shadowed: number) =>
    ({ tenantsAffected: affected, tenantsTotal: total, overridesShadowing: shadowed });

  it('says "all of them" only when no tenant shadows the key', () => {
    expect(radiusKey(r(2847, 2847, 0))).toBe('st11.radius.all');
    expect(radiusKey(r(1739, 2847, 1108))).toBe('st11.radius.shadowed');
    expect(radiusKey(r(0, 2847, 2847))).toBe('st11.radius.none');
    expect(dict['st11.radius.shadowed']).toMatch(/\{shadowed\}/);
  });

  // Unknown is DANGER: approving a change while believing it reaches nobody is the specific mistake this guards.
  it('treats an unreadable radius as dangerous, not as zero', () => {
    expect(radiusKey(null)).toBe('st11.radius.unknown');
    expect(radiusClass(null)).toContain('is-danger');
    expect(radiusClass(r(0, 10, 10))).not.toContain('is-danger');
    expect(dict['st11.radius.unknown']).toMatch(/do not read that as nobody/i);
  });

  it('warns when a change reaches more than a thousand tenants', () => {
    expect(radiusClass(r(1739, 2847, 1108))).toContain('is-warn');
    expect(radiusClass(r(12, 2847, 2835))).not.toContain('is-warn');
  });
});

describe('ADMIN-11 · W004 · flag tiers and the asymmetry', () => {
  it('labels every tier and draws a kill switch loudest', () => {
    for (const t of ['module', 'experiment', 'kill_switch']) expect(dict[tierKey(t)]).toBeTruthy();
    expect(tierKey('vip')).toBe('st11.tier.other');
    expect(tierTone('kill_switch')).toBe('danger');
    expect(tierTone('module')).toBe('warning');
    expect(tierTone('experiment')).not.toBe('warning');
  });

  // **THE ASYMMETRY THE WHOLE PLANE TURNS ON.** Narrowing is always available; widening a module flag or releasing a
  // kill switch is not, because those need a second administrator.
  it('offers narrowing always and widening only for experiments', () => {
    expect(canNarrowDirectly()).toBe(true);
    expect(canWidenDirectly('experiment')).toBe(true);
    expect(canWidenDirectly('module')).toBe(false);
    expect(canWidenDirectly('kill_switch')).toBe(false);
    // An unknown tier gets the strict treatment here too, matching the server.
    expect(canWidenDirectly('vip')).toBe(false);
  });

  it('explains each withheld widening', () => {
    expect(widenNoticeKey('experiment')).toBeNull();
    expect(dict[widenNoticeKey('module')!]).toMatch(/TWO ADMINISTRATORS/);
    expect(dict[widenNoticeKey('module')!]).toMatch(/bypassed the first time it mattered/);
    expect(dict[widenNoticeKey('kill_switch')!]).toMatch(/Firing it takes one/);
  });
});

describe('ADMIN-11 · targeting is no longer decoration', () => {
  it('summarises what a flag is bounded to', () => {
    expect(targetingSummaryKey(null)).toBe('st11.target.all');
    expect(targetingSummaryKey({})).toBe('st11.target.all');
    expect(targetingSummaryKey({ plans: [], countries: [] })).toBe('st11.target.all');
    expect(targetingSummaryKey({ tenant_ids: ['t'] })).toBe('st11.target.tenantsOnly');
    expect(targetingSummaryKey({ countries: ['IN'] })).toBe('st11.target.bounded');
  });

  // The sentence that records what changed this wave, where an operator will read it.
  it('says the bounds are now enforced', () => {
    expect(dict['st11.target.bounded']).toMatch(/enforced at request time/);
    expect(dict['st11.target.bounded']).toMatch(/honoured by nothing/);
  });

  // An operator adding a country rule should know that tenants without a resolvable country stop seeing the feature.
  it('flags that a plan or country rule excludes unknowns', () => {
    expect(excludesUnknowns({ countries: ['IN'] })).toBe(true);
    expect(excludesUnknowns({ plans: ['pro'] })).toBe(true);
    expect(excludesUnknowns({ tenant_ids: ['t'] })).toBe(false);
    expect(excludesUnknowns(null)).toBe(false);
    expect(dict['st11.target.excludesUnknown']).toMatch(/outside the bound, not inside/);
  });
});

describe('ADMIN-11 · the two rules that govern the registry, in words', () => {
  it('states that a setting is an insert rather than a migration', () => {
    expect(dict['st11.insertNotMigration']).toMatch(/without a deploy|needs a deploy/i);
  });

  it('states the checker rule and why the class lives on the key', () => {
    expect(dict['st11.checkerRule']).toMatch(/TWO ADMINISTRATORS/);
    expect(dict['st11.checkerRule']).toMatch(/recorded on the key/);
  });

  it('does not let an empty history read as a clean one', () => {
    expect(dict['st11.noHistory']).toMatch(/began with this release/);
  });
});
