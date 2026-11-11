// apps/web-ops/src/lib/locale-url.ts · DEV-26, Q16 (URL/locale scheme).
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
// PC-56 RTL-1e: the one exception is a PREVIEW code (`ar`, the Arabic machine draft): choosing it is the explicit act, so `pickChosenLang`
// accepts it here — and only here (Accept-Language never reaches it; `lib/i18n.ts` resolves the header as implicit).
import { isSupported, resolveLanguage, resolveServable, PREVIEW_LANGUAGES } from '@krishalaya/i18n';

/** A language a person CHOSE (the switcher's posted value, `?lang=`) — PC-56 RTL-1e, web-tenant's RTL-1b-1 rule: a live code resolves
 *  as before; a preview code (`ar`, the machine draft — founder Q1 "Draft all, opt-in only") resolves too, because choosing it IS the
 *  explicit act; anything else (unknown, or a not-yet-live "coming soon" code) is `null` — never invented. */
export function pickChosenLang(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (isSupported(raw)) return resolveLanguage(raw).code;
  const served = resolveServable(raw, 'explicit');
  return PREVIEW_LANGUAGES.includes(served.code) ? served.code : null;
}

/** Reads `?lang=` from a URL and returns the chosen language code (live, or the explicit-only preview `ar`), or `null` if
 *  absent/unknown/not-live (never throws, never silently invents a code — a null return means "the URL expressed no valid preference,
 *  fall through to the existing cookie/Accept-Language chain unchanged"). */
export function pickUrlLang(url: URL): string | null {
  return pickChosenLang(url.searchParams.get('lang'));
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
