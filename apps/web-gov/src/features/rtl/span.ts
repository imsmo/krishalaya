// apps/web-gov/src/features/rtl/span.ts · PC-56 RTL-1f (web-tenant's RTL-1b-2 helper / web-ops's RTL-1e one, adapted) — one left-to-right
// run, isolated.
//
// WHY: inside a right-to-left (Arabic) sentence or table cell a left-to-right run such as a masked phone "••••••318", a scheme code, an
// application number or an instant "2026-11-10 06:30 UTC" is split at its neutral characters (`• - : space ( )`) and reordered. Wrapping it in
// LRI…PDI (U+2066 … U+2069) keeps it ONE left-to-right run AND makes it count as a single neutral to the text around it (UAX #9 isolates).
// The gov console adds them ONLY under a preview (rtl) language, so en/hi/gu text stays byte-identical. Pure: no React, no I/O.
//
// The gov console prints NO money (the gov realm reads no amount — survey_rtl1 G-5: 0 `formatMoneyMinor`), so it has no money helper;
// test/rtl-static.spec.ts pins that 0.
import { PREVIEW_LANGUAGES } from '@krishalaya/i18n';

export const LRI = '⁦';
export const PDI = '⁩';

/** One left-to-right run, isolated (always). */
export function ltrRun(s: string): string { return `${LRI}${s}${PDI}`; }

/** A code, number, masked phone or instant shown inside a sentence or cell: isolated under a preview (rtl) language, untouched otherwise. */
export function ltrText(s: string, lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(s) : s;
}

/** The same, for a value that may be absent (an instant `atUtc` could not read): null stays null, so the caller's dash is unchanged. */
export function ltrOrNull(s: string | null, lang: string): string | null {
  return s === null ? null : ltrText(s, lang);
}
