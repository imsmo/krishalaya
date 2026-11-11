// apps/web-tenant/src/features/rtl/span.ts · PC-56 RTL-1b-2 — a plain-text span "a → b" that reads the page's way.
//
// WHY: U+2192 "→" is NOT Bidi_Mirrored, so a literal "a → b" built in code points the wrong way on an Arabic (rtl) page.
// The arrow is therefore COPY — the catalogue key `rtl.span` ('{from} → {to}' in en/hi/gu, '{from} ← {to}' in ar).
// Each end is a code, an ID or an ISO date: it is wrapped in LRI…PDI (U+2066 … U+2069) so it stays one left-to-right run
// AND counts as a neutral to the sentence around it. Without the isolates two Latin codes ("MCC-VNT ← MCC-BHE") would pull
// the arrow between them into a left-to-right run (UAX #9 rule N1) and the span would read backwards under rtl.
// On an ltr page (en/hi/gu) the isolates change nothing visible. Pure: no React, no I/O.
export interface SpanT { t(key: string, vars?: Record<string, string | number>): string }

export const LRI = '⁦';
export const PDI = '⁩';

/** One left-to-right run, isolated (a code, an ID, an ISO date). */
export function ltrRun(s: string): string { return `${LRI}${s}${PDI}`; }

/** "from → to" in the reader's direction: the arrow from the catalogue, each end isolated. */
export function spanText(t: SpanT, from: string, to: string): string {
  return t.t('rtl.span', { from: ltrRun(from), to: ltrRun(to) });
}
