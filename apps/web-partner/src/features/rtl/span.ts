// apps/web-partner/src/features/rtl/span.ts · PC-56 RTL-1d (web-tenant's RTL-1b-2 helper / the storefront's RTL-1c one, adapted) — one
// left-to-right run, isolated.
//
// WHY: inside a right-to-left (Arabic) sentence a left-to-right run such as "₹1,23,456.50", "LN-2026-000417", a policy number, a phone number
// or a file name is split at its neutral characters (`, . / - • space`) and reordered. Wrapping it in LRI…PDI (U+2066 … U+2069) keeps it ONE
// left-to-right run AND makes it count as a single neutral to the sentence around it (UAX #9 isolates). The partner console adds them ONLY
// under a preview (rtl) language, so en/hi/gu text stays byte-identical. Pure: no React, no I/O.
import { PREVIEW_LANGUAGES } from '@krishalaya/i18n';

export const LRI = '⁦';
export const PDI = '⁩';

/** One left-to-right run, isolated (always). */
export function ltrRun(s: string): string { return `${LRI}${s}${PDI}`; }

/** A code, reference, phone number, token or file name shown inside a sentence: isolated under a preview (rtl) language, untouched otherwise. */
export function ltrText(s: string, lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(s) : s;
}
