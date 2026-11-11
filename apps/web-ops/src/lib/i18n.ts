// apps/web-ops/src/lib/i18n.ts · server-side i18n for the console. Resolves the active language from the
// `kvo_lang` cookie (set by the locale switcher), falling back to the Accept-Language header, then the default —
// and returns a @krishalaya/i18n Translator pre-loaded with en/hi/gu/ar (ar: the PC-56 RTL-1e machine draft). Server-only: the catalogs are tiny +
// framework-free, so there is no client provider and no per-request bundle cost.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { Translator, resolveServable, DEFAULT_LANGUAGE, type LanguageDef } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

// PC-56 HOTFIX-10 · H10-4: the cookie's name has ONE definition, `./lang-cookie` (framework-free, so the Edge middleware
// imports it too); re-exported here so every existing importer of `lib/i18n`'s LANG_COOKIE keeps working.
import { LANG_COOKIE } from './lang-cookie';
export { LANG_COOKIE };

/** The active language code for this request (cookie → Accept-Language → default).
 *  PC-56 RTL-1e (founder Q1 "Draft all, opt-in only"; web-tenant's RTL-1b-1 rule): the cookie is a person's own choice (the switcher, or
 *  `?lang=` persisted by middleware), so it resolves as EXPLICIT and may serve the Arabic machine draft; Accept-Language is a browser
 *  preference, so it resolves as IMPLICIT and can never serve Arabic — an `ar` browser gets English. */
export function getLang(): string {
  const cookieLang = cookies().get(LANG_COOKIE)?.value;
  if (cookieLang) return resolveServable(cookieLang, 'explicit').code;
  const accept = headers().get('accept-language') ?? '';
  const first = accept.split(',')[0]?.trim();
  return resolveServable(first || DEFAULT_LANGUAGE, 'implicit').code;
}

/** Resolved language definition (code, native name, dir, intlLocale) for the active request. `getLang()` has already applied the
 *  explicit/implicit rule, so its code is served as it stands (an `ar` here came from the cookie). */
export function getLanguageDef(): LanguageDef {
  return resolveServable(getLang(), 'explicit');
}

/** A translator bound to the active language, with all catalogs registered (missing keys fall back to en). `ar` is the RTL-1e machine
 *  draft of the WHOLE ops console. */
export function getTranslator(langCode = getLang()): Translator {
  return new Translator(langCode).register('en', en).register('hi', hi).register('gu', gu).register('ar', ar);
}
