// apps/mobile/src/features/buyer/components/BrowseList.tsx · the shared, keyset-paginated browse/search list used
// by the buyer Home and Search screens. Composite over ui-native + BuyerListingCard (guide §3). Scale (§5):
// FlatList, stable keys, CURSOR pagination only, bounded pages, pull-to-refresh, infinite scroll. Saves are
// on-device (saved.api) — tapping ♥ toggles + persists, and the saved-id set is loaded on focus. Degrade-never-die:
// a failed page → empty (handled upstream), never a crash.
import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import type { ListingCard, ListingQuery } from '@krishalaya/sdk-js';
import { EmptyState, SkeletonCard, color, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { browseListings } from '../browse.api';
import { getSavedListings, toggleSavedListing } from '../saved.api';
import { BuyerListingCard } from './BuyerListingCard';

export function BrowseList({ query, ListHeader, emptyTitle, emptyMessage, onCountChange }: {
  query: ListingQuery; ListHeader?: React.ReactElement; emptyTitle: string; emptyMessage?: string;
  /** Reports the number of listings CURRENTLY loaded (grows as pages are appended). The read-model has no total
   *  count, so screens surface this honest loaded-count — never a fabricated grand total (§13). */
  onCountChange?: (loaded: number, hasMore: boolean) => void;
}) {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<ListingCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);

  const queryKey = JSON.stringify(query);
  const refreshSaved = useCallback(async () => { setSavedIds(new Set((await getSavedListings()).map((l) => l.id))); }, []);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    const page = await browseListings({ ...query, cursor: undefined });
    setItems(page.items); setCursor(page.nextCursor); setLoading(false);
    await refreshSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, refreshSaved]);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { const page = await browseListings({ ...query, cursor: undefined }); setItems(page.items); setCursor(page.nextCursor); await refreshSaved(); }
    finally { setRefreshing(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, refreshSaved]);

  const onEndReached = useCallback(async () => {
    if (paging || !cursor) return;
    setPaging(true);
    try { const page = await browseListings({ ...query, cursor }); setItems((prev) => [...prev, ...page.items]); setCursor(page.nextCursor); }
    finally { setPaging(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paging, cursor, queryKey]);

  const onToggleSave = useCallback(async (card: ListingCard) => {
    const next = await toggleSavedListing(card);
    setSavedIds(new Set(next.map((l) => l.id)));
  }, []);

  useEffect(() => { onCountChange?.(items.length, cursor !== null); }, [items.length, cursor, onCountChange]);

  if (loading) return <View style={{ gap: space[3] }}>{ListHeader}<SkeletonCard /><SkeletonCard /><SkeletonCard /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={ListHeader}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
      ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
      ListEmptyComponent={<EmptyState title={emptyTitle} message={emptyMessage} />}
      onEndReachedThreshold={0.4}
      onEndReached={onEndReached}
      ListFooterComponent={paging ? <ActivityIndicator color={color.primary600} style={{ marginVertical: space[4] }} /> : null}
      renderItem={({ item }) => (
        <BuyerListingCard
          card={item} langCode={lang} saved={savedIds.has(item.id)}
          onPress={() => router.push({ pathname: '/(buyer)/listings/[id]', params: { id: item.id } })}
          onToggleSave={() => onToggleSave(item)}
          saveLabel={t(savedIds.has(item.id) ? 'buyer.unsave' : 'buyer.save')}
        />
      )}
    />
  );
}
