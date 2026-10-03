// @krishalaya/tokens · public entry — the design system as typed constants for every frontend.
// colors.ts / spacing.ts / typography.ts are GENERATED (HAND-1) — see sync-from-design-system.js.
export { colors } from './colors';
export type { ColorScale } from './colors';
export { spacing, radii, breakpoints, touchTarget, touchTargetMinPx } from './spacing';
export { fontFamily, fontSize, fontWeight, lineHeight, seniorModeTypeScaleMultiplier } from './typography';
// DEV-19: dark-console token bridge (`web.dark` scope, APPLY-7/G0-2 Q40) — closes the GENUINE GAP
// packages/ui's own internal/theme.ts disclosed at DEV-15/17 (hand-cited literals, no package export).
export { darkColors } from './colorsDark';
export type { DarkColorScale } from './colorsDark';
// PC-56 TENANT-13d · the contrast law (WCAG 2.x) and the brand-surface rules — ONE implementation for the API's publish gate, the
// console's live panel and the storefront.
export {
  BRAND_HEX_RE, AA_NORMAL, AA_LARGE, AAA_NORMAL, AAA_LARGE, PUBLISH_MIN_RATIO, normaliseHex, relativeLuminance, contrastRatio,
  formatRatio, BRAND_PAIRS, brandContrast, PLATFORM_BRAND_COLOURS,
} from './contrast';
export type { BrandColours, BrandPairCode, PairVerdict, ContrastReport } from './contrast';
export {
  PLATFORM_BRAND, TRUST_SURFACES, BRANDABLE_SURFACES, isTrustSurface, showsPoweredBy, SMS_SENDER_IS_DLT_REGISTERED,
} from './brand-surfaces';
export type { TrustSurface, BrandableSurface, BrandSurface } from './brand-surfaces';
