// apps/web-partner/src/lib/i18n.ts · server-side i18n for the partner portal. PC-56 PARTNER-0 (founder D8): the language comes from the
// `kv_lang` cookie (the storefront's mechanism, ported — apps/web-storefront/src/lib/i18n.ts), else the Accept-Language header, else en, and
// the Translator carries en + hi + gu. hi.ts / gu.ts are PARTIAL catalogues over en.ts: they hold this wave's NEW keys (every new key × 3);
// a key missing there falls back to en INSIDE the shared Translator (`catalogs.get(active)?.[key] ?? catalogs.get('en')?.[key] ?? key`), so
// a Hindi page shows the untranslated keys in English, never blank. Backfilling them is its own wave (named). PC-56 PARTNER-6c (founder 6c-3,
// door Q7-A): THE SWITCHER EXISTS — a partner person chooses the language on `/account/notifications/preferences` (a radio group of the
// package's live languages, read from `@krishalaya/i18n`), and the Server Action there sets this cookie for the browser
// (features/partner6/language.ts holds the cookie's name and attributes; it is defined once, there).
// Server-only: the catalogs are tiny + framework-free, so there is no client provider and no per-request bundle cost.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { Translator, resolveLanguage, DEFAULT_LANGUAGE, type LanguageDef } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { LANG_COOKIE } from '../features/partner6/language';

export { LANG_COOKIE };
/** The default language of the partner portal (kept for imports that predate the cookie). */
export const PARTNER_LANG = DEFAULT_LANGUAGE;

/** The active language code for this request (cookie → Accept-Language → default). */
export function getLang(): string {
  try {
    const cookieLang = cookies().get(LANG_COOKIE)?.value;
    if (cookieLang) return resolveLanguage(cookieLang).code;
    const accept = headers().get('accept-language') ?? '';
    const first = accept.split(',')[0]?.trim();
    return resolveLanguage(first || DEFAULT_LANGUAGE).code;
  } catch {
    return DEFAULT_LANGUAGE;   // outside a request scope (a build-time render) → the default
  }
}

/** Resolved language definition (code, native name, dir, intlLocale) for the active request. */
export function getLanguageDef(): LanguageDef {
  return resolveLanguage(getLang());
}

/** A translator bound to the active language, with all catalogs registered (missing keys fall back to en). */
export function getTranslator(langCode = getLang()): Translator {
  return new Translator(langCode).register('en', en).register('hi', hi).register('gu', gu);
}
