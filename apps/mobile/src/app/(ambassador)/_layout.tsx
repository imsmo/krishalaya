// apps/mobile/src/app/(ambassador)/_layout.tsx · the village-ambassador role's bottom-tab navigator (Home /
// Farmers / Earnings). Mirrors the other role layouts: auth-gated (anonymous → onboarding; the server re-enforces
// on every call) and behind the `ambassador_app` kill-switch flag (Law 10). Onboarding/help/visit sub-routes are
// hidden from the tab bar.
import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { color, font, EmptyState } from '@krishalaya/ui-native';
import { useAuth } from '../../core/auth/auth.store';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';

function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }} accessibilityElementsHidden importantForAccessibility="no">{glyph}</Text>;
}

export default function AmbassadorTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('ambassador_app');
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
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: ({ focused }) => <Icon glyph="🏠" focused={focused} /> }} />
      <Tabs.Screen name="farmers" options={{ title: t('amb.tabs.farmers'), tabBarIcon: ({ focused }) => <Icon glyph="🧑‍🌾" focused={focused} /> }} />
      <Tabs.Screen name="earnings" options={{ title: t('amb.tabs.earnings'), tabBarIcon: ({ focused }) => <Icon glyph="💰" focused={focused} /> }} />
      <Tabs.Screen name="onboard-start" options={{ href: null }} />
      <Tabs.Screen name="onboard-scan" options={{ href: null }} />
      <Tabs.Screen name="onboard-verify" options={{ href: null }} />
      <Tabs.Screen name="onboard-complete" options={{ href: null }} />
      <Tabs.Screen name="help-listing" options={{ href: null }} />
      <Tabs.Screen name="help-order" options={{ href: null }} />
      <Tabs.Screen name="visit-log" options={{ href: null }} />
      <Tabs.Screen name="commissions" options={{ href: null }} />
      <Tabs.Screen name="withdraw" options={{ href: null }} />
      <Tabs.Screen name="leaderboard" options={{ href: null }} />
      <Tabs.Screen name="targets" options={{ href: null }} />
      <Tabs.Screen name="goal-setting" options={{ href: null }} />
      <Tabs.Screen name="training" options={{ href: null }} />
      <Tabs.Screen name="course/[id]" options={{ href: null }} />
      <Tabs.Screen name="lesson/[id]" options={{ href: null }} />
      <Tabs.Screen name="quiz/[id]" options={{ href: null }} />
      <Tabs.Screen name="faq" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}
