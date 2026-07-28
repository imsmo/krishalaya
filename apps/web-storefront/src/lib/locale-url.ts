// apps/web-storefront/src/lib/locale-url.ts · DEV-26, Q16 (URL/locale scheme, ENGINEERING-ROUTED per
// `Design_Program/12_G0-2_DECISION_REGISTER.md` line 44 — "URL/locale scheme"). PURE, framework-free so it is
// unit-testable with no Next.js runtime.
//
// SCHEME DECIDED (Q16, this batch): a `?lang=<code>` query parameter, read with priority over the existing
// `kv_lang` cookie, wired to `@krishi-verse/i18n`'s LANGUAGE_REGISTRY (only LIVE codes are accepted — a
// "coming soon" registry code is a real, known code but never a selectable locale today, same distinction the
// LocaleSwitcher's own `COMING_SOON_LANGUAGES` rendering already makes).
//
// WHY query-param, not path-prefix (disclosed, per contract §7's "no silent invention" spirit — an engineering
// call, not a design one, so recorded here rather than in the design canon): this app's real route tree
// (grep-verified, DEV-26) already uses `app/[tenantSlug]/**` as a first-level dynamic segment for a tenant's own
// public storefront (`[tenantSlug]/page.tsx`, `[tenantSlug]/listings/[id]`), alongside a large set of top-level
// platform routes (pricing/about/help/cart/checkout/orders/auctions/…) that are NOT tenant-scoped at all. Adding
// a `/{locale}/` prefix ABOVE everything would require physically moving the entire `app/` tree under a new
// `[locale]` segment (`/{locale}/{tenantSlug}/...` for tenant pages, `/{locale}/pricing` for platform pages) —
// a large, high-blast-radius restructure (every relative import, every `Link`/`redirect` call, every existing
// route test) disproportionate to an M-sized batch already covering three other rulings, and it does not sit
// well with `[tenantSlug]` already occupying the first path segment. A `?lang=` parameter makes the locale a
// REAL, bookmarkable, shareable part of the URL (satisfying the ruling's own text — "locale scheme in URL", not
// "URL as the ONLY locale source") without moving a single existing file or changing a single existing route's
// path. It is explicitly ADDITIVE: a future batch can still layer a path-prefix scheme on top without conflict.
import { isSupported, resolveLanguage } from '@krishi-verse/i18n';

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
