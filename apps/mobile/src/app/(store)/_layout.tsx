// apps/mobile/src/app/(store)/_layout.tsx · the store-owner role's bottom-tab navigator (PC-50 W10-4):
// Orders / Inventory / Batches / Licence. Auth-gated + behind the `store_owner` kill-switch (Law 10).
// The agri-input store persona (RBAC pharma_store): sells to farmers, keeps a batch/expiry stock ledger.
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

export default function StoreTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('store_owner');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="orders/index" options={{ title: t('store.tab.orders'), tabBarIcon: ({ focused }) => <Icon glyph="🧾" focused={focused} /> }} />
      <Tabs.Screen name="inventory" options={{ title: t('store.tab.inventory'), tabBarIcon: ({ focused }) => <Icon glyph="📦" focused={focused} /> }} />
      <Tabs.Screen name="batches/index" options={{ title: t('store.tab.batches'), tabBarIcon: ({ focused }) => <Icon glyph="🏷" focused={focused} /> }} />
      <Tabs.Screen name="licence" options={{ title: t('store.tab.licence'), tabBarIcon: ({ focused }) => <Icon glyph="📋" focused={focused} /> }} />
      <Tabs.Screen name="orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="batches/add" options={{ href: null }} />
    </Tabs>
  );
}
