// apps/web-ops/src/lib/i18n.ts · server-side i18n for the console. Resolves the active language from the
// `kvo_lang` cookie (set by the locale switcher), falling back to the Accept-Language header, then the default —
// and returns a @krishalaya/i18n Translator pre-loaded with en/hi/gu. Server-only: the catalogs are tiny +
// framework-free, so there is no client provider and no per-request bundle cost.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { Translator, resolveLanguage, DEFAULT_LANGUAGE, type LanguageDef } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

// PC-56 HOTFIX-10 · H10-4: the cookie's name has ONE definition, `./lang-cookie` (framework-free, so the Edge middleware
// imports it too); re-exported here so every existing importer of `lib/i18n`'s LANG_COOKIE keeps working.
import { LANG_COOKIE } from './lang-cookie';
export { LANG_COOKIE };

/** The active language code for this request (cookie → Accept-Language → default). */
export function getLang(): string {
  const cookieLang = cookies().get(LANG_COOKIE)?.value;
  if (cookieLang) return resolveLanguage(cookieLang).code;
  const accept = headers().get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim();
  return resolveLanguage(first || DEFAULT_LANGUAGE).code;
}

/** Resolved language definition (code, native name, dir, intlLocale) for the active request. */
export function getLanguageDef(): LanguageDef {
  return resolveLanguage(getLang());
}

/** A translator bound to the active language, with all catalogs registered (missing keys fall back to en). */
export function getTranslator(langCode = getLang()): Translator {
  return new Translator(langCode).register('en', en).register('hi', hi).register('gu', gu);
}
