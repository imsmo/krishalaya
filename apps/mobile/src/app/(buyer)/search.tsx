// apps/mobile/src/app/(buyer)/search.tsx · screen 67 "Search Results". Thin screen (guide §3): a pill search box
// (icon + editable term + voice affordance) + a filter button that shows a dot when filters are active; a row of
// removable active-filter chips (term / organic / sale-type / price bounds); a meta row with the loaded-result
// count + a tap-to-cycle sort control; then the shared, keyset-paginated BrowseList of real listings. The filter
// sheet (68) returns its state via params; "Save search" persists the query on-device. Behind `buyer_app`.
// Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • "42 results": the public listing feed is keyset-paginated with NO grand total → we surface the honest
//    loaded-count ("N results", "N+" while more pages remain), never a fabricated fixed total.
//  • Sort "Distance" / "Best Rated" from the design need geo + rating read-models the feed doesn't expose →
//    omitted from the selector (Newest / Price ↑ / Price ↓ only), never a dead option that silently no-ops.
//  • Per-card location · distance · ⭐rating · GRADE badge: no geo/rating/grade in the read-model → the shared
//    BuyerListingCard already degrades those; the AUCTION badge IS shown (real saleType/auctionId).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Input, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { buildListingQuery, activeFilterCount, activeFilterChips, removeFilterChip, cycleSort, describeSearch, type FilterForm, type FilterChip, type SortKey } from '../../features/buyer/search-query';
import { addSavedSearch, pushRecentSearch } from '../../features/buyer/saved.api';
import { BrowseList } from '../../features/buyer/components/BrowseList';

export default function BuyerSearch() {
  const { t } = useTranslation();
  const router = useRouter();
  // Filters arrive via route params (set by the filter sheet, screen 68) or a deep link (a home category chip).
  const params = useLocalSearchParams<{ q?: string; categoryId?: string; saleType?: string; organic?: string; priceMinRupees?: string; priceMaxRupees?: string; sort?: string }>();
  const paramsForm: FilterForm = useMemo(() => ({
    q: params.q ?? '',
    categoryId: params.categoryId || undefined,
    saleType: params.saleType || undefined,
    organic: params.organic === '1',
    priceMinRupees: params.priceMinRupees || undefined,
    priceMaxRupees: params.priceMaxRupees || undefined,
    sort: (params.sort as SortKey) || 'newest',
  }), [params.q, params.categoryId, params.saleType, params.organic, params.priceMinRupees, params.priceMaxRupees, params.sort]);

  // Local, editable working copy: the search box, the chip ✕ removals, and the sort toggle all mutate this. Re-sync
  // whenever the params change (returning from the filter sheet).
  const [form, setForm] = useState<FilterForm>(paramsForm);
  const paramsKey = JSON.stringify(paramsForm);
  useEffect(() => { setForm(paramsForm); }, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce the free-text term into the query (keeps the cache key + network calls stable while typing).
  const [debouncedQ, setDebouncedQ] = useState(form.q ?? '');
  useEffect(() => { const id = setTimeout(() => setDebouncedQ((form.q ?? '').trim()), 350); return () => clearTimeout(id); }, [form.q]);

  const [count, setCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Record the buyer's actual query into on-device recent-searches (screen 128) when leaving the screen — the last
  // settled (debounced) term, once, rather than every keystroke.
  const lastQRef = useRef('');
  useEffect(() => { lastQRef.current = debouncedQ; }, [debouncedQ]);
  useFocusEffect(useCallback(() => () => { const q = lastQRef.current.trim(); if (q) void pushRecentSearch(q); }, []));

  const effectiveForm: FilterForm = { ...form, q: debouncedQ };
  const query = buildListingQuery(effectiveForm);
  const chips = activeFilterChips(form);
  const filterN = activeFilterCount(form);
  const sortKey: SortKey = form.sort ?? 'newest';

  const onSaveSearch = async () => {
    await addSavedSearch(describeSearch(effectiveForm), effectiveForm);
    Alert.alert(t('buyer.savedSearch.done'));
  };

  const chipLabel = (c: FilterChip): string => {
    switch (c.key) {
      case 'q': return c.value ?? '';
      case 'organic': return t('search.chip.organic');
      case 'saleType': return t('search.chip.saleType', { v: c.value ?? '' });
      case 'priceMin': return t('search.chip.priceMin', { v: c.value });
      case 'priceMax': return t('search.chip.priceMax', { v: c.value });
      default: return '';
    }
  };

  const resultLabel = debouncedQ
    ? t(hasMore ? 'search.resultsForMore' : 'search.resultsFor', { n: count, q: debouncedQ })
    : t(hasMore ? 'search.resultsMore' : 'search.results', { n: count });

  const Header = (
    <View style={{ gap: space[2], marginBottom: space[2] }}>
      {/* Pill search + voice + filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchGlyph}>🔍</Text>
          <View style={{ flex: 1 }}>
            <Input value={form.q ?? ''} onChangeText={(q) => setForm((f) => ({ ...f, q }))} placeholder={t('buyer.searchHint')} autoFocus />
          </View>
          <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('buyer.home.voice')}><Text style={styles.mic}>🎤</Text></Pressable>
        </View>
        <Pressable onPress={() => router.push({ pathname: '/(buyer)/filters', params })} style={styles.filterBtn} accessibilityRole="button" accessibilityLabel={t('buyer.filters')}>
          <Text style={styles.filterGlyph}>⚙︎</Text>
          {filterN > 0 ? <View style={styles.dot} /> : null}
        </Pressable>
      </View>

      {/* Active-filter chips (each removable) */}
      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map((c) => (
            <Pressable key={c.key + (c.value ?? '')} onPress={() => setForm((f) => removeFilterChip(f, c.key))} style={styles.chip}
              accessibilityRole="button" accessibilityLabel={t('search.removeFilter', { name: chipLabel(c) })}>
              <Text style={styles.chipTxt}>{chipLabel(c)}</Text>
              <Text style={styles.chipX}>✕</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Meta row: honest loaded count + tap-to-cycle sort + save */}
      <View style={styles.meta}>
        <Text style={styles.metaTxt} numberOfLines={1}>{resultLabel}</Text>
        <View style={styles.metaRight}>
          <Pressable onPress={() => setForm((f) => ({ ...f, sort: cycleSort(f.sort) }))} accessibilityRole="button" accessibilityLabel={t('search.sort')} style={styles.sortBtn}>
            <Text style={styles.sortTxt}>{t(`search.sort.${sortKey}`)} ⇅</Text>
          </Pressable>
          <Pressable onPress={onSaveSearch} accessibilityRole="button" accessibilityLabel={t('buyer.saveSearch')} style={styles.saveBtn}>
            <Text style={styles.saveTxt}>{t('buyer.saveSearch')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('buyer.tabs.search')} scroll={false}>
      <BrowseList query={query} ListHeader={Header}
        onCountChange={(n, more) => { setCount(n); setHasMore(more); }}
        emptyTitle={t('buyer.noResults.title')} emptyMessage={t('buyer.noResults.message')} />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.primary50, borderWidth: 1, borderColor: color.ink100 },
  searchGlyph: { fontSize: 15, color: color.ink500 },
  mic: { fontSize: 18, color: color.primary700 },
  filterBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.primary50, borderWidth: 1.5, borderColor: color.primary300, alignItems: 'center', justifyContent: 'center' },
  filterGlyph: { fontSize: 18, color: color.primary700 },
  dot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent500 },
  chips: { gap: space[2], paddingRight: space[3] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.white },
  chipX: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, opacity: 0.85 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  metaTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  sortBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: space[2] },
  sortTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary700 },
  saveBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.primary600, backgroundColor: color.primary50 },
  saveTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.primary800 },
});
