// apps/mobile/src/core/mechanisms/seniorMode.ts · DEV-20 mechanism 2/4 (senior). PURE scale math (zero RN
// imports) → unit-tested under the "core" jest project.
//
// Canon source (verified): `system/screen.css` §"SENIOR MODE (mobile 480px .screen frame)" — APPLIED at APPLY-8
// per G0-2 Q48 ("1.30x senior multiplier RATIFIED"), scope "farmer-facing app surfaces only... consoles excluded".
// screen.css writes each scaled step as a literal `calc(<tokens.css base rem> * 1.30)` (CSS can't reference its
// own prior value inside its own redefinition) — this file does the SAME multiplication in TS against
// `@krishi-verse/tokens`' `seniorModeTypeScaleMultiplier` (1.30, already-committed export, pre-dates DEV-19,
// safe to consume) so the mobile app derives its senior scale from the identical ratified constant, never a
// re-typed literal. Tap floor: screen.css's `--tap-min`/`--tap-rural` both collapse onto `--tap-large` (56px,
// tokens.css:222) inside `.screen.senior-mode` — mirrored here as `SENIOR_TAP_MIN`.
import { seniorModeTypeScaleMultiplier } from '@krishi-verse/tokens';

export const SENIOR_TYPE_SCALE = seniorModeTypeScaleMultiplier; // 1.30, Q48
export const SENIOR_TAP_MIN = 56; // tokens.css --tap-large, screen.css .screen.senior-mode override target

/** Scale one base font size (px, e.g. ui-native's `font.size.md`) by the ratified senior multiplier, rounded to
 * one decimal (matches screen.css's own worked comments, e.g. "16px -> 20.8px"). Pure. */
export function seniorFontSize(basePx: number): number {
  return Math.round(basePx * SENIOR_TYPE_SCALE * 10) / 10;
}

/** Scale a whole `font.size` scale object (ui-native's shape) at once — used to build a parallel "senior" size
 * table a screen can swap to when senior mode is on, without inventing any token ui-native didn't already define.
 * Pure; input keys pass through unchanged. */
export function seniorFontSizeScale<T extends Record<string, number>>(base: T): T {
  const out = {} as T;
  for (const k of Object.keys(base) as (keyof T)[]) out[k] = seniorFontSize(base[k] as number) as T[keyof T];
  return out;
}

/** The effective minimum tap size for a control, honoring senior mode's floor when it's on. Never returns a value
 * SMALLER than the app's own baseline (Rule Zero: a variant never loses a law) — if a screen's base tap target is
 * already >= the senior floor, it is left alone. Pure. */
export function effectiveTapMin(baseTapPx: number, seniorOn: boolean): number {
  return seniorOn ? Math.max(baseTapPx, SENIOR_TAP_MIN) : baseTapPx;
}
