// apps/mobile/src/app/(system)/message-archive.tsx · screen 192 (message archive). Thin screen (guide §3): the
// caller's ARCHIVED conversation threads (per-participant), with a per-row Restore. Header count + a retention
// banner, then rows (counterparty name / context label, last-message preview, archived-since month). Behind
// `offers_chat`. Degrade-never-die (skeleton / designed empty / inline).
//
// Contract-gap P0-1 CLOSED: archive is now a real per-participant flag + a restore mutation (migration 0055,
// conversations.list({archived:true}) + conversations.restore). Rows show the real counterparty name (fallback to
// the context label), the last-message preview, and the archived month — no fabricated "Ramani Traders · ₹23,040".
// The "kept for 1 year" line remains static chrome (retention is a server policy, not surfaced per-thread).
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { Conversation } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, Button, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { listConversations, restoreConversation } from '../../features/messaging/messaging.api';
import { conversationPreview } from '../../features/system/system';

export default function MessageArchive() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => { setItems((await listConversations(undefined, true)).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const restore = async (id: string) => {
    setBusyId(id);
    try { await restoreConversation(id); setItems((prev) => prev.filter((c) => c.id !== id)); }
    catch { Alert.alert(t('messages.archive.title'), t('common.error.generic')); }
    finally { setBusyId(null); }
  };

  if (!enabled) return <ScreenScaffold title={t('messages.archive.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;
  if (loading) return <ScreenScaffold title={t('messages.archive.title')}><SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={items.length > 0 ? `${t('messages.archive.title')} · ${items.length}` : t('messages.archive.title')} scroll={false}>
      <View style={styles.banner}>
        <Text style={styles.bannerIcon}>📦</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{t('messages.archive.banner')}</Text>
          <Text style={styles.bannerSub}>{t('messages.archive.autoDelete')}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
        ListEmptyComponent={<EmptyState title={t('messages.archive.empty.title')} message={t('messages.archive.empty.message')} />}
        renderItem={({ item }) => {
          const preview = conversationPreview(item);
          const previewText = preview.kind === 'text' ? preview.text
            : preview.kind === 'photo' ? t('messages.preview.photo')
            : preview.kind === 'voice' ? t('messages.preview.voice')
            : t(`chat.context.${item.contextType}`);
          const when = item.lastMessageAt ?? item.createdAt;
          return (
            <Card style={styles.row}>
              <Pressable
                style={{ flex: 1 }}
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
              >
                <Text style={styles.title} numberOfLines={1}>{item.counterpartyName || t(`chat.context.${item.contextType}`)}</Text>
                <Text style={styles.sub} numberOfLines={1}>{previewText}</Text>
                {when ? <Text style={styles.month}>{safeMonth(when, lang)}</Text> : null}
              </Pressable>
              <Button title={t('messages.archive.restore')} variant="outline" size="md" fullWidth={false} loading={busyId === item.id} onPress={() => restore(item.id)} />
            </Card>
          );
        }}
        contentContainerStyle={{ paddingBottom: space[6] }}
      />
    </ScreenScaffold>
  );
}

function safeMonth(iso: string, langCode: string): string {
  try { return formatDate(iso, langCode, { month: 'short', year: 'numeric' }); } catch { return iso.slice(0, 7); }
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, backgroundColor: color.earth100, marginBottom: space[3] },
  bannerIcon: { fontSize: font.size.xl },
  bannerTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  bannerSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink900 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  month: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 2 },
});
