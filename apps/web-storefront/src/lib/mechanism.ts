// apps/web-storefront/src/lib/mechanism.ts · DEV-19. Server-side reader for the storefront's preference
// cookies (theme + senior mode) — mirrors `apps/web-tenant/src/lib/mechanism.ts` exactly (same pure-resolver
// separation: parsing lives in `@krishalaya/ui`, only the Next.js `cookies()` read is app-specific). Density
// (DELTA-001) is deliberately NOT wired for this app — see `globals.css`'s own header comment: DELTA-001 scopes
// the 36px console-density cut to ops/B2B console realms, not this farmer/consumer-facing commerce storefront.
// PC-56 STORE-5a · D4 (founder Q17): + High contrast (`kvs_contrast` on/off) and Calm motion (`kvs_motion` calm/off), PER DEVICE, the
// `kvs_senior` shape — parsed by @krishalaya/ui (`isContrastOn`, `isCalmMotionOn`, fail-closed); the modes stack (one attribute each).
import 'server-only';
import { cookies } from 'next/headers';
import { parseThemePreference, isSeniorOn, isContrastOn, isCalmMotionOn, resolveThemeHtmlAttrs, type ThemePreference, type ThemeHtmlAttrs } from '@krishalaya/ui';

export const THEME_COOKIE = 'kvs_theme';
export const SENIOR_COOKIE = 'kvs_senior';
export const CONTRAST_COOKIE = 'kvs_contrast';
export const MOTION_COOKIE = 'kvs_motion';

export function getThemePreference(): ThemePreference {
  return parseThemePreference(cookies().get(THEME_COOKIE)?.value);
}
export function getThemeHtmlAttrs(): ThemeHtmlAttrs {
  return resolveThemeHtmlAttrs(getThemePreference());
}
export function getSeniorMode(): boolean {
  return isSeniorOn(cookies().get(SENIOR_COOKIE)?.value);
}
export function getContrastMode(): boolean {
  return isContrastOn(cookies().get(CONTRAST_COOKIE)?.value);
}
export function getCalmMotion(): boolean {
  return isCalmMotionOn(cookies().get(MOTION_COOKIE)?.value);
}
