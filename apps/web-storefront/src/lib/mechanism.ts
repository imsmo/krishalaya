// apps/web-storefront/src/lib/mechanism.ts · DEV-19. Server-side reader for the storefront's 2 preference
// cookies (theme + senior mode) — mirrors `apps/web-tenant/src/lib/mechanism.ts` exactly (same pure-resolver
// separation: parsing lives in `@krishi-verse/ui`, only the Next.js `cookies()` read is app-specific). Density
// (DELTA-001) is deliberately NOT wired for this app — see `globals.css`'s own header comment: DELTA-001 scopes
// the 36px console-density cut to ops/B2B console realms, not this farmer/consumer-facing commerce storefront.
import 'server-only';
import { cookies } from 'next/headers';
import { parseThemePreference, isSeniorOn, resolveThemeHtmlAttrs, type ThemePreference, type ThemeHtmlAttrs } from '@krishi-verse/ui';

export const THEME_COOKIE = 'kvs_theme';
export const SENIOR_COOKIE = 'kvs_senior';

export function getThemePreference(): ThemePreference {
  return parseThemePreference(cookies().get(THEME_COOKIE)?.value);
}
export function getThemeHtmlAttrs(): ThemeHtmlAttrs {
  return resolveThemeHtmlAttrs(getThemePreference());
}
export function getSeniorMode(): boolean {
  return isSeniorOn(cookies().get(SENIOR_COOKIE)?.value);
}
