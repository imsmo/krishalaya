// apps/mobile/src/app/(vet)/bookings/index.tsx · my work queue (PC-50 W10-3). box=vet — bookings where I am
// the provider. Status chips filter server-side; the fee shown is the server-snapshotted price the farmer
// will pay on confirm.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myVetBookings } from '../../../features/vet/vet.api';
import { bookingTone } from '../../../features/livestock/livestock';

const FILTERS = ['', 'requested', 'accepted', 'en_route', 'in_consult', 'prescribed', 'completed'] as const;

export default function VetWorkQueue() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<VetBooking[] | null>(null);
  const load = useCallback(async () => { setItems(null); setItems(await myVetBookings(status || undefined)); }, [status]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenScaffold title={t('vetpro.queue.title')}>
      <View style={styles.wrap}>
        {FILTERS.map((f) => (
          <Pressable key={f || 'all'} style={[styles.chip, status === f && styles.chipOn]} onPress={() => setStatus(f)}>
            <Text style={styles.chipText}>{f ? t(`pashu.status.${f}`) : t('vetpro.queue.all')}</Text>
          </Pressable>
        ))}
      </View>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('vetpro.queue.empty')} message={t('vetpro.queue.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(vet)/bookings/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <StatusPill label={t(`pashu.status.${item.status}`) || item.status} tone={bookingTone(item.status)} />
                  <MoneyText minor={item.feeMinor} langCode={lang} size="sm" />
                </View>
                <Text style={styles.muted}>{t(`pashu.urgency.${item.urgency}`)} · {t(`pashu.mode.${item.mode}`)}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[2] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill, borderWidth: 1, borderColor: color.ink100 },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontSize: font.size.xs, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
