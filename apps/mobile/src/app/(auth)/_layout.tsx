// apps/mobile/src/app/(auth)/_layout.tsx · onboarding/auth stack. Headerless (each screen draws its own header
// via ScreenScaffold). The flow is welcome → language → phone → verify → role → profile, with explicit
// navigation between steps (we don't auto-redirect away once authenticated, because role + profile are
// post-OTP steps still inside this group).
import React from 'react';
import { Stack } from 'expo-router';
import { color } from '@krishalaya/ui-native';

export default function AuthLayout() {
  // contentStyle pins the native Screen surface to the app's cream page background — react-native-screens has no
  // default of its own, so without this a slow-loading screen (or a dark system theme) can show raw black through
  // the gap before JS content paints (Law 12: never a blank/black screen).
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: color.page } }} />;
}
