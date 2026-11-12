// apps/mobile/src/app/_layout.tsx · the expo-router ROOT layout. Wraps the whole app in SafeAreaProvider +
// AuthProvider, keeps the splash up until session + fonts are restored, then renders the route tree (Slot). Auth
// gating is per-group; this root owns providers + boot. Boot work: fail-closed config import, remote flag/kill-
// switch hydration, and the offline SYNC ENGINE (NetInfo + AppState → replay the write queue on reconnect /
// foreground). An offline banner sits above the routes (degrade-never-die UX).
import React, { useCallback, useEffect } from 'react';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { color, OfflineBanner } from '@krishalaya/ui-native';
import { AuthProvider } from '../core/auth/auth.store';
import { AppErrorBoundary } from '../core/errors/AppErrorBoundary';
import { hydrateFlags } from '../core/flags/hydrate';
import { startSyncEngine } from '../core/offline/sync.engine';
import { useConnectivity } from '../core/connectivity/connectivity';
import { useTranslation } from '../core/i18n/useTranslation';
import { initObservability, rotateCorrelationId, flushAnalytics } from '../core/observability';
import { ForcedUpdateGate, checkAndFetchOta } from '../core/release';
import { isEnabled } from '../core/flags/flags';
import { hydrateMechanismPreferences } from '../core/mechanisms/mechanismStore.runtime';
import { useThemeMode } from '../core/mechanisms/useThemeMode';
import { statusBarStyleFor } from '../core/mechanisms/theme';
import { MachineDraftBanner, LanguageRestartNotice } from '../core/i18n/LanguageShell';
import '../core/offline/handlers'; // register offline replay handlers (media.upload, listing.create)
import '../core/config'; // fail-closed env validation at boot

// PC-56 BUNDLE-1a: ONLY the 6 faces the app uses, each `require`d by file. Importing them from an @expo-google-fonts
// package index made every weight of every family ship (Metro doesn't tree-shake: 37 TTFs, ~4.15 MB); by file, 6 ship.
// The keys are the fontFamily names ui-native's `font` tokens use — unchanged (pinned by core spec bundle1a-size-and-fonts).
/* eslint-disable no-restricted-syntax -- a font asset is a Metro `require` of the file; an ES import of a .ttf has no type */
const FONT_FACES = {
  Fraunces: require('@expo-google-fonts/fraunces/Fraunces_700Bold.ttf'),
  PlusJakartaSans: require('@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_400Regular.ttf'),
  PlusJakartaSans_Semibold: require('@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_600SemiBold.ttf'),
  PlusJakartaSans_Bold: require('@expo-google-fonts/plus-jakarta-sans/PlusJakartaSans_700Bold.ttf'),
  Hind: require('@expo-google-fonts/hind/Hind_400Regular.ttf'),
  Hind_Semibold: require('@expo-google-fonts/hind/Hind_600SemiBold.ttf'),
};
/* eslint-enable no-restricted-syntax */

function ConnectivityBanner() {
  const online = useConnectivity();
  const { t } = useTranslation();
  // On reconnect: flush buffered analytics (§6), fresh correlation id, and check for an OTA update (flag-gated,
  // never mid-critical-flow; staged for the next cold start — §8). All best-effort.
  useEffect(() => {
    if (!online) return;
    rotateCorrelationId();
    void flushAnalytics();
    void checkAndFetchOta({ enabled: isEnabled('ota_updates'), isCriticalFlow: false });
  }, [online]);
  return <OfflineBanner visible={!online} message={t('common.offline')} />;
}

export default function RootLayout() {
  // `error` matters as much as `loaded`: if a font asset can't be fetched (e.g. a Metro/pnpm asset hiccup in
  // Expo Go), we must still render — falling back to the system font — rather than hang forever on the splash.
  const [fontsLoaded, fontError] = useFonts(FONT_FACES);

  // DEV-20: resolved color-scheme drives the OS status-bar icon color (the one real, canon-independent effect —
  // see core/mechanisms/theme.ts's own header for why this does NOT yet repaint any screen).
  const { scheme } = useThemeMode();

  const onLayout = useCallback(() => { /* hook point for SplashScreen.hideAsync once ready */ }, []);
  // Boot: hydrate remote flags (best-effort), then start the sync engine (replays queued writes on reconnect).
  useEffect(() => {
    initObservability(); // crash + analytics providers (no-op without a DSN; never breaks boot) — §6
    void hydrateFlags();
    void hydrateMechanismPreferences(); // DEV-20: restore theme-mode + senior-mode preferences (best-effort)
    // PC-56 RTL-1h-1: the RTL flags are NOT set here any more. This effect ran before the saved language was read (so it always
    // saw 'en') and mapped 'ar' to 'ltr'; the direction is now applied by the AuthProvider's start-up restore, from the saved
    // choice (core/i18n/languageChoice.ts → restoreSavedLanguage), and at a language tap.
    const stop = startSyncEngine();
    return stop;
    // Deliberately empty deps: this boot effect runs exactly once. No `eslint-disable` comment here — this project's ESLint config
    // doesn't register `react-hooks/exhaustive-deps` at all (5 pre-existing files already show the resulting
    // "Definition for rule ... was not found" error for the same reason; a disable comment for an unregistered
    // rule is itself a lint error, not a suppression, per that disclosed baseline gate-quality debt).
  }, []);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: color.page }} />;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: color.page }} onLayout={onLayout}>
        <StatusBar style={statusBarStyleFor(scheme)} />
        <AuthProvider>
          <ConnectivityBanner />
          <MachineDraftBanner />
          <LanguageRestartNotice />
          <AppErrorBoundary>
            <ForcedUpdateGate>
              <Slot />
            </ForcedUpdateGate>
          </AppErrorBoundary>
        </AuthProvider>
      </View>
    </SafeAreaProvider>
  );
}
