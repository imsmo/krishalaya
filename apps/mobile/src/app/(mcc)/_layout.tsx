// apps/mobile/src/app/(mcc)/_layout.tsx · the MCC-counter role's bottom-tab navigator (PC-50 W10-7; design
// canon screens 236–239): Counter / Members / Centre. Auth-gated + behind the `mcc_operator` kill-switch
// (Law 10). The mobile twin of the web-ops dairy POS — same endpoints, same server-priced slips.
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

export default function MccTabsLayout() {
  const { state } = useAuth();
  const { t } = useTranslation();
  const on = useFlag('mcc_operator');
  if (state.status === 'anonymous') return <Redirect href="/(auth)/welcome" />;
  if (!on) return <View style={{ flex: 1, backgroundColor: color.page, justifyContent: 'center' }}><EmptyState title={t('common.unavailable')} /></View>;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primary600 }}>
      <Tabs.Screen name="counter" options={{ title: t('mcc.tab.counter'), tabBarIcon: ({ focused }) => <Icon glyph="🥛" focused={focused} /> }} />
      <Tabs.Screen name="members/index" options={{ title: t('mcc.tab.members'), tabBarIcon: ({ focused }) => <Icon glyph="👥" focused={focused} /> }} />
      <Tabs.Screen name="centre" options={{ title: t('mcc.tab.centre'), tabBarIcon: ({ focused }) => <Icon glyph="🏭" focused={focused} /> }} />
      <Tabs.Screen name="members/[id]" options={{ href: null }} />
    </Tabs>
  );
}
