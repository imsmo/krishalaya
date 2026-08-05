// apps/mobile/src/app/(store)/inventory.tsx · shelf inventory (PC-50 W10-4). The store's LIVE marketplace
// listings — the same features/listings data path the farmer sell-side uses (one domain, one code path).
// Stock quantity + server price per listing; creating/editing listings uses the existing listing flows.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ListingCard } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, StatusPill, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { myListings } from '../../features/listings/listings.api';

export default function StoreInventory() {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<ListingCard[] | null>(null);
  useFocusEffect(useCallback(() => { myListings().then((p) => setItems(p.items)); }, []));

  return (
    <ScreenScaffold title={t('store.inv.title')}>
      {items === null ? <SkeletonCard lines={6} /> : items.length === 0 ? (
        <EmptyState title={t('store.inv.empty')} message={t('store.inv.emptyHint')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.between}>
                <Text style={styles.name}>{item.title}</Text>
                <MoneyText minor={item.priceMinor} langCode={lang} size="sm" />
              </View>
              <View style={styles.between}>
                <Text style={styles.muted}>{t('store.inv.stock')} {item.quantityAvailable} {item.unitCode}</Text>
                {item.quantityAvailable <= 0 ? <StatusPill label={t('store.inv.out')} tone="danger" /> : item.quantityAvailable <= 5 ? <StatusPill label={t('store.inv.low')} tone="warning" /> : null}
              </View>
            </Card>
          )}
          ListFooterComponent={<Text style={styles.muted}>{t('store.inv.manageNote')}</Text>}
        />
      )}
    </ScreenScaffold>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800, flexShrink: 1 },
  muted: { fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
