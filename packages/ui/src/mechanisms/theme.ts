// packages/ui/src/mechanisms/theme.ts · DEV-19 (Phase D4, "implement the 4 UI mechanisms" batch).
//
// Pure, framework-agnostic dark-mode PREFERENCE RESOLVER. This module intentionally imports nothing from
// `next/headers` or any browser API — it is a plain function of a raw string in, HTML-attribute-shape out —
// so it stays usable from any consuming app (Next.js server component, a future non-Next app, or a unit test)
// without dragging a framework dependency into `packages/ui`. Each app's own `lib/*.ts` (mirroring the existing
// `lib/i18n.ts` cookie-read convention already established by `web-tenant`/`web-storefront`) is responsible for
// reading its OWN cookie and calling this resolver — exactly the same separation `@krishalaya/i18n`'s
// `resolveLanguage()` already has from each app's own `getLanguageDef()`.
//
// SSR STRATEGY (stated, not assumed — see `dev19_report.md` "SSR strategy" section): this mechanism is 100%
// cookie-driven, read server-side, rendered into the initial HTML — there is NO client-side localStorage read,
// NO inline bootstrap `<script>` in `<head>`, and NO client `useEffect` that flips an attribute after mount.
// That is the textbook cause of the "dark-mode flash" / hydration-mismatch bug this module is explicitly
// designed to avoid BY CONSTRUCTION: the server already knows the user's preference (from the cookie) before
// it renders a single byte of HTML, so the attribute is correct on the very first paint and never changes
// after hydration. The cost of this choice (disclosed): a preference change requires a full page navigation
// (a `<form method="post">` to a cookie-setting route + redirect, exactly the pattern
// `apps/web-tenant/src/app/api/lang/route.ts` already established for language) rather than an instant
// client-side toggle — the same trade-off `LocaleSwitcher.tsx` already accepted for language switching.
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_PREFERENCES: readonly ThemePreference[] = Object.freeze(['light', 'dark', 'system']);

/** Fail-closed parse of a raw (possibly attacker-controlled) cookie value — never trust the client's string. */
export function parseThemePreference(raw: string | undefined | null): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export interface ThemeHtmlAttrs {
  /** Spread onto `<html>` (or `<body>` — canon's `body.web[data-theme="dark"]` reconciliation rule, see
   *  `web-tokens.css`, means either ancestor works; this package's own components key off the bare
   *  `[data-theme="dark"]` attribute selector, which matches at ANY ancestor level). */
  'data-theme'?: 'dark';
  /** Opt-in hook for the canon's OWN system-preference mechanism (`web-tokens.css`:
   *  `@media (prefers-color-scheme: dark) { :root.dark-enabled { ... } }`) — present only in 'system' mode,
   *  per that block's own comment: "Auto via media query only when .dark-enabled also present (opt-in, no
   *  surprises)." DISCLOSED BOUNDARY: that canon block only remaps 4 of the ~19 dark-scope tokens (surface-
   *  page/card, ink-700, border-subtle) — it is a pre-existing canon limitation (not introduced by this
   *  batch), so 'system' mode is visually a PARTIAL dark mode until a user makes an explicit 'dark' choice.
   *  Stated here, not silently smoothed over. */
  className?: 'dark-enabled';
}

/** Resolves a stored preference into the exact HTML attributes a server layout should render. Pure — no DOM,
 *  no cookies, no request object; testable with zero mocking. */
export function resolveThemeHtmlAttrs(pref: ThemePreference): ThemeHtmlAttrs {
  if (pref === 'dark') return { 'data-theme': 'dark' };
  if (pref === 'light') return {};
  return { className: 'dark-enabled' };
}
