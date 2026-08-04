// apps/mobile/src/app/(system)/search.tsx · screen 183 (global search) — rebuilt to the Phase-1 design
// (screens/183-global-search.html): a debounced search box, category filter tabs with live counts (All / per-kind),
// a "Top results for {q}" header, and rich result rows (icon · kind · seller · price · chevron). Thin screen
// (guide §3): one query → the unified server search (P1-14), degrading to the client fan-out (public listings +
// the caller's own orders) when the endpoint's off. Money via MoneyText (Law 2). Behind `system_screens`.
// Degrade-never-die.
//
// §13 (NOT faked): the mock shows Listings/Sellers/Tips/Mandi/Crop-guide result kinds and per-category counts. The
// live unified index covers listings + products today; the tabs + counts are built from the REAL hits (so only the
// categories actually returned appear — never a fabricated "Sellers · 12"). Each row's price/seller come from the
// hit's `ref` when the server provides them, else those bits are omitted. When the index expands to sellers/tips/
// mandi/crops, those rows + tabs light up automatically (real data) with zero screen changes.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Input, MoneyText, EmptyState, ScreenScaffold, SkeletonCard, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { globalSearch } from '../../features/system/system.api';
import { normalizeQuery, searchKindIcon, searchTabs, filterHits, type SearchHit, type SearchHitKind } from '../../features/system/system';

const ROUTE_OF: Partial<Record<SearchHitKind, string>> = {
  listing: '/(buyer)/listing/[id]',
  seller: '/(buyer)/seller/[id]',
  tip: '/(farmer)/tips/[id]',
  order: '/(farmer)/orders/[id]',
};

export default function GlobalSearch() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('system_screens');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [tab, setTab] = useState<'all' | SearchHitKind>('all');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (q: string) => {
    if (!normalizeQuery(q)) { setHits([]); setSearched(false); return; }
    setLoading(true); setSearched(true); setTab('all');
    setHits(await globalSearch(q));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(query), 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, run]);

  const tabs = useMemo(() => searchTabs(hits), [hits]);
  const shown = useMemo(() => filterHits(hits, tab), [hits, tab]);

  if (!enabled) return <ScreenScaffold title={t('search.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const open = (h: SearchHit) => {
    const route = ROUTE_OF[h.kind];
    if (route) router.push({ pathname: route, params: { id: h.id } } as never);
  };

  return (
    <ScreenScaffold title={t('search.title')}>
      <Input label={t('search.label')} value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} autoFocus returnKeyType="search" onSubmitEditing={() => run(query)} />

      {loading ? <SkeletonCard lines={6} /> : !searched ? (
        <EmptyState title={t('search.hint.title')} message={t('search.hint.message')} />
      ) : hits.length === 0 ? (
        <EmptyState title={t('search.empty.title')} message={t('search.empty.message', { q: normalizeQuery(query) })} />
      ) : (
        <>
          {/* Filter tabs with live counts */}
          <FlatList
            horizontal
            data={tabs}
            keyExtractor={(x) => x.key}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
            renderItem={({ item }) => {
              const active = item.key === tab;
              const label = item.key === 'all' ? t('search.tab.all') : t(`search.kind.${item.key}`);
              return (
                <Pressable onPress={() => setTab(item.key)} accessibilityRole="button" accessibilityState={{ selected: active }}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{`${label} · ${item.count}`}</Text>
                </Pressable>
              );
            }}
          />

          <Text style={styles.section}>{t('search.topResults', { q: normalizeQuery(query) })}</Text>
          <FlatList
            data={shown}
            keyExtractor={(h) => `${h.kind}:${h.id}`}
            renderItem={({ item }) => (
              <Pressable onPress={() => open(item)} accessibilityRole="button" style={styles.row}>
                <Text style={styles.icon}>{searchKindIcon(item.kind)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                  <View style={styles.subRow}>
                    <Text style={styles.sub} numberOfLines={1}>
                      {[t(`search.kind.${item.kind}`), item.note, item.subtitle].filter(Boolean).join(' · ')}
                    </Text>
                    {item.priceMinor ? (
                      <>
                        <Text style={styles.sub}> · </Text>
                        <MoneyText minor={item.priceMinor} currencyCode={item.currencyCode} langCode={lang} size="sm" />
                        {item.unitCode ? <Text style={styles.sub}>{`/${item.unitCode}`}</Text> : null}
                      </>
                    ) : null}
                  </View>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
            )}
            contentContainerStyle={{ paddingBottom: space[6] }}
          />
        </>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: space[2], paddingVertical: space[3] },
  chip: { minHeight: 36, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: 999, backgroundColor: color.earth100 },
  chipActive: { backgroundColor: color.primary600 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  chipTextActive: { color: color.white },
  section: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, fontWeight: font.weight.bold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: color.ink100 },
  icon: { fontSize: font.size.xl },
  title: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink900 },
  subRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  sub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  chev: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink400 },
});
