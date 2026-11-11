// apps/web-admin/src/features/rtl/arrow.ts · PC-56 RTL-1g — the "from → to" arrow of a range or a transition, chosen by the page's
// writing direction. U+2192/U+2190 are NOT Unicode Bidi_Mirrored: inside a right-to-left run a bare "→" keeps pointing right while the
// range now reads right to left, so the arrow would point backwards. web-admin is ENGLISH-ONLY BY DESIGN (07_RTL Q3, lead's call: no
// `ar` catalogue, no switcher) and renders dir="ltr" only, so today every call returns "→" and every page is byte-identical; the glyph
// lives HERE, once, so a direction the realm ever gains flows through with no page edit. A plain string (not a CSS-flipped span like
// web-tenant's DirArrow) because three of the sites are template strings, a DataTable cell and an <option> label, where markup cannot go.
// No React, no IO → unit-tested (test/rtl-static.spec.ts pins that no other source carries the glyph).
import type { LanguageDir } from '@krishalaya/i18n';

/** The arrow that points from the first value of a range to the second in a `dir` page: "→" in ltr, "←" in rtl. */
export function rangeArrow(dir: LanguageDir): '→' | '←' {
  return dir === 'rtl' ? '←' : '→';
}
