// apps/mobile/src/app/(delivery)/tasks/index.tsx · today's tasks (PC-50 W10-5). The rider's ACTIVE assigned
// shipments (box=mine, active statuses). AWB + order ref + status pill. No route MAP is drawn — there is no
// routing backend; the task list IS the honest route sheet (PC-54 note).
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Shipment } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myTasks } from '../../../features/delivery-partner/delivery.api';
import { isActiveTask, shipmentTone } from '../../../features/delivery-partner/delivery';

export default function TodayTasks() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<Shipment[] | null>(null);
  useFocusEffect(useCallback(() => { myTasks().then(setItems); }, []));

  const active = items?.filter((s) => isActiveTask(s.status)) ?? null;
  return (
    <ScreenScaffold title={t('rider.today.title')}>
      {active === null ? <SkeletonCard lines={6} /> : active.length === 0 ? (
        <EmptyState title={t('rider.today.empty')} message={t('rider.today.emptyHint')} />
      ) : (
        <FlatList
          data={active}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(delivery)/tasks/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.awb}>{item.awbNo ? `AWB ${item.awbNo}` : t('rider.today.noAwb')}</Text>
                  <StatusPill label={t(`rider.status.${item.status}`) || item.status} tone={shipmentTone(item.status)} />
                </View>
                {item.requiresOtp ? <Text style={styles.muted}>{t('rider.today.otpNeeded')}</Text> : null}
                {item.scheduledPickupAt ? <Text style={styles.muted}>{t('rider.today.pickupAt')} {new Date(item.scheduledPickupAt).toLocaleString()}</Text> : null}
              </Card>
            </Pressable>
          )}
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
