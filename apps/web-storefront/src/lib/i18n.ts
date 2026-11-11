// apps/web-storefront/src/lib/i18n.ts · server-side i18n for the storefront. Resolves the active language from
// the `kv_lang` cookie (set by the locale switcher), falling back to the Accept-Language header, then to the
// default — and returns a @krishalaya/i18n Translator pre-loaded with the en/hi/gu/ar catalogs. Server-only:
// the catalogs are tiny + framework-free, so there is no client provider and no per-request bundle cost.
import 'server-only';
import { cookies, headers } from 'next/headers';
import { Translator, resolveServable, DEFAULT_LANGUAGE, type LanguageDef } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

// DEV-26/Q16: this exact string is ALSO hardcoded (disclosed, not re-imported — see that file's own comment) in
// `../middleware.ts`, which cannot safely import this `server-only` + `next/headers` module. Keep both in sync.
export const LANG_COOKIE = 'kv_lang';

/** The active language code for this request (cookie → Accept-Language → default).
 *  PC-56 RTL-1c (founder Q1 "Draft all, opt-in only"): the cookie is a person's own choice (the switcher, the language route, or `?lang=`
 *  persisted by middleware), so it resolves as EXPLICIT and may serve the Arabic machine draft; Accept-Language is a browser preference, so it
 *  resolves as IMPLICIT and can never serve Arabic — an `ar` browser gets English. */
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

/** A translator bound to the active language, with all catalogs registered (missing keys fall back to en). `ar` is the RTL-1c machine
 *  draft of every storefront key (i18n/ar.ts — MACHINE DRAFT, NOT REVIEWED). */
export function getTranslator(langCode = getLang()): Translator {
  return new Translator(langCode).register('en', en).register('hi', hi).register('gu', gu).register('ar', ar);
}
