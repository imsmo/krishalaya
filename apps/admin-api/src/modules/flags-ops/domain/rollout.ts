// apps/admin-api/src/modules/flags-ops/domain/rollout.ts · pure percent-rollout + targeting rules. The eval here
// MIRRORS the runtime evaluator EXACTLY (apps/api core/feature-flags/flags.service.ts) so the console can preview
// who a flag is on for, and so unit tests prove parity. The persisted `rules` use snake_case keys
// (tenant_ids/plans/countries) — the shape the runtime reads — even though the DTO is camelCase.
import { InvalidRolloutError, InvalidTargetingError, InvalidFlagKeyError } from './flags-ops.errors';

export interface TargetingRules { tenant_ids?: string[]; plans?: string[]; countries?: string[] }
export interface FlagSnapshot { isEnabled: boolean; rolloutPct: number; rules: TargetingRules }
export interface FlagContext {
  tenantId?: string;
  userId?: string;
  /** PC-56 ADMIN-11: the two facts `rules.plans` / `rules.countries` need. Resolved from `tenant_flag_context` (0121) at
   *  runtime and supplied by the console for a preview. UNDEFINED means unknown, and unknown EXCLUDES. */
  planCode?: string;
  countryCode?: string;
}

// Bounds (abuse/DoS guard §4): an allowlist can't be unbounded.
export const MAX_TENANT_IDS = 1000;
export const MAX_PLANS = 200;
export const MAX_COUNTRIES = 300;
const FLAG_KEY_RE = /^[a-z][a-z0-9_.]{1,79}$/;   // linear, ReDoS-safe; mirrors the runtime key space
const PLAN_RE = /^[a-z0-9_]{1,40}$/;
const CC_RE = /^[A-Z]{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertFlagKey(key: string): string {
  if (!FLAG_KEY_RE.test(key)) throw new InvalidFlagKeyError("key must match ^[a-z][a-z0-9_.]{1,79}$");
  return key;
}

export function assertRolloutPct(pct: number): number {
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new InvalidRolloutError('rollout_pct must be an integer 0..100');
  return pct;
}

/** Validate + normalise targeting into the persisted snake_case shape; throws InvalidTargetingError. */
export function buildTargeting(input: { tenantIds?: string[]; plans?: string[]; countries?: string[] }): TargetingRules {
  const tenant_ids = input.tenantIds ?? [];
  const plans = input.plans ?? [];
  const countries = input.countries ?? [];
  if (tenant_ids.length > MAX_TENANT_IDS) throw new InvalidTargetingError(`tenant_ids exceeds ${MAX_TENANT_IDS}`);
  if (plans.length > MAX_PLANS) throw new InvalidTargetingError(`plans exceeds ${MAX_PLANS}`);
  if (countries.length > MAX_COUNTRIES) throw new InvalidTargetingError(`countries exceeds ${MAX_COUNTRIES}`);
  if (!tenant_ids.every((t) => UUID_RE.test(t))) throw new InvalidTargetingError('tenant_ids must be uuids');
  if (!plans.every((p) => PLAN_RE.test(p))) throw new InvalidTargetingError('plan codes must match ^[a-z0-9_]{1,40}$');
  if (!countries.every((c) => CC_RE.test(c))) throw new InvalidTargetingError('countries must be ISO-3166 alpha-2');
  return { tenant_ids, plans, countries };
}

/** Stable 0–99 bucket from a string (FNV-1a) — byte-identical to the runtime evaluator. */
export function bucket(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 100;
}

/**
 * Preview resolution for a (flag, context) — MUST match apps/api core/feature-flags/flags.service.ts.
 *
 * **PC-56 ADMIN-11: THE PREVIEW WAS ALSO MISSING PLANS AND COUNTRIES, AND THE PARITY WAS THE PROBLEM.** This function
 * mirrored the runtime evaluator byte-for-byte, and the runtime evaluator ignored `rules.plans` and `rules.countries`.
 * So the console's "who is this on for" preview agreed with the runtime and both were wrong: an operator could target
 * `countries: ['IN']`, preview it, see it apply everywhere, and conclude the preview was working.
 *
 * Parity is still the rule; what changed is what both sides do. The caller now supplies the tenant's plan and country
 * when it has them, exactly as the runtime resolves them from `tenant_flag_context` (0121).
 */
export function isEnabledFor(key: string, flag: FlagSnapshot, ctx: FlagContext = {}): boolean {
  if (!flag.isEnabled) return false;                                   // unknown/kill-switched ⇒ OFF
  const rules = flag.rules ?? {};
  const allow = rules.tenant_ids ?? [];
  if (ctx.tenantId && allow.includes(ctx.tenantId)) return true;       // explicit allowlist beats every other rule

  // PLAN + COUNTRY, conjunctive with each other and subordinate to the allowlist. An UNKNOWN fact excludes: a flag
  // limited to one country must not serve a caller whose country cannot be established.
  if ((rules.plans?.length ?? 0) > 0) {
    if (!ctx.planCode || !rules.plans!.includes(ctx.planCode)) return false;
  }
  if ((rules.countries?.length ?? 0) > 0) {
    if (!ctx.countryCode) return false;
    if (!rules.countries!.map((c) => c.toUpperCase()).includes(ctx.countryCode.toUpperCase())) return false;
  }

  if (flag.rolloutPct >= 100) return true;
  if (flag.rolloutPct <= 0) return false;
  return bucket(`${key}:${ctx.tenantId ?? ctx.userId ?? 'anon'}`) < flag.rolloutPct;
}

/* ------------------------------------------------------------------------------------------------ */
/* WHICH FLIPS NEED A SECOND PERSON — the fifteenth maker-checker site                               */
/* ------------------------------------------------------------------------------------------------ */

export const FLAG_TIERS = ['module', 'experiment', 'kill_switch'] as const;
export type FlagTier = (typeof FLAG_TIERS)[number];

export type FlagAction = 'enable' | 'disable' | 'kill' | 'unlock' | 'set_rollout' | 'set_targeting';

/**
 * **W004 SAYS "maker-checker gated for module-level flags" AND NOTHING GATED ANYTHING.** The reason was enforced (NOT
 * NULL since 0036, `min(3)` in the DTO); the second person was enforced nowhere — twelve other modules use
 * `two-person-rule.ts` and flags-ops never did. One operator holding `flags.manage` could switch `module.listings` off
 * for every tenant on the platform, or fire `payments.kill_switch`, with a three-character reason.
 *
 * **THE ASYMMETRY IS THE DESIGN, and it is the ADMIN-9 rule with the sign flipped again.** Removing access to a feature
 * is the emergency direction and takes one person; giving it back — or widening it — is the permissive direction and
 * takes two. A platform that needs a checker to STOP something is a platform whose kill-switch does not work at 2 a.m.
 */
export function needsSecondPerson(tier: string, action: FlagAction, widening: boolean): boolean {
  // Turning something OFF, killing it, or narrowing a rollout: always one person.
  if (action === 'disable' || action === 'kill') return false;
  if ((action === 'set_rollout' || action === 'set_targeting') && !widening) return false;
  // An unrecognised tier is treated as the STRICTEST, not the loosest: a tier added by a future migration must arrive
  // gated. This is the correction ADMIN-8's `needsChecker` had to have applied to it, learned once.
  if (!(FLAG_TIERS as readonly string[]).includes(tier)) return true;
  // `experiment` flags widen without a checker — that is what an experiment is, and requiring two people to move a
  // rollout from 10% to 25% would make percentage rollouts something nobody uses.
  return tier !== 'experiment';
}

/** Is this rollout change a WIDENING? Equal is not widening — re-applying the same percentage is a no-op and should not
 *  need a checker to confirm nothing happened. */
export function isWideningRollout(from: number, to: number): boolean {
  return to > from;
}

/**
 * Is this targeting change a WIDENING? **A rule REMOVED is a widening**, which is the counter-intuitive half and the one
 * that matters: deleting `countries: ['IN']` from a flag takes it from one country to every country. Adding to the
 * allowlist is also widening; adding a NEW restricting key (plans/countries where there was none) narrows.
 */
export function isWideningTargeting(before: TargetingRules, after: TargetingRules): boolean {
  const allowGrew = (after.tenant_ids?.length ?? 0) > (before.tenant_ids?.length ?? 0);
  const restrictionDropped = (['plans', 'countries'] as const).some((k) => {
    const b = before[k]?.length ?? 0;
    const a = after[k]?.length ?? 0;
    // A restriction that existed and now does not, or one that now names MORE values (a bigger allowed set is a wider
    // audience) — both widen.
    return (b > 0 && a === 0) || (b > 0 && a > b);
  });
  return allowGrew || restrictionDropped;
}
