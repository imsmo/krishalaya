// apps/mobile/src/app/(dairy)/bills/index.tsx · my milk bills (PC-50 W10-2). box=mine — the farmer's own
// settlement bills, status straight from the server's lifecycle (draft→previewed→approved→paid | disputed).
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { MilkBill } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myBills } from '../../../features/dairy/dairy.api';
import { billTone } from '../../../features/dairy/dairy';

export default function BillList() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<MilkBill[] | null>(null);
  useFocusEffect(useCallback(() => { myBills().then(setItems); }, []));

  return (
    <ScreenScaffold title={t('dairyapp.bills.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('dairyapp.bills.empty')} message={t('dairyapp.bills.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/(dairy)/bills/${item.id}`)}>
              <Card>
                <View style={styles.between}>
                  <StatusPill label={t(`dairyapp.bill.${item.status}`) || item.status} tone={billTone(item.status)} />
                  <MoneyText minor={item.netMinor} langCode={lang} size="md" />
                </View>
                <Text style={styles.muted}>{item.periodStart} → {item.periodEnd} · {item.totalLitres} {t('dairyapp.bills.litres')}</Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
