// apps/mobile/src/core/mechanisms/mechanismStore.runtime.ts · DEV-20: the RN-facing singleton runtimes for the
// theme-mode + senior-mode PREFERENCES (persisted, subscribable). Kept separate from the pure logic files
// (theme.ts/seniorMode.ts, which stay zero-RN-import and unit-tested under the "core" jest project) — this file
// imports AsyncStorage/react-native and is exercised only via the render-project tests + manual QA, mirroring
// core/auth/token-store.ts's own "storage glue is not pure-logic-unit-tested" convention.
//
// Storage keys follow the app's existing `kv.*` non-secret-preference convention (core/auth/token-store.ts's
// `kv.lang`/`kv.role`). Both preferences default OFF/system (never opt the user into an unrequested variant —
// Golden Law 8's "feature-flagged by default" spirit applied to a UI preference, not just a server flag).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_THEME_MODE, isThemeMode, type ThemeMode } from './theme';

const K_THEME_MODE = 'kv.themeMode';
const K_SENIOR_MODE = 'kv.seniorMode';

class MechanismPreferenceRuntime {
  private _themeMode: ThemeMode = DEFAULT_THEME_MODE;
  private _seniorMode = false;
  private readonly listeners = new Set<() => void>();

  get themeMode(): ThemeMode { return this._themeMode; }
  get seniorMode(): boolean { return this._seniorMode; }

  /** Best-effort restore at boot (mirrors hydrateFlags' degrade-never-die shape: any storage failure just keeps
   * the safe defaults — never blocks or crashes boot). Call once from the root layout's boot effect. */
  async hydrate(): Promise<void> {
    try {
      const [mode, senior] = await Promise.all([
        AsyncStorage.getItem(K_THEME_MODE),
        AsyncStorage.getItem(K_SENIOR_MODE),
      ]);
      let changed = false;
      if (isThemeMode(mode) && mode !== this._themeMode) { this._themeMode = mode; changed = true; }
      const seniorOn = senior === '1';
      if (seniorOn !== this._seniorMode) { this._seniorMode = seniorOn; changed = true; }
      if (changed) this.listeners.forEach((l) => l());
    } catch {
      /* keep built-in defaults — degrade-never-die */
    }
  }

  async setThemeMode(mode: ThemeMode): Promise<void> {
    this._themeMode = mode;
    this.listeners.forEach((l) => l());
    try { await AsyncStorage.setItem(K_THEME_MODE, mode); } catch { /* best-effort persistence */ }
  }

  async setSeniorMode(on: boolean): Promise<void> {
    this._seniorMode = on;
    this.listeners.forEach((l) => l());
    try { await AsyncStorage.setItem(K_SENIOR_MODE, on ? '1' : '0'); } catch { /* best-effort persistence */ }
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const mechanismPreferences = new MechanismPreferenceRuntime();

/** Boot-time hydrate entry point, named/shaped like `hydrateFlags()` so `_layout.tsx`'s boot effect reads the
 * same way for every subsystem. */
export async function hydrateMechanismPreferences(): Promise<void> {
  await mechanismPreferences.hydrate();
}
