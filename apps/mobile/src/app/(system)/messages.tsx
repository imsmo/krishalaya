// apps/mobile/src/app/(system)/messages.tsx · screen 191 (unified messages inbox). Thin screen (guide §3): the
// caller's conversation threads across all contexts, with category filter tabs (All / Buyers / Workers / Support)
// derived from each thread's real contextType, and a tap-through to the chat thread. Behind `offers_chat`.
// Degrade-never-die (skeleton / designed empty / inline).
//
// Contract-gap P0-1 CLOSED: the server now returns a conversation-summary read-model — counterparty name, last-
// message preview + time, and the caller's unread count — so each row shows the real name (falling back to the
// context label when a thread has no single counterparty), a text/📷/🎤 preview, the created time, and an unread
// badge; the header shows the real "· N new" total. Names/previews come straight from the API (never invented);
// a thread with no messages yet shows no preview rather than a fake one (Law 12).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Conversation } from '@krishalaya/sdk-js';
import { EmptyState, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listConversations } from '../../features/messaging/messaging.api';
import { messageTabs, filterConversationsByTab, conversationPreview, unreadTotal, type MessageCategory } from '../../features/system/system';

export default function Messages() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'all' | MessageCategory>('all');

  const load = useCallback(async () => { setItems((await listConversations()).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const tabs = useMemo(() => messageTabs(items), [items]);
  const shown = useMemo(() => filterConversationsByTab(items, tab), [items, tab]);
  const unread = useMemo(() => unreadTotal(items), [items]);
  const header = unread > 0 ? `${t('messages.title')} · ${t('messages.newCount', { n: unread })}` : t('messages.title');

  if (!enabled) return <ScreenScaffold title={t('messages.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('messages.title')}><SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={header} scroll={false}>
      {items.length > 0 ? (
        <FlatList
          horizontal
          data={tabs}
          keyExtractor={(x) => x.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          renderItem={({ item }) => {
            const active = item.key === tab;
            const label = item.key === 'all' ? t('messages.tab.all') : t(`messages.tab.${item.key}`);
            return (
              <Pressable onPress={() => setTab(item.key)} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{`${label} · ${item.count}`}</Text>
              </Pressable>
            );
          }}
        />
      ) : null}

      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
        ListEmptyComponent={<EmptyState title={t('messages.empty.title')} message={t('messages.empty.message')} />}
        renderItem={({ item }) => {
          const preview = conversationPreview(item);
          const previewText = preview.kind === 'text' ? preview.text
            : preview.kind === 'photo' ? t('messages.preview.photo')
            : preview.kind === 'voice' ? t('messages.preview.voice')
            : item.isLocked ? t('chat.locked') : t(`chat.context.${item.contextType}`);
          const when = item.lastMessageAt ?? item.createdAt;
          return (
            <Pressable
              onPress={() => router.push({
                pathname: '/(system)/chat/[id]',
                params: {
                  id: item.id,
                  ...(item.counterpartyUserId ? { peerId: item.counterpartyUserId } : {}),
                  ...(item.counterpartyName ? { peerName: item.counterpartyName } : {}),
                  context: item.contextType,
                },
              } as never)}
              accessibilityRole="button"
              style={styles.row}
            >
              <Text style={styles.icon}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{item.counterpartyName || t(`chat.context.${item.contextType}`)}</Text>
                <Text style={styles.sub} numberOfLines={1}>{previewText}</Text>
              </View>
              <View style={styles.rowEnd}>
                {when ? <Text style={styles.time}>{safeDate(when, lang)}</Text> : null}
                {(item.unreadCount ?? 0) > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount}</Text></View> : <Text style={styles.chev}>›</Text>}
              </View>
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: space[6] }}
      />
    </ScreenScaffold>
  );
}

function safeDate(iso: string, langCode: string): string {
  try { return formatDate(iso, langCode, { day: 'numeric', month: 'short' }); } catch { return iso.slice(0, 10); }
}

const styles = StyleSheet.create({
  tabs: { gap: space[2], paddingVertical: space[3] },
  chip: { minHeight: 36, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: 999, backgroundColor: color.earth100 },
  chipActive: { backgroundColor: color.primary600 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTextActive: { color: color.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  icon: { fontSize: font.size.xl },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink900 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end', gap: 4 },
  time: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white },
});
