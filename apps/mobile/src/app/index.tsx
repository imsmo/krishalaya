// apps/mobile/src/app/index.tsx · the entry gate. While the session is restoring (status 'booting') we show a
// neutral splash; once known we redirect: anonymous → onboarding welcome, authenticated → the active role's home
// (farmer is the built vertical this release). No screen flashes because we wait for 'booting' to resolve.
import React from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { color } from '@krishalaya/ui-native';
import { useAuth } from '../core/auth/auth.store';

export default function Index() {
  const { state } = useAuth();
  if (state.status === 'booting') {
    return <View style={{ flex: 1, backgroundColor: color.page, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.primary600} /></View>;
  }
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  // Authenticated. Farmer is the implemented home; other role groups land here until they ship.
  return <Redirect href="/(farmer)/home" />;
}
