// apps/mobile/src/app/(farmer)/mandi/index.tsx · screen 52 "Today's Mandi Prices". Thin screen (guide §3): the
// region's latest mandi price rows (GET /market/prices?regionId), each showing the commodity name, yard · grade,
// the modal price (bigint paise via MoneyText, Law 2) and its unit. A location + "updated … ago" header and the
// design's category chips. Tapping a row opens that yard's detail (or price alerts). Behind `mandi_weather`.
// Degrade-never-die: loading skeleton, designed empty, inline retry.
// §13 gaps (no contract → rendered honestly, never faked): the price read-model carries no commodity CATEGORY
// (so the chips beyond "All" are disabled) and no day-over-day CHANGE% (computing it per row would be N+1) — a
// mandi pulse-list read-model is the production path; we never invent an arrow or a category.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { MandiPrice } from '@krishalaya/sdk-js';
import { formatRelative } from '@krishalaya/i18n';
import { Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listPrices, defaultRegionId } from '../../../features/market/market.api';
import { latestPriceDate, headerRegion, distinctCategories, filterByCategory } from '../../../features/market/mandi-list';

export default function MandiPrices() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('mandi_weather');
  const [items, setItems] = useState<MandiPrice[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setFailed(false);
    const region = await defaultRegionId();
    const r = await listPrices({ regionId: region ?? undefined });
    setItems(r.items); setFailed(false); setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) { setLoading(true); load(); } }, [enabled, load]));

  const region = useMemo(() => headerRegion(items), [items]);
  const updated = useMemo(() => latestPriceDate(items), [items]);
  const categories = useMemo(() => ['all', ...distinctCategories(items)], [items]);
  const visible = useMemo(() => filterByCategory(items, category), [items, category]);

  if (!enabled) return <ScreenScaffold title={t('mandi.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  return (
    <ScreenScaffold title={t('mandi.title')}>
      {loading ? <SkeletonCard lines={8} /> : failed || items.length === 0 ? (
        <EmptyState title={t('mandi.empty.title')} message={t('mandi.empty.message')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={
            <View>
              <Text style={styles.h1}>{t('mandi.todayTitle')}</Text>
              <Text style={styles.h1vern}>{t('mandi.todaySubtitle')}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaTxt}>📍 {region ?? t('mandi.regionUnknown')}</Text>
                {updated ? <Text style={styles.metaTxt}>🕐 {t('mandi.updated', { ago: safeRelative(updated, lang) })}</Text> : null}
              </View>
              {/* Category chips — "All" + the REAL distinct commodity categories in the loaded rows (P1-3); tapping filters. */}
              <View style={styles.chips}>
                {categories.map((c) => {
                  const active = c === category;
                  const label = c === 'all' ? t('mandi.category.all') : c;
                  return (
                    <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, active ? styles.chipOn : styles.chipIdle]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <Text style={[styles.chipTxt, active && styles.chipTxtOn]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/(farmer)/mandi/[id]', params: { id: item.productId, regionId: item.regionId ?? '' } })}
              accessibilityRole="button"
            >
              <Card style={styles.card}>
                <View style={styles.thumb}><Text style={styles.thumbGlyph}>🌾</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.productName ?? t('mandi.commodity')}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {(item.regionName ?? region ?? '—')}{item.gradeName ? ` · ${item.gradeName}` : ''}
                  </Text>
                </View>
                <View style={styles.priceCol}>
                  <MoneyText minor={item.modalMinor} langCode={lang} size="lg" />
                  <Text style={styles.unit}>{t('mandi.perUnit', { unit: item.unitCode })}</Text>
                </View>
              </Card>
            </Pressable>
          )}
          contentContainerStyle={{ paddingBottom: space[6] }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeRelative(value: string, lang: string): string { try { return formatRelative(value, lang); } catch { return value; } }

const styles = StyleSheet.create({
  h1: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink900 },
  h1vern: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, marginTop: 2 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginTop: space[2] },
  metaTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.pill },
  chipOn: { backgroundColor: color.primary600 },
  chipIdle: { backgroundColor: color.earth100 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, fontWeight: font.weight.semibold },
  chipTxtOn: { color: color.white },
  note: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2], marginBottom: space[3] },

  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  thumb: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.earth100, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 22 },
  name: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 2 },
  priceCol: { alignItems: 'flex-end' },
  unit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
});
