// modules/cms/domain/banner-audience.ts · PC-56 TENANT-8d · W173/W174 "Audience" — the declared rule and its evaluator.
//
// W173: *"a camp reminder that only pending-KYC members see is one banner, not one blast"*. Before 0178 the rule was a free
// jsonb nothing validated and nothing read (survey: `grep -rn audience_rules apps/api/src` → the repository's INSERT
// only). Now it is a DECLARATION in `banners.audience`, validated against the registries by 0178's
// `banner_audience_issues()` (and here first, by name):
//   • `roles`   — codes of TENANT-scope, active rows of `roles` (`farmer`, `dairy_farmer`, `worker` …). Empty = any role.
//   • `regions` — ids of active `admin_regions` rows in the tenant's country, ANY level (state · district · taluka ·
//                 village — W173's "Junagadh belt" is the Junagadh district). Empty = anywhere.
// A member matches when they hold one of the roles AND one of their addresses lies IN OR UNDER one of the regions (by
// the region's ltree path). This file is the evaluator — pure, with its tests — used for W174's reach (a real count of
// the members it matches today, by the language they read) and by the live box for the member asking.
//
// NOT DECLARABLE, and printed so: `min_orders` (the legacy key — an order count is another module's fact), KYC state
// (W173's *"kyc: pending only"* — a KYC status is the identity module's and a rule over it is a promise this evaluator
// cannot keep without reading it), clusters (no cluster registry exists).
import { AUDIENCE_LIST_MAX } from './banner-rules';

export interface AudienceRule { roles: string[]; regions: string[] }
export const EVERYONE: AudienceRule = Object.freeze({ roles: [], regions: [] }) as AudienceRule;

/** One region the rule may name, from `admin_regions`. */
export interface RegionFact { id: string; path: string; name: string; level: number }
/** What the evaluator knows about one member: their tenant role codes, their addresses' region paths, their language. */
export interface MemberFacts { userId: string; roles: readonly string[]; regionPaths: readonly string[]; languageCode: string | null }

export const AUDIENCE_REFUSALS = ['ROLE_UNKNOWN', 'REGION_UNKNOWN', 'AUDIENCE_TOO_MANY'] as const;
export type AudienceRefusal = (typeof AUDIENCE_REFUSALS)[number];

/** The rule as stored: lists de-duplicated, order kept. */
export function audienceRule(roles: readonly string[], regions: readonly string[]): AudienceRule {
  return { roles: [...new Set(roles)], regions: [...new Set(regions)] };
}

/** A stored jsonb → a rule (anything not a list of strings reads as an empty list — legacy rows were free). */
export function readAudience(raw: unknown): AudienceRule {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return audienceRule(list(o.roles), list(o.regions));
}

/** Every reason the rule is refused, with the offending values (the console prints them). */
export function audienceIssues(rule: AudienceRule, knownRoles: readonly string[], knownRegions: readonly RegionFact[]): Array<{ code: AudienceRefusal; values: string[] }> {
  const out: Array<{ code: AudienceRefusal; values: string[] }> = [];
  const badRoles = rule.roles.filter((r) => !knownRoles.includes(r));
  if (badRoles.length > 0) out.push({ code: 'ROLE_UNKNOWN', values: badRoles });
  const ids = new Set(knownRegions.map((g) => g.id));
  const badRegions = rule.regions.filter((r) => !ids.has(r));
  if (badRegions.length > 0) out.push({ code: 'REGION_UNKNOWN', values: badRegions });
  if (rule.roles.length > AUDIENCE_LIST_MAX || rule.regions.length > AUDIENCE_LIST_MAX) out.push({ code: 'AUDIENCE_TOO_MANY', values: [] });
  return out;
}

/** `memberPath` lies in or under `rulePath` (ltree semantics: `IN.GJ.JUN.x` is under `IN.GJ.JUN`, `IN.GJ.JUNA` is not). */
export function regionContains(rulePath: string, memberPath: string): boolean {
  return memberPath === rulePath || memberPath.startsWith(`${rulePath}.`);
}

/** THE EVALUATOR. `pathOf` maps a rule's region id to its path; an id with no path matches nobody. */
export function matchesAudience(rule: AudienceRule, member: MemberFacts, pathOf: ReadonlyMap<string, string>): boolean {
  const roleOk = rule.roles.length === 0 || member.roles.some((r) => rule.roles.includes(r));
  if (!roleOk) return false;
  if (rule.regions.length === 0) return true;
  const paths = rule.regions.map((id) => pathOf.get(id)).filter((p): p is string => p !== undefined);
  return member.regionPaths.some((mp) => paths.some((rp) => regionContains(rp, mp)));
}

export interface Reach {
  /** Members the rule matches today. */
  matched: number;
  /** Of those, how many read each language — and whether the banner has words in it. */
  byLanguage: Array<{ code: string; members: number; hasText: boolean }>;
  /** Matched members who would NOT see it: their language has no words on this banner (W173: no English fallback). */
  hiddenNoText: number;
  /** The members considered (the tenant's active members, bounded). */
  considered: number;
}

/** W174's "Estimated reach" — not estimated: the members the rule matches now, split by the language they read. */
export function reachOf(rule: AudienceRule, members: readonly MemberFacts[], pathOf: ReadonlyMap<string, string>, textLanguages: readonly string[]): Reach {
  const counts = new Map<string, number>();
  let matched = 0;
  for (const m of members) {
    if (!matchesAudience(rule, m, pathOf)) continue;
    matched += 1;
    const k = m.languageCode ?? '';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const byLanguage = [...counts.entries()]
    .map(([code, n]) => ({ code, members: n, hasText: code !== '' && textLanguages.includes(code) }))
    .sort((a, b) => b.members - a.members || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const hiddenNoText = byLanguage.filter((l) => !l.hasText).reduce((s, l) => s + l.members, 0);
  return { matched, byLanguage, hiddenNoText, considered: members.length };
}

/** Is the rule "every member"? */
export function isEveryone(rule: AudienceRule): boolean { return rule.roles.length === 0 && rule.regions.length === 0; }
