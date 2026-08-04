// apps/mobile/src/app/(buyer)/chats.tsx · screen 97 (conversations / inquiries). Thin screen (guide §3): the
// caller's chat threads (keyset); tap → the chat thread. Behind `offers_chat`. Degrade-never-die.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Conversation } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listConversations } from '../../features/messaging/messaging.api';

export default function Chats() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setItems((await listConversations()).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  if (!enabled) return <ScreenScaffold title={t('chat.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('chat.title')} scroll={false}>
      {loading ? <View style={{ gap: space[3] }}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></View> : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('chat.empty.title')} message={t('chat.empty.message')} />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push({ pathname: '/(buyer)/chat/[id]', params: { id: item.id } })} accessibilityLabel={t(`chat.context.${item.contextType}`)}>
              <Text style={styles.title}>{t(`chat.context.${item.contextType}`)}</Text>
              {item.isLocked ? <Text style={styles.locked}>{t('chat.locked')}</Text> : null}
            </Card>
          )}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  locked: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: 2 },
});
