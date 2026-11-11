// apps/web-admin/src/lib/i18n.ts · server-side i18n for the god-mode console. web-admin is an internal staff-only
// realm, so there is a single primary locale (en) and no locale switcher — but copy is still centralised in the
// catalog (no hardcoded literals), resolved through the shared @krishalaya/i18n Translator. Server-only: the
// catalog is tiny + framework-free, so there is no client provider and no per-request bundle cost. hi/gu can be
// registered here later if the realm ever needs them (the Translator already falls back to en for missing keys).
import 'server-only';
import { Translator, resolveLanguage } from '@krishalaya/i18n';
import type { LanguageDir } from '@krishalaya/i18n';
import { en } from '../i18n/en';

export const ADMIN_LANG = 'en';

/** PC-56 RTL-1g · the admin page direction, from the same LanguageDef the root layout's `<html dir>` uses (always 'ltr' while the
 *  realm is English-only — 07_RTL Q3). Pages pass it to features/rtl/arrow `rangeArrow`. */
export function getAdminDir(): LanguageDir {
  return resolveLanguage(ADMIN_LANG).dir;
}

/** A translator bound to the admin locale (en), with the catalog registered. */
export function getTranslator(): Translator {
  return new Translator(ADMIN_LANG).register('en', en);
}
