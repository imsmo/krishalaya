// apps/mobile/src/app/(farmer)/orders.tsx · the Orders tab (screen 22 My Orders) — rebuilt to the Phase-1 design
// (Krishi_Verse_Design_System/screens/22-my-orders.html): As-Buyer / As-Seller tabs with counts, a status filter
// chip row (All / In Transit / Delivered / Completed / Cancelled), and rich order cards (id + status badge, thumb,
// counterparty, price, a fulfilment progress bar + status label + a primary CTA). Thin screen (guide §3); money
// via MoneyText/paise (Law 2); degrade-never-die (Law 12); i18n(hi/en/gu).
//
// REAL data: features/orders.listOrders({role}) → OrderListItem (id, orderNo, status, totalMinor, counterparty,
// createdAt, primaryItem, itemCount), SWR-cached + keyset. The status badge/tone, the filter chips, the progress
// bar fill and the row CTA are all derived purely from the REAL status (order-status.ts) — never fabricated. Tab
// counts are the number of orders loaded for each role (first page), suffixed "+" when more pages exist (no count
// endpoint — honest). "Pay Now" is a real order payment (payForOrder → gateway → webhook is the source of truth).
//
// KV mobile-hardening fix: the card now leads with the REAL primary crop + qty (order-timeline read-model's
// primaryItemsFor enrichment, OrderRepository.primaryItemsFor — one bounded batch read for the whole page, no
// N+1), with a "+N more" hint from itemCount when the order has additional lines; the counterparty/date becomes
// the secondary meta line. Previously this screen fetched primaryItem/itemCount but never rendered them, so every
// card fell back to showing the order number as its own title (never a fabricated crop when a row genuinely
// carries no line item — the old counterparty-or-order-no title remains the degrade path).
//
// HONEST GAPS (§13, never faked): delivery-ETA / rating still live on OrderDetail (fetching per card would be an
// N+1, forbidden §5); the thumb stays a neutral 📦 (no product-image field on the list contract). No fabricated
// ETA or "you rated N" — those show on the order DETAIL screen (tap the card).
//
// DEV-20 (APPLY-9/Q49, honest-minimum): same tablet two-pane wiring as `listings/index.tsx` — on a split-eligible
// viewport, tapping a card sets `selectedId` (no navigation) and a second pane shows a REAL preview built only
// from the already-loaded `OrderListItem` fields (order no/status/primary item/price — zero extra API calls).
// The pane's own CTA (pay/track/rate) still runs the real `onCta` handler. A phone viewport is unaffected
// (isSplit false → single column, tap navigates, byte-identical to pre-DEV-20).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import type { OrderListItem, OrderRole } from '@krishi-verse/sdk-js';
import { formatDate } from '@krishi-verse/i18n';
import { EmptyState, MoneyText, StatusPill, SkeletonCard, Button, color, font, space, radius } from '@krishi-verse/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { listOrders } from '../../features/orders/orders.api';
import { payForOrder } from '../../features/payments/payments.api';
import { useSplitLayout } from '../../core/mechanisms/useSplitLayout';
import { orderStatusTone, matchesOrderFilter, orderProgress, orderListCta, counterpartyLabel, moreItemsCount, type OrderFilter, type OrderListCta } from '../../features/orders/order-status';

const ROLES: OrderRole[] = ['buyer', 'seller'];
const FILTERS: OrderFilter[] = ['all', 'in_transit', 'delivered', 'completed', 'cancelled'];

export default function Orders() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { isSplit, listColumnWidth, maxWidth } = useSplitLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [role, setRole] = useState<OrderRole>('buyer');
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [byRole, setByRole] = useState<Record<OrderRole, OrderListItem[]>>({ buyer: [], seller: [] });
  const [moreByRole, setMoreByRole] = useState<Record<OrderRole, boolean>>({ buyer: false, seller: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPay, setBusyPay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([listOrders({ role: 'buyer' }), listOrders({ role: 'seller' })]);
    setByRole({ buyer: b.items, seller: s.items });
    setMoreByRole({ buyer: b.nextCursor !== null, seller: s.nextCursor !== null });
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const items = byRole[role];
  const filtered = useMemo(() => items.filter((o) => matchesOrderFilter(o.status, filter)), [items, filter]);

  const onCta = async (o: OrderListItem, cta: OrderListCta) => {
    if (cta === 'pay') {
      setBusyPay(o.id);
      try {
        const res = await payForOrder(o.id, o.totalMinor);
        const key = res.outcome === 'success' ? 'orders.pay.success' : res.outcome === 'failed' ? 'orders.pay.failed' : 'orders.pay.pending';
        await load();
        router.push({ pathname: '/(farmer)/orders/[id]', params: { id: o.id, role, notice: t(key), party: o.counterparty ?? '' } });
      } catch { router.push({ pathname: '/(farmer)/orders/[id]', params: { id: o.id, role, party: o.counterparty ?? '' } }); }
      finally { setBusyPay(null); }
    } else if (cta === 'track') {
      // KV MF-06 fix: track.tsx reads `orderId` (useLocalSearchParams<{ orderId: string }>()), not `id` —
      // the mismatched key here meant orderId was always undefined, load()'s `if (!orderId) return;` guard
      // fired before setLoading(false), so the screen was stuck on its initial loading=true forever (an
      // infinite skeleton). Same mismatch existed for 'rate' below. See orders/[id].tsx's onAction for the
      // correct key this was copied from incorrectly.
      router.push({ pathname: '/(farmer)/orders/track', params: { orderId: o.id } });
    } else if (cta === 'rate') {
      router.push({ pathname: '/(farmer)/orders/review', params: { orderId: o.id } });
    }
  };

  // DEV-20 (APPLY-9/Q49): real navigation, unchanged; onCardPress below decides whether to run it immediately
  // (phone) or defer to a tap on the pane's own CTA (split).
  const openOrder = (o: OrderListItem) => router.push({ pathname: '/(farmer)/orders/[id]', params: { id: o.id, role, party: o.counterparty ?? '' } });
  const onCardPress = (o: OrderListItem) => { if (isSplit) setSelectedId(o.id); else openOrder(o); };
  const selectedItem = isSplit ? filtered.find((o) => o.id === selectedId) ?? null : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appbar}>
        <Text style={styles.appbarTitle}>{t('orders.title')}</Text>
        {role === 'seller' ? (
          <Pressable onPress={() => router.push('/(farmer)/orders/received')} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.appbarLink}>{t('ordersRecv.title')} →</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Buyer / Seller tabs with counts */}
      <View style={styles.tabs}>
        {ROLES.map((r) => {
          const active = role === r;
          const count = `${byRole[r].length}${moreByRole[r] ? '+' : ''}`;
          return (
            <Pressable key={r} onPress={() => setRole(r)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{t(`orders.role.${r}`)}</Text>
              <View style={[styles.tabCount, active && styles.tabCountOn]}><Text style={[styles.tabCountTxt, active && styles.tabCountTxtOn]}>{count}</Text></View>
            </Pressable>
          );
        })}
      </View>

      {/* Status filter chips — R2-04 (founder screenshot review): restyled to the app's compact pill convention
          (identical metrics to the My Listings filter chips: paddingVertical 6 / horizontal 12, 1px border,
          solid-fill selected state) instead of the previous oversized rounded-oval look. Polish only — same
          filter/state logic. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <Text style={[styles.chipTxt, active && styles.chipTxtOn]} numberOfLines={1}>{t(`orders.filter.${f}`)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* DEV-20: split-eligible viewport wraps the list in a fixed-width left column + a preview pane; a phone
          viewport renders the plain single-column body unchanged (isSplit false → styles resolve to no-ops). */}
      <View style={[styles.splitRow, isSplit && { maxWidth, alignSelf: 'center', width: '100%' }]}>
      <View style={isSplit ? { width: listColumnWidth } : styles.flex1}>
      {loading ? (
        <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={3} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListEmptyComponent={<View style={styles.body}><EmptyState title={t('orders.empty.title')} message={t('orders.empty.message')} /></View>}
          renderItem={({ item }) => (
            <OrderCard item={item} role={role} t={t} lang={lang} busyPay={busyPay === item.id}
              onOpen={() => onCardPress(item)}
              onCta={onCta}
            />
          )}
        />
      )}
      </View>

      {isSplit ? (
        <View style={styles.splitDetail}>
          {selectedItem ? (
            <View>
              <View style={styles.cardHead}>
                <Text style={styles.cardId}>{t('orders.orderNo', { id: selectedItem.orderNo })}</Text>
                <StatusPill label={t(`orders.status.${selectedItem.status}`)} tone={orderStatusTone(selectedItem.status)} />
              </View>
              {selectedItem.primaryItem ? (
                <Text style={styles.cardTitle}>
                  {selectedItem.primaryItem.title}
                  {moreItemsCount(selectedItem.itemCount) > 0 ? <Text style={styles.cardMore}>  {t('ordersRecv.moreItems', { n: moreItemsCount(selectedItem.itemCount) })}</Text> : null}
                </Text>
              ) : (
                <Text style={styles.cardTitle}>{counterpartyLabel(selectedItem.counterparty) ?? t('orders.orderNo', { id: selectedItem.orderNo })}</Text>
              )}
              <MoneyText minor={selectedItem.totalMinor} langCode={lang} size="lg" tone="default" style={styles.cardPrice} />
              <View style={{ marginTop: space[4] }}>
                <Button title={t('orders.viewFullDetails')} onPress={() => openOrder(selectedItem)} fullWidth={false} />
              </View>
            </View>
          ) : (
            <EmptyState title={t('orders.splitSelectPrompt')} />
          )}
        </View>
      ) : null}
      </View>
    </SafeAreaView>
  );
}

function OrderCard({ item, role, t, lang, busyPay, onOpen, onCta }: {
  item: OrderListItem; role: OrderRole; t: (k: string, p?: Record<string, unknown>) => string; lang: string; busyPay: boolean;
  onOpen: () => void; onCta: (o: OrderListItem, cta: OrderListCta) => void;
}) {
  const cta = orderListCta(item.status, role);
  const pct = orderProgress(item.status);
  const date = (() => { try { return item.createdAt ? formatDate(item.createdAt, lang, { dateStyle: 'medium' }) : ''; } catch { return ''; } })();
  return (
    <Pressable style={styles.card} onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('orders.orderNo', { id: item.orderNo })}>
      <View style={styles.cardHead}>
        <Text style={styles.cardId}>{t('orders.orderNo', { id: item.orderNo })}</Text>
        <StatusPill label={t(`orders.status.${item.status}`)} tone={orderStatusTone(item.status)} />
      </View>
      <View style={styles.cardBody}>
        <View style={styles.thumb}><Text style={styles.thumbEmoji}>📦</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Lead with the REAL primary crop + qty (order-timeline read-model's primaryItemsFor enrichment) —
              the counterparty/date becomes the secondary meta line. Degrades to the old counterparty-or-order-no
              title when a row genuinely carries no line item (older orders), never a fabricated crop. */}
          {item.primaryItem ? (
            <>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.primaryItem.title}
                {moreItemsCount(item.itemCount) > 0 ? <Text style={styles.cardMore}>  {t('ordersRecv.moreItems', { n: moreItemsCount(item.itemCount) })}</Text> : null}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {`${item.primaryItem.quantity} ${item.primaryItem.unitCode}`}
                {counterpartyLabel(item.counterparty) ? ` · ${counterpartyLabel(item.counterparty)}` : ''}
                {date ? ` · ${date}` : ''}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle} numberOfLines={1}>{counterpartyLabel(item.counterparty) ?? t('orders.orderNo', { id: item.orderNo })}</Text>
              {date ? <Text style={styles.cardMeta}>{date}</Text> : null}
            </>
          )}
          <MoneyText minor={item.totalMinor} langCode={lang} size="md" tone="default" style={styles.cardPrice} />
        </View>
      </View>
      <View style={styles.cardFoot}>
        <View style={styles.progressMini}>
          {pct > 0 ? <View style={styles.progressBar}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View> : null}
          <Text style={styles.progressLabel}><Text style={styles.progressStrong}>{t(`orders.status.${item.status}`)}</Text></Text>
        </View>
        {cta ? (
          <Button
            title={t(`orders.cta.${cta}`)}
            size="sm"
            variant={cta === 'pay' ? 'accent' : cta === 'track' ? 'outline' : 'ghost'}
            loading={cta === 'pay' && busyPay}
            onPress={() => onCta(item, cta)}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  // DEV-20 (APPLY-9/Q49): `splitRow` is a no-op single-column flex container on phone; on a split-eligible
  // viewport it becomes a row (list column + preview pane) via the inline maxWidth/alignSelf override applied
  // at the call site — kept separate from the pre-existing `body` style (loading/empty container) on purpose.
  splitRow: { flex: 1, flexDirection: 'row' },
  flex1: { flex: 1 },
  splitDetail: { flex: 1, borderLeftWidth: 1, borderLeftColor: color.earth200, padding: space[5] },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  appbarLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },

  tabs: { flexDirection: 'row', paddingHorizontal: space[5], borderBottomWidth: 1, borderBottomColor: color.ink100, backgroundColor: color.card },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: space[3], borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: color.primary600 },
  tabText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink500 },
  tabTextOn: { color: color.primary700 },
  tabCount: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: color.earth200, alignItems: 'center', justifyContent: 'center' },
  tabCountOn: { backgroundColor: color.primary600 },
  tabCountTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink600 },
  tabCountTxtOn: { color: color.white },

  filters: { gap: space[2], paddingHorizontal: space[5], paddingVertical: space[3] },
  // R2-04: same compact pill metrics as listings/index.tsx's filter chips (design-canon kv-chip style) —
  // paddingVertical 6 / paddingHorizontal 12, 1px border, solid-fill selected state.
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: color.earth200, backgroundColor: color.card },
  chipOn: { backgroundColor: color.primary600, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  chipTxtOn: { color: color.white },

  body: { flex: 1, padding: space[5] },
  list: { paddingHorizontal: space[5], paddingBottom: space[6] },

  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, padding: space[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.ink100, borderStyle: 'dashed', marginBottom: space[3] },
  cardId: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink500 },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 30 },
  cardTitle: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  cardMore: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.regular, color: color.ink500 },
  cardMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 4 },
  cardPrice: { marginTop: 4 },

  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], paddingTop: space[3], marginTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100, borderStyle: 'dashed' },
  progressMini: { flex: 1 },
  progressBar: { height: 4, backgroundColor: color.earth200, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: color.primary600, borderRadius: 2 },
  progressLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 4 },
  progressStrong: { fontWeight: font.weight.bold, color: color.ink800 },
});
