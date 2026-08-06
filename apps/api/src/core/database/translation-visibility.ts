// core/database/translation-visibility.ts · WHICH TRANSLATIONS MAY REACH A FARMER (PC-56 ADMIN-3b).
//
// THE RULE, from the canon's W028: "Machine translations (is_machine) require human review before farmer-facing surfaces
// show them."
//
// Until ADMIN-3b this rule was written down and not enforced anywhere. Every read of `translations` in the monorepo — the
// lookups service's two queries and the payout repository's one — LEFT JOINed the table with no predicate at all, which
// meant two bugs waiting for the first write:
//
//   1. AN UNREVIEWED MACHINE TRANSLATION WOULD BE SERVED IMMEDIATELY. The moment ADMIN-3b's write path inserted a
//      machine draft, a farmer would see raw AI text presented as the platform's own words. The feature meant to honour
//      the rule would have broken it on its first day.
//   2. A SOFT-DELETED TRANSLATION WAS STILL SERVED. `deleted_at` was not filtered, so revoking a bad translation would
//      not have revoked it.
//
// THIS CONSTANT IS THE FIX, AND IT LIVES IN ONE PLACE ON PURPOSE. Three call sites need the same predicate; three copies
// is how one of them misses the next correction. It is a SQL fragment rather than a function because it has to be
// composable into an ON clause, and it takes no parameters — the rule does not vary by caller.
//
// Matched by `idx_translation_servable` (migration 0103), whose partial WHERE is deliberately the same expression.

/**
 * The predicate every farmer-facing translation read must carry, as an AND-able fragment.
 *
 * A HUMAN-AUTHORED row is live on insert: a person wrote it, and requiring them to also approve their own work would be
 * ceremony. A MACHINE-AUTHORED row is a DRAFT until somebody who can read that language has accepted it.
 *
 * Alias-parameterised because the joins use different table aliases (`t` in two places today).
 */
export function servableTranslation(alias = 't'): string {
  return `${alias}.deleted_at IS NULL AND (${alias}.is_machine = false OR ${alias}.reviewed_at IS NOT NULL)`;
}

/** The same rule as a sentence, for a payload or a log line that has to explain why a name came back in English. */
export const TRANSLATION_VISIBILITY_NOTE =
  'A translation is served only when a human wrote it, or when a machine translation has been reviewed by somebody scoped to that language. An unreviewed machine draft never reaches a farmer.';
