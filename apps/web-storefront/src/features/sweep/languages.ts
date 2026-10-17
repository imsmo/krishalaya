// apps/web-storefront/src/features/sweep/languages.ts · PC-56 STORE-SWEEP-b · C1 (founder D3 — canon W323) — THE LANGUAGE PAGE'S RULES. PURE.
//
//   • the LIVE languages (the code registry `@krishalaya/i18n`, status `live` — en/hi/gu today; test/languages-drift.spec.ts pins that set to the
//     seed's ACTIVE rows, db/seeds/core/0001_languages.sql), each a button written in itself (`nameNative`);
//   • the rest as ONE honest "not available yet" line (DELTA `coming_soon_languages` against W323's "never show"; the 4c `nine_more` precedent);
//   • the choice is posted to the existing `/api/lang` route, which takes the form field `from` (a same-origin path: it must start with "/" and not
//     "//", else "/") and answers 303 to it with `?lang=<code>` (lib/locale-url `withUrlLang`) after setting the `kv_lang` cookie — this module only
//     decides WHICH `from` the page carries: the `?from=` the link brought, else the Referer when it is this same host, else the chrome's home;
//     never the language page itself (that would send the person back here).
// No IP guess (the browser's own Accept-Language stays — lib/i18n `getLang`), no speaker, no first-visit interstitial: refused by name.
import { LANGUAGE_REGISTRY, type LanguageRegistryEntry } from '@krishalaya/i18n';

export interface LiveLanguage { code: string; nameNative: string; dir: 'ltr' | 'rtl' }
/** The selectable languages, in registry order. */
export function liveLanguages(registry: readonly LanguageRegistryEntry[] = LANGUAGE_REGISTRY): LiveLanguage[] {
  return registry.filter((l) => l.status === 'live').map((l) => ({ code: l.code, nameNative: l.nameNative, dir: l.dir }));
}
/** The registry's other entries ("not available yet"), in registry order. */
export function comingSoonLanguages(registry: readonly LanguageRegistryEntry[] = LANGUAGE_REGISTRY): LiveLanguage[] {
  return registry.filter((l) => l.status !== 'live').map((l) => ({ code: l.code, nameNative: l.nameNative, dir: l.dir }));
}
export function comingSoonCount(registry: readonly LanguageRegistryEntry[] = LANGUAGE_REGISTRY): number {
  return comingSoonLanguages(registry).length;
}

const isLocalPath = (p: string) => p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') && !/[\r\n]/.test(p) && p.length <= 2000;
/** Is this path the language page itself (on the platform, under a store's path, or on a store's own host)? */
export function isLanguagePath(p: string): boolean {
  const path = p.split(/[?#]/)[0].replace(/\/+$/, '');
  return path === '/language' || /^\/[a-z0-9][a-z0-9-]{1,61}\/language$/i.test(path);
}
/** Where the choice returns the person: `?from=` (a same-origin path) → the Referer (same host only, its path + query) → `home`. */
export function languageFrom(fromParam: string | string[] | null | undefined, referer: string | null | undefined, host: string | null | undefined, home: string): string {
  const q = Array.isArray(fromParam) ? fromParam[0] : fromParam;
  if (typeof q === 'string' && isLocalPath(q) && !isLanguagePath(q)) return q;
  if (referer && host) {
    try {
      const u = new URL(referer);
      if (u.host.toLowerCase() === host.toLowerCase() && (u.protocol === 'https:' || u.protocol === 'http:')) {
        const p = `${u.pathname}${u.search}`;
        if (isLocalPath(p) && !isLanguagePath(p)) return p;
      }
    } catch { /* not a URL — fall through */ }
  }
  return home;
}
