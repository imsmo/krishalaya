// apps/web-partner/src/lib/mechanism.ts · DEV-19. Server-side reader for the partner portal's 2 preference
// cookies (theme + senior mode) — mirrors `apps/web-tenant/src/lib/mechanism.ts` exactly (same pure-resolver
// separation: parsing lives in `@krishalaya/ui`, only the Next.js `cookies()` read is app-specific). MINIMAL
// WIRING (per this batch's own scope note): web-partner is not yet on `@krishalaya/ui`'s ported shell (its
// `Sidebar`/layout are this app's own hand-rolled components, unlike web-tenant post-DEV-18) — this file still
// gives the app a real, working mechanism (attributes + cookies), it just has no packages/ui shell component to
// visually respond to `[data-theme="dark"]` yet beyond this app's own `globals.css` remap (see that file).
import 'server-only';
import { cookies } from 'next/headers';
import { parseThemePreference, isSeniorOn, resolveThemeHtmlAttrs, type ThemePreference, type ThemeHtmlAttrs } from '@krishalaya/ui';

export const THEME_COOKIE = 'kvp_theme';
export const SENIOR_COOKIE = 'kvp_senior';

export function getThemePreference(): ThemePreference {
  return parseThemePreference(cookies().get(THEME_COOKIE)?.value);
}
export function getThemeHtmlAttrs(): ThemeHtmlAttrs {
  return resolveThemeHtmlAttrs(getThemePreference());
}
export function getSeniorMode(): boolean {
  return isSeniorOn(cookies().get(SENIOR_COOKIE)?.value);
}
