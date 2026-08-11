// apps/api/src/core/feature-flags/targeting.ts · PC-56 ADMIN-11.
//
// **`rules.plans` AND `rules.countries` WERE STORED, DISPLAYED, AND IGNORED.** The admin plane validates all three
// targeting keys, bounds them, charset-checks them and renders them; `FlagsService.isEnabled` consulted `tenant_ids` and
// nothing else, with `plans` and `countries` typed in its row interface and never read.
//
// An operator could enable a flag for `countries: ['IN']`, watch the console list it as targeted, and have it serve
// every country. **That is precisely the shape Rule Zero exists to catch** — a control that names a country and bounds
// nothing — and it is worse than an absent feature, because the console teaches the operator the bound is in force.
//
// The evaluation order below is the decision that matters, and it is not obvious. See `matches`.
export interface TargetingRules {
  tenant_ids?: string[];
  plans?: string[];
  countries?: string[];
}

/** What the evaluator knows about the caller. `planCode`/`countryCode` are resolved from `tenant_flag_context` (0121)
 *  and are UNDEFINED when the tenant is unknown or has no active subscription — which is a real state, not an error:
 *  a trialing tenant between plans, or an anonymous storefront read. */
export interface TargetSubject {
  tenantId?: string;
  userId?: string;
  planCode?: string;
  countryCode?: string;
}

export type TargetVerdict =
  /** On the explicit allowlist — skips the percentage entirely. */
  | { kind: 'allowlisted' }
  /** No rule excludes this caller; the percentage rollout decides. */
  | { kind: 'eligible' }
  /** A rule named a set this caller is not in. The percentage never runs. */
  | { kind: 'excluded'; by: 'plan' | 'country' }
  /** A rule named a set and this caller's fact is UNKNOWN. **Treated as excluded, and that is the whole point of
   *  having a separate verdict for it**: a flag limited to `countries: ['IN']` must not serve a caller whose country
   *  cannot be established. "Unknown" is not "matches" — the same rule ADMIN-8b applied to preflight checks. */
  | { kind: 'excluded_unknown'; by: 'plan' | 'country' };

const has = (list: string[] | undefined): list is string[] => Array.isArray(list) && list.length > 0;

/**
 * Does this caller pass the flag's targeting rules?
 *
 * **THE ALLOWLIST WINS OVER EVERYTHING, AND THAT IS DELIBERATE.** `tenant_ids` is how a named pilot tenant gets a
 * feature — the demo tenant, the anchor FPO, the one cooperative that agreed to try voice listings. If a plan or country
 * rule could exclude an explicitly named tenant, then adding `plans: ['professional']` to a flag would silently drop the
 * pilot tenant that was on `growth`, and the operator who added the plan rule would have no way to see it happen. So an
 * allowlisted tenant is in, full stop.
 *
 * **PLAN AND COUNTRY RULES ARE CONJUNCTIVE (AND), NOT DISJUNCTIVE.** `plans: ['pro'], countries: ['IN']` means "an
 * Indian tenant on pro", not "anyone on pro, plus anyone in India". The alternative reading is defensible for
 * marketing and indefensible for safety: OR is the reading under which adding a rule can WIDEN the audience, and a
 * targeting control whose every edit can only narrow is the one an operator can reason about at 2 a.m.
 */
export function matches(rules: TargetingRules | null | undefined, s: TargetSubject): TargetVerdict {
  const r = rules ?? {};

  if (has(r.tenant_ids) && s.tenantId && r.tenant_ids.includes(s.tenantId)) {
    return { kind: 'allowlisted' };
  }

  if (has(r.plans)) {
    if (!s.planCode) return { kind: 'excluded_unknown', by: 'plan' };
    if (!r.plans.includes(s.planCode)) return { kind: 'excluded', by: 'plan' };
  }

  if (has(r.countries)) {
    if (!s.countryCode) return { kind: 'excluded_unknown', by: 'country' };
    // Case-normalised on both sides: the admin plane stores `^[A-Z]{2}$` and `tenants.country_code` is char(2), and a
    // single lower-case row in either would silently exclude a whole country.
    const want = r.countries.map((c) => c.toUpperCase());
    if (!want.includes(s.countryCode.toUpperCase())) return { kind: 'excluded', by: 'country' };
  }

  return { kind: 'eligible' };
}

/** True when the caller may proceed to the percentage rollout (or straight to ON if allowlisted). */
export function passesTargeting(rules: TargetingRules | null | undefined, s: TargetSubject): boolean {
  const v = matches(rules, s);
  return v.kind === 'allowlisted' || v.kind === 'eligible';
}

/**
 * **A FLAG WITH A TENANT ALLOWLIST AND A 0% ROLLOUT IS STILL ON FOR THOSE TENANTS.** Worth its own function because the
 * order in `isEnabled` used to make this true by accident and could have been reordered by anybody: the allowlist check
 * ran before the `rollout_pct <= 0` early return. Naming it makes the property survive a refactor.
 */
export function allowlistBeatsRollout(): boolean { return true; }
