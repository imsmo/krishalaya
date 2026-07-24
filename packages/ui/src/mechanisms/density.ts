// packages/ui/src/mechanisms/density.ts · DEV-19 (Phase D4, "implement the 4 UI mechanisms" batch).
//
// Closes DELTA-001's own named ENGINEERING-OWED residual (per `Design_Program/13_G0-3_DELTA_REGISTER.md`'s
// contract v1.3 changelog addendum, cited in full in `designer_pack/07-developer-handoff.md` §10): the
// console's 36px dense control height (`--web-control-h`, vs. contract §4's 44px blanket rural-tap rule) IS
// ratified canon (G0-3, 2026-07-19) — it is NOT awaiting a design decision. What was never built is the real
// `pointer:`/`hover:` media-query gating so the 36px density applies ONLY on desktop-class input, never
// dropping a touch/tablet console user below the 44px floor. Verified this batch (re-grepped, same finding
// the handoff doc already recorded): zero `pointer:`/`hover:` media queries exist anywhere in
// `system/web/*.css` — `--web-control-h: 36px` in `web-tokens.css` applies UNCONDITIONALLY today, and
// `packages/ui`'s own `internal/theme.ts` `lightVars` inherited that same unconditional 36px value verbatim
// (DEV-15). This file is the gating layer DELTA-001 asked for, built the SAME way the mobile canon's own
// tablet-split mechanism (`screen.css`'s `@media (min-width:768px) and (pointer:coarse)`) already gates its
// own scope — reusing the identical `pointer:`/`hover:` media-feature vocabulary, not inventing a new one.
//
// RULE ZERO / TAP-NEVER-SHRINKS: a touch or coarse-pointer console user NEVER gets less than the 44px floor —
// the `@media (pointer: coarse), (hover: none)` branch below explicitly RAISES `--web-control-h` back to 44px
// (undoing `theme.ts`'s own unconditional 36px), it never lowers anything. The 36px density cut applies ONLY
// inside `@media (pointer: fine) and (hover: hover)` — genuine desktop-class input (a real mouse/trackpad with
// hover support), exactly DELTA-001's own "ONLY on desktop-class input" instruction.
export const densityStyles = `
/* Console pointer/hover density gating (DELTA-001 residual, closed DEV-19). Additive: overrides the
   unconditional --web-control-h this package's own :root block sets (theme.ts lightVars, DEV-15), via source-
   order cascade (same specificity, later media-scoped rule wins) — never edits web-tokens.css upstream. */
@media (pointer: fine) and (hover: hover) {
  :root { --web-control-h: 36px; }
}
@media (pointer: coarse), (hover: none) {
  :root { --web-control-h: 44px; }
}
`;
