// apps/web-tenant/src/components/DirArrow.tsx · PC-56 TENANT-CLOSE · RTL spot-check.
//
// The "from → to" arrow of a range (effective dates, a breach opened → closed, a report's day range). U+2192 is NOT a
// Unicode Bidi_Mirrored character, so under dir="rtl" a bare "→" keeps pointing right while the range now reads right to
// left — the arrow would point backwards. This span is flipped by CSS under an ancestor [dir="rtl"] (`.kv-dir-flip` in
// globals.css); under ltr (en / hi / gu today) the glyph and the visible text are unchanged. The breadcrumb "›" (U+203A)
// needs no such wrapper: it IS Bidi_Mirrored, so the browser mirrors it itself inside a right-to-left run.
export function DirArrow() {
  return <span className="kv-dir-flip">→</span>;
}
