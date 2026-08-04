// apps/mobile/src/app/(farmer)/notifications/index.tsx · screens 28/191 (notification inbox). Thin screen (guide
// §3): the caller's notifications (features/notifications, SWR-cached), All/Unread tabs with live counts, a
// "Mark all read", day-grouped (Today / Yesterday / Earlier) rows with an unread dot, relative time, optional
// reference line, and a per-item action that follows the server's in-app deep link. Behind the `notifications`
// flag. Degrade-never-die: empty/failed → a designed "all caught up" / friendly state.
//
// §13 — the rendered title/body/ref and the action DEEP LINK all come from the SERVER payload (localized); we never
// invent copy. The action deep link is accepted only if it's an in-app path (internalDeepLink, §4) — an external
// URL never auto-opens. Tab counts reflect the loaded page (the inbox is keyset, no grand total) — honest, not a
// fabricated "5".
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { NotificationItem } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { inbox, markAllRead } from '../../../features/notifications/notifications.api';
import { presentNotification, groupByDay, unreadCount } from '../../../features/notifications/present';

export default function NotificationInbox() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const enabled = useFlag('notifications');
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Always load the full inbox; the Unread tab filters client-side so both counts stay consistent.
  const load = useCallback(async () => { setItems((await inbox({})).items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  const unread = useMemo(() => unreadCount(items), [items]);
  const shown = tab === 'unread' ? items.filter((n) => n.status !== 'read') : items;
  const sections = useMemo(() => groupByDay(shown).map((g) => ({ key: g.key, title: t(`notifications.group.${g.key}`), data: g.items })), [shown, t]);

  if (!enabled) return <ScreenScaffold title={t('notifications.title')}><EmptyState title={t('notifications.unavailable')} /></ScreenScaffold>;

  const onMarkAll = async () => {
    const ids = items.filter((n) => n.status !== 'read').map((n) => n.id);
    if (!ids.length) return;
    setBusy(true);
    try { await markAllRead(ids); await load(); } finally { setBusy(false); }
  };
  const openItem = (n: NotificationItem) => {
    const p = presentNotification(n);
    if (p.deepLink) router.push(p.deepLink as never);
    else router.push(`/(farmer)/notifications/${n.id}`);
  };

  return (
    <ScreenScaffold title={t('notifications.title')} scroll={false}>
      <View style={styles.top}>
        <View style={styles.tabs}>
          {(['all', 'unread'] as const).map((key) => {
            const active = tab === key;
            const n = key === 'all' ? items.length : unread;
            return (
              <Pressable key={key} onPress={() => setTab(key)} style={[styles.chip, active && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                <Text style={[styles.chipText, active && styles.chipTextOn]}>{t(`notifications.${key}`)}</Text>
                <View style={[styles.count, active && styles.countOn]}><Text style={[styles.countTxt, active && styles.countTxtOn]}>{n}</Text></View>
              </Pressable>
            );
          })}
        </View>
        {unread > 0 ? <Pressable onPress={onMarkAll} disabled={busy} hitSlop={8} accessibilityRole="button"><Text style={styles.markAll}>{t('notifications.markAllRead')}</Text></Pressable> : null}
      </View>

      {loading ? <View style={{ gap: space[3], marginTop: space[3] }}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></View> : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          style={{ marginTop: space[3] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.sectionHead}>{(section as { title: string }).title}</Text>}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          SectionSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('notifications.caughtUp')} />}
          renderItem={({ item }) => {
            const p = presentNotification(item);
            return (
              <Card onPress={() => openItem(item)} accessibilityLabel={p.title}>
                <View style={styles.row}>
                  {p.unread ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.title, p.unread && styles.titleUnread]} numberOfLines={2}>{p.title}</Text>
                    {p.body ? <Text style={styles.body} numberOfLines={3}>{p.body}</Text> : null}
                    <View style={styles.metaRow}>
                      <Text style={styles.meta} numberOfLines={1}>
                        {p.createdAt ? safeRel(p.createdAt, lang) : ''}{p.ref ? ` · ${p.ref}` : ''}
                      </Text>
                      {p.deepLink ? <Text style={styles.action}>{t('notifications.view')}</Text> : null}
                    </View>
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeRel(iso: string, langCode: string): string { try { return formatRelative(iso, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  tabs: { flexDirection: 'row', gap: space[2] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  count: { minWidth: 20, paddingHorizontal: 6, height: 20, borderRadius: 10, backgroundColor: color.ink100, alignItems: 'center', justifyContent: 'center' },
  countOn: { backgroundColor: color.primary600 },
  countTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink600 },
  countTxtOn: { color: color.white },
  markAll: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  sectionHead: { fontFamily: font.display, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink500, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.primary600, marginTop: 6 },
  dotSpacer: { width: 10 },
  title: { fontFamily: font.body, fontSize: font.size.md, color: color.ink700 },
  titleUnread: { fontWeight: font.weight.bold, color: color.ink900 },
  body: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, lineHeight: font.size.sm * 1.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[1], gap: space[2] },
  meta: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  action: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
});
