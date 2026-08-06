// apps/web-admin/src/test/admin3b-translations.spec.ts · PC-56 ADMIN-3b, console side.
//
// THE THIRD COPY OF ONE RULE, and the duplication is deliberate: apps/api's SQL ENFORCES what a farmer sees, admin-api's
// domain LABELS it for an API consumer, and this one LABELS it on screen. They cannot be shared — a SQL fragment, a
// server predicate and a browser predicate — so all three are asserted against the SAME four cases, in three specs. A
// change to any one of them fails the other two.
//
// The rest of this file is about not letting a draft read as live, and not letting "no keys" read as 0%.
import {
  REVIEW_DECISIONS, TRANSLATABLE_ENTITIES, MIN_REASON, MAX_TEXT,
  isServable, isAwaitingReview, stateClass, stateKey, coverageClass, pctText, canReview, totalPending,
  buildTranslation, buildReview, buildGrant, buildRun,
  TAXONOMY_REPORTS, reportNeedsLanguage, buildTaxonomyExport, taxonomyExportFileName,
  MAX_EXPORT_ROWS, DEFAULT_EXPORT_ROWS,
  type TranslationRow,
} from '../features/catalogue/translations';

const UUID = '11111111-1111-4111-8111-111111111111';
const REASON = 'a real reason for the audit trail';
const bag = (o: Record<string, string>) => (n: string) => o[n] ?? '';
const multi = (o: Record<string, string[]>) => (n: string) => o[n] ?? [];

const row = (over: Partial<TranslationRow> = {}): TranslationRow => ({
  id: 'tr1', entityType: 'category', entityId: UUID, field: 'name', languageCode: 'gu',
  text: 'ઘઉં', isMachine: false, createdAt: '2026-08-06T00:00:00.000Z', ...over,
});

describe('THE SERVABLE RULE — the third copy, same four cases', () => {
  it.each([
    [false, null, true],
    [false, '2026-01-01T00:00:00.000Z', true],
    [true, null, false],
    [true, '2026-01-01T00:00:00.000Z', true],
  ])('isMachine=%s reviewedAt=%s → servable=%s', (isMachine, reviewedAt, expected) => {
    expect(isServable({ isMachine: isMachine as boolean, reviewedAt: reviewedAt as string | null })).toBe(expected);
  });

  it('treats an AMBIGUOUS row as human rather than as an unreviewed draft', () => {
    // a payload from an older API with no isMachine flag: the row exists, so somebody put it there, and the servable
    // default must not hide real text. The draft path requires isMachine to be explicitly true.
    expect(isServable({ isMachine: undefined as any, reviewedAt: null })).toBe(true);
  });

  it('identifies exactly the queue\'s rows', () => {
    expect(isAwaitingReview({ isMachine: true, reviewedAt: null })).toBe(true);
    expect(isAwaitingReview({ isMachine: true, reviewedAt: '2026-01-01' })).toBe(false);
    expect(isAwaitingReview({ isMachine: false, reviewedAt: null })).toBe(false);
  });

  it('styles a DRAFT amber — not green, and not red either', () => {
    // it is not live and it is not an error; the distinction is the whole point of the screen
    expect(stateClass({ isMachine: true, reviewedAt: null })).toBe('kv-status--warn');
    expect(stateClass({ isMachine: true, reviewedAt: '2026-01-01' })).toBe('kv-status--ok');
    expect(stateClass({ isMachine: false, reviewedAt: null })).toBe('kv-status--ok');
  });

  it('names the three states distinctly', () => {
    expect(stateKey({ isMachine: false, reviewedAt: null })).toBe('human');
    expect(stateKey({ isMachine: true, reviewedAt: null })).toBe('draft');
    expect(stateKey({ isMachine: true, reviewedAt: '2026-01-01' })).toBe('reviewed');
  });
});

describe('coverage must not mislead', () => {
  it('styles NULL — no keys — as neutral, never as a failure', () => {
    // a red cell beside a kind nobody has created yet is a criticism of nothing, and it sits there for ever
    expect(coverageClass(null)).toBe('kv-status--muted');
    expect(coverageClass(0)).toBe('kv-status--danger');
    expect(coverageClass(39)).toBe('kv-status--danger');
    expect(coverageClass(40)).toBe('kv-status--warn');
    expect(coverageClass(89)).toBe('kv-status--warn');
    expect(coverageClass(90)).toBe('kv-status--ok');
    expect(coverageClass(100)).toBe('kv-status--ok');
  });

  it('renders NO percentage at all for a kind with no keys', () => {
    expect(pctText(null)).toBeNull();
    // and 0 is a real, actionable zero — not the same thing
    expect(pctText(0)).toBe('0%');
    expect(pctText(58)).toBe('58%');
  });

  it('totals the pending drafts across languages', () => {
    expect(totalPending([{ pending: 3218 }, { pending: 40 }])).toBe(3258);
    expect(totalPending([])).toBe(0);
  });
});

describe('canReview — a row in another language offers no form', () => {
  it('trusts the server\'s own flag when present', () => {
    expect(canReview(row({ reviewableByYou: true }), [])).toBe(true);
    expect(canReview(row({ reviewableByYou: false }), ['gu'])).toBe(false);
  });

  it('falls back to the caller\'s scopes', () => {
    expect(canReview(row({ languageCode: 'gu' }), ['hi', 'gu'])).toBe(true);
    expect(canReview(row({ languageCode: 'ta' }), ['hi', 'gu'])).toBe(false);
    expect(canReview(row({ languageCode: 'gu' }), [])).toBe(false);
  });
});

describe('buildTranslation', () => {
  const base = { entityType: 'category', entityId: UUID, field: 'name', languageCode: 'gu', text: 'ઘઉં', reason: REASON };

  it('accepts a translation and leaves the SCRIPT untouched', () => {
    // Indic combining marks are meaning, not noise — ક્ષ is not ક ્ ષ to a reader
    const r = buildTranslation(bag({ ...base, text: '  ક્ષેત્ર  ' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe('ક્ષેત્ર');
  });

  it('refuses an unlisted kind, a bad id, a bad language and an empty text', () => {
    expect([...TRANSLABLE_OR(TRANSLATABLE_ENTITIES)]).toContain('category');
    expect(buildTranslation(bag({ ...base, entityType: 'catagory' }))).toEqual({ ok: false, error: 'entityType' });
    expect(buildTranslation(bag({ ...base, entityId: 'wheat' }))).toEqual({ ok: false, error: 'entityId' });
    expect(buildTranslation(bag({ ...base, languageCode: 'gujarati' }))).toEqual({ ok: false, error: 'language' });
    expect(buildTranslation(bag({ ...base, text: '   ' }))).toEqual({ ok: false, error: 'text' });
    expect(buildTranslation(bag({ ...base, text: 'x'.repeat(MAX_TEXT + 1) }))).toEqual({ ok: false, error: 'textLong' });
    expect(buildTranslation(bag({ ...base, reason: 'fix' }))).toEqual({ ok: false, error: 'reason' });
  });
});

/** Tiny helper so the entity list is referenced without an unused-import lint error. */
function TRANSLABLE_OR<T>(v: readonly T[]): readonly T[] { return v; }

describe('buildReview — the three decisions are three different acts', () => {
  it('accepts a plain approval with nothing else', () => {
    expect(buildReview(bag({ decision: 'approve' }))).toEqual({ ok: true, value: { decision: 'approve' } });
  });

  it('carries an optional note on a plain approval', () => {
    const r = buildReview(bag({ decision: 'approve', note: 'checked against the ICAR glossary' }));
    expect(r.ok && r.value.note).toBe('checked against the ICAR glossary');
  });

  it('refuses replacement text on a PLAIN approval', () => {
    expect(buildReview(bag({ decision: 'approve', text: 'ઘઉં' }))).toEqual({ ok: false, error: 'approveText' });
  });

  it('DEMANDS text and a note when approving with an edit', () => {
    expect(buildReview(bag({ decision: 'approve_with_edit', note: 'x'.repeat(20) }))).toEqual({ ok: false, error: 'editText' });
    expect(buildReview(bag({ decision: 'approve_with_edit', text: 'ઘઉં' }))).toEqual({ ok: false, error: 'editNote' });
    expect(buildReview(bag({ decision: 'approve_with_edit', text: 'ઘઉં', note: 'short' }))).toEqual({ ok: false, error: 'editNote' });
    const r = buildReview(bag({ decision: 'approve_with_edit', text: 'ઘઉં', note: 'engine used the Hindi word' }));
    expect(r).toEqual({ ok: true, value: { decision: 'approve_with_edit', text: 'ઘઉં', note: 'engine used the Hindi word' } });
  });

  it('DEMANDS a note on a rejection and REFUSES replacement text', () => {
    // a rejection carrying text would be an approval wearing the wrong label
    expect(buildReview(bag({ decision: 'reject' }))).toEqual({ ok: false, error: 'rejectNote' });
    expect(buildReview(bag({ decision: 'reject', text: 'ઘઉં', note: 'x'.repeat(20) }))).toEqual({ ok: false, error: 'rejectText' });
    expect(buildReview(bag({ decision: 'reject', note: 'this is Hindi, not Gujarati' })))
      .toEqual({ ok: true, value: { decision: 'reject', note: 'this is Hindi, not Gujarati' } });
  });

  it('refuses an invented decision', () => {
    expect([...REVIEW_DECISIONS]).toEqual(['approve', 'approve_with_edit', 'reject']);
    expect(buildReview(bag({ decision: 'maybe' }))).toEqual({ ok: false, error: 'decision' });
  });

  it('respects the note floor exactly', () => {
    expect(buildReview(bag({ decision: 'reject', note: 'a'.repeat(MIN_REASON) })).ok).toBe(true);
    expect(buildReview(bag({ decision: 'reject', note: 'a'.repeat(MIN_REASON - 1) }))).toEqual({ ok: false, error: 'rejectNote' });
  });
});

describe('buildGrant and buildRun', () => {
  it('builds a grant and normalises the language', () => {
    const r = buildGrant(bag({ adminUserId: UUID, languageCode: 'GU', reason: REASON }));
    expect(r.ok && r.value).toEqual({ adminUserId: UUID, languageCode: 'gu', reason: REASON });
  });

  it('omits an empty note rather than sending an empty string', () => {
    const r = buildGrant(bag({ adminUserId: UUID, languageCode: 'gu', note: '  ', reason: REASON }));
    expect(r.ok && 'note' in r.value).toBe(false);
  });

  it('refuses a grant to nobody or for nothing', () => {
    expect(buildGrant(bag({ adminUserId: 'pooja', languageCode: 'gu', reason: REASON }))).toEqual({ ok: false, error: 'adminUserId' });
    expect(buildGrant(bag({ adminUserId: UUID, languageCode: 'gujarati', reason: REASON }))).toEqual({ ok: false, error: 'language' });
  });

  it('builds a run, de-duplicating languages and dropping unlisted kinds', () => {
    const r = buildRun(bag({ reason: REASON }), multi({
      entityTypes: ['category', 'attribute', 'catagory'], languageCodes: ['gu', 'GU', 'hi'],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entityTypes).toEqual(['category', 'attribute']);
    expect(r.value.languageCodes).toEqual(['gu', 'hi']);
  });

  it('refuses an empty or absurd run', () => {
    expect(buildRun(bag({ reason: REASON }), multi({ entityTypes: [], languageCodes: ['gu'] })))
      .toEqual({ ok: false, error: 'entityTypes' });
    expect(buildRun(bag({ reason: REASON }), multi({ entityTypes: ['category'], languageCodes: [] })))
      .toEqual({ ok: false, error: 'languages' });
    const many = Array.from({ length: 15 }, (_, i) => `l${i}`);
    expect(buildRun(bag({ reason: REASON }), multi({ entityTypes: ['category'], languageCodes: many })))
      .toEqual({ ok: false, error: 'tooManyLanguages' });
  });
});

describe('the taxonomy export', () => {
  it('lists the four reports and knows which needs a language', () => {
    expect([...TAXONOMY_REPORTS]).toEqual(['category_tree', 'attributes', 'lookup_values', 'missing_translations']);
    expect(reportNeedsLanguage('missing_translations')).toBe(true);
    expect(reportNeedsLanguage('category_tree')).toBe(false);
  });

  it('DEMANDS a language for missing-translations — "missing" means nothing otherwise', () => {
    expect(buildTaxonomyExport({ report: 'missing_translations' })).toEqual({ ok: false, error: 'exportLanguage' });
    expect(buildTaxonomyExport({ report: 'missing_translations', languageCode: 'gujarati' })).toEqual({ ok: false, error: 'exportLanguage' });
    expect(buildTaxonomyExport({ report: 'missing_translations', languageCode: 'gu' }))
      .toMatchObject({ ok: true, value: { languageCode: 'gu' } });
  });

  it('DROPS a language a report cannot use rather than sending it', () => {
    // silently applying it would produce a file that does not match what was asked for
    const r = buildTaxonomyExport({ report: 'category_tree', languageCode: 'gu' });
    expect(r.ok && 'languageCode' in r.value).toBe(false);
  });

  it('CLAMPS an over-large limit to the maximum, not to the default', () => {
    expect(buildTaxonomyExport({ report: 'category_tree', limit: '999999' }))
      .toMatchObject({ ok: true, value: { limit: MAX_EXPORT_ROWS } });
    expect(buildTaxonomyExport({ report: 'category_tree', limit: '0' })).toMatchObject({ ok: true, value: { limit: 1 } });
    expect(buildTaxonomyExport({ report: 'category_tree' })).toMatchObject({ ok: true, value: { limit: DEFAULT_EXPORT_ROWS } });
    expect(buildTaxonomyExport({ report: 'category_tree', limit: 'all' })).toEqual({ ok: false, error: 'limit' });
  });

  it('refuses an unknown report', () => {
    expect(buildTaxonomyExport({ report: 'everything' })).toEqual({ ok: false, error: 'report' });
  });

  it('builds a filename that carries the language when there is one', () => {
    expect(taxonomyExportFileName('missing_translations', '9f1c2b7a-1111-4222-8333-444455556666', '2026-08-06T00:00:00.000Z', 'gu'))
      .toBe('krishalaya-taxonomy-missing_translations-gu-2026-08-06-9f1c2b7a.csv');
    expect(taxonomyExportFileName('category_tree', '9f1c2b7a-1111', '2026-08-06T00:00:00.000Z'))
      .toBe('krishalaya-taxonomy-category_tree-2026-08-06-9f1c2b7a.csv');
  });
});
