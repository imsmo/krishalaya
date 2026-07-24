// @krishi-verse/tokens · public entry — the design system as typed constants for every frontend.
// colors.ts / spacing.ts / typography.ts are GENERATED (HAND-1) — see sync-from-design-system.js.
export { colors } from './colors';
export type { ColorScale } from './colors';
export { spacing, radii, breakpoints, touchTarget, touchTargetMinPx } from './spacing';
export { fontFamily, fontSize, fontWeight, lineHeight, seniorModeTypeScaleMultiplier } from './typography';
// DEV-19: dark-console token bridge (`web.dark` scope, APPLY-7/G0-2 Q40) — closes the GENUINE GAP
// packages/ui's own internal/theme.ts disclosed at DEV-15/17 (hand-cited literals, no package export).
export { darkColors } from './colorsDark';
export type { DarkColorScale } from './colorsDark';
