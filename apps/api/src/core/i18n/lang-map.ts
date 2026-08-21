// core/i18n/lang-map.ts · PC-56 TENANT-6d-7 · A VALUE THAT KNOWS IT HAS TO BE READ BY SOMEBODY.
//
// This platform ships three launch languages and its notification copy exists three times over — but a domain event's
// payload exists ONCE and is rendered for every recipient. So an event that puts `shift: 'evening'` into its payload
// has already decided that a Gujarati template will contain an English word, and no amount of care in the copy can
// undo it. TENANT-6b-1's SMS body reads *"{{mcc}} માં {{shift}} નું તમારું દૂધ..."* and the word that landed in it
// was `evening`.
//
// A `LangMap` is the payload's answer: one value, every language, chosen at RENDER time by the template's own
// language (see `NotificationTemplate.render`). It is deliberately NOT a translation service — a caller must supply
// all three strings, from the database (`ui_messages`, `translations`, `lookup_values`), because Law 6 says a word a
// tenant may want to change is data, not a literal in a service.
export const PLATFORM_LANGS = ['en', 'hi', 'gu'] as const;
export type PlatformLang = (typeof PLATFORM_LANGS)[number];

/** A word in every language this platform sends in. `en` is required — it is the fallback of last resort. */
export interface LangMap { en: string; hi?: string; gu?: string; [lang: string]: string | undefined; }

/** Is this payload value a per-language map rather than a plain value? Shape-checked, never type-asserted. */
export function isLangMap(v: unknown): v is LangMap {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.en !== 'string') return false;                                  // `en` is what makes it a LangMap
  return Object.values(o).every((x) => x === undefined || typeof x === 'string');
}

/**
 * The word for one language, falling back to English.
 *
 * A MISSING TRANSLATION IS NOT AN ERROR AND NOT A BLANK: a cooperative reading Gujarati who meets a word the platform
 * only has in English should see the English word, not an empty space where the meaning was. The fallback is
 * countable at the call site that cares (the notification spine counts `comm.language_fallback`).
 */
export function pickLang(m: LangMap, lang: string): string {
  const exact = m[lang];
  if (typeof exact === 'string' && exact.length > 0) return exact;
  const base = lang.split('-')[0];                                             // 'gu-IN' reads the 'gu' copy
  const b = m[base];
  if (typeof b === 'string' && b.length > 0) return b;
  return m.en;
}

/**
 * Build a LangMap from rows the database gave us, with English REQUIRED.
 *
 * Fail-closed on a missing English row rather than silently emitting an empty string: an undeclared label is a copy
 * defect somebody must fix, and this programme has now spent two waves on values that rendered as nothing.
 */
export function langMapFrom(rows: ReadonlyMap<string, string>, what: string): LangMap {
  const en = rows.get('en');
  if (!en) throw new Error(`i18n: no English text for ${what} — a notice cannot be worded from nothing`);
  const out: LangMap = { en };
  for (const l of PLATFORM_LANGS) { const t = rows.get(l); if (t) out[l] = t; }
  return out;
}
