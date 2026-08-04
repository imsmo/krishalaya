// apps/mobile/src/app/(buyer)/_layout.tsx · the buyer role's bottom-tab navigator (Home / Search / Saved).
// Mirrors the (farmer) layout: auth-gated (anonymous → onboarding; the server re-enforces on every call — this is
// UX) and behind the `buyer_app` kill-switch flag (Law 10), so the whole vertical can be disabled without a
// release. Detail/filter/seller routes live in the stack but are hidden from the tab bar.
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

export default function BuyerTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const buyerOn = useFlag('buyer_app');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!buyerOn) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

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
      <Tabs.Screen name="search" options={{ title: t('buyer.tabs.search'), tabBarIcon: ({ focused }) => <Icon glyph="🔍" focused={focused} /> }} />
      <Tabs.Screen name="cart" options={{ title: t('cart.title'), tabBarIcon: ({ focused }) => <Icon glyph="🛒" focused={focused} /> }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders'), tabBarIcon: ({ focused }) => <Icon glyph="📦" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: ({ focused }) => <Icon glyph="👤" focused={focused} /> }} />
      {/* hidden stack routes */}
      <Tabs.Screen name="saved" options={{ href: null }} />
      <Tabs.Screen name="filters" options={{ href: null }} />
      <Tabs.Screen name="listings/[id]" options={{ href: null }} />
      <Tabs.Screen name="seller/[id]" options={{ href: null }} />
      <Tabs.Screen name="delivery" options={{ href: null }} />
      <Tabs.Screen name="payment" options={{ href: null }} />
      <Tabs.Screen name="checkout" options={{ href: null }} />
      <Tabs.Screen name="addresses" options={{ href: null }} />
      <Tabs.Screen name="kyc" options={{ href: null }} />
      <Tabs.Screen name="orders/[id]" options={{ href: null }} />
      <Tabs.Screen name="orders/track" options={{ href: null }} />
      <Tabs.Screen name="orders/report" options={{ href: null }} />
      <Tabs.Screen name="make-offer" options={{ href: null }} />
      <Tabs.Screen name="inquiry" options={{ href: null }} />
      <Tabs.Screen name="offers" options={{ href: null }} />
      <Tabs.Screen name="offers/[id]" options={{ href: null }} />
      <Tabs.Screen name="chats" options={{ href: null }} />
      <Tabs.Screen name="chat/[id]" options={{ href: null }} />
      <Tabs.Screen name="auctions" options={{ href: null }} />
      <Tabs.Screen name="auctions/[id]" options={{ href: null }} />
      <Tabs.Screen name="auctions/bid" options={{ href: null }} />
      <Tabs.Screen name="auctions/history" options={{ href: null }} />
      <Tabs.Screen name="auctions/my-bids" options={{ href: null }} />
      <Tabs.Screen name="auctions/outbid" options={{ href: null }} />
    </Tabs>
  );
}
