// apps/mobile/src/app/(store)/orders/[id].tsx · store order detail (PC-50 W10-4). Items + server totals,
// and ONLY the legal seller actions from features/orders/order-status.ts (the same spec-pinned gate the
// farmer sell-side uses; the server re-validates every transition). Idempotent lifecycle writes (Law 3).
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getOrder, confirmOrder, packOrder, readyOrder, markOrderDelivered, completeOrder, cancelOrder } from '../../../features/orders/orders.api';
import { nextActions, orderStatusTone, type OrderAction } from '../../../features/orders/order-status';

const RUNNERS: Partial<Record<OrderAction, (id: string) => Promise<{ ok: boolean }>>> = {
  confirm: confirmOrder, packed: packOrder, ready: readyOrder, recordDelivery: markOrderDelivered, complete: completeOrder, cancel: (id) => cancelOrder(id),
};

export default function StoreOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (id) setOrder(await getOrder(id)); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = (action: OrderAction) => {
    const fn = RUNNERS[action];
    if (!fn) return;
    Alert.alert(t('store.order.title'), t(`orders.action.${action}`), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.confirm'), onPress: async () => {
        setBusy(true);
        try { await fn(id!); load(); } catch { Alert.alert(t('store.order.title'), t('orders.action.failed')); } finally { setBusy(false); }
      } },
    ]);
  };

  if (order === undefined) return <ScreenScaffold title={t('store.order.title')}><SkeletonCard lines={6} /></ScreenScaffold>;
  if (order === null) return <ScreenScaffold title={t('store.order.title')}><EmptyState title={t('store.order.notFound')} /></ScreenScaffold>;

  const actions = nextActions(order.status, 'seller').filter((a) => RUNNERS[a]);
  return (
    <ScreenScaffold title={`#${order.orderNo}`}>
      <ScrollView>
        <Card>
          <View style={styles.between}>
            <StatusPill label={t(`orders.status.${order.status}`) || order.status} tone={orderStatusTone(order.status)} />
            <MoneyText minor={order.totalMinor} langCode={lang} />
          </View>
          {order.items?.map((it, i) => (
            <View key={`${it.listing_id}-${i}`} style={styles.between}>
              <Text style={styles.item}>{it.title_snapshot} × {it.quantity} {it.unit_code}</Text>
              <MoneyText minor={it.line_total_minor} langCode={lang} size="sm" />
            </View>
          ))}
        </Card>
        {actions.map((a) => <Button key={a} title={t(`orders.action.${a}`)} disabled={busy} variant={a === 'cancel' ? 'outline' : 'primary'} onPress={() => run(a)} />)}
      </ScrollView>
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  item: { fontSize: font.size.sm, color: color.ink800, flexShrink: 1 },
  muted: { fontSize: font.size.xs, color: color.ink500 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[2] },
});
