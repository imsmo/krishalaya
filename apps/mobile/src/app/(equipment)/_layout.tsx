// apps/mobile/src/app/(equipment)/_layout.tsx · the equipment-owner (CHC) role's bottom-tab navigator
// (PC-50 W10-6; design canon screens 308–312): Requests / Fleet / Earnings. Auth-gated + behind the
// `equipment_owner` kill-switch (Law 10). The OWNER side of the rental lifecycle; the renter confirms
// and pays from their own device.
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

export default function EquipmentTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('equipment_owner');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="rentals/index" options={{ title: t('equip.tab.requests'), tabBarIcon: ({ focused }) => <Icon glyph="🚜" focused={focused} /> }} />
      <Tabs.Screen name="fleet/index" options={{ title: t('equip.tab.fleet'), tabBarIcon: ({ focused }) => <Icon glyph="🛠" focused={focused} /> }} />
      <Tabs.Screen name="earnings" options={{ title: t('equip.tab.earnings'), tabBarIcon: ({ focused }) => <Icon glyph="💰" focused={focused} /> }} />
      <Tabs.Screen name="rentals/[id]" options={{ href: null }} />
      <Tabs.Screen name="fleet/add" options={{ href: null }} />
      <Tabs.Screen name="fleet/[id]" options={{ href: null }} />
    </Tabs>
  );
}
