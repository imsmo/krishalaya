// apps/mobile/src/core/i18n/bidi.ts · PC-56 RTL-1h-2 — text that must read the right way under a right-to-left language.
//
// THE one place in the app that holds a directional glyph (→ ← › ‹) or builds an isolate. rtl1h2-money-dates-arrows.spec pins it:
// no string, JSX text or template piece anywhere else under src/ may carry one of those four glyphs (checked by the TypeScript
// parser, not a grep).
//
//   • en/hi/gu (ltr): every helper returns EXACTLY what the screens printed before — `→`, `←`, `›`, `‹`, "a → b", the code as
//     given. Byte-identical, no marks.
//   • a right-to-left language (ar, chosen explicitly): "forward" points left and "back" points right.
//       – Arrows (U+2192/U+2190) are NOT Bidi_Mirrored, so the opposite arrow is printed as it is.
//       – Chevrons (U+203A/U+2039) ARE Bidi_Mirrored: a text engine that resolves a lone chevron as right-to-left would flip it
//         again (and one that resolves it left-to-right would not), so the swapped chevron is wrapped in LRI…PDI. Inside a
//         left-to-right isolate it is never mirrored, so it points the same way on every engine.
//       – Codes, IDs, phone numbers and the two ends of a "from → to" span are wrapped in LRI…PDI (U+2066 … U+2069): one
//         left-to-right run that counts as a single neutral in the Arabic sentence around it (UAX #9 isolates; RN `Text` has no
//         `<bdi>`, so the marks are the only tool — the web-tenant `ltrRun` pattern).
// Pure: no React Native, no I/O — unit-tested under the core project.
import { PREVIEW_LANGUAGES, getRegistryEntry } from '@krishalaya/i18n';

export const LRI = '\u2066';
export const PDI = '\u2069';

/** True only for a right-to-left PREVIEW language — one the app serves only after a person chose it (Arabic). en/hi/gu, any other
 *  registered code (e.g. Urdu, not servable) and any unknown code → false. Reads the registry, never the runtime: the code passed is
 *  already the app's active language (the choice itself is enforced in languageChoice.ts / i18n.ts). */
export function isRtl(lang: string): boolean {
  return PREVIEW_LANGUAGES.includes(lang) && getRegistryEntry(lang)?.dir === 'rtl';
}

/** One left-to-right run, isolated. */
export function ltrRun(s: string): string { return `${LRI}${s}${PDI}`; }

/** A code, ID, phone number or reference inside a sentence: isolated under rtl, untouched under ltr. Never use it on a value that
 *  is sent to the server (a form value, a ticket subject) — the marks are for the screen only. */
export function isolate(s: string, lang: string): string { return isRtl(lang) ? ltrRun(s) : s; }

/** "Go on" arrow: → under ltr, ← under rtl. */
export function arrowFwd(lang: string): string { return isRtl(lang) ? '\u2190' : '\u2192'; }
/** "Go back" arrow (a pager's previous): ← under ltr, → under rtl. */
export function arrowBack(lang: string): string { return isRtl(lang) ? '\u2192' : '\u2190'; }
/** A row's "opens" chevron: › under ltr, an isolated ‹ under rtl. */
export function chevFwd(lang: string): string { return isRtl(lang) ? ltrRun('\u2039') : '\u203A'; }
/** A pager's "previous" chevron: ‹ under ltr, an isolated › under rtl. */
export function chevBack(lang: string): string { return isRtl(lang) ? ltrRun('\u203A') : '\u2039'; }

/** "from → to" in the reader's direction: exactly `${from} \u2192 ${to}` under ltr; each end isolated and the arrow reversed under rtl
 *  (without the isolates two Latin/ISO ends would pull the arrow into a left-to-right run and the span would read backwards). */
export function spanText(from: string, to: string, lang: string): string {
  return isRtl(lang) ? `${ltrRun(from)} \u2190 ${ltrRun(to)}` : `${from} \u2192 ${to}`;
}
