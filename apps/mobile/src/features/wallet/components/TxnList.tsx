// apps/mobile/src/features/wallet/components/TxnList.tsx · the shared, keyset-paginated money-list used by both
// Transactions (payments) and Payout history. Composite over ui-native primitives (guide §3). Scale (§5):
// FlatList with stable keys, CURSOR pagination only (never offset), bounded page fetches, pull-to-refresh, and
// infinite scroll via onEndReached. Degrade-never-die: a failed fetch yields an empty page (handled upstream) so
// the list shows a friendly empty state, never a crash. `present` maps a raw item → a pure TxnView.
import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { EmptyState, SkeletonCard, color, space } from '@krishalaya/ui-native';
import { TxnRow } from './TxnRow';
import type { TxnView } from '../txn';

interface Keyset<T> { items: T[]; nextCursor: string | null }

export function TxnList<T>({ fetchPage, present, titleFor, statusFor, onOpen, langCode, emptyTitle, emptyMessage }: {
  fetchPage: (cursor?: string) => Promise<Keyset<T>>;
  present: (item: T) => TxnView;
  titleFor: (v: TxnView) => string;
  statusFor: (v: TxnView) => string;
  onOpen: (v: TxnView) => void;
  langCode: string;
  emptyTitle: string;
  emptyMessage?: string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paging, setPaging] = useState(false);

  const loadFirst = useCallback(async () => {
    const page = await fetchPage(undefined);
    setItems(page.items); setCursor(page.nextCursor); setLoading(false);
  }, [fetchPage]);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { const page = await fetchPage(undefined); setItems(page.items); setCursor(page.nextCursor); }
    finally { setRefreshing(false); }
  }, [fetchPage]);

  const onEndReached = useCallback(async () => {
    if (paging || !cursor) return; // no more pages
    setPaging(true);
    try {
      const page = await fetchPage(cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally { setPaging(false); }
  }, [paging, cursor, fetchPage]);

  if (loading) return <View style={{ gap: space[3] }}><SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} /></View>;

  return (
    <FlatList
      data={items}
      keyExtractor={(_, i) => presentKey(items[i], present)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={<EmptyState title={emptyTitle} message={emptyMessage} />}
      onEndReachedThreshold={0.4}
      onEndReached={onEndReached}
      ListFooterComponent={paging ? <ActivityIndicator color={color.primary600} style={{ marginVertical: space[4] }} /> : null}
      renderItem={({ item }) => {
        const v = present(item);
        return <TxnRow txn={v} title={titleFor(v)} statusLabel={statusFor(v)} langCode={langCode} onPress={() => onOpen(v)} />;
      }}
    />
  );
}

function presentKey<T>(item: T, present: (item: T) => TxnView): string { return present(item).id; }
function Separator() { return <View style={{ height: space[2] }} />; }
