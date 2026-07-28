// apps/web-tenant/src/lib/locale-url.ts · DEV-26, Q16 (URL/locale scheme, ENGINEERING-ROUTED per
// `Design_Program/12_G0-2_DECISION_REGISTER.md` line 44 — "URL/locale scheme"). PURE, framework-free so it is
// unit-testable with no Next.js runtime. See `apps/web-storefront/src/lib/locale-url.ts` for the full grounding
// comment (scheme decision + rejected path-prefix alternative) — identical scheme here, this console app has no
// `[tenantSlug]`-style dynamic segment, but the same reasoning (bounded, additive, no route-tree restructure)
// applies equally and keeps the mechanism identical across both apps that actually run a live locale switcher.
import { isSupported, resolveLanguage } from '@krishi-verse/i18n';

/** Reads `?lang=` from a URL and returns the resolved LIVE language code, or `null` if absent/unknown/not-live. */
export function pickUrlLang(url: URL): string | null {
  const raw = url.searchParams.get('lang');
  if (!raw) return null;
  return isSupported(raw) ? resolveLanguage(raw).code : null;
}

/** Appends (or replaces) `?lang=<code>` on a same-origin relative path, preserving any other existing query
 *  params. `path` must already be validated same-origin-relative by the caller. */
export function withUrlLang(path: string, code: string): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('lang', code);
  return `${pathname}?${params.toString()}`;
}
