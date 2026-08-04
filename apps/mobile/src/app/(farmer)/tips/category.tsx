// apps/mobile/src/app/(farmer)/tips/category.tsx · screen 102 "Tips by Category". Thin screen (guide §3): a
// category header (the resource KIND we're scoped to + a REAL count), a type sub-filter chip row, and a rich tip
// list (kind glyph, audio badge, title, DERIVED read-time). Reached from crop-hub with a `kind` param. Reads
// cached tips → offline. Behind `tips_assistant`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • The design's topic-CATEGORY name ("Pest Control") and its total ("24 tips") — the resource read-model carries
//    a topicId (uuid) but NO topic NAME, so we scope by the REAL grouping we have (kind) and count the REAL items.
//  • The CROP sub-filters ("Wheat (8)", "Cotton (6)", …) and the card "crop · topic" subline — no crop/topic NAME
//    on the resource → the sub-filter row uses the real KIND grouping; a footnote flags the crop taxonomy gap.
//  • Per-tip READS ("12.4k reads") — no view-count contract → omitted, never invented.
//  • The AUDIO badge + read-time are REAL (kind === 'audio'; read-time derived from the body).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { LearningResource, ResourceKind } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listTips } from '../../../features/content/content.api';
import { groupByKind, kindLabelKey, readTimeMinutes } from '../../../features/content/content';

function kindGlyph(kind: string): string {
  switch (kind) {
    case 'video': return '📹';
    case 'audio': return '🎧';
    case 'blog': return '📝';
    case 'post': return '📣';
    default: return '🌾';
  }
}

export default function TipsCategory() {
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('tips_assistant');
  const [all, setAll] = useState<LearningResource[]>([]);
  const [kind, setKind] = useState<ResourceKind | null>((kindParam as ResourceKind) ?? null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { const r = await listTips(); setAll(r.items); setLoading(false); }, []);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  const sections = useMemo(() => groupByKind(all), [all]);
  // 'all' shows the whole catalogue; otherwise the chosen real kind grouping.
  const active: ResourceKind | 'all' = kind ?? 'all';
  const items = useMemo(() => (active === 'all' ? all : all.filter((r) => r.kind === active)), [all, active]);
  const headerLabel = active === 'all' ? t('content.category.allTitle') : t(kindLabelKey(active));

  if (!enabled) return <ScreenScaffold title={t('content.category.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('content.category.title')}>
      {loading ? <SkeletonCard lines={6} /> : sections.length === 0 ? (
        <EmptyState title={t('content.tips.empty.title')} message={t('content.tips.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <>
          {/* Category header — real label + real count (maps to "Pest Control · 24 tips") */}
          <Text style={styles.catTitle}>{headerLabel}</Text>
          <Text style={styles.catCount}>{t('content.category.count', { n: items.length })}</Text>

          {/* Type sub-filter chips (real kind grouping; design's crop sub-filter — see §13 footnote) */}
          <FlatList
            horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}
            data={[{ kind: 'all' as const, items: all }, ...sections]}
            keyExtractor={(s) => s.kind}
            renderItem={({ item: s }) => {
              const on = active === s.kind;
              const label = s.kind === 'all' ? t('content.kind.all') : t(kindLabelKey(s.kind));
              return (
                <Pressable onPress={() => setKind(s.kind === 'all' ? null : (s.kind as ResourceKind))} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{label} ({s.items.length})</Text>
                </Pressable>
              );
            }}
          />
          <Text style={styles.note}>{t('content.category.taxonomyNote')}</Text>

          <FlatList
            data={items}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => {
              const mins = readTimeMinutes(item.body);
              return (
                <Pressable onPress={() => router.push({ pathname: '/(farmer)/tips/[id]', params: { id: item.id } })} accessibilityRole="button">
                  <Card style={styles.card}>
                    <Text style={styles.glyph}>{kindGlyph(item.kind)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.kindLine}>{t(kindLabelKey(item.kind))}</Text>
                      <Text style={styles.tipTitle} numberOfLines={2}>{item.title}</Text>
                      <View style={styles.meta}>
                        {item.kind === 'audio' ? <Text style={styles.audio}>🎧 {t('content.kind.audio')}</Text> : null}
                        <Text style={styles.metaItem}>🕐 {t('content.readTime', { n: mins })}</Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              );
            }}
            contentContainerStyle={{ paddingBottom: space[6] }}
          />
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  catTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  catCount: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2, marginBottom: space[2] },
  chipRow: { marginBottom: space[1], flexGrow: 0 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[3], marginRight: space[2], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginBottom: space[2] },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], marginBottom: space[2] },
  glyph: { fontSize: 30, width: 40, textAlign: 'center' },
  kindLine: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginBottom: 2 },
  tipTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, lineHeight: 20 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2] },
  audio: { fontFamily: font.body, fontSize: font.size.xs, color: color.info, fontWeight: font.weight.semibold },
  metaItem: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
});
