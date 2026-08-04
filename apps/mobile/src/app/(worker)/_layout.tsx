// apps/mobile/src/app/(worker)/_layout.tsx · the worker role's bottom-tab navigator (Home / Jobs / Offers /
// Profile). Mirrors the (farmer)/(buyer) layouts: auth-gated (anonymous → onboarding; the server re-enforces on
// every call) and behind the `worker_app` kill-switch flag (Law 10). Detail routes are hidden from the tab bar.
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

export default function WorkerTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const workerOn = useFlag('worker_app');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!workerOn) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

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
      <Tabs.Screen name="jobs" options={{ title: t('worker.tabs.jobs'), tabBarIcon: ({ focused }) => <Icon glyph="🌾" focused={focused} /> }} />
      <Tabs.Screen name="offers" options={{ title: t('worker.tabs.offers'), tabBarIcon: ({ focused }) => <Icon glyph="📨" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ focused }) => <Icon glyph="👤" focused={focused} /> }} />
      <Tabs.Screen name="jobs/[id]" options={{ href: null }} />
      <Tabs.Screen name="jobs/apply/[id]" options={{ href: null }} />
      <Tabs.Screen name="offers/[id]" options={{ href: null }} />
      <Tabs.Screen name="offers/decline/[id]" options={{ href: null }} />
      <Tabs.Screen name="my-jobs" options={{ href: null }} />
      <Tabs.Screen name="availability" options={{ href: null }} />
      <Tabs.Screen name="skills" options={{ href: null }} />
      <Tabs.Screen name="profile/edit" options={{ href: null }} />
      <Tabs.Screen name="profile/skills-add" options={{ href: null }} />
      <Tabs.Screen name="active-job/[id]" options={{ href: null }} />
      <Tabs.Screen name="payment-received/[id]" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
      <Tabs.Screen name="withdraw" options={{ href: null }} />
      <Tabs.Screen name="reviews" options={{ href: null }} />
      <Tabs.Screen name="insurance" options={{ href: null }} />
      <Tabs.Screen name="work-history" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="dispute/[id]" options={{ href: null }} />
      <Tabs.Screen name="help" options={{ href: null }} />
      <Tabs.Screen name="pmsby-enroll" options={{ href: null }} />
      <Tabs.Screen name="claim" options={{ href: null }} />
    </Tabs>
  );
}
