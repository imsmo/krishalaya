// apps/mobile/src/core/mechanisms/rtl.ts · DEV-20 mechanism 4/4 (RTL). PURE resolver logic (zero RN imports) →
// unit-tested under the "core" jest project. The RN-specific `I18nManager` application lives in rtlBoot.ts (a
// thin, untested-under-"core" glue file, same convention as core/auth/token-store.ts's storage glue).
//
// Canon source (verified): `system/screen.css` — `[dir="rtl"]` rules exist canon-wide (icon-mirror utility,
// tab-underbar `inset-inline-start` note) — APPLY-6/BRAND-017. CLOSE-2 shipped a full Urdu (`ur`, RTL) screen set
// under `screens/lang-ur/` in the DESIGN CANON — but `@krishi-verse/i18n`'s LIVE registry (`LANGUAGES`) still
// carries only `hi`/`en`/`gu`, all `dir: 'ltr'` (grep-verified). So today `shouldForceRTL` always resolves false
// for every live app language — the mechanism is real and tested, but structurally INACTIVE until a live RTL
// language ships (mirrors DEV-19's own disclosed residual: "no live RTL-triggering language exists yet").
//
// DEV-21: the shared `@krishi-verse/i18n` package now carries the FULL 14-entry `LANGUAGE_REGISTRY` (including
// every target language's `dir`) — this file's own `COMING_LANGUAGE_DIR` map below is DERIVED from that registry
// rather than hand-duplicated, so a future language's RTL flag can never drift between the shared package and
// this mobile-only forward-compat map.
export type Direction = 'ltr' | 'rtl';

/** Should the app force RTL layout for this language's direction? Pure — takes the direction value directly so
 * it works with any `LanguageDef`-shaped object (`@krishi-verse/i18n`'s registry OR a locally-registered
 * "coming soon" entry) without importing the package's type. */
export function shouldForceRTL(dir: Direction | null | undefined): boolean {
  return dir === 'rtl';
}

/** React Native's `I18nManager.forceRTL` only takes full effect after the JS bundle reloads (RN limitation, not
 * a bug in this mechanism) — this tells the caller whether a change actually flips the forced value (so it knows
 * whether to prompt/trigger a reload) vs. a no-op re-application of the same value. Pure. */
export function rtlChangeRequiresReload(currentlyForced: boolean, dir: Direction | null | undefined): boolean {
  return shouldForceRTL(dir) !== currentlyForced;
}

import { LANGUAGE_REGISTRY } from '@krishi-verse/i18n';

/** Every registered language's direction (live AND target, all 14) — derived from the shared registry, never
 * hand-duplicated. `ur` (Urdu) is CLOSE-2's own shipped RTL design-canon language (screens/lang-ur/) with no
 * mobile-app translation catalog yet (`LANGUAGE_REGISTRY`'s own `codeCatalogAbsent` flag on that row) — the
 * MECHANISM (dir flip, RN's built-in RTL layout mirroring) is real and ships this batch; the CATALOG does not
 * exist, so `ur` cannot be selected as an active language yet.
 * [DEV-21]: this map is now consumed by `(system)/language.tsx`'s "coming soon" rows via the registry directly
 * (the screen reads `LANGUAGE_REGISTRY`'s own `dir` field for each row's `dir=` attribute) — this export stays for
 * any call-site that only wants a `code → Direction` map without pulling the full registry shape. */
export const COMING_LANGUAGE_DIR: Record<string, Direction> = Object.fromEntries(
  LANGUAGE_REGISTRY.map((l) => [l.code, l.dir]),
);
