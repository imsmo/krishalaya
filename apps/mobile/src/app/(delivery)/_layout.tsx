// apps/mobile/src/app/(delivery)/_layout.tsx · the rider role's bottom-tab navigator (PC-50 W10-5):
// Today / History. Auth-gated + behind the `delivery_partner` kill-switch (Law 10). box=mine everywhere —
// a rider sees ONLY their assigned shipments (server-scoped).
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

export default function DeliveryTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('delivery_partner');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="tasks/index" options={{ title: t('rider.tab.today'), tabBarIcon: ({ focused }) => <Icon glyph="🛵" focused={focused} /> }} />
      <Tabs.Screen name="history" options={{ title: t('rider.tab.history'), tabBarIcon: ({ focused }) => <Icon glyph="📜" focused={focused} /> }} />
      <Tabs.Screen name="tasks/[id]" options={{ href: null }} />
    </Tabs>
  );
}
