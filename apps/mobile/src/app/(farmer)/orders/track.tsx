// apps/mobile/src/app/(farmer)/orders/track.tsx · screen 131 (order tracking). Thin screen (guide §3): load the
// order's shipment → render a progress Timeline from the PURE trackingSteps(status). Behind `orders_fulfilment`.
// Degrade-never-die: no shipment / failure → a friendly state, never a crash.
import React, { useCallback, useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { Shipment } from '@krishalaya/sdk-js';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getOrderShipment } from '../../../features/orders/orders.api';
import { trackingSteps, orderStatusTone } from '../../../features/orders/order-status';
import { Timeline } from '../../../features/orders/components/Timeline';

export default function TrackOrder() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { t } = useTranslation();
  const enabled = useFlag('orders_fulfilment');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // KV MF-06 hardening: a missing/undefined orderId (e.g. a caller passing the wrong param key) must still
    // clear the loading flag — otherwise the screen is stuck on SkeletonCard forever (Law 12 degrade-never-die).
    if (!orderId) { setLoading(false); return; }
    setLoading(true); setShipment(await getOrderShipment(orderId)); setLoading(false);
  }, [orderId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('track.title')}><EmptyState title={t('orders.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('track.title')}>
      {loading ? <SkeletonCard lines={6} /> : !shipment ? (
        <EmptyState title={t('track.noShipment.title')} message={t('track.noShipment.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <Card>
          {shipment.awbNo ? <Text style={styles.awb}>{t('track.awb', { awb: shipment.awbNo })}</Text> : null}
          <StatusPill label={t(`shipment.status.${shipment.status}`)} tone={orderStatusTone(shipment.status)} />
          <Text style={styles.spacer} />
          <Timeline steps={trackingSteps(shipment.status)} labelFor={(k) => t(`shipment.status.${k}`)} />
        </Card>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  awb: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: space[2] },
  spacer: { height: space[4] },
});
