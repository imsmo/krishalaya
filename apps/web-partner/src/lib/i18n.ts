// apps/web-partner/src/lib/i18n.ts · server-side i18n for the partner portal. Partners are external B2B
// businesses, so en is the primary (and currently only) locale — but copy is still centralised in the catalog
// (no hardcoded literals), resolved through the shared @krishalaya/i18n Translator. Server-only: the catalog is
// tiny + framework-free, so there is no client provider and no per-request bundle cost. hi/gu can be registered
// here later (the Translator already falls back to en for missing keys).
import 'server-only';
import { Translator } from '@krishalaya/i18n';
import { en } from '../i18n/en';

export const PARTNER_LANG = 'en';

/** A translator bound to the partner locale (en), with the catalog registered. */
export function getTranslator(): Translator {
  return new Translator(PARTNER_LANG).register('en', en);
}
