// apps/mobile/src/core/mechanisms/useThemeMode.ts · DEV-20: the React hook screens/settings use to read + change
// the theme-mode preference. Mirrors core/i18n/useTranslation.ts's useSyncExternalStore shape exactly.
import { useSyncExternalStore, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { mechanismPreferences } from './mechanismStore.runtime';
import { resolveColorScheme, type ColorScheme, type ThemeMode } from './theme';

export interface UseThemeModeResult {
  /** The user's stored preference: 'system' | 'light' | 'dark'. */
  mode: ThemeMode;
  /** The EFFECTIVE scheme after resolving 'system' against the OS's reported appearance. See theme.ts's own
   * header comment for the honest boundary: no farmer-app dark PALETTE is ratified in canon yet, so this scheme
   * value drives the OS status-bar icon color (real, canon-independent) but not a screen repaint (not yet real). */
  scheme: ColorScheme;
  setMode: (mode: ThemeMode) => void;
}

export function useThemeMode(): UseThemeModeResult {
  const mode = useSyncExternalStore(
    (cb) => mechanismPreferences.subscribe(cb),
    () => mechanismPreferences.themeMode,
    () => mechanismPreferences.themeMode,
  );
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null | undefined
  const setMode = useCallback((m: ThemeMode) => { void mechanismPreferences.setThemeMode(m); }, []);
  const scheme = resolveColorScheme(mode, systemScheme as ColorScheme | null | undefined);
  return { mode, scheme, setMode };
}
