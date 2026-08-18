// apps/web-admin/src/features/settings/setting.ts · W103 / W004 view logic (PC-56 ADMIN-11).
//
// **THE TWO SENTENCES THIS FILE EXISTS TO KEEP APART.** A platform setting has a SHIPPED DEFAULT and a SET VALUE, and
// before 0121 they were one column — so "48 because that is what we ship" and "48 because somebody chose it on 9 July"
// were indistinguishable. A console that renders them alike loses the only information an operator wants when deciding
// whether to change one.
//
// DEV-60 (UI Port Program batch 3, Part 1): `provenanceClass`/`riskClassName`/`tierClass` now return a `StatusTone`
// instead of a raw `kv-badge is-X` string — disposition (c), same pattern as `ai-governance.ts`. Call sites render
// `<StatusPill tone={...} label={...}/>`. `radiusClass` (`kv-note`-returning) is OUT OF SCOPE — `kv-note` never
// matched the 98/29 population's own grep.

import type { StatusTone } from '@krishalaya/ui';

export type ValueType = 'string' | 'int' | 'decimal' | 'bool' | 'json';
export type RiskClass = 'ordinary' | 'money_path' | 'security';

export interface SettingRow {
  key: string;
  valueType: string;
  scope: string;
  riskClass: string;
  defaultValue: unknown;
  platformValue: unknown;
  onShippedDefault: boolean;
  tenantOverridable: boolean;
  needsChecker: boolean;
  overrideCount: number;
  lockNote: string | null;
}

/** What is SERVING right now: the platform value when one is set, the shipped default otherwise. */
export function effectiveValue(r: Pick<SettingRow, 'platformValue' | 'defaultValue'>): unknown {
  return r.platformValue === null || r.platformValue === undefined ? r.defaultValue : r.platformValue;
}

/** Where that value came from. Three states, not two: a set value that happens to EQUAL the shipped default is still a
 *  decision somebody made, and flattening it into "default" would erase the fact that a person looked at this key. */
export function provenanceKey(r: Pick<SettingRow, 'platformValue' | 'defaultValue' | 'onShippedDefault'>): string {
  if (r.onShippedDefault) return 'st11.prov.shipped';
  const same = JSON.stringify(r.platformValue) === JSON.stringify(r.defaultValue);
  return same ? 'st11.prov.setSameAsShipped' : 'st11.prov.set';
}

export function provenanceTone(r: Pick<SettingRow, 'onShippedDefault'>): StatusTone {
  return r.onShippedDefault ? 'neutral' : 'info';
}

/* ------------------------------------------------------------------------------------------------ */
/* RISK + SCOPE                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

export function riskKey(riskClass: string): string {
  const known = ['ordinary', 'money_path', 'security'];
  return known.includes(riskClass) ? `st11.risk.${riskClass}` : 'st11.risk.other';
}

export function riskTone(riskClass: string): StatusTone {
  if (riskClass === 'money_path') return 'danger';
  if (riskClass === 'security') return 'warning';
  // An unrecognised class is drawn as a WARNING rather than as ordinary: a class this console does not know is a class
  // whose rules it cannot describe, and treating it as harmless is the wrong default.
  return riskClass === 'ordinary' ? 'neutral' : 'warning';
}

/** W103's own column: "Tenant overrides · 312 tenants" versus "0 (locked)". A platform-scoped key shows the lock rather
 *  than a zero — a zero invites the reader to think no tenant has bothered yet. */
export function overridesKey(r: Pick<SettingRow, 'tenantOverridable' | 'overrideCount'>): string {
  if (!r.tenantOverridable) return 'st11.over.locked';
  return r.overrideCount === 0 ? 'st11.over.noneYet' : 'st11.over.count';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE CONTROLS — absence, not disablement                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** Whether the console offers a "set value" form directly. **It does not for a money-path or security key**: those need
 *  a named proposer and a different approver, so the direct form would be a control that always 403s. The propose flow
 *  is offered instead — a refusal an operator can act on rather than one they have to decode. */
export function canSetDirectly(r: Pick<SettingRow, 'needsChecker'>): boolean {
  return !r.needsChecker;
}

/** Why the direct form is absent. An unexplained missing form reads as an unbuilt feature. */
export function checkerNoticeKey(r: Pick<SettingRow, 'needsChecker' | 'riskClass'>): string | null {
  if (!r.needsChecker) return null;
  return r.riskClass === 'security' ? 'st11.checker.security' : 'st11.checker.money';
}

/** A revert is only meaningful when something is set. Offering it on a key already on its shipped default would be a
 *  button whose success message describes a change that did not happen. */
export function canRevert(r: Pick<SettingRow, 'onShippedDefault'>): boolean {
  return !r.onShippedDefault;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DRY RUN                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export interface BlastRadius { tenantsTotal: number; overridesShadowing: number; tenantsAffected: number }

/** The sentence W103 puts in its audit note. The AFFECTED count leads, because that is the number the decision turns
 *  on — and it is not the tenant count whenever an override exists. */
export function radiusKey(b: BlastRadius | null | undefined): string {
  if (!b) return 'st11.radius.unknown';
  if (b.tenantsAffected === 0) return 'st11.radius.none';
  return b.overridesShadowing > 0 ? 'st11.radius.shadowed' : 'st11.radius.all';
}

export function radiusClass(b: BlastRadius | null | undefined): string {
  // Unknown is DANGER: approving a change while believing it reaches nobody is the specific mistake this guards.
  if (!b) return 'kv-note is-danger';
  return b.tenantsAffected > 1000 ? 'kv-note is-warn' : 'kv-note';
}

/* ------------------------------------------------------------------------------------------------ */
/* W004 · FLAG TIERS AND THE CHECKER                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export function tierKey(tier: string): string {
  const known = ['module', 'experiment', 'kill_switch'];
  return known.includes(tier) ? `st11.tier.${tier}` : 'st11.tier.other';
}

export function tierTone(tier: string): StatusTone {
  if (tier === 'kill_switch') return 'danger';
  if (tier === 'module') return 'warning';
  return 'neutral';
}

/**
 * Whether the console offers a DIRECT widening control. It does not for a module flag or a kill-switch release: those
 * need a second administrator, so the direct control would always be refused.
 *
 * **AND THE NARROWING CONTROL IS ALWAYS OFFERED**, which is the asymmetry the whole plane turns on: an operator must be
 * able to switch a module off at 2 a.m. without finding a colleague.
 */
export function canWidenDirectly(tier: string): boolean {
  return tier === 'experiment';
}

export function canNarrowDirectly(): boolean { return true; }

export function widenNoticeKey(tier: string): string | null {
  if (canWidenDirectly(tier)) return null;
  return tier === 'kill_switch' ? 'st11.widen.killSwitch' : 'st11.widen.module';
}

/* ------------------------------------------------------------------------------------------------ */
/* TARGETING — the rules that used to be decoration                                                  */
/* ------------------------------------------------------------------------------------------------ */

export interface Targeting { tenant_ids?: string[]; plans?: string[]; countries?: string[] }

/** One sentence describing who a flag is bounded to. Renders the ENFORCED rules — and until this wave two of the three
 *  were stored, shown here, and honoured by nothing. */
export function targetingSummaryKey(t: Targeting | null | undefined): string {
  const tn = t?.tenant_ids?.length ?? 0;
  const pl = t?.plans?.length ?? 0;
  const co = t?.countries?.length ?? 0;
  if (tn === 0 && pl === 0 && co === 0) return 'st11.target.all';
  if (tn > 0 && pl === 0 && co === 0) return 'st11.target.tenantsOnly';
  return 'st11.target.bounded';
}

/** True when a rule would exclude a caller whose plan or country is unknown — which the console flags, because an
 *  operator adding a country rule should know that tenants without a resolvable country stop seeing the feature. */
export function excludesUnknowns(t: Targeting | null | undefined): boolean {
  return (t?.plans?.length ?? 0) > 0 || (t?.countries?.length ?? 0) > 0;
}
