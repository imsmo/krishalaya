// apps/mobile/src/app/(equipment)/earnings.tsx · settled jobs (PC-50 W10-6; canon screen 311). Each row's
// total is the SERVER-settled amount (advance + balance moved server-side). NO client-side grand total —
// the wallet is the ledger of record and the footer says so.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { EquipmentRental } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { ownerRentals } from '../../features/equipment/equipment.api';

export default function EquipmentEarnings() {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<EquipmentRental[] | null>(null);
  useFocusEffect(useCallback(() => { ownerRentals('settled').then(setItems); }, []));

  return (
    <ScreenScaffold title={t('equip.earn.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('equip.earn.empty')} message={t('equip.earn.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.name}>{item.assetName ?? item.id.slice(0, 8)}</Text>
                {item.totalMinor ? <MoneyText minor={item.totalMinor} langCode={lang} size="md" tone="positive" /> : null}
              </View>
              <Text style={styles.muted}>{item.quantity} {item.unitCode}{item.completedAt ? ` · ${new Date(item.completedAt).toLocaleDateString()}` : ''}</Text>
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('equip.earn.walletNote')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
