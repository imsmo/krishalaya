// apps/mobile/src/app/(delivery)/history.tsx · finished work (PC-50 W10-5). Delivered/returned/cancelled
// shipments from box=mine. HONEST MONEY NOTE: shipment.chargeMinor is what the CUSTOMER paid for delivery,
// not the rider's cut — rider payout terms have NO backend, so no per-drop earnings are invented
// (PC-54 `rider-payouts`); the footer says exactly that.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { Shipment } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myTasks } from '../../features/delivery-partner/delivery.api';
import { isActiveTask, shipmentTone } from '../../features/delivery-partner/delivery';

export default function RiderHistory() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Shipment[] | null>(null);
  useFocusEffect(useCallback(() => { myTasks().then(setItems); }, []));

  const done = items?.filter((s) => !isActiveTask(s.status) && s.status !== 'pending') ?? null;
  return (
    <ScreenScaffold title={t('rider.history.title')}>
      {done === null ? <SkeletonCard lines={6} /> : done.length === 0 ? (
        <EmptyState title={t('rider.history.empty')} message={t('rider.history.emptyHint')} />
      ) : (
        <FlatList
          data={done}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.awb}>{item.awbNo ? `AWB ${item.awbNo}` : item.id.slice(0, 8)}</Text>
                <StatusPill label={t(`rider.status.${item.status}`) || item.status} tone={shipmentTone(item.status)} />
              </View>
              {item.deliveredAt ? <Text style={styles.muted}>{new Date(item.deliveredAt).toLocaleString()}</Text> : null}
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('rider.history.payoutNote')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  awb: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
