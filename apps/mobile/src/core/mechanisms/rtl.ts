// apps/mobile/src/core/mechanisms/rtl.ts · DEV-20 mechanism 4/4 (RTL). PURE resolver logic (zero RN imports) →
// unit-tested under the "core" jest project. The RN-specific `I18nManager` application lives in rtlBoot.ts (a
// thin, untested-under-"core" glue file, same convention as core/auth/token-store.ts's storage glue).
//
// Canon source (verified): `system/screen.css` — `[dir="rtl"]` rules exist canon-wide (icon-mirror utility,
// tab-underbar `inset-inline-start` note) — APPLY-6/BRAND-017. CLOSE-2 shipped a full Urdu (`ur`, RTL) screen set
// under `screens/lang-ur/` in the DESIGN CANON — but `@krishi-verse/i18n`'s live registry (`packages/i18n/src/
// languages.ts`, a shared package this batch does NOT edit per its own scope boundary — apps/mobile only) still
// carries only `hi`/`en`/`gu`, all `dir: 'ltr'` (grep-verified). So today `shouldForceRTL` always resolves false
// for every live app language — the mechanism is real and tested, but structurally INACTIVE until a live RTL
// language ships (mirrors DEV-19's own disclosed residual: "no live RTL-triggering language exists yet").
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

/** Locally-registered languages, INCLUDING their direction — kept in apps/mobile (not the shared
 * @krishi-verse/i18n package, out of this batch's scope) so registering a not-yet-live language never touches a
 * package file. `ur` (Urdu) is CLOSE-2's own shipped RTL design-canon language (screens/lang-ur/) with no
 * mobile-app translation catalog yet — registering it here is the "honest boundary" the founder brief asks for:
 * the MECHANISM (dir flip, RN's built-in RTL layout mirroring) is real and ships this batch; the CATALOG does not
 * exist, so `ur` cannot be selected as an active language yet.
 * [QA-FIX 2026-07-26]: this map is NOT yet consumed anywhere at runtime — `features/system/system.ts`'s own
 * `COMING_LANGUAGES` (consumed by `(system)/language.tsx`'s "coming soon" row) is a plain code list with no
 * direction field and does NOT import this map (grep-verified: zero references to `COMING_LANGUAGE_DIR` outside
 * this file and its own unit test). A prior version of this comment claimed system.ts already consumed it — that
 * was inaccurate; corrected here. This map exists as forward-compatible, tested infrastructure a future language-
 * switcher update can read directly (no shape change needed) once a real `ur` catalog ships. */
export const COMING_LANGUAGE_DIR: Record<string, Direction> = {
  mr: 'ltr', // pre-existing COMING_LANGUAGES entry (Marathi) — included here only so callers have one map to read
  ur: 'rtl', // NEW this batch — canon-shipped (CLOSE-2), no mobile catalog yet
};
