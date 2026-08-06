// apps/admin-api/src/modules/translations/domain/translation.ts · the TRANSLATIONS plane's rules
// (PC-56 ADMIN-3b, canon W028). No I/O → unit-provable.
//
// WHAT A TRANSLATION IS, AND WHY THAT DECIDES EVERY RULE BELOW. It is not a label. It is the words a farmer reads when
// the platform tells them what they are buying, what their produce is called, or why their money did not arrive. If the
// Gujarati text says something other than the English text, the platform has misled somebody who cannot check.
//
// So the rules are not about string length. They are about WHO IS ENTITLED TO SAY A TRANSLATION IS CORRECT:
//
//   1. A MACHINE TRANSLATION IS A DRAFT. Never live on insert. The canon says so (W028) and until ADMIN-3b nothing
//      enforced it, because the read path had no predicate at all.
//   2. APPROVING IS LANGUAGE-SCOPED. A reviewer who cannot read Tamil cannot distinguish a correct Tamil translation
//      from a fluent-sounding wrong one, and fluent-sounding wrong is exactly what a machine produces. Holding
//      `translations.review` is necessary and NOT sufficient — the reviewer must hold that language.
//   3. NOBODY APPROVES THEIR OWN MACHINE DRAFT'S EDIT SILENTLY. Editing the text while approving is allowed and is
//      recorded as an edit, with the note, because "approved" and "rewrote and approved" are different facts.
//   4. A HUMAN TRANSLATION IS LIVE IMMEDIATELY. A person wrote it in a language they were trusted with; asking them to
//      then approve themselves is ceremony, and ceremony teaches people to click through.
import { InvalidTranslationError, ReviewerScopeError } from './translations.errors';

/* ------------------------------------------------------------------ entity kinds */

/**
 * The entity kinds a translation may describe. Closed on purpose: `translations.entity_type` is a free varchar, so this
 * list is the only thing standing between the table and a typo that silently orphans a row — `catagory` would insert
 * cleanly and never join to anything.
 *
 * The canon's W028 coverage matrix shows exactly the first four; `listing` and `insurance_claim` are here because the
 * codebase already reads them elsewhere and omitting them would make this module refuse rows the platform holds.
 */
export const TRANSLATABLE_ENTITIES = [
  'category', 'attribute', 'attribute_option', 'lookup_value', 'scheme', 'region', 'listing', 'insurance_claim',
] as const;
export type TranslatableEntity = (typeof TRANSLATABLE_ENTITIES)[number];
export function isTranslatableEntity(v: string): v is TranslatableEntity {
  return (TRANSLATABLE_ENTITIES as readonly string[]).includes(v);
}

/** The fields worth translating, per entity. `name` everywhere; `description` only where one exists. A `field` outside
 *  this set would join to nothing, which is the same orphan problem as a bad entity_type. */
const FIELDS_BY_ENTITY: Readonly<Record<TranslatableEntity, readonly string[]>> = Object.freeze({
  category: ['name', 'description'],
  attribute: ['name', 'help_text'],
  attribute_option: ['name'],
  lookup_value: ['name'],
  scheme: ['name', 'description', 'eligibility_summary'],
  region: ['name'],
  listing: ['title', 'description'],
  insurance_claim: ['status_note'],
});
export function fieldsFor(entity: TranslatableEntity): readonly string[] { return FIELDS_BY_ENTITY[entity]; }

/* ------------------------------------------------------------------ the text itself */

export const MIN_TEXT = 1;
export const MAX_TEXT = 4000;
export const MIN_REASON = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** BCP-47-ish, matching what `languages.code` holds (`hi`, `gu`, `bn-IN`). */
const LANG_RE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;

export interface TranslationInput {
  entityType: string; entityId: string; field: string; languageCode: string; text: string;
  isMachine?: boolean; source?: string | null;
}
export interface Translation {
  entityType: TranslatableEntity; entityId: string; field: string; languageCode: string; text: string;
  isMachine: boolean; source: string | null;
}

/**
 * Validate one translation.
 *
 * THE TEXT IS TRIMMED AND OTHERWISE UNTOUCHED. No normalising, no case correction, no whitespace collapsing inside the
 * string. Indic scripts use combining marks and zero-width joiners that a naive normaliser mangles — ક્ષ is not the same
 * as ક ્ ષ to a reader — and the platform is in no position to improve somebody's Gujarati.
 */
export function assertTranslation(input: TranslationInput): Translation {
  const entityType = String(input.entityType ?? '').trim();
  if (!isTranslatableEntity(entityType)) {
    throw new InvalidTranslationError(`entityType must be one of ${TRANSLATABLE_ENTITIES.join('|')}`);
  }
  const entityId = String(input.entityId ?? '').trim();
  if (!UUID_RE.test(entityId)) throw new InvalidTranslationError('entityId must be a uuid');

  const field = String(input.field ?? '').trim().toLowerCase();
  const allowed = fieldsFor(entityType);
  if (!allowed.includes(field)) {
    throw new InvalidTranslationError(`"${field}" is not a translatable field on a ${entityType} — allowed: ${allowed.join(', ')}`);
  }

  const languageCode = String(input.languageCode ?? '').trim().toLowerCase();
  if (!LANG_RE.test(languageCode)) throw new InvalidTranslationError('languageCode must be a language code such as hi or gu');

  const text = String(input.text ?? '').trim();
  if (text.length < MIN_TEXT) throw new InvalidTranslationError('the translation cannot be empty');
  if (text.length > MAX_TEXT) throw new InvalidTranslationError(`the translation must be at most ${MAX_TEXT} characters`);

  const isMachine = input.isMachine === true;
  const source = String(input.source ?? '').trim() || null;
  // 0103 CHECKs the same pair. Refused here so the message can say WHY rather than naming a constraint: "the AI said so"
  // is not a provenance, and six months from now somebody will need to know which engine produced a wrong word.
  if (isMachine && !source) {
    throw new InvalidTranslationError('a machine translation must name the engine that produced it — an unattributed machine translation cannot be audited');
  }
  if (!isMachine && source) {
    throw new InvalidTranslationError('source names a machine engine; a human translation is attributed by its author, not by a source');
  }
  if (source && source.length > 40) throw new InvalidTranslationError('source is too long');

  return { entityType, entityId, field, languageCode, text, isMachine, source };
}

/* ------------------------------------------------------------------ visibility */

export interface TranslationRow {
  id: string; entityType: string; entityId: string; field: string; languageCode: string; text: string;
  isMachine: boolean; source?: string | null;
  reviewedBy?: string | null; reviewedAt?: string | null; reviewNote?: string | null;
  createdAt?: string | null;
}

/**
 * Would a farmer see this row? THE SAME RULE apps/api's `servableTranslation()` enforces in SQL, expressed here so the
 * console can label a row honestly without a second round trip.
 *
 * Deliberately duplicated across the realms — and this is the one place in the program where I am duplicating a rule on
 * purpose, so the reasoning matters: the SQL version is the ENFORCEMENT and this one is a LABEL. A label that drifted
 * would mislead an operator; enforcement that drifted would mislead a farmer. They cannot be shared, because one is a
 * SQL fragment composed into an ON clause in another app and the other is a TypeScript predicate over a fetched row.
 * Both are tested against the same table of cases, in both apps, so a change to one fails the other's spec.
 */
export function isServable(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): boolean {
  if (!row.isMachine) return true;
  return !!row.reviewedAt;
}

/** A machine draft nobody has judged. The review queue's definition, and the count that means something. */
export function isAwaitingReview(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): boolean {
  return row.isMachine && !row.reviewedAt;
}

/** One sentence saying what a row IS, for a screen that must not let a draft read as live text. */
export function describeState(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt' | 'source'>): string {
  if (!row.isMachine) return 'Written by a person — live.';
  if (row.reviewedAt) return 'Machine translation, reviewed and accepted — live.';
  return `DRAFT from ${row.source ?? 'a machine'} — not shown to anybody until a reviewer who reads this language accepts it.`;
}

/* ------------------------------------------------------------------ review */

/** What a reviewer may CONCLUDE. Named verdicts, because "how many machine translations were actually wrong?" is the
 *  question that decides whether the engine is worth using. */
export const REVIEW_DECISIONS = ['approve', 'approve_with_edit', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export function isReviewDecision(v: string): v is ReviewDecision {
  return (REVIEW_DECISIONS as readonly string[]).includes(v);
}

export interface ReviewInput { decision: string; text?: string | null; note?: string | null }
export interface Review { decision: ReviewDecision; text: string | null; note: string | null }

/**
 * Validate a review.
 *
 * `approve_with_edit` REQUIRES the corrected text AND a note. Approving a machine draft after rewriting it is a
 * different fact from approving it as-is — the note is what tells the next person whether the engine is trustworthy for
 * this language, which is the only way anybody ever finds out.
 *
 * `reject` requires a note and NO text: a rejection that silently carried replacement text would be an approval wearing
 * the wrong label.
 */
export function assertReview(input: ReviewInput): Review {
  const decision = String(input.decision ?? '').trim();
  if (!isReviewDecision(decision)) {
    throw new InvalidTranslationError(`decision must be one of ${REVIEW_DECISIONS.join('|')}`);
  }
  const text = String(input.text ?? '').trim() || null;
  const note = String(input.note ?? '').trim() || null;

  if (decision === 'approve_with_edit') {
    if (!text) throw new InvalidTranslationError('approving with an edit needs the corrected text');
    if (text.length > MAX_TEXT) throw new InvalidTranslationError(`the translation must be at most ${MAX_TEXT} characters`);
    if (!note || note.length < MIN_REASON) {
      throw new InvalidTranslationError(
        `say what you changed, in at least ${MIN_REASON} characters — it is the only record of whether the engine is trustworthy in this language`);
    }
    return { decision, text, note };
  }
  if (decision === 'reject') {
    if (text) throw new InvalidTranslationError('a rejection carries no replacement text — approve with an edit instead');
    if (!note || note.length < MIN_REASON) {
      throw new InvalidTranslationError(`say why it is wrong, in at least ${MIN_REASON} characters`);
    }
    return { decision, text: null, note };
  }
  // plain approve: unchanged text, and a note is optional because "it was correct" needs no elaboration
  if (text) throw new InvalidTranslationError('a plain approval leaves the text as it is — use approve with an edit to change it');
  if (note && note.length > 2000) throw new InvalidTranslationError('note is too long');
  return { decision, text: null, note };
}

/* ------------------------------------------------------------------ reviewer scope */

/**
 * THE LANGUAGE-SCOPE CHECK. Holding `translations.review` is necessary and not sufficient.
 *
 * `scopes` is the reviewer's LIVE grants. Thrown rather than returned false so no caller can forget to check the boolean
 * — a permission check that can be ignored is a permission check that will be.
 */
export function assertReviewerScope(languageCode: string, scopes: readonly string[]): void {
  const lc = String(languageCode ?? '').trim().toLowerCase();
  const held = scopes.map((s) => String(s).trim().toLowerCase());
  if (!held.includes(lc)) {
    throw new ReviewerScopeError(lc, held);
  }
}

export interface ReviewerGrantInput { adminUserId: string; languageCode: string; note?: string | null }
export interface ReviewerGrant { adminUserId: string; languageCode: string; note: string | null }

export function assertReviewerGrant(input: ReviewerGrantInput): ReviewerGrant {
  const adminUserId = String(input.adminUserId ?? '').trim();
  if (!UUID_RE.test(adminUserId)) throw new InvalidTranslationError('adminUserId must be a uuid');
  const languageCode = String(input.languageCode ?? '').trim().toLowerCase();
  if (!LANG_RE.test(languageCode)) throw new InvalidTranslationError('languageCode must be a language code such as hi or gu');
  const note = String(input.note ?? '').trim() || null;
  if (note && note.length > 2000) throw new InvalidTranslationError('note is too long');
  return { adminUserId, languageCode, note };
}

/* ------------------------------------------------------------------ coverage */

export interface CoverageCell { entityType: string; languageCode: string; translated: number }

/**
 * The W028 matrix: a percentage per (entity kind, language), computed against the number of KEYS that kind actually has.
 *
 * `null` WHEN THERE IS NOTHING TO TRANSLATE. An entity kind with no rows is not 0% translated — it is not applicable, and
 * showing 0% would put a red cell next to a kind nobody has created yet, which is a criticism of nothing.
 */
export function coverageMatrix(
  keyCounts: ReadonlyArray<{ entityType: string; keys: number }>,
  cells: readonly CoverageCell[],
  languages: readonly string[],
): Array<{ entityType: string; keys: number; byLanguage: Array<{ languageCode: string; translated: number; pct: number | null }> }> {
  const byPair = new Map(cells.map((c) => [`${c.entityType}|${c.languageCode}`, c.translated]));
  return keyCounts.map(({ entityType, keys }) => ({
    entityType,
    keys,
    byLanguage: languages.map((languageCode) => {
      const translated = byPair.get(`${entityType}|${languageCode}`) ?? 0;
      return {
        languageCode,
        translated,
        // unknown ≠ zero: no keys means the question does not apply
        pct: keys > 0 ? Math.round((translated / keys) * 100) : null,
      };
    }),
  }));
}

/** Languages with NO translations at all for a kind that HAS keys — the gaps worth acting on, as opposed to cells that
 *  are merely low. */
export function emptyLanguages(
  row: { keys: number; byLanguage: ReadonlyArray<{ languageCode: string; translated: number }> },
): string[] {
  if (row.keys <= 0) return [];
  return row.byLanguage.filter((l) => l.translated === 0).map((l) => l.languageCode);
}
