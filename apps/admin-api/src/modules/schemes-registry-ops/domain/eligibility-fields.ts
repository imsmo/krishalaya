// apps/admin-api/src/modules/schemes-registry-ops/domain/eligibility-fields.ts · W071 pure rules
// (PC-56 ADMIN-SWEEP-c2). No I/O.
//
// THE VOCABULARY IS THE EVALUATOR'S, VERBATIM — because the evaluator's own comment is the trap: "unknown rule keys
// are ignored (forward-safe)". Forward-safe for the CODE is silently-broken for the AUTHOR: an operator who writes
// "land_max" believes they have constrained eligibility while every farmer passes the check. So the builder REFUSES
// any key the evaluator does not read, names it, and suggests the nearest real field (the canon's own error state:
// 'unknown field "land_max" (did you mean landholding_max_acres?). Nothing saved.'). A spec pins this list to the
// apps/api source, so the day the evaluator learns a field, this vocabulary must learn it in the same commit.
//
// THE CANON'S OWN SAMPLE RULES FAIL THIS VALIDATOR, AND THAT IS A FINDING, NOT A BUG: W071 draws `requires`,
// `crop_in` and `exclusions` — none of which the evaluator reads. Accepting them would store rules that silently do
// nothing on the screen whose whole job is deciding real benefit access. They are GAP-BACKEND (evaluator support),
// named in the tracker; until the evaluator reads them, refusing them here is what keeps the rule honest.

/** The one place the evaluator's semantics live (the LISTING_STATE_SOURCE convention). */
export const ELIGIBILITY_EVALUATOR_SOURCE = 'apps/api/src/modules/schemes/domain/scheme.entity.ts' as const;

export const KNOWN_ELIGIBILITY_FIELDS = ['roles', 'landholding_max_acres', 'gender', 'age_min', 'age_max'] as const;
export type EligibilityField = (typeof KNOWN_ELIGIBILITY_FIELDS)[number];

export class EligibilityRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/* ------------------------------------------------------------------ the suggestion */

/** Small, exact Levenshtein — the vocabulary is five words; this is not a search engine. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** The nearest known field, if it is near enough to be a plausible typo or truncation. `land_max` →
 *  `landholding_max_acres` is the canon's own example, and raw distance would never bridge it — so a key that is a
 *  SUBSEQUENCE-ish fragment of a known field (all its parts appear, in order) also counts as near. */
export function suggestField(unknown: string): EligibilityField | null {
  const u = unknown.toLowerCase();
  let best: EligibilityField | null = null;
  let bestScore = Infinity;
  for (const k of KNOWN_ELIGIBILITY_FIELDS) {
    const parts = u.split('_').filter(Boolean);
    const fragment = parts.length > 0 && parts.every((p) => k.includes(p));
    const dist = editDistance(u, k);
    const score = fragment ? Math.min(dist, 3) : dist;
    if (score < bestScore) { bestScore = score; best = k; }
  }
  // a suggestion must be plausible — suggesting `gender` for `xyzzy` teaches operators to ignore suggestions
  return bestScore <= Math.max(3, Math.floor((best?.length ?? 0) / 2)) ? best : null;
}

/* ------------------------------------------------------------------ the validator */

/** Refuses unknown keys BY NAME with the suggestion in the sentence, and type-checks the known ones — a rule of the
 *  right name and the wrong shape is ignored by the evaluator just as silently. Returns the validated rules. */
export function assertEligibilityRules(rules: unknown): Record<string, unknown> {
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    throw new EligibilityRuleError('ELIG_NOT_OBJECT', 'eligibility_rules must be a JSON object');
  }
  const r = rules as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!(KNOWN_ELIGIBILITY_FIELDS as readonly string[]).includes(key)) {
      const s = suggestField(key);
      throw new EligibilityRuleError('ELIG_UNKNOWN_FIELD',
        `Rule JSON has an unknown field "${key}"${s ? ` (did you mean ${s}?)` : ''}. Nothing saved. The evaluator ignores unknown keys, so this rule would silently do nothing — the fields it reads are: ${KNOWN_ELIGIBILITY_FIELDS.join(', ')} (${ELIGIBILITY_EVALUATOR_SOURCE}).`);
    }
  }
  if (r.roles !== undefined) {
    if (!Array.isArray(r.roles) || r.roles.length === 0 || !r.roles.every((x) => typeof x === 'string' && x.trim().length > 0)) {
      throw new EligibilityRuleError('ELIG_BAD_ROLES', '"roles" must be a non-empty array of role codes — an empty array would mean "no role qualifies", which is a scheme nobody can hold');
    }
  }
  if (r.landholding_max_acres !== undefined && (typeof r.landholding_max_acres !== 'number' || !(r.landholding_max_acres > 0))) {
    throw new EligibilityRuleError('ELIG_BAD_LANDMAX', '"landholding_max_acres" must be a positive number — the evaluator compares it numerically and ignores any other shape');
  }
  if (r.gender !== undefined && (typeof r.gender !== 'string' || r.gender.trim().length === 0)) {
    throw new EligibilityRuleError('ELIG_BAD_GENDER', '"gender" must be a non-empty string — the evaluator compares it as one');
  }
  for (const k of ['age_min', 'age_max'] as const) {
    if (r[k] !== undefined && (typeof r[k] !== 'number' || !Number.isInteger(r[k]) || (r[k] as number) < 0)) {
      throw new EligibilityRuleError('ELIG_BAD_AGE', `"${k}" must be a non-negative integer`);
    }
  }
  if (typeof r.age_min === 'number' && typeof r.age_max === 'number' && r.age_min > r.age_max) {
    throw new EligibilityRuleError('ELIG_AGE_INVERTED', '"age_min" exceeds "age_max" — no age satisfies this rule, which is a scheme nobody can hold');
  }
  return r;
}

/* ------------------------------------------------------------------ the dry-run verdict */

export interface CohortDiff {
  publishedEligible: number | null;   // null when no published version exists to compare against
  draftEligible: number;
  gained: number;
  lost: number;
  /** land parcels in units other than acre — counted and SAID, because silently treating a bigha as an acre would
   *  re-band real people, and silently ignoring the parcel would too. */
  unconvertibleParcels: number;
}

/** W071's banner rule: only a diff with ZERO losers may claim expansion-only (and skip the re-notification wave). */
export function expansionOnly(d: CohortDiff): boolean {
  return d.publishedEligible !== null && d.lost === 0;
}
