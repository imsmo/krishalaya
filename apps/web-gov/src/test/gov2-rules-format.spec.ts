// apps/web-gov/src/test/gov2-rules-format.spec.ts · PC-56 GOV-2b · E6 — the rules in words (features/gov2/rules-format.ts) mirror the
// evaluator (`apps/api/src/modules/schemes/domain/scheme.entity.ts` `Scheme.evaluate`) EXACTLY: the same five fields, the same accepted shape
// for each, the same order; land a MAXIMUM in ACRES as stored (never converted, never rounded); a field in another shape named as not applied.
// The field list is pinned to the evaluator's source and to the admin builder's vocabulary, so the day the evaluator learns a field this
// formatter must learn it in the same commit.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RULE_FIELDS, rulesInWords } from '../features/gov2/rules-format';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const REPO = path.join(__dirname, '..', '..', '..', '..');

describe('PC-56 GOV-2b · rules in words', () => {
  it('the five fields, in the evaluator\'s order, from the full rule set', () => {
    const w = rulesInWords({ roles: ['farmer', 'fpo_member'], landholding_max_acres: 2.5, gender: 'female', age_min: 18, age_max: 60 });
    expect(w.lines.map((l) => [l.key, l.vars])).toEqual([
      ['gov2.rule.roles', { roles: 'farmer, fpo_member' }], ['gov2.rule.landMax', { n: '2.5' }], ['gov2.rule.gender', { gender: 'female' }],
      ['gov2.rule.ageMin', { n: '18' }], ['gov2.rule.ageMax', { n: '60' }],
    ]);
    expect(w.notApplied).toEqual([]);
  });
  it('land stays in ACRES as stored: no conversion, no rounding', () => {
    for (const n of [2.5, 0.1, 4, 1.234567, 100]) expect(rulesInWords({ landholding_max_acres: n }).lines[0].vars.n).toBe(String(n));
    expect(en['gov2.rule.landMax']).toBe('Land held: at most {n} acres');
    expect(/एकड़/.test(hi['gov2.rule.landMax']) && /એકર/.test(gu['gov2.rule.landMax'])).toBe(true);
    for (const cat of [en, hi, gu]) expect(/hectare|हेक्टेयर|હેક્ટર|\bha\b/i.test(cat['gov2.rule.landMax'])).toBe(false);
  });
  it('a shape the evaluator ignores is NOT printed as a condition; it is named as not applied', () => {
    const w = rulesInWords({ roles: [], landholding_max_acres: '3', gender: 7, age_min: '18', age_max: null });
    expect(w.lines).toEqual([]); expect(w.notApplied).toEqual(['roles', 'landholding_max_acres', 'gender', 'age_min']);
  });
  it('no rule → no line (the view says "no condition"); junk input → no line; unknown keys never printed', () => {
    expect(rulesInWords({})).toEqual({ lines: [], notApplied: [] });
    expect(rulesInWords(null)).toEqual({ lines: [], notApplied: [] });
    expect(rulesInWords([] as unknown as Record<string, unknown>)).toEqual({ lines: [], notApplied: [] });
    expect(rulesInWords({ caste: 'x', residence: 'y', land_min: 1 })).toEqual({ lines: [], notApplied: [] });
  });
  it('the field list is the evaluator\'s and the admin builder\'s, verbatim', () => {
    expect(RULE_FIELDS).toEqual(['roles', 'landholding_max_acres', 'gender', 'age_min', 'age_max']);
    const ev = fs.readFileSync(path.join(REPO, 'apps/api/src/modules/schemes/domain/scheme.entity.ts'), 'utf8');
    const read = [...new Set([...ev.matchAll(/\br\.([a-z_]+)/g)].map((m) => m[1]))];
    expect(read.sort()).toEqual([...RULE_FIELDS].sort());
    const adm = fs.readFileSync(path.join(REPO, 'apps/admin-api/src/modules/schemes-registry-ops/domain/eligibility-fields.ts'), 'utf8');
    expect(adm).toContain("KNOWN_ELIGIBILITY_FIELDS = ['roles', 'landholding_max_acres', 'gender', 'age_min', 'age_max']");
  });
});
