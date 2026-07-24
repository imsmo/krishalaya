// apps/mobile/src/core/mechanisms/rtlBoot.ts · DEV-20: applies the RTL mechanism to RN's own layout engine at
// boot (and whenever the active language changes). Thin `I18nManager` glue — kept separate from rtl.ts's pure
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

/** Apply (or re-apply, idempotently) RN's forced-RTL flag for a given language direction. Returns true when the
 * call actually changed the forced value (i.e. a reload is needed for full effect), false when it was already a
 * no-op (including the common case today: every live app language is 'ltr', so this call is inert). */
export function applyRtlForDirection(dir: Direction | null | undefined): boolean {
  const forced = shouldForceRTL(dir);
  const needsReload = rtlChangeRequiresReload(I18nManager.isRTL, dir);
  // allowRTL must be true for forceRTL to take effect at all; harmless to call every time (idempotent).
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(forced);
  return needsReload;
}
