// apps/web-tenant/src/lib/i18n.ts · server-side i18n for the console. Resolves the active language from the
// `kvt_lang` cookie (set by the locale switcher), falling back to the Accept-Language header, then the default —
// and returns a @krishalaya/i18n Translator pre-loaded with en/hi/gu. Server-only: the catalogs are tiny +
// framework-free, so there is no client provider and no per-request bundle cost.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { Translator, resolveLanguage, DEFAULT_LANGUAGE, type LanguageDef } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

// DEV-26/Q16: this exact string is ALSO hardcoded (disclosed, not re-imported — see that file's own comment) in
// `../middleware.ts`, which cannot safely import this `server-only` + `next/headers` module. Keep both in sync.
export const LANG_COOKIE = 'kvt_lang';

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
