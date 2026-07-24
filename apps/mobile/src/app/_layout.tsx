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
import { useFonts, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans';
import { Hind_400Regular, Hind_600SemiBold } from '@expo-google-fonts/hind';
import { color, OfflineBanner } from '@krishi-verse/ui-native';
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
import { applyRtlForDirection } from '../core/mechanisms/rtlBoot';
import { resolveLanguage } from '@krishi-verse/i18n';
import '../core/offline/handlers'; // register offline replay handlers (media.upload, listing.create)
import '../core/config'; // fail-closed env validation at boot

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
  const [fontsLoaded, fontError] = useFonts({
    Fraunces: Fraunces_700Bold,
    PlusJakartaSans: PlusJakartaSans_400Regular,
    PlusJakartaSans_Semibold: PlusJakartaSans_600SemiBold,
    PlusJakartaSans_Bold: PlusJakartaSans_700Bold,
    Hind: Hind_400Regular,
    Hind_Semibold: Hind_600SemiBold,
  });

  // DEV-20: resolved color-scheme drives the OS status-bar icon color (the one real, canon-independent effect —
  // see core/mechanisms/theme.ts's own header for why this does NOT yet repaint any screen). `lang` is read once
  // below for the RTL boot mechanism.
  const { scheme } = useThemeMode();
  const { lang } = useTranslation();

  const onLayout = useCallback(() => { /* hook point for SplashScreen.hideAsync once ready */ }, []);
  // Boot: hydrate remote flags (best-effort), then start the sync engine (replays queued writes on reconnect).
  useEffect(() => {
    initObservability(); // crash + analytics providers (no-op without a DSN; never breaks boot) — §6
    void hydrateFlags();
    void hydrateMechanismPreferences(); // DEV-20: restore theme-mode + senior-mode preferences (best-effort)
    // DEV-20 RTL mechanism: apply RN's forced-RTL flag for the CURRENT boot language. Every live app language
    // (hi/en/gu) is `ltr` today (see core/mechanisms/rtl.ts's own header) so this is inert in production right
    // now — real once a live RTL language ships. Deliberately read once at boot, not on every language switch,
    // since I18nManager.forceRTL only fully takes effect after a JS reload (see rtlBoot.ts) — re-applying it
    // mid-session would half-mirror the running screen tree, worse than doing nothing.
    applyRtlForDirection(resolveLanguage(lang).dir);
    const stop = startSyncEngine();
    return stop;
    // Deliberately empty deps: this boot effect runs exactly once (see the RTL comment above for why re-running
    // it on every `lang` change would be wrong). No `eslint-disable` comment here — this project's ESLint config
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
