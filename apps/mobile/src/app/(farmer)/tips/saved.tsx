// apps/mobile/src/app/(farmer)/tips/saved.tsx · screen 103 "Saved Tips". Thin screen (guide §3): a header with the
// REAL saved count, a list of bookmarked tips (kind glyph, kind line, title, REAL "Saved {relative}" from the
// snapshot's savedAt), and a remove (un-save) action. Saves are SERVER-persisted (buyer/saves entityType='tip',
// P1-16) with an AsyncStorage mirror so the list renders instantly + offline. Behind `tips_assistant`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The design's "crop · topic" subline ("Wheat · Disease") — the saved snapshot carries kind/title/savedAt but
//    NO crop/topic NAME → we show the real kind label, not an invented crop.
//  • Per-tip READ-TIME ("5 min read") — the snapshot has no body to derive it from → omitted (shown only on the
//    detail screen, which loads the full tip), never faked here.
//  • The "Recently read" section + "View all →" — there is NO read-history contract → shown as a coming-soon block,
//    never populated with invented rows.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { formatRelative } from '@krishalaya/i18n';
import { Card, EmptyState, StatusPill, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { loadSavedTips, unsaveTip } from '../../../features/content/content.api';
import { kindLabelKey, type TipSnapshot } from '../../../features/content/content';

function kindGlyph(kind: string): string {
  switch (kind) {
    case 'video': return '📹';
    case 'audio': return '🎧';
    case 'blog': return '📝';
    case 'post': return '📣';
    default: return '🌾';
  }
}
function safeRel(value: number, lang: string): string { try { return formatRelative(value, lang); } catch { return ''; } }

export default function SavedTips() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const [items, setItems] = useState<TipSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setItems(await loadSavedTips()); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('content.saved.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const remove = async (snap: TipSnapshot) => { setItems(await unsaveTip(snap.id, items)); };

  return (
    <ScreenScaffold title={t('content.saved.title')}>
      {loading ? <SkeletonCard lines={5} /> : items.length === 0 ? (
        <EmptyState title={t('content.saved.empty.title')} message={t('content.saved.empty.message')} actionLabel={t('content.tips.title')} onAction={() => router.push('/(farmer)/tips')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>{t('content.saved.heading')}</Text>
                <Text style={styles.count}>{t('content.saved.count', { n: items.length })}</Text>
              </View>
              <StatusPill label={t('content.saved.bookmarked')} tone="success" />
            </View>
          }
          renderItem={({ item }) => {
            const ago = safeRel(item.savedAt, lang);
            return (
              <Card style={styles.card}>
                <Pressable onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: item.id } })} accessibilityRole="button" style={styles.row}>
                  <Text style={styles.glyph}>{kindGlyph(item.kind)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.kindLine}>{t(kindLabelKey(item.kind))}</Text>
                    <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                    {ago ? <Text style={styles.meta}>{t('content.saved.savedAgo', { ago })}</Text> : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => remove(item)} accessibilityRole="button" style={styles.removeBtn}><Text style={styles.remove}>{t('content.saved.remove')}</Text></Pressable>
              </Card>
            );
          }}
          ListFooterComponent={
            // Recently read — §13: no read-history contract → coming-soon, never invented rows.
            <Card style={styles.recent}>
              <Text style={styles.recentTitle}>{t('content.saved.recentTitle')}</Text>
              <Text style={styles.recentSoon}>{t('content.saved.recentSoon')}</Text>
            </Card>
          }
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[3] },
  heading: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  count: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  glyph: { fontSize: 30, width: 40, textAlign: 'center' },
  kindLine: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: 2 },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, lineHeight: 20 },
  meta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  removeBtn: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  remove: { fontFamily: font.body, fontSize: font.size.sm, color: color.danger, marginTop: space[2] },
  recent: { marginTop: space[3] },
  recentTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900, marginBottom: space[1] },
  recentSoon: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
});
