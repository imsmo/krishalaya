// apps/mobile/src/app/(buyer)/offers.tsx · the buyer's offers (outgoing). Thin screen (guide §3): keyset list via
// features/offers; tap → offer detail to negotiate. Behind `offers_chat`. Degrade-never-die.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { ListingOffer } from '@krishalaya/sdk-js';
import { Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listOffers } from '../../features/offers/offers.api';
import { offerStatusTone, currentOfferPriceMinor } from '../../features/offers/offer-status';

export default function BuyerOffers() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [items, setItems] = useState<ListingOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setItems((await listOffers('outgoing')).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  if (!enabled) return <ScreenScaffold title={t('offer.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('offer.title')} scroll={false}>
      {loading ? <View style={{ gap: space[3] }}><SkeletonCard /><SkeletonCard /></View> : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.offerId}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListEmptyComponent={<EmptyState title={t('offer.empty.title')} message={t('offer.empty.message')} />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/(buyer)/offers/[id]', params: { id: item.offerId } })} accessibilityLabel={t('offer.title')}>
              <View style={styles.row}>
                <Text style={styles.qty}>{item.quantity}</Text>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <MoneyText minor={currentOfferPriceMinor(item)} langCode={lang} />
                  <StatusPill label={t(`offer.status.${item.status}`)} tone={offerStatusTone(item.status)} />
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qty: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink800 },
});
