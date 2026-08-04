// apps/mobile/src/app/(buyer)/orders/track.tsx · screen 131 (Track Order, buyer). Thin screen (guide §3): the
// REAL order + shipment (getOrder + getOrderShipment) drive an order-journey timeline (shared, PURE orderTimeline +
// trackTimestamps → real per-step timestamps), a "Message farmer" link (openDirect), a masked "Call driver" (only
// when the shipment names a rider) and a "Mark Delivered" that confirms receipt (completeOrder — idempotent, Law 3;
// releases escrow server-side). Behind `buyer_app`. Degrade-never-die (skeleton / friendly retry).
//
// §13 (no contract → rendered honestly, never faked): there is NO ETA feed → the ETA shows "—" rather than a
// fabricated "1h 28m / 18 km away / Karjan checkpoint"; the driver NAME + vehicle plate aren't in the shipment
// contract (only an opaque riderUserId) → we show a generic "Driver assigned" + a masked call, never
// "Hareshbhai · GJ-23-AB-7821". The status timeline + per-step times are now REAL — driven by the stamped
// order-tracking feed (order_events transitions); when a rider has posted a GPS ping we show an honest
// "last updated <time>" (no reverse-geocoded place name). Steps with no stamped event still show no time.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Shipment, OrderDetail, OrderTracking } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrder, getOrderShipment, getOrderTracking, completeOrder } from '../../../features/orders/orders.api';
import { orderTimeline, trackTimestamps, trackTimestampsFromEvents, lastKnownLocation, type OrderTimelineStep } from '../../../features/orders/order-status';
import { openDirect, startMaskedCall } from '../../../features/messaging/messaging.api';

export default function BuyerTrack() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // KV MF-06 hardening: a missing/undefined orderId (e.g. a caller passing the wrong param key) must still
    // clear the loading flag — otherwise the screen is stuck on SkeletonCard forever (Law 12 degrade-never-die).
    if (!orderId) { setLoading(false); return; }
    setLoading(true);
    const [o, s, tr] = await Promise.all([getOrder(orderId), getOrderShipment(orderId), getOrderTracking(orderId)]);
    setOrder(o); setShipment(s); setTracking(tr);
    setLoading(false);
  }, [orderId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('track.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const title = order ? `${t('track.title')} #${order.orderNo}` : t('track.title');

  if (loading) return <ScreenScaffold title={t('track.title')}><SkeletonCard lines={3} /><SkeletonCard lines={6} /></ScreenScaffold>;
  if (!order) return <ScreenScaffold title={t('track.title')}><EmptyState title={t('track.noShipment.title')} message={t('track.noShipment.message')} actionLabel={t('common.retry')} onAction={load} /></ScreenScaffold>;

  // Prefer the REAL stamped tracking feed (per-step transition times); fall back to the order+shipment-derived
  // times when the feed isn't available yet (offline / not fetched) — degrade-never-die, never fabricated.
  const ts = tracking ? trackTimestampsFromEvents(tracking) : trackTimestamps(order, shipment);
  const steps = orderTimeline(order.status, ts);
  const riderId = tracking?.shipment?.riderUserId ?? shipment?.riderUserId ?? null;
  const lastLoc = lastKnownLocation(tracking?.shipmentEvents);

  const messageFarmer = async () => {
    const convo = await openDirect(order.sellerUserId, orderId).catch(() => null);
    if (convo) router.push({ pathname: '/(buyer)/chat/[id]', params: { id: convo.id, peerId: order.sellerUserId } });
  };
  const callDriver = async () => {
    if (!riderId) return;
    const ok = await startMaskedCall(riderId, orderId).then(() => true).catch(() => false);
    if (!ok) Alert.alert(t('track.callFailed'));
  };
  const markDelivered = () => {
    Alert.alert(t('track.confirmTitle'), t('track.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('track.markDelivered'), onPress: async () => {
        setBusy(true);
        try { await completeOrder(order.id); await load(); } catch { Alert.alert(t('track.markFailed')); } finally { setBusy(false); }
      } },
    ]);
  };

  const footer = (
    <View style={styles.footerRow}>
      <Button title={t('track.callDriver')} variant="outline" onPress={callDriver} disabled={!riderId} />
      <View style={{ flex: 1 }}>
        <Button title={t('track.markDelivered')} onPress={markDelivered} loading={busy} disabled={order.status === 'completed'} fullWidth />
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={title} footer={footer}>
      {/* §13: decorative map placeholder (no live GPS/route feed) with origin/vehicle/destination pins. */}
      <View style={styles.map} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.pin, styles.pinOrigin]}><Text style={styles.pinGlyph}>🏠</Text></View>
        <View style={[styles.pin, styles.pinTruck]}><Text style={styles.pinGlyph}>🚛</Text></View>
        <View style={[styles.pin, styles.pinDest]}><Text style={styles.pinGlyph}>📍</Text></View>
        <View style={styles.eta}>
          <View>
            <Text style={styles.etaLabel}>{t('track.eta')}</Text>
            <Text style={styles.etaValue}>—</Text>
            {/* §13: no ETA feed → "—". When a rider posted a GPS ping we surface an honest last-updated time
                (never a fabricated place name / "X km away"). */}
            {lastLoc ? <Text style={styles.lastUpdate}>{t('track.lastUpdate', { time: safeDate(lastLoc.at, lang) })}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.etaLabel}>{t('track.driver')}</Text>
            <Text style={styles.driverValue}>{riderId ? t('track.driverAssigned') : '—'}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.h3}>{t('track.timeline')}</Text>
      <Card>
        {steps.map((s, i) => <Step key={s.key} step={s} label={t(`orderDetail.step.${s.key}`)} at={s.atIso ? safeDate(s.atIso, lang) : null} last={i === steps.length - 1} />)}
      </Card>

      <Card style={styles.help}>
        <Text style={styles.helpText}><Text style={styles.helpBold}>{t('track.helpTitle')} </Text>{t('track.helpBody')}</Text>
        <Pressable onPress={messageFarmer} accessibilityRole="button"><Text style={styles.link}>{t('track.messageFarmer')}</Text></Pressable>
      </Card>
    </ScreenScaffold>
  );
}

function Step({ step, label, at, last }: { step: OrderTimelineStep; label: string; at: string | null; last: boolean }) {
  const glyph = step.state === 'done' ? '✓' : step.state === 'active' ? '●' : '';
  return (
    <View style={[styles.step, !last && styles.stepDivider]}>
      <View style={[styles.stepIcon, step.state === 'done' && styles.iconDone, step.state === 'active' && styles.iconActive]}>
        <Text style={styles.stepGlyph}>{glyph}</Text>
      </View>
      <View style={{ flex: 1, opacity: step.state === 'pending' ? 0.5 : 1 }}>
        <Text style={styles.stepLabel}>{label}</Text>
        {at ? <Text style={styles.stepAt}>{at}</Text> : null}
      </View>
    </View>
  );
}
function safeDate(iso: string, langCode: string): string { try { return formatDate(iso, langCode, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }

const styles = StyleSheet.create({
  map: { height: 200, borderRadius: radius.lg, backgroundColor: color.primary50, overflow: 'hidden', marginBottom: space[4] },
  pin: { position: 'absolute', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  pinOrigin: { top: '18%', left: '20%', backgroundColor: color.primary600 },
  pinTruck: { top: '45%', left: '46%', backgroundColor: color.accent500 },
  pinDest: { top: '68%', left: '72%', backgroundColor: color.success },
  pinGlyph: { fontSize: 16 },
  eta: { position: 'absolute', left: space[3], right: space[3], bottom: space[3], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: color.card, borderRadius: radius.md, padding: space[3] },
  etaLabel: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5 },
  etaValue: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: 2 },
  driverValue: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800, marginTop: 2 },
  lastUpdate: { fontFamily: font.body, fontSize: 10, color: color.ink500, marginTop: 2 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  step: { flexDirection: 'row', gap: space[3], paddingVertical: space[3], alignItems: 'flex-start' },
  stepDivider: { borderBottomWidth: 1, borderBottomColor: color.ink100, borderStyle: 'dashed' },
  stepIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.earth200, alignItems: 'center', justifyContent: 'center' },
  iconDone: { backgroundColor: color.success },
  iconActive: { backgroundColor: color.accent500 },
  stepGlyph: { fontSize: 13, color: color.white, fontWeight: font.weight.bold },
  stepLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  stepAt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  help: { marginTop: space[4], backgroundColor: color.infoLight },
  helpText: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: font.size.xs * 1.5 },
  helpBold: { fontWeight: font.weight.bold },
  link: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700, marginTop: space[2] },
  footerRow: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
});
