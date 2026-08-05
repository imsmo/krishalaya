// apps/mobile/src/app/(dairy)/_layout.tsx · the dairy-farmer role's bottom-tab navigator (PC-50 W10-2):
// Home / Diary / Bills / Rates. Auth-gated + behind the `dairy` kill-switch (Law 10). This persona is a TRUST
// MIRROR — the farmer READS what the cooperative recorded and settled; recording happens at the MCC counter.
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

export default function DairyTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('dairy');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="home" options={{ title: t('dairyapp.tab.home'), tabBarIcon: ({ focused }) => <Icon glyph="🏠" focused={focused} /> }} />
      <Tabs.Screen name="diary" options={{ title: t('dairyapp.tab.diary'), tabBarIcon: ({ focused }) => <Icon glyph="🥛" focused={focused} /> }} />
      <Tabs.Screen name="bills/index" options={{ title: t('dairyapp.tab.bills'), tabBarIcon: ({ focused }) => <Icon glyph="🧾" focused={focused} /> }} />
      <Tabs.Screen name="rates" options={{ title: t('dairyapp.tab.rates'), tabBarIcon: ({ focused }) => <Icon glyph="📈" focused={focused} /> }} />
      <Tabs.Screen name="bills/[id]" options={{ href: null }} />
    </Tabs>
  );
}
