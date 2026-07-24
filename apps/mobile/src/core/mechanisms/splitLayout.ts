// apps/mobile/src/core/mechanisms/splitLayout.ts · DEV-20 mechanism 3/4 (tablet two-pane). PURE eligibility logic
// (zero RN imports) → unit-tested under the "core" jest project.
//
// Canon source (verified): `system/screen.css` §"TABLET TWO-PANE MASTER-DETAIL (mobile farmer-app frame)" —
// APPLIED at APPLY-9 per G0-2 Q49 + BRAND-027's founder-picked Candidate B. Mechanism gate, copied verbatim:
// `@media (min-width: 768px) and (pointer: coarse)`. Constants below are the exact canon figures, cited inline —
// `SPLIT_BREAKPOINT_PX` (768, the media query's own width), `SPLIT_MAX_WIDTH_PX` (1100, screen.css's own comment:
// "reuses W380-389's own already-shipped kiosk-tablet frame max-width"), `SPLIT_LIST_COL_PX` (280, screen.css's
// own comment: "reuses BRAND-027's own drawn split-view wireframe value"). Tap targets NEVER shrink at either
// pointer type (screen.css's own "TAP TARGETS NEVER SHRINK" doctrine, Rule Zero) — this file introduces no tap
// sizing at all, only the pane-split eligibility boolean; screens keep their existing tap-target styling.
export const SPLIT_BREAKPOINT_PX = 768;
export const SPLIT_MAX_WIDTH_PX = 1100;
export const SPLIT_LIST_COL_PX = 280;

/** A conservative "is this a real touchscreen" signal. React Native has no `pointer:`/`hover:` media feature —
 * every native (iOS/Android) surface IS a touchscreen, so `pointer: coarse` is implicitly true there; the one
 * place a `pointer: fine` device is even possible is an Expo-web build running in a desktop browser, where the
 * caller can pass a real `matchMedia('(pointer: coarse)').matches` reading. Defaults to `true` (native) so a
 * screen calling this hook with no override never silently loses the mechanism it asked for. Pure. */
export function isEligibleForSplit(widthPx: number, isCoarsePointer = true): boolean {
  return widthPx >= SPLIT_BREAKPOINT_PX && isCoarsePointer;
}

/** The list-column width to use inside a `screen.screen-split .screen-split-body` grid once split is active —
 * always the ratified 280px figure; exists as a named export so screens never re-type the literal. Pure. */
export function splitListColumnWidth(): number {
  return SPLIT_LIST_COL_PX;
}
