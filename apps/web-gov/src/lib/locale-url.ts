// apps/web-gov/src/lib/locale-url.ts · DEV-26, Q16 (URL/locale scheme).
// PURE and framework-free so it is unit-testable with no Next.js runtime.
//
// This app's `middleware.ts` and `app/api/lang/route.ts` were written against this helper but the file
// itself was never added for web-ops/web-gov (only storefront/tenant had it) — which broke `pnpm build`
// for both consoles. Same contract, same behaviour as
// apps/web-storefront/src/lib/locale-url.ts: keep the three copies in sync, or promote to a shared
// package if a fourth consumer ever appears.
//
// SCHEME: a `?lang=<code>` query parameter, read with priority over the existing `kv_lang` cookie, wired
// to `@krishalaya/i18n`'s LANGUAGE_REGISTRY — only LIVE codes are accepted (a "coming soon" registry code
// is a real, known code but never a selectable locale today).
import { isSupported, resolveLanguage } from '@krishalaya/i18n';

/** Reads `?lang=` from a URL and returns the resolved LIVE language code, or `null` if absent/unknown/not-live
 *  (never throws, never silently invents a code — a null return means "the URL expressed no valid preference,
 *  fall through to the existing cookie/Accept-Language chain unchanged"). */
export function pickUrlLang(url: URL): string | null {
  const raw = url.searchParams.get('lang');
  if (!raw) return null;
  return isSupported(raw) ? resolveLanguage(raw).code : null;
}

/** Appends (or replaces) `?lang=<code>` on a same-origin relative path, preserving any other existing query
 *  params — used by the `/api/lang` switch endpoint so that choosing a language produces a URL that itself
 *  carries the choice (shareable/bookmarkable), not just a cookie side-effect. `path` must already be validated
 *  same-origin-relative by the caller (this function does no origin/redirect safety checking of its own). */
export function withUrlLang(path: string, code: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('lang', code);
  return `${pathname}?${params.toString()}`;
}
