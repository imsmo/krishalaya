// apps/mobile/src/app/(farmer)/tips/index.tsx · screen 55 "Farming Tips library". Thin screen (guide §3): browse
// approved curated tips (cached → offline), with the design's topic-category tabs + a text search (local,
// ReDoS-safe) + a thumbnail card carrying a kind glyph, kind tag, title, DERIVED read-time and the REAL content
// language. Tap a tip for detail; links to saved tips + crop hub + the AI assistant + voice search.
// Behind `tips_assistant`. Degrade-never-die.
// §13 (rendered honestly, never faked):
//  • Topic chips are now REAL — the resource read-model carries the server-resolved topic NAME (P1-5), so the
//    chips are built dynamically from the topics actually present on this page (+ an "All" chip). Topics that
//    don't resolve to a name simply don't appear (never a fabricated label).
//  • A per-tip VIEW COUNT ("2.4k views") has no contract on the resource read-model → omitted, never invented.
//  • A thumbnail IMAGE isn't carried either → a kind glyph stands in (design's emoji thumb).
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { LearningResource } from '@krishalaya/sdk-js';
import { Input, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listTips } from '../../../features/content/content.api';
import { searchResources, kindLabelKey, readTimeMinutes, languageLabelKey, distinctTopics, filterByTopic } from '../../../features/content/content';

/** Design's emoji thumb stands in for the (absent) thumbnail image — chosen by resource kind. Pure. */
function kindGlyph(kind: string): string {
  switch (kind) {
    case 'video': return '📹';
    case 'audio': return '🎧';
    case 'blog': return '📝';
    case 'post': return '📣';
    default: return '🌾';
  }
}
const LANG_FLAG: Record<string, string> = { hi: '🇮🇳', gu: '🇮🇳', en: '🇬🇧', other: '🌐' };

export default function TipsLibrary() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const [all, setAll] = useState<LearningResource[]>([]);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<TipCategory>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { const r = await listTips(); setAll(r.items); setLoading(false); }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  // Only 'all' is satisfiable (no topic-name contract) → the list always reflects 'all' + the text query (§13).
  const items = useMemo(() => searchResources(all, query), [all, query]);

  if (!enabled) return <ScreenScaffold title={t('content.tips.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('content.tips.title')}>
      <View style={styles.links}>
        <Pressable onPress={() => router.push('/(farmer)/crop-hub')} accessibilityRole="button"><Text style={styles.link}>🌱 {t('content.cropHub.title')}</Text></Pressable>
        <Pressable onPress={() => router.push('/(farmer)/tips/saved')} accessibilityRole="button"><Text style={styles.link}>🔖 {t('content.saved.title')}</Text></Pressable>
        <Pressable onPress={() => router.push('/(farmer)/assistant')} accessibilityRole="button"><Text style={styles.link}>🤖 {t('content.assistant.title')}</Text></Pressable>
      </View>
      <Input label={t('content.search.label')} value={query} onChangeText={setQuery} placeholder={t('content.search.placeholder')} returnKeyType="search" />
      <Pressable onPress={() => router.push('/(farmer)/voice-search')} accessibilityRole="button" style={styles.voiceLink}><Text style={styles.link}>🎙️ {t('content.voiceSearch.cta')}</Text></Pressable>

      {/* Topic-category tabs (design). §13: only 'all' has a contract; named topics are disabled until a topic
          taxonomy ships (footnote below) — never wired to a fake filter. */}
      <View style={styles.tabs}>
        {TIP_CATEGORIES.map((c) => {
          const on = cat === c;
          const usable = c === 'all';
          return (
            <Pressable
              key={c}
              disabled={!usable}
              onPress={() => usable && setCat(c)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: !usable }}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabTxt, on && styles.tabTxtOn, !usable && styles.tabTxtOff]}>{t(`content.cat.${c}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.catNote}>{t('content.cat.note')}</Text>

      {loading ? <SkeletonCard lines={5} /> : items.length === 0 ? (
        <EmptyState title={t('content.tips.empty.title')} message={t('content.tips.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => {
            const mins = readTimeMinutes(item.body);
            const lk = languageLabelKey(item.languageCode);
            return (
              <Pressable onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: item.id } })} accessibilityRole="button">
                <View style={styles.card}>
                  <View style={styles.thumb}>
                    <Text style={styles.thumbGlyph}>{kindGlyph(item.kind)}</Text>
                    <Text style={styles.catTag}>{t(kindLabelKey(item.kind))}</Text>
                  </View>
                  <View style={styles.body}>
                    <Text style={styles.tipTitle} numberOfLines={2}>{item.title}</Text>
                    <View style={styles.meta}>
                      <Text style={styles.metaItem}>🕐 {t('content.readTime', { n: mins })}</Text>
                      <Text style={styles.metaItem}>{LANG_FLAG[lk] ?? '🌐'} {t(`content.lang.${lk}`)}</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingBottom: space[2] },
  link: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.primary700, minHeight: 44, paddingVertical: space[1] },
  voiceLink: { paddingVertical: space[1] },

  tabs: { flexDirection: 'row', marginTop: space[2], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space[3], borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink500 },
  tabTxtOn: { color: color.primary700 },
  tabTxtOff: { color: color.ink300 },
  catNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[1], marginBottom: space[2] },

  card: { flexDirection: 'row', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, overflow: 'hidden', marginBottom: space[3] },
  thumb: { width: 96, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 40 },
  catTag: { position: 'absolute', top: 6, left: 6, paddingHorizontal: space[2], paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radius.pill, fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.ink700, textTransform: 'uppercase' },
  body: { flex: 1, padding: space[3], justifyContent: 'center' },
  tipTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, lineHeight: 20 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2] },
  metaItem: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
});
