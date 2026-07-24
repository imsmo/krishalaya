// apps/web-tenant/src/lib/mechanism.ts · DEV-19. Server-side reader for the console's 2 preference cookies
// (theme + senior mode), mirroring `lib/i18n.ts`'s own cookie-read convention (`kvt_lang` there, `kvt_theme`/
// `kvt_senior` here). The actual PARSE logic is pure and lives in `@krishi-verse/ui`'s `mechanisms/` module
// (`parseThemePreference`/`isSeniorOn`) — this file's only job is the Next.js-specific `cookies()` read, same
// separation `getLang()`/`resolveLanguage()` already has.
import 'server-only';
import { cookies } from 'next/headers';
import { parseThemePreference, isSeniorOn, resolveThemeHtmlAttrs, type ThemePreference, type ThemeHtmlAttrs } from '@krishi-verse/ui';

export const THEME_COOKIE = 'kvt_theme';
export const SENIOR_COOKIE = 'kvt_senior';

/** The active theme preference for this request (cookie → 'system' default — never trust the raw value). */
export function getThemePreference(): ThemePreference {
  return parseThemePreference(cookies().get(THEME_COOKIE)?.value);
}

/** The exact `<html>` attrs to render for the active theme preference — SSR-safe, computed server-side. */
export function getThemeHtmlAttrs(): ThemeHtmlAttrs {
  return resolveThemeHtmlAttrs(getThemePreference());
}

/** Whether senior mode is on for this request (cookie → OFF default — fail-closed). */
export function getSeniorMode(): boolean {
  return isSeniorOn(cookies().get(SENIOR_COOKIE)?.value);
}
