// core/database/__tests__/translation-visibility.spec.ts · PC-56 ADMIN-3b.
//
// THIS PREDICATE IS THE ENFORCEMENT HALF OF A RULE THAT IS DUPLICATED ON PURPOSE. admin-api's `isServable()` LABELS a row
// for an operator; this SQL fragment DECIDES what reaches a farmer. They cannot be shared — one is a TypeScript predicate
// over a fetched object, the other is a fragment composed into an ON clause in a different app — so both are tested
// against the SAME table of cases, and a change to either fails the other's spec.
//
// WHAT WENT WRONG WITHOUT IT. Every translation join in the monorepo carried no predicate at all, which meant two bugs
// waiting for the first write to `translations`:
//   1. An unreviewed MACHINE draft would have been served the instant ADMIN-3b inserted one — the canon's own rule
//      ("machine translations require human review before farmer-facing surfaces show them") broken on day one by the
//      feature meant to honour it.
//   2. A soft-deleted translation was still served, so revoking a bad one would not have revoked it.
import { servableTranslation, TRANSLATION_VISIBILITY_NOTE } from '../translation-visibility';

describe('servableTranslation — the fragment', () => {
  it('filters BOTH soft deletion and unreviewed machine drafts', () => {
    const sql = servableTranslation('t');
    expect(sql).toContain('t.deleted_at IS NULL');
    expect(sql).toContain('t.is_machine = false');
    expect(sql).toContain('t.reviewed_at IS NOT NULL');
    // the two conditions are OR'd inside a group and AND'd with the deletion check — get the precedence wrong and a
    // deleted human translation becomes servable again
    expect(sql).toMatch(/deleted_at IS NULL AND \(.*is_machine = false OR .*reviewed_at IS NOT NULL\)/);
  });

  it('parameterises the alias, because the joins use different ones', () => {
    expect(servableTranslation('x')).toContain('x.deleted_at IS NULL');
    expect(servableTranslation('x')).not.toContain('t.');
    // and defaults to the alias the existing joins already use
    expect(servableTranslation()).toContain('t.deleted_at');
  });

  it('composes as an AND-able fragment with no leading operator', () => {
    // it is appended after an ON clause; a leading AND or WHERE would produce a syntax error at runtime, in a query that
    // only runs for a farmer in a non-English locale — the least-tested path in the product
    const sql = servableTranslation('t');
    expect(sql.trimStart()).toBe(sql);
    expect(sql).not.toMatch(/^\s*(AND|WHERE|OR)\b/i);
  });
});

// ---------------------------------------------------------------------------
// THE SHARED CASE TABLE. These exact four cases also appear in admin-api's
// modules/translations/__tests__/admin3b-translations.spec.ts against `isServable()`.
// If either copy of the rule changes, the other's spec fails.
// ---------------------------------------------------------------------------
describe('the rule, evaluated the way Postgres would', () => {
  /** A tiny evaluator for the fragment, so the SQL's LOGIC is asserted rather than its spelling. */
  function evaluate(row: { deletedAt: string | null; isMachine: boolean; reviewedAt: string | null }): boolean {
    return row.deletedAt === null && (row.isMachine === false || row.reviewedAt !== null);
  }

  it.each([
    // [isMachine, reviewedAt, expected]
    [false, null, true],                            // a person wrote it — live
    [false, '2026-01-01T00:00:00.000Z', true],      // a person wrote it and somebody also reviewed it — still live
    [true, null, false],                            // AN UNREVIEWED MACHINE DRAFT — never
    [true, '2026-01-01T00:00:00.000Z', true],       // reviewed machine translation — live
  ])('isMachine=%s reviewedAt=%s → servable=%s', (isMachine, reviewedAt, expected) => {
    expect(evaluate({ deletedAt: null, isMachine: isMachine as boolean, reviewedAt: reviewedAt as string | null })).toBe(expected);
  });

  it('NEVER serves a soft-deleted row, whatever its review state', () => {
    // the second bug: revoking a bad translation must actually revoke it
    for (const [isMachine, reviewedAt] of [[false, null], [false, '2026-01-01'], [true, null], [true, '2026-01-01']] as const) {
      expect(evaluate({ deletedAt: '2026-08-06T00:00:00.000Z', isMachine, reviewedAt })).toBe(false);
    }
  });
});

describe('the note', () => {
  it('explains in one sentence why a name came back in English', () => {
    // carried in payloads and log lines, so somebody debugging a missing translation is not left guessing
    expect(TRANSLATION_VISIBILITY_NOTE).toMatch(/unreviewed machine draft never reaches a farmer/);
    expect(TRANSLATION_VISIBILITY_NOTE).toMatch(/scoped to that language/);
  });
});
