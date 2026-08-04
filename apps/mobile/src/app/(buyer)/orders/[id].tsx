// apps/mobile/src/app/(buyer)/orders/[id].tsx · screen 23 (buyer order detail). Thin screen (guide §3): the SHARED
// features/orders.getOrder + money breakdown (Law 2), driven by the PURE nextActions(status,'buyer'). Buyer
// transitions (cancel/complete) are real idempotent calls (server is the authority — a 409/403 is shown, never
// bypassed); track pushes the shipment timeline. Behind `buyer_app`. Degrade-never-die.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderDetail } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, Icon, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder, completeOrder, cancelOrder } from '../../../features/orders/orders.api';
import { nextActions, orderStatusTone, type OrderAction } from '../../../features/orders/order-status';

// The buyer order detail handles these inline/navigation actions; others (review/report) are deferred for buyer.
const HANDLED: OrderAction[] = ['complete', 'cancel', 'track', 'report'];

export default function BuyerOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<OrderAction | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const o = await getOrder(id); setOrder(o); setFailed(!o); setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title=" "><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const run = async (action: OrderAction, fn: () => Promise<unknown>) => {
    setBusy(action);
    try { await fn(); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('orders.action.conflict') : e instanceof SdkError && e.isForbidden ? t('orders.action.forbidden') : t('common.error.generic');
      Alert.alert(t('orders.action.failed'), msg);
    } finally { setBusy(null); }
  };
  const onAction = (a: OrderAction) => {
    if (!id) return;
    if (a === 'complete') return run('complete', () => completeOrder(id));
    if (a === 'cancel') return Alert.alert(t('orders.cancel.title'), t('orders.cancel.message'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('orders.cancel.confirm'), style: 'destructive', onPress: () => run('cancel', () => cancelOrder(id)) },
    ]);
    if (a === 'track') return router.push({ pathname: '/(buyer)/orders/track', params: { orderId: id } });
    if (a === 'report') return router.push({ pathname: '/(buyer)/orders/report', params: { orderId: id } });
  };

  const actions = (order ? nextActions(order.status, 'buyer') : []).filter((a) => HANDLED.includes(a));

  return (
    <ScreenScaffold title={order ? t('orders.orderNo', { id: order.orderNo }) : ' '}>
      {loading ? <SkeletonCard lines={6} /> : !order || failed ? (
        <>
          {/* KV MF-06 fix: ScreenScaffold has no back-chrome header (headerShown:false at the tab-navigator
              level) and EmptyState only supports one action — "unavailable" previously offered ONLY Retry,
              which never escapes a genuinely missing/fake order (Law 12: never a dead end). */}
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(buyer)/orders'))}
            accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backRow}>
            <Icon name="arrow-left" size={18} color={color.ink700} />
            <Text style={styles.backLabel}>{t('common.back')}</Text>
          </Pressable>
          <EmptyState title={t('orders.unavailable')} actionLabel={t('common.retry')} onAction={load} />
        </>
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <StatusPill label={t(`orders.status.${order.status}`)} tone={orderStatusTone(order.status)} />
              <MoneyText minor={order.totalMinor} currencyCode={order.currencyCode} langCode={lang} size="xl" />
            </View>
            {order.items.map((it) => (
              <View key={it.listing_id} style={styles.item}>
                <Text style={styles.itemName} numberOfLines={1}>{it.title_snapshot}</Text>
                <Text style={styles.itemQty}>{it.quantity} {it.unit_code}</Text>
                <MoneyText minor={it.line_total_minor} currencyCode={order.currencyCode} langCode={lang} size="md" />
              </View>
            ))}
          </Card>
          <Card style={{ marginTop: space[3] }}>
            <Row label={t('orders.subtotal')} minor={order.subtotalMinor} cc={order.currencyCode} lang={lang} />
            <Row label={t('orders.delivery')} minor={order.deliveryFeeMinor} cc={order.currencyCode} lang={lang} />
            {order.discountMinor !== '0' ? <Row label={t('orders.discount')} minor={order.discountMinor} cc={order.currencyCode} lang={lang} /> : null}
            <Row label={t('orders.tax')} minor={order.taxMinor} cc={order.currencyCode} lang={lang} />
            <Row label={t('orders.total')} minor={order.totalMinor} cc={order.currencyCode} lang={lang} strong />
          </Card>
          {actions.length ? (
            <View style={styles.actions}>
              {actions.map((a) => (
                <Button key={a} title={t(`orders.action.${a}`)} variant={a === 'cancel' ? 'outline' : a === 'track' ? 'ghost' : 'primary'}
                  loading={busy === a} disabled={busy !== null && busy !== a} onPress={() => onAction(a)} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, minor, cc, lang, strong }: { label: string; minor: string; cc: string; lang: string; strong?: boolean }) {
  return (
    <View style={[styles.brRow, strong && styles.brStrong]}>
      <Text style={[styles.brLabel, strong && styles.brLabelStrong]}>{label}</Text>
      <MoneyText minor={minor} currencyCode={cc} langCode={lang} size={strong ? 'lg' : 'md'} tone={strong ? 'default' : 'muted'} />
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  backLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.ink100 },
  itemName: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  itemQty: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  brRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2] },
  brStrong: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[3] },
  brLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  brLabelStrong: { color: color.ink800, fontWeight: font.weight.semibold },
  actions: { marginTop: space[4], gap: space[3] },
});
