// apps/mobile/src/app/(farmer)/orders/received.tsx · screen 56 "Orders Received" (the SELLER view). Thin screen
// (guide §3): listOrders({role:'seller'}) → header KPIs (New / In-Progress counts + This-Month gross, all derived
// from the REAL loaded orders via the PURE sellerOrderStats — never fabricated), New/Active/Completed tabs, and
// per-order cards. A NEW order card offers Reject / Accept Order → cancelOrder / confirmOrder (idempotent, Law 3,
// flag-gated by `orders_fulfilment`; the SERVER re-authorises every transition). Money via MoneyText (Law 2).
// Degrade-never-die: loading skeleton, designed empty, inline retry.
// The list read-model now carries the PRIMARY line item (crop title + qty) + item count (P1-2), so the card
// leads with the crop and shows "500 kg · +2 more"; the counterparty is the secondary line. §13 (still no
// contract → honest): buyer location / buyer rating / an acceptance-deadline countdown aren't on the list
// read-model, so NEW shows a generic "Action needed" (never a fake "2 hours left"), and a dedicated seller
// order-stats endpoint remains the production path for exact period totals (these are the loaded-page totals).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import type { OrderListItem } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listOrders, confirmOrder, cancelOrder } from '../../../features/orders/orders.api';
import { orderStatusTone, sellerOrderStats, matchesSellerTab, sellerOrderTab, moreItemsCount, type SellerTab } from '../../../features/orders/order-status';

const TABS: SellerTab[] = ['new', 'active', 'completed'];

export default function OrdersReceived() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const canAct = useFlag('orders_fulfilment');
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<SellerTab>('new');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const page = await listOrders({ role: 'seller', limit: 50 });
    setItems(page.items); setFailed(false); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => sellerOrderStats(items), [items]);
  const visible = useMemo(() => items.filter((o) => matchesSellerTab(o.status, tab)), [items, tab]);
  const newCount = stats.newCount;

  const act = async (id: string, kind: 'accept' | 'reject') => {
    setBusy(id + kind);
    try { await (kind === 'accept' ? confirmOrder(id) : cancelOrder(id)); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('orders.action.conflict')
        : e instanceof SdkError && e.isForbidden ? t('orders.action.forbidden') : t('common.error.generic');
      Alert.alert(t('orders.action.failed'), msg);
    } finally { setBusy(null); }
  };
  const confirmReject = (id: string) => Alert.alert(t('ordersRecv.reject.title'), t('ordersRecv.reject.message'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('ordersRecv.reject.confirm'), style: 'destructive', onPress: () => act(id, 'reject') },
  ]);

  return (
    <ScreenScaffold title={t('ordersRecv.title')}>
      {loading ? <SkeletonCard lines={8} /> : failed ? (
        <EmptyState title={t('orders.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* KPI header */}
          <View style={styles.stats}>
            <Stat label={t('ordersRecv.statNew')} value={String(stats.newCount)} tone="accent" />
            <Stat label={t('ordersRecv.statInProgress')} value={String(stats.activeCount)} tone="info" />
            <Stat label={t('ordersRecv.statMonth')}>
              <MoneyText minor={stats.monthMinor} currencyCode="INR" langCode={lang} size="lg" />
            </Stat>
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            {TABS.map((tb) => (
              <Pressable key={tb} onPress={() => setTab(tb)} style={[styles.tab, tab === tb && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: tab === tb }}>
                <Text style={[styles.tabTxt, tab === tb && styles.tabTxtOn]}>{t(`ordersRecv.tab.${tb}`)}</Text>
                {tb === 'new' && newCount > 0 ? <View style={styles.badge}><Text style={styles.badgeTxt}>{newCount}</Text></View> : null}
              </Pressable>
            ))}
          </View>

          <FlatList
            data={visible}
            keyExtractor={(o) => o.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
            ListEmptyComponent={<EmptyState title={t(`ordersRecv.empty.${tab}`)} />}
            renderItem={({ item }) => (
              <SellerOrderCard item={item} t={t} lang={lang} canAct={canAct}
                busyAccept={busy === item.id + 'accept'} busyReject={busy === item.id + 'reject'}
                onOpen={() => router.push({
                  // NEW orders open the focused accept/reject decision screen (57); others go to the detail (23).
                  pathname: sellerOrderTab(item.status) === 'new' ? '/(farmer)/orders/decision' : '/(farmer)/orders/[id]',
                  params: { id: item.id, role: 'seller', party: item.counterparty ?? '' },
                })}
                onAccept={() => act(item.id, 'accept')} onReject={() => confirmReject(item.id)} />
            )}
          />
        </>
      )}
    </ScreenScaffold>
  );
}

function Stat({ label, value, tone, children }: { label: string; value?: string; tone?: 'accent' | 'info'; children?: React.ReactNode }) {
  const valColor = tone === 'accent' ? color.accent600 : tone === 'info' ? color.infoDark : color.ink900;
  return (
    <View style={styles.stat}>
      {children ?? <Text style={[styles.statVal, { color: valColor }]}>{value}</Text>}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SellerOrderCard({ item, t, lang, canAct, busyAccept, busyReject, onOpen, onAccept, onReject }: {
  item: OrderListItem; t: (k: string, p?: Record<string, string | number>) => string; lang: string; canAct: boolean;
  busyAccept: boolean; busyReject: boolean; onOpen: () => void; onAccept: () => void; onReject: () => void;
}) {
  const isNew = sellerOrderTab(item.status) === 'new';
  return (
    <Pressable onPress={onOpen} accessibilityRole="button">
      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.orderNo}>#{item.orderNo}</Text>
          {isNew
            ? <Text style={styles.actionNeeded}>⏱ {t('ordersRecv.actionNeeded')}</Text>
            : <StatusPill label={t(`orders.status.${item.status}`)} tone={orderStatusTone(item.status)} />}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.thumb}><Text style={styles.thumbGlyph}>📦</Text></View>
          <View style={{ flex: 1 }}>
            {/* Lead with the REAL primary crop + qty; counterparty is the secondary line. Degrades to the
                counterparty as title when the read-model carries no item (older orders / no line). */}
            {item.primaryItem ? (
              <>
                <Text style={styles.party} numberOfLines={1}>
                  {item.primaryItem.title}
                  {moreItemsCount(item.itemCount) > 0 ? <Text style={styles.moreItems}>  {t('ordersRecv.moreItems', { n: moreItemsCount(item.itemCount) })}</Text> : null}
                </Text>
                <Text style={styles.qtyLine} numberOfLines={1}>
                  {`${item.primaryItem.quantity} ${item.primaryItem.unitCode}`}
                  {item.counterparty ? ` · ${item.counterparty}` : ''}
                </Text>
              </>
            ) : (
              <Text style={styles.party} numberOfLines={1}>{item.counterparty ?? t('orders.counterpartyUnknown')}</Text>
            )}
            <MoneyText minor={item.totalMinor} currencyCode="INR" langCode={lang} size="md" />
          </View>
        </View>
        {isNew && canAct ? (
          <View style={styles.actions}>
            <Button title={t('ordersRecv.reject')} variant="outline" onPress={onReject} loading={busyReject} disabled={busyAccept} />
            <View style={{ flex: 1 }}>
              <Button title={t('ordersRecv.accept')} onPress={onAccept} loading={busyAccept} disabled={busyReject} />
            </View>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space[3], marginBottom: space[4] },
  stat: { flex: 1, backgroundColor: color.card, borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[2], alignItems: 'center', gap: 2 },
  statVal: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textAlign: 'center' },

  tabs: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  tab: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.earth100 },
  tabOn: { backgroundColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, fontWeight: font.weight.semibold },
  tabTxtOn: { color: color.white },
  badge: { minWidth: 18, height: 18, borderRadius: radius.pill, backgroundColor: color.accent500, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, fontWeight: font.weight.bold },

  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  orderNo: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, fontWeight: font.weight.semibold },
  actionNeeded: { fontFamily: font.body, fontSize: font.size.sm, color: color.accent700, fontWeight: font.weight.bold },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 22 },
  party: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold, marginBottom: 2 },
  moreItems: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.regular },
  qtyLine: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: 2 },
  actions: { flexDirection: 'row', gap: space[3], alignItems: 'center', marginTop: space[3] },
});
