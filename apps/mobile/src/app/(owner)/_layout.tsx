// apps/mobile/src/app/(owner)/_layout.tsx · the tenant-owner (FPO/business) role's bottom-tab navigator —
// tenant-admin-LITE: monitoring + approvals on the go (heavy admin stays on apps/web-tenant). Mirrors the other
// role layouts: auth-gated + behind the `tenant_admin_lite` kill-switch flag (Law 10). Law 11: NO god-mode here —
// every action is authorized SERVER-SIDE against the tenant admin's own permissions. Detail/sub routes hidden.
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { color, font, EmptyState } from '@krishi-verse/ui-native';
import { useAuth } from '../../core/auth/auth.store';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }} accessibilityElementsHidden importantForAccessibility="no">{glyph}</Text>;
}

export default function OwnerTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('tenant_admin_lite');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // See (farmer)/_layout.tsx: react-native-screens has no default scene background — pin it to the app's
        // cream page color so a slow/erroring screen never shows raw black (Law 12).
        sceneContainerStyle: { backgroundColor: color.page },
        tabBarActiveTintColor: color.primary600,
        tabBarInactiveTintColor: color.ink400,
        tabBarStyle: { backgroundColor: color.card, borderTopColor: color.ink100, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('owner.tabs.dashboard'), tabBarIcon: ({ focused }) => <Icon glyph="📊" focused={focused} /> }} />
      <Tabs.Screen name="farmers" options={{ title: t('owner.tabs.farmers'), tabBarIcon: ({ focused }) => <Icon glyph="🧑‍🌾" focused={focused} /> }} />
      <Tabs.Screen name="approvals" options={{ title: t('owner.tabs.approvals'), tabBarIcon: ({ focused }) => <Icon glyph="✅" focused={focused} /> }} />
      <Tabs.Screen name="disputes" options={{ title: t('owner.tabs.disputes'), tabBarIcon: ({ focused }) => <Icon glyph="⚖️" focused={focused} /> }} />
      <Tabs.Screen name="apply" options={{ href: null }} />
      <Tabs.Screen name="pending" options={{ href: null }} />
      <Tabs.Screen name="farmer/[id]" options={{ href: null }} />
      <Tabs.Screen name="add-farmer" options={{ href: null }} />
      <Tabs.Screen name="approve/[id]" options={{ href: null }} />
      <Tabs.Screen name="dispute/[id]" options={{ href: null }} />
      <Tabs.Screen name="listings" options={{ href: null }} />
      <Tabs.Screen name="payouts" options={{ href: null }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="farmer-analytics" options={{ href: null }} />
      <Tabs.Screen name="order-analytics" options={{ href: null }} />
      <Tabs.Screen name="today-orders" options={{ href: null }} />
      <Tabs.Screen name="worker-analytics" options={{ href: null }} />
      <Tabs.Screen name="custom-report" options={{ href: null }} />
      <Tabs.Screen name="export" options={{ href: null }} />
      <Tabs.Screen name="broadcast" options={{ href: null }} />
      <Tabs.Screen name="campaigns" options={{ href: null }} />
      <Tabs.Screen name="payment-settings" options={{ href: null }} />
      <Tabs.Screen name="notif-settings" options={{ href: null }} />
      <Tabs.Screen name="integrations" options={{ href: null }} />
      <Tabs.Screen name="compliance" options={{ href: null }} />
      <Tabs.Screen name="branding" options={{ href: null }} />
      <Tabs.Screen name="billing" options={{ href: null }} />
      <Tabs.Screen name="team" options={{ href: null }} />
      <Tabs.Screen name="bulk-actions" options={{ href: null }} />
    </Tabs>
  );
}
