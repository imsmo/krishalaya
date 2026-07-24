// apps/mobile/src/core/mechanisms/useSeniorMode.ts · DEV-20: the React hook screens/settings use to read + toggle
// senior mode, plus the scaled type-size table + effective tap floor a screen applies when it's on. Mirrors
// core/flags/useFlag.ts's useSyncExternalStore shape.
import { useSyncExternalStore, useCallback, useMemo } from 'react';
import { font as baseFont } from '@krishi-verse/ui-native';
import { mechanismPreferences } from './mechanismStore.runtime';
import { seniorFontSizeScale, effectiveTapMin, SENIOR_TAP_MIN } from './seniorMode';

export interface UseSeniorModeResult {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** ui-native's `font.size` scale, OR the same shape scaled 1.30x (Q48) when senior mode is on — a screen reads
   * this instead of `font.size` directly so its own StyleSheet reflects the ratified senior scale. Never invents a
   * step ui-native didn't already define. */
  fontSize: typeof baseFont.size;
  /** The tap-target floor (px) a screen's pressable controls should honor — 48 (ui-native's existing HIT_TARGET)
   * normally, 56 (canon's --tap-large, Q48) when senior mode is on. Never smaller than the app's own baseline. */
  tapMin: number;
}

const BASE_TAP_MIN = 48; // matches @krishi-verse/ui-native's HIT_TARGET

export function useSeniorMode(): UseSeniorModeResult {
  const enabled = useSyncExternalStore(
    (cb) => mechanismPreferences.subscribe(cb),
    () => mechanismPreferences.seniorMode,
    () => mechanismPreferences.seniorMode,
  );
  const setEnabled = useCallback((on: boolean) => { void mechanismPreferences.setSeniorMode(on); }, []);
  const fontSize = useMemo(() => (enabled ? seniorFontSizeScale(baseFont.size) : baseFont.size), [enabled]);
  const tapMin = effectiveTapMin(BASE_TAP_MIN, enabled);
  return { enabled, setEnabled, fontSize, tapMin };
}

export { SENIOR_TAP_MIN };
