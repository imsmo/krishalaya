// core/http/query-boolean.ts · PC-56 HOTFIX-6 · B6 (survey STORE-4 F-10 / B13 / E3) — THE ONE STRICT QUERY-STRING BOOLEAN.
//
// `z.coerce.boolean()` is `Boolean(value)`, and every non-empty string is truthy — so `?unreadOnly=false` meant TRUE (the storefront's "All"
// tab listed unread only) and `?archived=false` meant the archive. This parser says what the string says and refuses anything else:
//   'true' | '1'  → true
//   'false' | '0' → false
//   anything else (including '', 'yes', 'maybe') → refused by the schema (the house validation answer, 422 VALIDATION_FAILED) — never guessed.
// A real boolean (an internal caller) passes through. Applied to `query-notification.dto.ts` `unreadOnly` and `query-conversation.dto.ts`
// `archived`; the other `z.coerce.boolean()` query sites are listed in the HOTFIX-6 report and owed by name (not widened here).
import { z } from 'zod';

export const QUERY_BOOLEAN_TRUE: readonly string[] = Object.freeze(['true', '1']);
export const QUERY_BOOLEAN_FALSE: readonly string[] = Object.freeze(['false', '0']);

/** PURE: the strict reading of one query value — `true` / `false`, or `null` when the value is not one of the four spellings. */
export function parseQueryBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  if (QUERY_BOOLEAN_TRUE.includes(v)) return true;
  if (QUERY_BOOLEAN_FALSE.includes(v)) return false;
  return null;
}

/** The zod field: a strict query boolean (refuses an unknown spelling). Chain `.optional()` / `.default(false)` as needed. */
export const queryBoolean = () =>
  z.preprocess((v) => {
    if (v === undefined) return undefined;
    const b = parseQueryBoolean(v);
    return b === null ? v : b;   // an unknown spelling stays a string → z.boolean() refuses it
  }, z.boolean());
