// apps/mobile/src/app/(equipment)/fleet/index.tsx · my fleet (PC-50 W10-6; canon screens 308/312). box=mine
// assets with honest status pills (active / maintenance / retired). The alerts canon (312) needs a
// maintenance-schedule backend → the status pill IS today's honest alert; no fabricated service reminders.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { EquipmentAsset } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myFleet } from '../../../features/equipment/equipment.api';
import { assetTone } from '../../../features/equipment/equipment';

export default function Fleet() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<EquipmentAsset[] | null>(null);
  useFocusEffect(useCallback(() => { myFleet().then(setItems); }, []));

  return (
    <ScreenScaffold title={t('equip.fleet.title')}>
      <Button title={t('equip.fleet.add')} onPress={() => router.push('/(equipment)/fleet/add')} />
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('equip.fleet.empty')} message={t('equip.fleet.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(equipment)/fleet/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <Text style={styles.name}>{item.defaultName}</Text>
                  <StatusPill label={t(`equip.asset.${item.status ?? 'active'}`)} tone={assetTone(item.status)} />
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
  name: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
