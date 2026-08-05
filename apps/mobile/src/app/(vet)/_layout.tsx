// apps/mobile/src/app/(vet)/_layout.tsx · the vet-professional role's bottom-tab navigator (PC-50 W10-3):
// Practice / Bookings / Earnings. Auth-gated + behind the `vet` kill-switch (Law 10). This is the PROVIDER
// side of the Pashupalak app's bookings — the vet drives the service lifecycle; the farmer pays.
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { color, EmptyState } from '@krishalaya/ui-native';
import { useAuth } from '../../core/auth/auth.store';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }} accessibilityElementsHidden importantForAccessibility="no">{glyph}</Text>;
}

export default function VetTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('vet');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="home" options={{ title: t('vetpro.tab.practice'), tabBarIcon: ({ focused }) => <Icon glyph="🩺" focused={focused} /> }} />
      <Tabs.Screen name="bookings/index" options={{ title: t('vetpro.tab.bookings'), tabBarIcon: ({ focused }) => <Icon glyph="🗓" focused={focused} /> }} />
      <Tabs.Screen name="earnings" options={{ title: t('vetpro.tab.earnings'), tabBarIcon: ({ focused }) => <Icon glyph="💰" focused={focused} /> }} />
      <Tabs.Screen name="bookings/[id]" options={{ href: null }} />
    </Tabs>
  );
}
