// apps/mobile/src/app/(buyer)/auctions.tsx · auction discovery (screens 16 list / 66 ended via the Live/Ended
// filter). Thin screen (guide §3): keyset list via features/auctions; Live/Ended chips; tap → detail. Behind
// `auctions`. Degrade-never-die.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Auction } from '@krishalaya/sdk-js';
import { Button, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listAuctions } from '../../features/auctions/auctions.api';
import { auctionStatusTone } from '../../features/auctions/auction-status';
import { AuctionCard } from '../../features/auctions/components/AuctionCard';

const FILTERS = [['live', 'live'], ['ended', 'ended']] as const;

export default function Auctions() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const [status, setStatus] = useState<'live' | 'ended'>('live');
  const [items, setItems] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setItems((await listAuctions({ status })).items); setLoading(false); }, [status]);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  if (!enabled) return <ScreenScaffold title={t('auction.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('auction.title')} scroll={false}>
      <View style={styles.filters}>
        {FILTERS.map(([key, val]) => {
          const active = status === val;
          return (
            <Pressable key={key} onPress={() => { setStatus(val); setLoading(true); }} style={[styles.chip, active && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.chipText, active && styles.chipTextOn]}>{t(`auction.filter.${key}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: space[2] }}>
        <Button title={t('auction.myBids')} variant="outline" onPress={() => router.push('/(buyer)/auctions/my-bids')} />
      </View>
      {loading ? <View style={{ gap: space[3], marginTop: space[3] }}><SkeletonCard /><SkeletonCard /></View> : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.auctionId}
          style={{ marginTop: space[3] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('auction.empty.title')} message={t('auction.empty.message')} />}
          renderItem={({ item }) => (
            <AuctionCard auction={item} langCode={lang}
              kindLabel={t(`auction.kind.${item.kind}`)} statusLabel={t(`auction.status.${item.status}`)} statusTone={auctionStatusTone(item.status)}
              startLabel={t('auction.startPrice')} endsLabel={t('auction.ends')}
              onPress={() => router.push({ pathname: '/(buyer)/auctions/[id]', params: { id: item.auctionId } })} />
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: space[2] },
  chip: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.md, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
});
