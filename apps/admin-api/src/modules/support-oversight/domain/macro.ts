// apps/admin-api/src/modules/support-oversight/domain/macro.ts · pure rules for a SUPPORT MACRO (PC-56 ADMIN-2,
// canon W053; tables in migration 0096). No I/O → unit-provable.
//
// A macro is a promise the platform makes repeatedly. The rules below all protect one property: an agent inserting
// `/payout-verify-wait` must get the same commitment every time, in the farmer's own language.
import { InvalidMacroError } from './support-oversight.errors';

/** The languages the platform is LIVE in (DEV-21: hi/en/gu live; eleven more are machine-draft-pending-review). A
 *  macro may only carry a live language — a Marathi body nobody has reviewed would be pasted to a farmer as if it had
 *  been. When a language goes live, it is added here and macros can be extended. */
export const MACRO_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type MacroLanguage = (typeof MACRO_LANGUAGES)[number];
export function isMacroLanguage(v: string): v is MacroLanguage {
  return (MACRO_LANGUAGES as readonly string[]).includes(v);
}

/** EN is mandatory. It is the language every agent reads, the fallback the Translator uses, and the version a reviewer
 *  checks the others against — a macro that existed only in Hindi could not be reviewed by most of the desk. */
export const REQUIRED_LANGUAGE: MacroLanguage = 'en';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The typed shortcut, without its leading slash. Lower-case and hyphenated because an agent types it mid-sentence and
 *  must be able to predict it; a slug with spaces or capitals is a slug nobody can use at speed. */
export function assertSlug(raw: string): string {
  const s = raw.trim().replace(/^\/+/, '').toLowerCase();
  if (s.length < 3 || s.length > 60) throw new InvalidMacroError('the shortcut must be 3–60 characters');
  if (!SLUG_RE.test(s)) throw new InvalidMacroError('the shortcut may contain only lower-case letters, digits and single hyphens');
  return s;
}

export interface MacroBodyInput { languageCode: string; body: string }

/**
 * Validate the bodies.
 *
 * A body has a MINIMUM length because a two-word macro is not a canned answer, it is a fragment that an agent will
 * have to finish differently every time — which is the inconsistency macros exist to remove. It also has a maximum:
 * past a few paragraphs nobody reads it, and a wall of text pasted into a WhatsApp reply is worse than no reply.
 */
export const MIN_BODY = 20;
export const MAX_BODY = 4000;

export function assertBodies(raw: readonly MacroBodyInput[]): Array<{ languageCode: MacroLanguage; body: string }> {
  const seen = new Set<string>();
  const out: Array<{ languageCode: MacroLanguage; body: string }> = [];
  for (const b of raw) {
    const lang = b.languageCode.trim().toLowerCase();
    if (!isMacroLanguage(lang)) {
      throw new InvalidMacroError(`${lang || '(blank)'} is not a live language; macros may be written in ${MACRO_LANGUAGES.join(', ')}`);
    }
    if (seen.has(lang)) throw new InvalidMacroError(`two bodies given for ${lang}`);
    seen.add(lang);
    const body = b.body.trim();
    if (body.length < MIN_BODY) throw new InvalidMacroError(`the ${lang} body is too short to be a canned answer (min ${MIN_BODY} characters)`);
    if (body.length > MAX_BODY) throw new InvalidMacroError(`the ${lang} body is too long (max ${MAX_BODY} characters)`);
    out.push({ languageCode: lang, body });
  }
  if (!seen.has(REQUIRED_LANGUAGE)) {
    throw new InvalidMacroError(`an ${REQUIRED_LANGUAGE} body is required — it is what the desk reviews the other languages against`);
  }
  return out.sort((a, b) => (a.languageCode < b.languageCode ? -1 : 1));
}

/** Which live languages a macro is MISSING. Surfaced in the list, because a macro that exists only in English will be
 *  pasted in English to a Gujarati farmer — and the gap is invisible unless something names it. */
export function missingLanguages(present: readonly string[]): MacroLanguage[] {
  const have = new Set(present.map((p) => p.toLowerCase()));
  return MACRO_LANGUAGES.filter((l) => !have.has(l));
}

/** CSAT-after-use as a share of 5, in basis points, or null. NEVER 0 for "no ratings": a macro used twenty times with
 *  no ratings is a different fact from one that upset everybody, and 0% would read as the second. */
export function csatAfterUseBps(avgScore: number | null): number | null {
  if (avgScore === null || !Number.isFinite(avgScore) || avgScore <= 0) return null;
  return Math.round((avgScore / 5) * 10000);
}
