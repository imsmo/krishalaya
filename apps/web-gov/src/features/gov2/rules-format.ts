// apps/web-gov/src/features/gov2/rules-format.ts · PC-56 GOV-2b · E6 — a scheme's eligibility rules IN WORDS, from the evaluator's five
// fields only. PURE (no translation here: it returns i18n keys and their values; the views translate).
//
// The evaluator is `apps/api/src/modules/schemes/domain/scheme.entity.ts` `Scheme.evaluate` — it reads exactly `roles`, `landholding_max_acres`,
// `gender`, `age_min`, `age_max`, each only in ONE shape (a non-empty array; a number; a string; a number; a number) and ignores anything else.
// The gov read (0240 `gov_version_public`) returns only those five keys. This formatter mirrors the evaluator's shapes exactly: a condition
// is printed as a condition only when the evaluator would apply it; a stored key in another shape is NAMED as not applied (never silently
// dropped, never printed as if it held).
//   • land is a MAXIMUM, in ACRES, AS STORED — never converted to any other unit, never rounded (String(n) of the stored number);
//   • roles are the role codes as stored (data, not translated here);
//   • no other condition exists (no residence, water source, tier, cost share or social group — survey F-6).
export type RuleField = 'roles' | 'landholding_max_acres' | 'gender' | 'age_min' | 'age_max';
export const RULE_FIELDS: readonly RuleField[] = Object.freeze(['roles', 'landholding_max_acres', 'gender', 'age_min', 'age_max']);
export interface RuleLine { field: RuleField; key: string; vars: Record<string, string> }
export interface RulesInWords { lines: RuleLine[]; notApplied: RuleField[] }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The rules in words, in the evaluator's order. `notApplied` names a field that is stored in a shape the evaluator does not read. */
export function rulesInWords(rules: Record<string, unknown> | null | undefined): RulesInWords {
  const r = rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
  const lines: RuleLine[] = [];
  const notApplied: RuleField[] = [];
  const has = (k: RuleField) => Object.prototype.hasOwnProperty.call(r, k) && r[k] !== null && r[k] !== undefined;

  if (has('roles')) {
    const v = r.roles;
    // the evaluator: Array.isArray(r.roles) && r.roles.length > 0
    if (Array.isArray(v) && v.length > 0) lines.push({ field: 'roles', key: 'gov2.rule.roles', vars: { roles: v.map((x) => String(x)).join(', ') } });
    else notApplied.push('roles');
  }
  if (has('landholding_max_acres')) {
    const v = r.landholding_max_acres;
    // the evaluator: typeof r.landholding_max_acres === 'number' — compared in ACRES; printed as stored
    if (isNum(v)) lines.push({ field: 'landholding_max_acres', key: 'gov2.rule.landMax', vars: { n: String(v) } });
    else notApplied.push('landholding_max_acres');
  }
  if (has('gender')) {
    const v = r.gender;
    if (typeof v === 'string') lines.push({ field: 'gender', key: 'gov2.rule.gender', vars: { gender: v } });
    else notApplied.push('gender');
  }
  for (const [k, key] of [['age_min', 'gov2.rule.ageMin'], ['age_max', 'gov2.rule.ageMax']] as const) {
    if (!has(k)) continue;
    const v = r[k];
    if (isNum(v)) lines.push({ field: k, key, vars: { n: String(v) } });
    else notApplied.push(k);
  }
  return { lines, notApplied };
}
