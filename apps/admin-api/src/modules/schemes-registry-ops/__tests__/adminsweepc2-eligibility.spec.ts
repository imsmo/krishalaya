// PC-56 ADMIN-SWEEP-c2 · the eligibility builder's two hard halves: the validator that suggests, and the cohort
// dry run that mirrors the evaluator's forgiveness and counts losers exactly.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  KNOWN_ELIGIBILITY_FIELDS, ELIGIBILITY_EVALUATOR_SOURCE, editDistance, suggestField, assertEligibilityRules,
  expansionOnly, EligibilityRuleError,
} from '../domain/eligibility-fields';
import { SchemesRegistryRepository } from '../repositories/schemes-registry.repository';

function codeOf(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return e instanceof EligibilityRuleError ? e.code : `<not a rule error: ${e}>`; }
}
function msgOf(fn: () => unknown): string {
  try { fn(); return ''; } catch (e) { return (e as Error).message; }
}

/* ================================================================================================ */
describe('ADMIN-SWEEP-c2 · the vocabulary is the evaluator’s, pinned to BOTH ends', () => {
  it('exactly the five fields the evaluator reads', () => {
    expect([...KNOWN_ELIGIBILITY_FIELDS]).toEqual(['roles', 'landholding_max_acres', 'gender', 'age_min', 'age_max']);
  });
  it('the OTHER end (apps/api scheme.entity.ts) still reads each of them — drift fails here, not in a farmer’s pre-check', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'schemes', 'domain', 'scheme.entity.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of KNOWN_ELIGIBILITY_FIELDS) expect(src).toContain(`r.${f}`);
    // and the source constant names the right file, so the next reader finds the truth where we did
    expect(ELIGIBILITY_EVALUATOR_SOURCE).toContain('scheme.entity.ts');
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c2 · the validator refuses BY NAME and suggests the nearest real field', () => {
  it('the canon’s own example: land_max → landholding_max_acres', () => {
    expect(suggestField('land_max')).toBe('landholding_max_acres');
    const msg = msgOf(() => assertEligibilityRules({ land_max: 5 }));
    expect(msg).toContain('unknown field "land_max"');
    expect(msg).toContain('did you mean landholding_max_acres?');
    expect(msg).toContain('Nothing saved');
  });
  it('plausible typos suggest; gibberish does not (a bad suggestion teaches operators to ignore suggestions)', () => {
    expect(suggestField('gendr')).toBe('gender');
    expect(suggestField('age_mn')).toBe('age_min');
    expect(suggestField('xyzzy_quux_42')).toBeNull();
  });
  it('the canon’s sample fields requires/crop_in/exclusions are REFUSED — the evaluator does not read them, so they would silently do nothing', () => {
    for (const k of ['requires', 'crop_in', 'exclusions']) {
      expect(codeOf(() => assertEligibilityRules({ [k]: true }))).toBe('ELIG_UNKNOWN_FIELD');
    }
  });
  it('known fields are TYPE-checked — the right name with the wrong shape is ignored just as silently', () => {
    expect(codeOf(() => assertEligibilityRules({ roles: [] }))).toBe('ELIG_BAD_ROLES');
    expect(codeOf(() => assertEligibilityRules({ landholding_max_acres: '5' }))).toBe('ELIG_BAD_LANDMAX');
    expect(codeOf(() => assertEligibilityRules({ landholding_max_acres: -1 }))).toBe('ELIG_BAD_LANDMAX');
    expect(codeOf(() => assertEligibilityRules({ age_min: 2.5 }))).toBe('ELIG_BAD_AGE');
    expect(codeOf(() => assertEligibilityRules({ age_min: 60, age_max: 18 }))).toBe('ELIG_AGE_INVERTED');
    expect(codeOf(() => assertEligibilityRules([]))).toBe('ELIG_NOT_OBJECT');
    expect(assertEligibilityRules({ roles: ['farmer'], landholding_max_acres: 5, age_min: 18, age_max: 65, gender: 'female' }))
      .toMatchObject({ roles: ['farmer'] });
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c2 · the cohort diff SQL mirrors the evaluator’s forgiveness', () => {
  class StubPool {
    calls: Array<{ sql: string; params: unknown[] }> = [];
    results = new Map<string, any[]>();
    when(fragment: string, rows: any[]) { this.results.set(fragment, rows); }
    async query(sql: string, params?: unknown[]) {
      this.calls.push({ sql, params: params ?? [] });
      for (const [frag, rows] of this.results) if (sql.includes(frag)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    }
  }
  it('null profile values PASS their constraint (the evaluator skips the check) — in the SQL itself', async () => {
    const pool = new StubPool();
    pool.when('WITH draft_ok', [{ draft_n: 19876, pub_n: 18204, gained: 1672, lost: 0 }]);
    pool.when("area_unit <> 'acre'", [{ n: 7 }]);
    const repo = new SchemesRegistryRepository(pool as any);
    const d = await repo.cohortDiff(
      { roles: ['farmer', 'sharecropper'], landholding_max_acres: 5, gender: 'female', age_min: 18, age_max: 70 },
      { roles: ['farmer'] });
    expect(d).toEqual({ draftEligible: 19876, publishedEligible: 18204, gained: 1672, lost: 0, unconvertibleParcels: 7 });
    const sql = pool.calls.find((c) => c.sql.includes('WITH draft_ok'))!.sql;
    expect(sql).toContain('u.gender IS NULL OR u.gender =');            // unknown gender passes
    expect(sql).toContain('u.dob IS NULL OR');                          // unknown age passes
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM land_parcels');    // unknown landholding passes
    expect(sql).toContain('lost');
    // and every rule value is a bind parameter, never interpolated
    const params = pool.calls.find((c) => c.sql.includes('WITH draft_ok'))!.params;
    expect(params).toContainEqual(['farmer', 'sharecropper']);
    expect(params).toContain(5);
    expect(params).toContain('female');
  });
  it('first version (no published rules): counts only, no gained/lost fiction', async () => {
    const pool = new StubPool();
    pool.when('FROM users u WHERE', [{ n: 100 }]);
    pool.when("area_unit <> 'acre'", [{ n: 0 }]);
    const repo = new SchemesRegistryRepository(pool as any);
    const d = await repo.cohortDiff({ roles: ['farmer'] }, null);
    expect(d).toMatchObject({ draftEligible: 100, publishedEligible: null, gained: 0, lost: 0 });
  });
  it('expansionOnly demands a comparison AND zero losers', () => {
    expect(expansionOnly({ publishedEligible: 10, draftEligible: 12, gained: 2, lost: 0, unconvertibleParcels: 0 })).toBe(true);
    expect(expansionOnly({ publishedEligible: 10, draftEligible: 12, gained: 3, lost: 1, unconvertibleParcels: 0 })).toBe(false);
    expect(expansionOnly({ publishedEligible: null, draftEligible: 12, gained: 0, lost: 0, unconvertibleParcels: 0 })).toBe(false);
  });
  it('editDistance is exact on the small cases the suggester leans on', () => {
    expect(editDistance('gendr', 'gender')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});

/* ================================================================================================ */
describe('ADMIN-SWEEP-c2 · wiring truths (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the dry-run route is Manage-gated, saves nothing, and the SAVE path validates first', () => {
    const ctl = strip(fs.readFileSync(path.join(__dirname, '..', 'schemes-registry-ops.controller.ts'), 'utf8'));
    expect(ctl).toMatch(/@Post\('schemes\/:id\/versions\/dry-run'\) @RequireOwnerPermission\(OwnerPermissions\.SchemesRegistryManage\)/);
    const svc = strip(fs.readFileSync(path.join(__dirname, '..', 'services', 'eligibility-rules-editor.service.ts'), 'utf8'));
    expect(svc).toContain('assertEligibilityRules(dto.eligibilityRules)');   // before the draft opens
    expect(svc).toContain('savedNothing: true');
  });
});
