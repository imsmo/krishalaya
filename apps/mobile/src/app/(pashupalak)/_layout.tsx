// apps/mobile/src/app/(pashupalak)/_layout.tsx · the Pashupalak role's bottom-tab navigator (PC-50 W10-1):
// Home / Herd / Vets / Bookings. Mirrors the (worker) layout: auth-gated + behind the `livestock` kill-switch
// (Law 10). Detail routes are hidden from the tab bar.
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

export default function PashupalakTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('livestock');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="home" options={{ title: t('pashu.tab.home'), tabBarIcon: ({ focused }) => <Icon glyph="🏠" focused={focused} /> }} />
      <Tabs.Screen name="animals/index" options={{ title: t('pashu.tab.herd'), tabBarIcon: ({ focused }) => <Icon glyph="🐄" focused={focused} /> }} />
      <Tabs.Screen name="vets/index" options={{ title: t('pashu.tab.vets'), tabBarIcon: ({ focused }) => <Icon glyph="🩺" focused={focused} /> }} />
      <Tabs.Screen name="bookings/index" options={{ title: t('pashu.tab.bookings'), tabBarIcon: ({ focused }) => <Icon glyph="🗓" focused={focused} /> }} />
      <Tabs.Screen name="animals/add" options={{ href: null }} />
      <Tabs.Screen name="animals/[id]" options={{ href: null }} />
      <Tabs.Screen name="vets/[id]" options={{ href: null }} />
      <Tabs.Screen name="bookings/[id]" options={{ href: null }} />
    </Tabs>
  );
}
