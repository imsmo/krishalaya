// apps/mobile/src/app/(store)/orders/index.tsx · store orders (PC-50 W10-4). role=seller — the SAME orders
// data path + seller-tab pure logic the farmer's sell-side uses (one domain, one code path). Money is the
// server's totalMinor; the tab logic is spec-pinned in features/orders/order-status.ts.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { OrderListItem } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { listOrders } from '../../../features/orders/orders.api';
import { orderStatusTone, matchesSellerTab, type SellerTab } from '../../../features/orders/order-status';

const TABS: SellerTab[] = ['new', 'active', 'completed'];

export default function StoreOrders() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<SellerTab>('new');
  const [items, setItems] = useState<OrderListItem[] | null>(null);
  const load = useCallback(async () => { setItems((await listOrders({ role: 'seller', limit: 100 })).items); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = items?.filter((o) => matchesSellerTab(o.status, tab)) ?? null;

  return (
    <ScreenScaffold title={t('store.orders.title')}>
      <View style={styles.wrap}>
        {TABS.map((f) => (
          <Pressable key={f} style={[styles.chip, tab === f && styles.chipOn]} onPress={() => setTab(f)}>
            <Text style={styles.chipText}>{t(`store.orders.tab.${f}`)}</Text>
          </Pressable>
        ))}
      </View>
      {visible === null ? <SkeletonCard lines={6} /> : visible.length === 0 ? (
        <EmptyState title={t('store.orders.empty')} message={t('store.orders.emptyHint')} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(store)/orders/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.orderNo}>#{item.orderNo}</Text>
                  <MoneyText minor={item.totalMinor} langCode={lang} size="sm" />
                </View>
                <View style={styles.between}>
                  <Text style={styles.muted}>{item.primaryItem ? `${item.primaryItem.title} × ${item.primaryItem.quantity}` : ''}{item.itemCount && item.itemCount > 1 ? `  +${item.itemCount - 1}` : ''}</Text>
                  <StatusPill label={t(`orders.status.${item.status}`) || item.status} tone={orderStatusTone(item.status)} />
                </View>
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: space[1], marginBottom: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  orderNo: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1], flexShrink: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
