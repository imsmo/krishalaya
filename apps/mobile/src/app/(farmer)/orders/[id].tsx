// apps/mobile/src/app/(farmer)/orders/[id].tsx · order detail + tracking (design 23/57). Thin screen (guide §3):
// getOrder + getOrderShipment → render the status banner, item card, the 7-step Order Timeline (PURE
// orderTimeline(status, real-timestamps) — no fabricated times), the counterparty party card, the payment
// summary (Law 2 MoneyText; platform fee = order.commissionMinor), and an action bar built from the PURE
// nextActions(status, role) map. Transition actions call the api and reload; the SERVER is the authority
// (a 409/403 is shown, never worked around). Mutating actions are gated behind the `orders_fulfilment` flag.
// §13 gaps (no contract → never faked): exact per-step times for payment/seller-confirm, the arrival ETA,
// driver name/phone, item "Grade", and the seller "Verified" flag — those regions degrade, they don't invent.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OrderDetail, OrderRole, Shipment } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder, getOrderShipment, confirmOrder, packOrder, readyOrder, completeOrder, cancelOrder } from '../../../features/orders/orders.api';
import { nextActions, orderStatusTone, orderTimeline, orderBannerKey, type OrderAction, type OrderTimelineStep } from '../../../features/orders/order-status';

export default function OrderDetailScreen() {
  const { id, role, party } = useLocalSearchParams<{ id: string; role?: string; party?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const canAct = useFlag('orders_fulfilment');
  const orderRole: OrderRole = role === 'buyer' ? 'buyer' : 'seller';
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<OrderAction | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [o, s] = await Promise.all([getOrder(id), getOrderShipment(id).catch(() => null)]);
    setOrder(o); setShipment(s); setFailed(!o); setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const runTransition = async (action: OrderAction, fn: () => Promise<unknown>) => {
    setBusy(action);
    try { await fn(); await load(); }
    catch (e) {
      const msg = e instanceof SdkError && e.isConflict ? t('orders.action.conflict')
        : e instanceof SdkError && e.isForbidden ? t('orders.action.forbidden')
        : t('common.error.generic');
      Alert.alert(t('orders.action.failed'), msg);
    } finally { setBusy(null); }
  };

  const confirmCancel = () => Alert.alert(t('orders.cancel.title'), t('orders.cancel.message'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('orders.cancel.confirm'), style: 'destructive', onPress: () => runTransition('cancel', () => cancelOrder(id!)) },
  ]);

  const onAction = (a: OrderAction) => {
    if (!id) return;
    switch (a) {
      case 'confirm': return runTransition('confirm', () => confirmOrder(id));
      case 'packed': return runTransition('packed', () => packOrder(id));
      case 'ready': return runTransition('ready', () => readyOrder(id));
      case 'complete': return runTransition('complete', () => completeOrder(id));
      case 'cancel': return confirmCancel();
      case 'recordDelivery': return router.push({ pathname: '/(farmer)/orders/pod', params: { orderId: id } });
      case 'track': return router.push({ pathname: '/(farmer)/orders/track', params: { orderId: id } });
      case 'review': return router.push({ pathname: '/(farmer)/orders/review', params: { orderId: id, party: partyName ?? '', role: orderRole } });
      case 'report': return router.push({ pathname: '/(farmer)/orders/report', params: { orderId: id } });
    }
  };

  // §13: there is no contact-from-order endpoint (an order exposes no conversation id or masked number), so
  // call/chat degrade to an honest "coming soon" rather than dialling a fabricated number.
  const onContact = () => Alert.alert(t('orderDetail.contact.title'), t('orderDetail.contact.soon'));

  const actions = order ? nextActions(order.status, orderRole) : [];
  const isTransition = (a: OrderAction) => a === 'confirm' || a === 'packed' || a === 'ready' || a === 'complete' || a === 'cancel';

  const partyName = typeof party === 'string' && party.trim() ? party.trim() : null;
  const partyRoleLabel = orderRole === 'buyer' ? t('orders.role.seller') : t('orders.role.buyer'); // the OTHER side

  return (
    <ScreenScaffold title={order ? t('orders.orderNo', { id: order.orderNo }) : ' '}>
      {loading ? <SkeletonCard lines={8} /> : !order || failed ? (
        <>
          {/* KV MF-06 fix: ScreenScaffold renders no header chrome (headerShown:false at the tab-navigator
              level, guide §3) and EmptyState supports only a single action — so the "unavailable" state (a fake
              demo-era order id missing its partition-pruned row, or any genuine 404) previously had ONLY "Retry",
              which just fails again forever with no way out (Law 12: never a dead end). A real back affordance,
              same pattern as listings/[id].tsx's appbar, escapes even when Retry can never succeed. */}
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(farmer)/orders'))}
            accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backRow}>
            <Icon name="arrow-left" size={18} color={color.ink700} />
            <Text style={styles.backLabel}>{t('common.back')}</Text>
          </Pressable>
          <EmptyState title={t('orders.unavailable')} actionLabel={t('common.retry')} onAction={load} />
        </>
      ) : (
        <>
          {/* Status banner */}
          <StatusBanner status={order.status} t={t} />

          {/* Item card(s) */}
          <Card style={{ marginTop: space[3] }}>
            {order.items.map((it, i) => (
              <View key={it.listing_id + i} style={[styles.item, i > 0 && styles.itemDivide]}>
                <View style={styles.thumb}><Text style={styles.thumbGlyph}>📦</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={1}>{it.title_snapshot}</Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.itemMeta}>{it.quantity} {it.unit_code} · </Text>
                    <MoneyText minor={it.unit_price_minor} currencyCode={order.currencyCode} langCode={lang} size="sm" tone="muted" />
                    <Text style={styles.itemMeta}>/{it.unit_code}</Text>
                  </View>
                </View>
                <MoneyText minor={it.line_total_minor} currencyCode={order.currencyCode} langCode={lang} size="md" />
              </View>
            ))}
          </Card>

          {/* Order Timeline */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDetail.timeline')}</Text>
            <OrderTimelineView
              steps={orderTimeline(order.status, {
                placed: order.createdAt ?? null,
                ready: shipment?.pickedUpAt ?? null,
                delivered: shipment?.deliveredAt ?? null,
                completed: order.completedAt ?? null,
              })}
              t={t} lang={lang}
              escrowMinor={order.totalMinor} currencyCode={order.currencyCode}
            />
          </Card>

          {/* Party card (the counterparty) */}
          <Card style={{ marginTop: space[3] }}>
            <View style={styles.partyRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials(partyName)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.partyRole}>{partyRoleLabel}</Text>
                <Text style={styles.partyName} numberOfLines={1}>{partyName ?? t('orders.counterpartyUnknown')}</Text>
              </View>
            </View>
            <View style={styles.contactRow}>
              <Pressable style={styles.contactBtn} onPress={onContact} accessibilityRole="button">
                <Icon name="phone" size={16} color={color.primary700} />
                <Text style={styles.contactTxt}>{t('orderDetail.call')}</Text>
              </Pressable>
              <Pressable style={styles.contactBtn} onPress={onContact} accessibilityRole="button">
                <Text style={styles.contactGlyph}>💬</Text>
                <Text style={styles.contactTxt}>{t('orderDetail.message')}</Text>
              </Pressable>
            </View>
          </Card>

          {/* Payment summary */}
          <Card style={{ marginTop: space[3] }}>
            <Text style={styles.section}>{t('orderDetail.payment')}</Text>
            <Breakdown label={t('orders.subtotal')} minor={order.subtotalMinor} cc={order.currencyCode} lang={lang} />
            <BreakdownFree label={t('orders.delivery')} minor={order.deliveryFeeMinor} cc={order.currencyCode} lang={lang} freeLabel={t('orderDetail.free')} />
            {order.discountMinor !== '0' ? <Breakdown label={t('orders.discount')} minor={order.discountMinor} cc={order.currencyCode} lang={lang} /> : null}
            {order.commissionMinor !== '0' ? <Breakdown label={t('orderDetail.platformFee')} minor={order.commissionMinor} cc={order.currencyCode} lang={lang} /> : null}
            <Breakdown label={t('orders.tax')} minor={order.taxMinor} cc={order.currencyCode} lang={lang} />
            <Breakdown label={t('orderDetail.totalPaid')} minor={order.totalMinor} cc={order.currencyCode} lang={lang} strong />
          </Card>

          {/* Actions */}
          {actions.length ? (
            <View style={styles.actions}>
              {actions.map((a) => {
                const transition = isTransition(a);
                if (transition && !canAct) return null; // mutating actions behind the kill-switch
                return (
                  <Button key={a} title={a === 'report' ? t('orderDetail.help') : t(`orders.action.${a}`)}
                    variant={a === 'cancel' || a === 'report' ? 'outline' : 'primary'}
                    loading={busy === a} disabled={busy !== null && busy !== a}
                    onPress={() => onAction(a)} />
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </ScreenScaffold>
  );
}

function StatusBanner({ status, t }: { status: string; t: (k: string, p?: Record<string, unknown>) => string }) {
  const key = orderBannerKey(status);
  const tone = orderStatusTone(status);
  const bg = tone === 'success' ? color.successLight : tone === 'danger' ? color.dangerLight : tone === 'accent' ? color.accent50 : tone === 'info' ? color.infoLight : color.primary50;
  const fg = tone === 'success' ? color.successDark : tone === 'danger' ? color.dangerDark : tone === 'accent' ? color.accent700 : tone === 'info' ? color.infoDark : color.primary800;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <StatusPill label={t(`orders.status.${status}`)} tone={tone} />
      <Text style={[styles.bannerTitle, { color: fg }]}>{t(`orderDetail.banner.${key}`)}</Text>
    </View>
  );
}

function OrderTimelineView({ steps, t, lang, escrowMinor, currencyCode }: {
  steps: OrderTimelineStep[]; t: (k: string) => string; lang: string; escrowMinor: string; currencyCode: string;
}) {
  return (
    <View>
      {steps.map((s, i) => (
        <View key={s.key} style={styles.tlRow}>
          <View style={styles.tlRail}>
            <View style={[styles.tlDot,
              s.state === 'done' && styles.tlDotDone,
              s.state === 'active' && styles.tlDotActive]}>
              {s.state === 'done' ? <Icon name="check" size={10} color={color.white} /> : null}
            </View>
            {i < steps.length - 1 ? <View style={[styles.tlLine, s.state === 'done' && styles.tlLineDone]} /> : null}
          </View>
          <View style={styles.tlBody}>
            <Text style={[styles.tlLabel,
              s.state === 'pending' && styles.tlLabelPending,
              s.state === 'active' && styles.tlLabelActive]}>{t(`orderDetail.step.${s.key}`)}</Text>
            {s.atIso ? <Text style={styles.tlTime}>{formatDate(s.atIso, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text> : null}
            {/* Payment step shows the real escrow hold (order total held until completion) — honest, not fabricated. */}
            {s.key === 'payment' && s.state !== 'pending' ? (
              <View style={styles.tlDetailRow}>
                <MoneyText minor={escrowMinor} currencyCode={currencyCode} langCode={lang} size="sm" tone="muted" />
                <Text style={styles.tlDetail}> {t('orderDetail.escrowHeld')}</Text>
              </View>
            ) : null}
            {s.state === 'pending' ? <Text style={styles.tlPendingTag}>{t('orderDetail.pending')}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Breakdown({ label, minor, cc, lang, strong }: { label: string; minor: string; cc: string; lang: string; strong?: boolean }) {
  return (
    <View style={[styles.brRow, strong && styles.brStrong]}>
      <Text style={[styles.brLabel, strong && styles.brLabelStrong]}>{label}</Text>
      <MoneyText minor={minor} currencyCode={cc} langCode={lang} size={strong ? 'lg' : 'md'} tone={strong ? 'default' : 'muted'} />
    </View>
  );
}

function BreakdownFree({ label, minor, cc, lang, freeLabel }: { label: string; minor: string; cc: string; lang: string; freeLabel: string }) {
  if (minor === '0') return (
    <View style={styles.brRow}>
      <Text style={styles.brLabel}>{label}</Text>
      <Text style={styles.freeTxt}>{freeLabel}</Text>
    </View>
  );
  return <Breakdown label={label} minor={minor} cc={cc} lang={lang} />;
}

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—';
}

const styles = StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  backLabel: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink700 },
  banner: { borderRadius: radius.lg, padding: space[4], gap: space[2] },
  bannerTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold },

  item: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  itemDivide: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[3] },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 22 },
  itemName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  itemMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },

  section: { fontFamily: font.display, fontSize: font.size.lg, color: color.ink900, fontWeight: font.weight.bold, marginBottom: space[3] },

  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  tlRail: { alignItems: 'center', width: 22 },
  tlDot: { width: 20, height: 20, borderRadius: radius.pill, backgroundColor: color.ink200, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tlDotDone: { backgroundColor: color.primary600 },
  tlDotActive: { backgroundColor: color.white, borderWidth: 3, borderColor: color.primary600 },
  tlLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: color.ink200, marginVertical: 2 },
  tlLineDone: { backgroundColor: color.primary600 },
  tlBody: { flex: 1, paddingBottom: space[4] },
  tlLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink800, fontWeight: font.weight.semibold },
  tlLabelActive: { color: color.primary700 },
  tlLabelPending: { color: color.ink400, fontWeight: font.weight.semibold },
  tlTime: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  tlDetailRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  tlDetail: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  tlPendingTag: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 2 },

  partyRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: color.primary100, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.display, fontSize: font.size.md, color: color.primary700, fontWeight: font.weight.bold },
  partyRole: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  partyName: { fontFamily: font.body, fontSize: font.size.md, color: color.ink900, fontWeight: font.weight.semibold },
  contactRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], paddingVertical: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: color.primary600 },
  contactTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold },
  contactGlyph: { fontSize: 15 },

  brRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space[2] },
  brStrong: { borderTopWidth: 1, borderTopColor: color.ink100, marginTop: space[1], paddingTop: space[3] },
  brLabel: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500 },
  brLabelStrong: { color: color.ink800, fontWeight: font.weight.semibold },
  freeTxt: { fontFamily: font.body, fontSize: font.size.md, color: color.success, fontWeight: font.weight.semibold },
  actions: { marginTop: space[4], gap: space[3] },
});
