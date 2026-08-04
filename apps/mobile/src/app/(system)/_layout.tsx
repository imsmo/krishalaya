// apps/mobile/src/app/(system)/_layout.tsx · cross-cutting system stack (P-23): global search, settings, privacy
// + DPDP flows, permissions, tutorial, and the global fallback screens (offline / server-error / app-update).
// Headerless (each screen draws its own header via ScreenScaffold). Not auth-gated at the group level — these are
// reachable from anywhere (the data-backed calls enforce auth server-side); static fallbacks render unauthenticated.
import React from 'react';
import { Stack } from 'expo-router';
import { color } from '@krishalaya/ui-native';

export default function SystemLayout() {
  // contentStyle pins the native Screen surface to the app's cream page background — react-native-screens has no
  // default of its own, so without this a slow-loading/erroring screen (or a dark system theme) can show raw black
  // through the gap before JS content paints (Law 12: never a blank/black screen).
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: color.page } }} />;
}
