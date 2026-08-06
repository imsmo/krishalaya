// apps/admin-api/src/modules/translations/__tests__/admin3b-translations.spec.ts · PC-56 ADMIN-3b.
//
// A translation is not a label. It is the words a farmer reads when the platform tells them what their produce is called
// or why their money did not arrive — and if the Gujarati says something other than the English, the platform has misled
// somebody who cannot check.
//
// So the tests here are about ENTITLEMENT and VISIBILITY, not string length:
//   • `isServable` is the rule that keeps unreviewed AI away from farmers. It is duplicated across the realms on purpose
//     (SQL enforces, TypeScript labels) and BOTH copies are asserted against the same table of cases, in both apps, so a
//     change to one fails the other's spec.
//   • the language scope is what makes an approval mean anything, and it throws rather than returning false, because a
//     boolean check is one a caller can forget.
import {
  TRANSLATABLE_ENTITIES, isTranslatableEntity, fieldsFor,
  assertTranslation, assertReview, assertReviewerScope, assertReviewerGrant,
  isServable, isAwaitingReview, describeState, coverageMatrix, emptyLanguages,
  REVIEW_DECISIONS, isReviewDecision, MIN_REASON, MAX_TEXT,
} from '../domain/translation';
import { InvalidTranslationError, ReviewerScopeError } from '../domain/translations.errors';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('the translatable vocabulary is closed', () => {
  it('names the kinds and their fields, so a typo cannot orphan a row', () => {
    // `translations.entity_type` is a free varchar — 'catagory' would insert cleanly and never join to anything
    expect([...TRANSLATABLE_ENTITIES]).toEqual([
      'category', 'attribute', 'attribute_option', 'lookup_value', 'scheme', 'region', 'listing', 'insurance_claim']);
    expect(isTranslatableEntity('category')).toBe(true);
    expect(isTranslatableEntity('catagory')).toBe(false);
    expect(fieldsFor('category')).toEqual(['name', 'description']);
    expect(fieldsFor('lookup_value')).toEqual(['name']);
  });
});

describe('THE SERVABLE RULE — what a farmer may see', () => {
  it('serves a HUMAN translation immediately', () => {
    // a person who holds the language wrote it; asking them to approve themselves is ceremony
    expect(isServable({ isMachine: false, reviewedAt: null })).toBe(true);
    expect(isServable({ isMachine: false, reviewedAt: '2026-08-06T00:00:00.000Z' })).toBe(true);
  });

  it('NEVER serves an unreviewed machine draft', () => {
    // the canon's rule, and until ADMIN-3b nothing enforced it: apps/api's joins had no predicate at all
    expect(isServable({ isMachine: true, reviewedAt: null })).toBe(false);
    expect(isServable({ isMachine: true, reviewedAt: undefined })).toBe(false);
  });

  it('serves a machine translation ONCE reviewed', () => {
    expect(isServable({ isMachine: true, reviewedAt: '2026-08-06T00:00:00.000Z' })).toBe(true);
  });

  it('matches the SQL predicate case for case', () => {
    // `servableTranslation()` in apps/api is `deleted_at IS NULL AND (is_machine = false OR reviewed_at IS NOT NULL)`.
    // The same four cases are asserted in apps/api's own spec against the same expectations; if either copy changes, the
    // other's test fails.
    const cases: Array<[boolean, string | null, boolean]> = [
      [false, null, true],
      [false, '2026-01-01T00:00:00.000Z', true],
      [true, null, false],
      [true, '2026-01-01T00:00:00.000Z', true],
    ];
    for (const [isMachine, reviewedAt, expected] of cases) {
      expect(isServable({ isMachine, reviewedAt })).toBe(expected);
    }
  });

  it('identifies exactly the rows the review queue is for', () => {
    expect(isAwaitingReview({ isMachine: true, reviewedAt: null })).toBe(true);
    expect(isAwaitingReview({ isMachine: true, reviewedAt: '2026-08-06' })).toBe(false);
    // a human row is never awaiting review
    expect(isAwaitingReview({ isMachine: false, reviewedAt: null })).toBe(false);
  });

  it('describes a draft as a DRAFT, naming the engine', () => {
    expect(describeState({ isMachine: true, reviewedAt: null, source: 'ai4bharat' }))
      .toMatch(/DRAFT from ai4bharat — not shown to anybody/);
    expect(describeState({ isMachine: false, reviewedAt: null, source: null })).toMatch(/Written by a person — live/);
    expect(describeState({ isMachine: true, reviewedAt: '2026-08-06', source: 'ai4bharat' })).toMatch(/reviewed and accepted — live/);
  });
});

describe('assertTranslation', () => {
  const base = { entityType: 'category', entityId: UUID, field: 'name', languageCode: 'gu', text: 'ઘઉં' };

  it('accepts a real translation and leaves the TEXT untouched', () => {
    // Indic scripts use combining marks a naive normaliser mangles — ક્ષ is not ક ્ ષ to a reader — and the platform is
    // in no position to improve somebody's Gujarati
    const t = assertTranslation({ ...base, text: '  ઘઉં  ' });
    expect(t.text).toBe('ઘઉં');
    expect(t.languageCode).toBe('gu');
    expect(t.isMachine).toBe(false);
    expect(t.source).toBeNull();
  });

  it('refuses an entity kind or field that would orphan the row', () => {
    expect(() => assertTranslation({ ...base, entityType: 'catagory' })).toThrow(/entityType must be one of/);
    expect(() => assertTranslation({ ...base, field: 'label' })).toThrow(/is not a translatable field on a category/);
    // a field valid on ANOTHER kind is still refused here
    expect(() => assertTranslation({ ...base, entityType: 'lookup_value', field: 'description' })).toThrow(/not a translatable field/);
  });

  it('refuses a bad id, a bad language and an empty text', () => {
    expect(() => assertTranslation({ ...base, entityId: 'wheat' })).toThrow(/entityId must be a uuid/);
    expect(() => assertTranslation({ ...base, languageCode: 'gujarati' })).toThrow(/language code/);
    expect(() => assertTranslation({ ...base, text: '   ' })).toThrow(/cannot be empty/);
    expect(() => assertTranslation({ ...base, text: 'x'.repeat(MAX_TEXT + 1) })).toThrow(/at most 4000/);
  });

  it('DEMANDS A SOURCE on a machine translation — "the AI said so" is not a provenance', () => {
    expect(() => assertTranslation({ ...base, isMachine: true })).toThrow(/must name the engine that produced it/);
    expect(assertTranslation({ ...base, isMachine: true, source: 'ai4bharat' }).source).toBe('ai4bharat');
  });

  it('refuses a source on a HUMAN translation — a person is attributed by their author record', () => {
    expect(() => assertTranslation({ ...base, isMachine: false, source: 'ai4bharat' }))
      .toThrow(/a human translation is attributed by its author/);
  });
});

describe('assertReview — approving is a claim, not a click', () => {
  it('accepts a plain approval with no text and no note', () => {
    // "it was correct" needs no elaboration
    expect(assertReview({ decision: 'approve' })).toEqual({ decision: 'approve', text: null, note: null });
  });

  it('refuses replacement text on a PLAIN approval', () => {
    expect(() => assertReview({ decision: 'approve', text: 'ઘઉં' })).toThrow(/use approve with an edit to change it/);
  });

  it('DEMANDS the corrected text AND a note when approving with an edit', () => {
    // the note is the only record of whether the engine is trustworthy in this language, which is how anybody finds out
    expect(() => assertReview({ decision: 'approve_with_edit', note: 'x'.repeat(20) })).toThrow(/needs the corrected text/);
    expect(() => assertReview({ decision: 'approve_with_edit', text: 'ઘઉં' })).toThrow(/say what you changed/);
    expect(() => assertReview({ decision: 'approve_with_edit', text: 'ઘઉં', note: 'fix' })).toThrow(/at least 10 characters/);
    const r = assertReview({ decision: 'approve_with_edit', text: 'ઘઉં', note: 'engine used the Hindi word' });
    expect(r).toEqual({ decision: 'approve_with_edit', text: 'ઘઉં', note: 'engine used the Hindi word' });
  });

  it('DEMANDS a reason on a rejection and refuses replacement text', () => {
    expect(() => assertReview({ decision: 'reject' })).toThrow(/say why it is wrong/);
    expect(() => assertReview({ decision: 'reject', text: 'ઘઉં', note: 'x'.repeat(20) }))
      .toThrow(/a rejection carries no replacement text/);
    expect(assertReview({ decision: 'reject', note: 'this is the Hindi word, not Gujarati' }))
      .toEqual({ decision: 'reject', text: null, note: 'this is the Hindi word, not Gujarati' });
  });

  it('refuses an invented decision', () => {
    expect([...REVIEW_DECISIONS]).toEqual(['approve', 'approve_with_edit', 'reject']);
    expect(isReviewDecision('maybe')).toBe(false);
    expect(() => assertReview({ decision: 'maybe' })).toThrow(/decision must be one of/);
  });

  it('respects the reason floor exactly', () => {
    expect(assertReview({ decision: 'reject', note: 'a'.repeat(MIN_REASON) }).note).toHaveLength(MIN_REASON);
    expect(() => assertReview({ decision: 'reject', note: 'a'.repeat(MIN_REASON - 1) })).toThrow(InvalidTranslationError);
  });
});

describe('THE LANGUAGE SCOPE — the control that cannot be clicked through', () => {
  it('permits a language the reviewer holds', () => {
    expect(() => assertReviewerScope('gu', ['hi', 'gu'])).not.toThrow();
    expect(() => assertReviewerScope('GU', ['gu'])).not.toThrow();
  });

  it('THROWS rather than returning false, so no caller can forget to check', () => {
    // a permission check that can be ignored is a permission check that will be
    expect(() => assertReviewerScope('ta', ['hi', 'gu'])).toThrow(ReviewerScopeError);
  });

  it('names the languages the reviewer DOES hold, because the commonest cause is the wrong queue', () => {
    // "forbidden" alone would send them to ask for a permission they already have
    try { assertReviewerScope('ta', ['hi', 'gu']); throw new Error('should have thrown'); }
    catch (e) {
      const res = (e as ReviewerScopeError).getResponse() as any;
      expect((e as ReviewerScopeError).getStatus()).toBe(403);
      expect(res.message).toContain('hi, gu');
      expect(res.message).toContain('not ta');
    }
  });

  it('says something useful to somebody who reviews NO language', () => {
    try { assertReviewerScope('ta', []); throw new Error('should have thrown'); }
    catch (e) {
      const res = (e as ReviewerScopeError).getResponse() as any;
      expect(res.message).toMatch(/cannot read the language cannot tell a correct translation from a fluent-sounding wrong one/);
    }
  });

  it('is a 403, not a 422 — the request was fine, the entitlement was not', () => {
    try { assertReviewerScope('ta', ['hi']); } catch (e) {
      expect((e as ReviewerScopeError).getStatus()).toBe(403);
      expect(((e as ReviewerScopeError).getResponse() as any).code).toBe('TRANSLATION_REVIEWER_SCOPE');
    }
  });
});

describe('assertReviewerGrant', () => {
  it('accepts a grant and normalises the language', () => {
    expect(assertReviewerGrant({ adminUserId: UUID, languageCode: 'GU' }))
      .toEqual({ adminUserId: UUID, languageCode: 'gu', note: null });
  });

  it('refuses a grant to nobody or for nothing', () => {
    expect(() => assertReviewerGrant({ adminUserId: 'pooja', languageCode: 'gu' })).toThrow(/must be a uuid/);
    expect(() => assertReviewerGrant({ adminUserId: UUID, languageCode: 'gujarati' })).toThrow(/language code/);
  });
});

describe('coverageMatrix — the number that must not mislead a founder', () => {
  const languages = ['hi', 'gu', 'ta'];

  it('computes a percentage against the KEY COUNT, per kind', () => {
    const m = coverageMatrix(
      [{ entityType: 'category', keys: 200 }],
      [{ entityType: 'category', languageCode: 'hi', translated: 200 },
       { entityType: 'category', languageCode: 'gu', translated: 100 }],
      languages,
    );
    expect(m[0].byLanguage).toEqual([
      { languageCode: 'hi', translated: 200, pct: 100 },
      { languageCode: 'gu', translated: 100, pct: 50 },
      // a language with no rows is 0% of a kind that HAS keys — a real, actionable zero
      { languageCode: 'ta', translated: 0, pct: 0 },
    ]);
  });

  it('returns NULL, not 0%, for a kind with NO KEYS', () => {
    // 0% next to a kind nobody has created yet is a criticism of nothing, and it would sit there red for ever
    const m = coverageMatrix([{ entityType: 'scheme', keys: 0 }], [], languages);
    expect(m[0].byLanguage.every((l) => l.pct === null)).toBe(true);
    expect(m[0].byLanguage.every((l) => l.translated === 0)).toBe(true);
  });

  it('rounds rather than truncating, so 199/200 is not 99%', () => {
    const m = coverageMatrix([{ entityType: 'category', keys: 200 }],
      [{ entityType: 'category', languageCode: 'hi', translated: 199 }], languages);
    expect(m[0].byLanguage[0].pct).toBe(100);
  });

  it('names the languages worth acting on, and stays silent about a kind with no keys', () => {
    const m = coverageMatrix(
      [{ entityType: 'category', keys: 200 }, { entityType: 'scheme', keys: 0 }],
      [{ entityType: 'category', languageCode: 'hi', translated: 200 }],
      languages,
    );
    expect(emptyLanguages(m[0])).toEqual(['gu', 'ta']);
    // no keys means the question does not apply, so there is nothing to act on
    expect(emptyLanguages(m[1])).toEqual([]);
  });
});
