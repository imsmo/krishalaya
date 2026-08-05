// apps/mobile/src/app/(equipment)/rentals/index.tsx · booking requests (PC-50 W10-6; canon screen 310).
// box=owner — rentals on MY machines. Status chips filter server-side.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { EquipmentRental } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { ownerRentals } from '../../../features/equipment/equipment.api';
import { rentalTone, RENTAL_STATUSES } from '../../../features/equipment/equipment';

export default function BookingRequests() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<EquipmentRental[] | null>(null);
  const load = useCallback(async () => { setItems(null); setItems(await ownerRentals(status || undefined)); }, [status]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScreenScaffold title={t('equip.req.title')}>
      <View style={styles.wrap}>
        <Pressable style={[styles.chip, status === '' && styles.chipOn]} onPress={() => setStatus('')}><Text style={styles.chipText}>{t('equip.req.all')}</Text></Pressable>
        {RENTAL_STATUSES.map((s) => (
          <Pressable key={s} style={[styles.chip, status === s && styles.chipOn]} onPress={() => setStatus(s)}>
            <Text style={styles.chipText}>{t(`equip.status.${s}`)}</Text>
          </Pressable>
        ))}
      </View>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('equip.req.empty')} message={t('equip.req.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(equipment)/rentals/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.name}>{item.assetName ?? t('equip.req.asset')}</Text>
                  <StatusPill label={t(`equip.status.${item.status}`) || item.status} tone={rentalTone(item.status)} />
                </View>
                <View style={styles.between}>
                  <Text style={styles.muted}>{item.quantity} {item.unitCode}</Text>
                  {item.totalMinor ? <MoneyText minor={item.totalMinor} langCode={lang} size="sm" /> : null}
                </View>
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
  name: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
