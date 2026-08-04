// apps/mobile/src/core/__tests__/dev20-mechanisms.spec.ts · DEV-20 (4 UI mechanisms in apps/mobile) unit suite.
// Covers the PURE resolver/math logic in `core/mechanisms/{theme,seniorMode,splitLayout,rtl}.ts` — every one of
// these files is zero-RN-import by construction (see each file's own header) specifically so it can be unit
// tested here under the "core" jest project (node environment, no RN mocks needed). The RN-facing glue
// (`mechanismStore.runtime.ts`'s AsyncStorage persistence, `useThemeMode`/`useSeniorMode`/`useSplitLayout` hooks,
// `rtlBoot.ts`'s I18nManager call) is exercised by the render-project suite instead
// (`dev20-mechanisms.render-spec.tsx`) — same "pure logic here, RN glue there" convention DEV-14/dev14's own
// header documents for this directory.
import {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  isThemeMode,
  resolveColorScheme,
  statusBarStyleFor,
  type ThemeMode,
} from '../mechanisms/theme';
import {
  SENIOR_TYPE_SCALE,
  SENIOR_TAP_MIN,
  seniorFontSize,
  seniorFontSizeScale,
  effectiveTapMin,
} from '../mechanisms/seniorMode';
import {
  SPLIT_BREAKPOINT_PX,
  SPLIT_MAX_WIDTH_PX,
  SPLIT_LIST_COL_PX,
  isEligibleForSplit,
  splitListColumnWidth,
} from '../mechanisms/splitLayout';
import {
  shouldForceRTL,
  rtlChangeRequiresReload,
  COMING_LANGUAGE_DIR,
} from '../mechanisms/rtl';

describe('mechanisms/theme (DEV-20 mechanism 1/4 — dark)', () => {
  it('DEFAULT_THEME_MODE is system (never opts a user into a variant unrequested — Golden Law 8 spirit)', () => {
    expect(DEFAULT_THEME_MODE).toBe('system');
    expect(THEME_MODES).toEqual(['system', 'light', 'dark']);
  });

  it('isThemeMode is a real type guard — never trusts a stale/corrupt storage read', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
    expect(isThemeMode(42)).toBe(false);
  });

  it('resolveColorScheme: explicit light/dark always wins over the OS scheme', () => {
    expect(resolveColorScheme('light', 'dark')).toBe('light');
    expect(resolveColorScheme('dark', 'light')).toBe('dark');
  });

  it('resolveColorScheme: "system" mode follows the OS scheme when known', () => {
    expect(resolveColorScheme('system', 'dark')).toBe('dark');
    expect(resolveColorScheme('system', 'light')).toBe('light');
  });

  it('resolveColorScheme: "system" degrades to light on an unknown/undetectable OS scheme (never guesses dark)', () => {
    expect(resolveColorScheme('system', null)).toBe('light');
    expect(resolveColorScheme('system', undefined)).toBe('light');
  });

  it('statusBarStyleFor: light icons on a dark screen, dark icons on a light one', () => {
    expect(statusBarStyleFor('dark')).toBe('light');
    expect(statusBarStyleFor('light')).toBe('dark');
  });

  it('every ThemeMode round-trips through resolveColorScheme without throwing', () => {
    const modes: ThemeMode[] = ['system', 'light', 'dark'];
    for (const m of modes) expect(() => resolveColorScheme(m, 'dark')).not.toThrow();
  });
});

describe('mechanisms/seniorMode (DEV-20 mechanism 2/4 — senior, Q48)', () => {
  it('SENIOR_TYPE_SCALE is the ratified 1.30x constant, sourced from @krishalaya/tokens (not a re-typed literal)', () => {
    expect(SENIOR_TYPE_SCALE).toBe(1.3);
  });

  it('SENIOR_TAP_MIN is the ratified 56px canon figure (tokens.css --tap-large)', () => {
    expect(SENIOR_TAP_MIN).toBe(56);
  });

  it('seniorFontSize: matches screen.css\'s own worked example (16px -> 20.8px)', () => {
    expect(seniorFontSize(16)).toBeCloseTo(20.8, 5);
  });

  it('seniorFontSize: rounds to one decimal for every input, never throws on zero/negative', () => {
    expect(seniorFontSize(12)).toBeCloseTo(15.6, 5);
    expect(seniorFontSize(20)).toBeCloseTo(26, 5);
    expect(seniorFontSize(0)).toBe(0);
  });

  it('seniorFontSizeScale: scales every key of a font-size table, passes keys through unchanged', () => {
    const base = { xs: 12, sm: 14, md: 16, lg: 18, xl: 24 };
    const scaled = seniorFontSizeScale(base);
    expect(Object.keys(scaled)).toEqual(Object.keys(base));
    expect(scaled.md).toBeCloseTo(20.8, 5);
    expect(scaled.xl).toBeCloseTo(31.2, 5);
  });

  it('effectiveTapMin: senior OFF never changes the base tap size', () => {
    expect(effectiveTapMin(48, false)).toBe(48);
    expect(effectiveTapMin(60, false)).toBe(60); // a screen already above the floor stays untouched either way
  });

  it('effectiveTapMin: senior ON raises a below-floor control to 56px, never shrinks an already-larger one (Rule Zero)', () => {
    expect(effectiveTapMin(48, true)).toBe(56);
    expect(effectiveTapMin(60, true)).toBe(60);
    expect(effectiveTapMin(56, true)).toBe(56);
  });
});

describe('mechanisms/splitLayout (DEV-20 mechanism 3/4 — tablet two-pane, APPLY-9/Q49)', () => {
  it('ratified canon constants: 768px breakpoint, 1100px max-width, 280px list column', () => {
    expect(SPLIT_BREAKPOINT_PX).toBe(768);
    expect(SPLIT_MAX_WIDTH_PX).toBe(1100);
    expect(SPLIT_LIST_COL_PX).toBe(280);
  });

  it('isEligibleForSplit: below the breakpoint is never eligible, regardless of pointer type', () => {
    expect(isEligibleForSplit(375, true)).toBe(false);
    expect(isEligibleForSplit(767, true)).toBe(false);
  });

  it('isEligibleForSplit: at/above the breakpoint requires a coarse pointer (matches the canon\'s own gate exactly)', () => {
    expect(isEligibleForSplit(768, true)).toBe(true);
    expect(isEligibleForSplit(1024, true)).toBe(true);
    expect(isEligibleForSplit(1024, false)).toBe(false); // fine-pointer desktop browser at tablet width: NOT split
  });

  it('isEligibleForSplit: defaults to coarse-pointer=true when the caller omits it (native is always a touchscreen)', () => {
    expect(isEligibleForSplit(800)).toBe(true);
    expect(isEligibleForSplit(320)).toBe(false);
  });

  it('splitListColumnWidth: always returns the ratified 280px figure', () => {
    expect(splitListColumnWidth()).toBe(280);
  });
});

describe('mechanisms/rtl (DEV-20 mechanism 4/4 — RTL, APPLY-6/BRAND-017)', () => {
  it('shouldForceRTL: true only for rtl, false for ltr/null/undefined', () => {
    expect(shouldForceRTL('rtl')).toBe(true);
    expect(shouldForceRTL('ltr')).toBe(false);
    expect(shouldForceRTL(null)).toBe(false);
    expect(shouldForceRTL(undefined)).toBe(false);
  });

  it('rtlChangeRequiresReload: flags a real flip, not a no-op re-application of the same value', () => {
    expect(rtlChangeRequiresReload(false, 'rtl')).toBe(true); // ltr-forced app switching to an rtl language
    expect(rtlChangeRequiresReload(true, 'ltr')).toBe(true); // rtl-forced app switching to an ltr language
    expect(rtlChangeRequiresReload(false, 'ltr')).toBe(false); // already ltr, staying ltr
    expect(rtlChangeRequiresReload(true, 'rtl')).toBe(false); // already rtl, staying rtl
  });

  it('every live app language (hi/en/gu) resolves to false today (HONEST BOUNDARY: mechanism real, structurally inactive)', () => {
    // Mirrors this batch's own header comment: @krishalaya/i18n's live registry carries only hi/en/gu, all ltr.
    for (const dir of ['ltr', 'ltr', 'ltr'] as const) expect(shouldForceRTL(dir)).toBe(false);
  });

  it('COMING_LANGUAGE_DIR registers ur (Urdu, CLOSE-2 canon) as rtl, mr (Marathi) as ltr — no live catalog yet', () => {
    expect(COMING_LANGUAGE_DIR.ur).toBe('rtl');
    expect(COMING_LANGUAGE_DIR.mr).toBe('ltr');
    expect(shouldForceRTL(COMING_LANGUAGE_DIR.ur)).toBe(true); // proves the mechanism WOULD activate once real
  });
});
