// apps/mobile/src/app/(dairy)/rates.tsx · active rate charts (PC-50 W10-2). Rate TRANSPARENCY: the same
// server rate cards the MCC counter prices from (per-kg FAT / per-kg SNF / per-litre base, bigint minor).
// Reference data → cached, usable offline at the counter.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { DairyRateCard } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { activeRateCards } from '../../features/dairy/dairy.api';

export default function RateCharts() {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<DairyRateCard[] | null>(null);
  useFocusEffect(useCallback(() => { activeRateCards().then(setItems); }, []));

  return (
    <ScreenScaffold title={t('dairyapp.rates.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('dairyapp.rates.empty')} message={t('dairyapp.rates.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <Card>
              <Text style={styles.name}>{item.defaultName}</Text>
              <Text style={styles.muted}>{t(`dairyapp.animal.${item.animalType}`) || item.animalType} · {t('dairyapp.rates.from')} {item.effectiveFrom}</Text>
              {item.ratePerKgFatMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.fat')}</Text><MoneyText minor={item.ratePerKgFatMinor} langCode={lang} size="sm" /></View> : null}
              {item.ratePerKgSnfMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.snf')}</Text><MoneyText minor={item.ratePerKgSnfMinor} langCode={lang} size="sm" /></View> : null}
              {item.baseRatePerLitreMinor ? <View style={styles.between}><Text style={styles.label}>{t('dairyapp.rates.base')}</Text><MoneyText minor={item.baseRatePerLitreMinor} langCode={lang} size="sm" /></View> : null}
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('dairyapp.rates.note')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  label: { fontSize: font.size.xs, color: color.ink500 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space[1] },
});
