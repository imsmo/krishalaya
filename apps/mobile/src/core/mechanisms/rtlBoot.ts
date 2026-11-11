// apps/mobile/src/core/mechanisms/rtlBoot.ts · DEV-20: applies the RTL mechanism to RN's own layout engine at
// start-up (from the restored saved choice) and at a language tap. Thin `I18nManager` glue — kept separate from rtl.ts's pure
// resolver so the resolver stays zero-RN-import and unit-tested under the "core" jest project.
//
// RN LIMITATION (disclosed, not hidden): `I18nManager.forceRTL()` flips the flag RN's layout engine reads, but
// RN only re-measures every mounted view's layout direction after a FULL JS reload — it is not a live, in-place
// re-render like `[dir="rtl"]` is on the web canon. This mirrors the exact limitation the canon's own screen.css
// comment discloses for a different reason (its "HONESTY NOTE" on the tablet mechanism, static-canon vs.
// interactive) — here the honest note is: calling this with a changed value returns `true` (reload recommended)
// so a caller (e.g. the language switcher) can prompt the user, never silently leave the UI half-mirrored.
import { I18nManager } from 'react-native';
import { shouldForceRTL, rtlChangeRequiresReload, type Direction } from './rtl';

/** Apply (or re-apply, idempotently) RN's RTL flags for the direction of the language a person CHOSE. Returns true when the
 * call actually changed the forced value (i.e. a reload is needed for full effect), false when it was already a no-op.
 *
 * PC-56 RTL-1h-1 (survey F-H1, the live leak): RN's `allowRTL` defaults to TRUE, and `isRTL = forced || (allowed &&
 * deviceLocaleIsRTL)` — so an Android phone set to Arabic/Urdu/Persian/Hebrew laid the WHOLE app out right-to-left with
 * en/hi/gu words, and this function used to re-enable that on every start with `allowRTL(true)`. Right-to-left is now
 * ALLOWED only for an 'rtl' direction (a chosen Arabic: allowRTL(true) + forceRTL(true)); every other direction locks the
 * layout left-to-right (allowRTL(false) + forceRTL(false)), whatever the phone's language. The flags persist natively, so
 * they take effect from the next open. Callers: core/i18n/languageChoice.ts only (the start-up restore and a tap). */
export function applyRtlForDirection(dir: Direction | null | undefined): boolean {
  const forced = shouldForceRTL(dir);
  const needsReload = rtlChangeRequiresReload(I18nManager.isRTL, dir);
  // Right-to-left is allowed ONLY when it is forced by a chosen rtl language — never from the phone's own language.
  I18nManager.allowRTL(forced);
  I18nManager.forceRTL(forced);
  return needsReload;
}
