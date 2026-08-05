// apps/mobile/src/app/(vet)/earnings.tsx · my completed visits (PC-50 W10-3). Each row's fee is the SERVER-
// settled amount the farmer's confirm paid (Law 2/11). Deliberately NO client-side grand total — the ledger
// of record is the wallet, and the footer says so honestly.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { VetBooking } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myVetBookings } from '../../features/vet/vet.api';

export default function VetEarnings() {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<VetBooking[] | null>(null);
  useFocusEffect(useCallback(() => { myVetBookings('completed').then(setItems); }, []));

  return (
    <ScreenScaffold title={t('vetpro.earn.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('vetpro.earn.empty')} message={t('vetpro.earn.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.date}>{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : t('vetpro.earn.completed')}</Text>
                <MoneyText minor={item.feeMinor} langCode={lang} size="md" tone="positive" />
              </View>
              <Text style={styles.muted}>{t(`pashu.mode.${item.mode}`)}</Text>
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('vetpro.earn.walletNote')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  date: { fontSize: font.size.sm, color: color.ink800 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
