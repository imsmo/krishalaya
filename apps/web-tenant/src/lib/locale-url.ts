// apps/web-tenant/src/lib/locale-url.ts · DEV-26, Q16 (URL/locale scheme, ENGINEERING-ROUTED per
// `Design_Program/12_G0-2_DECISION_REGISTER.md` line 44 — "URL/locale scheme"). PURE, framework-free so it is
// unit-testable with no Next.js runtime. See `apps/web-storefront/src/lib/locale-url.ts` for the full grounding
// comment (scheme decision + rejected path-prefix alternative) — identical scheme here, this console app has no
// `[tenantSlug]`-style dynamic segment, but the same reasoning (bounded, additive, no route-tree restructure)
// applies equally and keeps the mechanism identical across both apps that actually run a live locale switcher.
import { isSupported, resolveLanguage, resolveServable, PREVIEW_LANGUAGES } from '@krishalaya/i18n';

/** A language a person CHOSE (the switcher's posted value, `?lang=`): a live code resolves as before; a preview code
 *  (`ar`, the RTL-1b-1 machine draft — founder Q1 "Draft all, opt-in only") resolves too, because choosing it IS the
 *  explicit act; anything else (unknown, or a not-yet-live "coming soon" code) is `null` — never invented. */
export function pickChosenLang(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (isSupported(raw)) return resolveLanguage(raw).code;
  const served = resolveServable(raw, 'explicit');
  return PREVIEW_LANGUAGES.includes(served.code) ? served.code : null;
}

/** Reads `?lang=` from a URL and returns the chosen language code (live, or the explicit-only preview `ar`), or `null`
 *  if absent/unknown/not-live. */
export function pickUrlLang(url: URL): string | null {
  return pickChosenLang(url.searchParams.get('lang'));
}

/** Appends (or replaces) `?lang=<code>` on a same-origin relative path, preserving any other existing query
 *  params. `path` must already be validated same-origin-relative by the caller. */
export function withUrlLang(path: string, code: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('lang', code);
  return `${pathname}?${params.toString()}`;
}
