// apps/mobile/src/app/(farmer)/_layout.tsx · the farmer role's bottom-tab navigator (screen 09's tab bar:
// Home / Listings / Orders / Wallet / Profile). Auth-gated: an anonymous session is redirected to onboarding
// (the server also re-enforces auth on every call — this is just UX). Tab labels are localized.
import React, { useEffect } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { color, font, EmptyState } from '@krishalaya/ui-native';
import { useAuth } from '../../core/auth/auth.store';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { startPush } from '../../core/push/push';

function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }} accessibilityElementsHidden importantForAccessibility="no">{glyph}</Text>;
}

export default function FarmerTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const farmerOn = useFlag('farmer_app');
  const notifOn = useFlag('notifications');
  // Register for push + attach tap-routing once the authenticated farmer area mounts (JIT permission inside).
  useEffect(() => {
    if (state.status !== 'authenticated' || !notifOn) return;
    let cleanup: (() => void) | undefined;
    startPush().then((c) => { cleanup = c; }).catch(() => { /* push is best-effort */ });
    return () => cleanup?.();
  }, [state.status, notifOn]);
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  // Kill-switch: if ops disabled the farmer vertical via remote config, show a maintenance state (Law 10).
  if (!farmerOn) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // react-native-screens paints each tab's native Screen surface with NO default background of its own —
        // without this, a slow-loading/erroring screen (or a dark system theme) shows raw black through the gap
        // before JS content paints (Law 12: never a blank/black screen). This one line kills that whole class.
        sceneContainerStyle: { backgroundColor: color.page },
        tabBarActiveTintColor: color.primary600,
        tabBarInactiveTintColor: color.ink400,
        tabBarStyle: { backgroundColor: color.card, borderTopColor: color.ink100, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: ({ focused }) => <Icon glyph="🏠" focused={focused} /> }} />
      <Tabs.Screen name="listings/index" options={{ title: t('tabs.listings'), tabBarIcon: ({ focused }) => <Icon glyph="🌾" focused={focused} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), tabBarIcon: ({ focused }) => <Icon glyph="📦" focused={focused} /> }} />
      <Tabs.Screen name="wallet/index" options={{ title: t('tabs.wallet'), tabBarIcon: ({ focused }) => <Icon glyph="💰" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ focused }) => <Icon glyph="👤" focused={focused} /> }} />
      {/* Detail/create/sub routes live in the stack but are hidden from the tab bar. */}
      <Tabs.Screen name="listings/new" options={{ href: null }} />
      <Tabs.Screen name="listings/[id]" options={{ href: null }} />
      <Tabs.Screen name="listings/preview" options={{ href: null }} />
      <Tabs.Screen name="listings/edit" options={{ href: null }} />
      <Tabs.Screen name="listings/boost" options={{ href: null }} />
      <Tabs.Screen name="listings/analytics" options={{ href: null }} />
      <Tabs.Screen name="listings/repost" options={{ href: null }} />
      <Tabs.Screen name="create-auction" options={{ href: null }} />
      <Tabs.Screen name="auction/[id]" options={{ href: null }} />
      <Tabs.Screen name="auction/complete" options={{ href: null }} />
      <Tabs.Screen name="hire/book/confirm" options={{ href: null }} />
      <Tabs.Screen name="hire/book/where" options={{ href: null }} />
      <Tabs.Screen name="wallet/add-money" options={{ href: null }} />
      <Tabs.Screen name="wallet/withdraw" options={{ href: null }} />
      <Tabs.Screen name="wallet/transactions" options={{ href: null }} />
      <Tabs.Screen name="wallet/payouts" options={{ href: null }} />
      <Tabs.Screen name="wallet/txn-detail" options={{ href: null }} />
      <Tabs.Screen name="wallet/autopay" options={{ href: null }} />
      <Tabs.Screen name="wallet/earnings" options={{ href: null }} />
      <Tabs.Screen name="wallet/statement" options={{ href: null }} />
      <Tabs.Screen name="wallet/upi" options={{ href: null }} />
      <Tabs.Screen name="wallet/spending" options={{ href: null }} />
      <Tabs.Screen name="orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="orders/received" options={{ href: null }} />
      <Tabs.Screen name="orders/decision" options={{ href: null }} />
      <Tabs.Screen name="orders/pod" options={{ href: null }} />
      <Tabs.Screen name="orders/track" options={{ href: null }} />
      <Tabs.Screen name="orders/review" options={{ href: null }} />
      <Tabs.Screen name="orders/report" options={{ href: null }} />
      <Tabs.Screen name="kyc/index" options={{ href: null }} />
      <Tabs.Screen name="kyc/aadhaar" options={{ href: null }} />
      <Tabs.Screen name="kyc/verify-otp" options={{ href: null }} />
      <Tabs.Screen name="kyc/bank" options={{ href: null }} />
      <Tabs.Screen name="kyc/selfie" options={{ href: null }} />
      <Tabs.Screen name="kyc/upload" options={{ href: null }} />
      <Tabs.Screen name="kyc/issues" options={{ href: null }} />
      <Tabs.Screen name="notifications/index" options={{ href: null }} />
      <Tabs.Screen name="notifications/[id]" options={{ href: null }} />
      <Tabs.Screen name="notifications/settings" options={{ href: null }} />
      <Tabs.Screen name="hire/bookings" options={{ href: null }} />
      <Tabs.Screen name="hire/workers" options={{ href: null }} />
      <Tabs.Screen name="hire/filter" options={{ href: null }} />
      <Tabs.Screen name="hire/worker/[id]" options={{ href: null }} />
      <Tabs.Screen name="hire/book" options={{ href: null }} />
      <Tabs.Screen name="hire/book/task" options={{ href: null }} />
      <Tabs.Screen name="hire/book/when" options={{ href: null }} />
      <Tabs.Screen name="hire/book/review" options={{ href: null }} />
      <Tabs.Screen name="hire/sent" options={{ href: null }} />
      <Tabs.Screen name="hire/booking/[id]" options={{ href: null }} />
      <Tabs.Screen name="hire/accepted/[id]" options={{ href: null }} />
      <Tabs.Screen name="hire/declined/[id]" options={{ href: null }} />
      <Tabs.Screen name="mandi/index" options={{ href: null }} />
      <Tabs.Screen name="mandi/[id]" options={{ href: null }} />
      <Tabs.Screen name="mandi/history" options={{ href: null }} />
      <Tabs.Screen name="mandi/alerts" options={{ href: null }} />
      <Tabs.Screen name="weather/index" options={{ href: null }} />
      <Tabs.Screen name="weather/[id]" options={{ href: null }} />
      <Tabs.Screen name="weather/detail" options={{ href: null }} />
      <Tabs.Screen name="weather/settings" options={{ href: null }} />
      <Tabs.Screen name="tips/index" options={{ href: null }} />
      <Tabs.Screen name="tips/[id]" options={{ href: null }} />
      <Tabs.Screen name="tips/category" options={{ href: null }} />
      <Tabs.Screen name="tips/saved" options={{ href: null }} />
      <Tabs.Screen name="crop-hub" options={{ href: null }} />
      <Tabs.Screen name="assistant" options={{ href: null }} />
      <Tabs.Screen name="voice-search" options={{ href: null }} />
      <Tabs.Screen name="schemes/index" options={{ href: null }} />
      <Tabs.Screen name="schemes/[id]" options={{ href: null }} />
      <Tabs.Screen name="schemes/apply" options={{ href: null }} />
      <Tabs.Screen name="schemes/status" options={{ href: null }} />
      <Tabs.Screen name="schemes/docs" options={{ href: null }} />
      <Tabs.Screen name="schemes/mine" options={{ href: null }} />
      <Tabs.Screen name="profile/edit" options={{ href: null }} />
      <Tabs.Screen name="profile/farm" options={{ href: null }} />
      <Tabs.Screen name="profile/bank" options={{ href: null }} />
      <Tabs.Screen name="profile/documents" options={{ href: null }} />
      <Tabs.Screen name="profile/help" options={{ href: null }} />
      <Tabs.Screen name="profile/complaint" options={{ href: null }} />
    </Tabs>
  );
}
