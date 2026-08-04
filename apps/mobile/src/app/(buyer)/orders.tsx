// apps/mobile/src/app/(buyer)/orders.tsx · screen 69 "My Orders" (buyer). Thin screen (guide §3): the buyer's
// orders via the SHARED features/orders.listOrders (role=buyer, keyset, SWR-cached), split into Active / Delivered /
// Returns tabs (pure buyerOrderTab). Each card shows the order no + status badge, a mini fulfilment progress bar
// (deterministic from the real status via orderProgress — not a fabricated %), the seller, the total (MoneyText,
// Law 2) and a status-appropriate CTA (Track / Detail). Tap → buyer order detail. Behind `buyer_app`. Degrade-
// never-die (loading skeleton / designed empty / inline retry).
// §13 gaps (the buyer order-list read-model is {orderNo,status,totalMinor,counterparty,createdAt} — no product/
// qty/region/ETA → rendered honestly, never faked):
//  • Product title + crop emoji + "2 qtl" + region: not on the list row → a neutral 📦 glyph, the seller line as
//    the card title, and the order date; the product summary needs a richer list read-model (flagged), and we
//    never guess a crop. (The detail screen 23 shows the real line items.)
//  • "Arrives 4:00 PM" / "Pickup tomorrow" / "Delivery on 18 Aug": no ETA/slot on the contract → the progress
//    label shows only the REAL status; no invented ETA.
//  • Tab counts: the feed is keyset with no grand total → counts reflect the loaded orders (honest), not a fixed
//    "28". "Edit" (recurring order) has no contract → the CTA is Detail; recurring editing is a roadmap item.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { OrderListItem } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, ProgressBar, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listOrders } from '../../features/orders/orders.api';
import { orderStatusTone, orderProgress, orderListCta, buyerOrderTab, buyerOrderCounts, type BuyerTab } from '../../features/orders/order-status';

const TABS: BuyerTab[] = ['active', 'delivered', 'returns'];

export default function BuyerOrders() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<BuyerTab>('active');

  const load = useCallback(async () => { setItems((await listOrders({ role: 'buyer' })).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  if (!enabled) return <ScreenScaffold title={t('buyer.orders.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const counts = buyerOrderCounts(items);
  const visible = items.filter((o) => buyerOrderTab(o.status) === tab);

  return (
    <ScreenScaffold title={t('buyer.orders.title')} scroll={false}>
      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tk) => {
          const on = tab === tk;
          return (
            <Pressable key={tk} onPress={() => setTab(tk)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
              <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{t(`buyer.orders.tab.${tk}`)}</Text>
              <View style={[styles.ct, on && styles.ctOn]}><Text style={[styles.ctTxt, on && styles.ctTxtOn]}>{counts[tk]}</Text></View>
            </Pressable>
          );
        })}
      </View>

      {loading ? <View style={{ padding: space[4], gap: space[3] }}><SkeletonCard lines={4} /><SkeletonCard lines={4} /></View> : (
        <FlatList
          data={visible}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: space[4], gap: space[3] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ListEmptyComponent={<EmptyState title={t('buyer.orders.empty.title')} message={t('buyer.orders.empty.message')} />}
          renderItem={({ item }) => {
            const cta = orderListCta(item.status, 'buyer');
            const date = safeDate(item.createdAt, lang);
            return (
              <Pressable onPress={() => router.push({ pathname: '/(buyer)/orders/[id]', params: { id: item.id } })} accessibilityRole="button"
                accessibilityLabel={t('orders.orderNo', { id: item.orderNo })} style={styles.card}>
                {/* Head: id + status */}
                <View style={styles.head}>
                  <Text style={styles.id}>{t('orders.orderNo', { id: item.orderNo })}</Text>
                  <StatusPill label={t(`orders.status.${item.status}`)} tone={orderStatusTone(item.status)} />
                </View>
                {/* Body: thumb + info + price */}
                <View style={styles.body}>
                  <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.thumbGlyph}>📦</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.title} numberOfLines={1}>{item.counterparty ?? t('buyer.orders.sellerGeneric')}</Text>
                    {date ? <Text style={styles.meta}>{t('buyer.orders.placedOn', { date })}</Text> : null}
                    <MoneyText minor={item.totalMinor} langCode={lang} size="md" style={{ marginTop: 2 }} />
                  </View>
                </View>
                {/* Foot: progress + CTA */}
                <View style={styles.foot}>
                  <View style={{ flex: 1, marginRight: space[3] }}>
                    <ProgressBar value={orderProgress(item.status) / 100} />
                    <Text style={styles.progressLabel}>{t(`orders.status.${item.status}`)}</Text>
                  </View>
                  {cta === 'track' ? (
                    // KV MF-06 fix: track.tsx reads `orderId` (useLocalSearchParams<{ orderId: string }>()), not
                    // `id` — the mismatched key here left orderId undefined, so load()'s `if (!orderId) return;`
                    // guard returned before setLoading(false) ever ran, leaving the screen on its initial
                    // loading=true forever (an infinite skeleton). '/(buyer)/orders/[id]' below correctly uses
                    // `id` — only this `track` push had the wrong key.
                    <View style={{ minWidth: 96 }}><Button title={t('buyer.orders.track')} variant="outline" size="sm" onPress={() => router.push({ pathname: '/(buyer)/orders/track', params: { orderId: item.id } })} /></View>
                  ) : (
                    <View style={{ minWidth: 96 }}><Button title={t('buyer.orders.detail')} variant="ghost" size="sm" onPress={() => router.push({ pathname: '/(buyer)/orders/[id]', params: { id: item.id } })} /></View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeDate(value: string | undefined, langCode: string): string {
  if (!value) return '';
  try { return formatDate(value, langCode, { day: 'numeric', month: 'short' }); } catch { return ''; }
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space[3], marginRight: space[4], borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink500 },
  tabTxtOn: { color: color.primary700 },
  ct: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: color.ink200, alignItems: 'center', justifyContent: 'center' },
  ctOn: { backgroundColor: color.primary600 },
  ctTxt: { fontFamily: font.body, fontSize: 11, fontWeight: font.weight.bold, color: color.ink700 },
  ctTxtOn: { color: color.white },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  id: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500 },
  body: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[3] },
  thumb: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 28 },
  title: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  meta: { fontFamily: font.body, fontSize: 11, color: color.ink500, marginTop: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  progressLabel: { fontFamily: font.body, fontSize: 11, fontWeight: font.weight.semibold, color: color.ink700, marginTop: 4 },
});
