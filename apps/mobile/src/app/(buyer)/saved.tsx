// apps/mobile/src/app/(buyer)/saved.tsx · screens 126/127/128 (saved listings / searches / sellers) in one screen
// with sub-tabs. Thin screen (guide §3): reads the on-device saved lists (saved.api) on focus and renders them.
// Tapping a saved search re-applies it (→ Search with params); listings/sellers deep-link to their detail. All
// saves are local-until-server (flagged). Behind `buyer_app`. Degrade-never-die: empty → friendly state.
//
// Screen 126 (Saved Listings) parity: header "Saved · N" (real count), filter chips, and per-row a crop glyph +
// title + a "↓ ₹X since saved" badge when the listing got cheaper since it was saved. The drop is REAL — we
// compare the stored save-time snapshot price (Law 2 bigint) against the LIVE price refetched via livePriceMap,
// and show the live price as the row's current price. §13 gaps (the public ListingCard read-model carries no
// categoryId, seller display name, region name or rating): the design's category chips (Wheat/Spices/Vegetables)
// and the "Ramesh Patel · Anand · ⭐4.9" seller line can't be built honestly, so we show only the chips the data
// backs — "All" and "Price dropped" — and the row's real qty·unit + organic line, never a fabricated category or
// seller name.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { ListingCard, SellerPublicProfile } from '@krishalaya/sdk-js';
import { Card, EmptyState, ScreenScaffold, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { BuyerListingCard } from '../../features/buyer/components/BuyerListingCard';
import { getSavedListings, toggleSavedListing, getSavedSellers, getSavedSearches, removeSavedSearch, getRecentSearches, addSavedSearch, type SavedSearch } from '../../features/buyer/saved.api';
import { livePriceMap, savedSellerProfiles } from '../../features/buyer/browse.api';
import { activeFilterChips, type FilterChip } from '../../features/buyer/search-query';
import { priceDropMinor, droppedCount, filterSaved, SAVED_ALL, SAVED_DROPPED, type SavedFilter } from '../../features/buyer/saved-listings';
import { yearsOnKv } from '../../features/buyer/seller-profile';
import { initials } from '../../features/profile/profile';
import { cropEmoji } from '../../features/listings/my-listings';

type Tab = 'listings' | 'searches' | 'sellers';

export default function SavedScreen() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [tab, setTab] = useState<Tab>('listings');
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [live, setLive] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<SavedFilter>(SAVED_ALL);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [sellers, setSellers] = useState<string[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<Record<string, SellerPublicProfile>>({});

  const load = useCallback(async () => {
    const saved = await getSavedListings();
    setListings(saved);
    setSearches(await getSavedSearches());
    setRecent(await getRecentSearches());
    const savedSellers = await getSavedSellers();
    setSellers(savedSellers);
    setLive(await livePriceMap(saved.map((l) => l.id))); // refetch current prices → real "since saved" drop
    setSellerProfiles(await savedSellerProfiles(savedSellers)); // real name/rating/listings·yrs per saved seller
  }, []);
  useFocusEffect(useCallback(() => { if (enabled) load(); }, [enabled, load]));

  if (!enabled) return <ScreenScaffold title={t('buyer.tabs.saved')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  // Real per-listing drop: save-time snapshot price (card.priceMinor) vs live price. null when not cheaper now.
  const drops: Record<string, string | null> = {};
  for (const l of listings) drops[l.id] = priceDropMinor(l.priceMinor, live[l.id] ?? l.priceMinor);
  const dropped = droppedCount(listings, drops);
  const shown = filterSaved(listings, filter, drops);

  const unsaveListing = async (card: ListingCard) => { const next = await toggleSavedListing(card); setListings(next); setLive(await livePriceMap(next.map((l) => l.id))); };
  const applySearch = (s: SavedSearch) => router.push({ pathname: '/(buyer)/search', params: {
    saleType: s.form.saleType || undefined, organic: s.form.organic ? '1' : undefined,
    priceMinRupees: s.form.priceMinRupees || undefined, priceMaxRupees: s.form.priceMaxRupees || undefined, sort: s.form.sort,
  } });
  const dropSearch = async (id: string) => setSearches(await removeSavedSearch(id));
  const saveRecent = async (q: string) => setSearches(await addSavedSearch(q, { q }));

  // Localise a saved search's real filter criteria into chips (organic / sale-type / price bounds). §13: the
  // design's Grade / min-qty / distance / location chips aren't on the FilterForm contract → not rendered.
  const chipLabel = (c: FilterChip): string => {
    switch (c.key) {
      case 'organic': return t('search.chip.organic');
      case 'saleType': return t('search.chip.saleType', { v: c.value ?? '' });
      case 'priceMin': return t('search.chip.priceMin', { v: c.value ?? '' });
      case 'priceMax': return t('search.chip.priceMax', { v: c.value ?? '' });
      default: return c.value ?? '';
    }
  };
  // Only the criteria chips (drop the free-text term chip — the query text is already the card title).
  const criteriaChips = (s: SavedSearch): FilterChip[] => activeFilterChips(s.form).filter((c) => c.key !== 'q');

  const title = tab === 'listings' ? `${t('buyer.tabs.saved')} · ${listings.length}`
    : tab === 'sellers' ? `${t('savedSellers.title')} · ${sellers.length}`
    : t('buyer.tabs.saved');

  return (
    <ScreenScaffold title={title} scroll={false}>
      <View style={styles.tabs}>
        {(['listings', 'searches', 'sellers'] as Tab[]).map((tb) => {
          const active = tab === tb;
          return (
            <Pressable key={tb} onPress={() => setTab(tb)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{t(`buyer.saved.${tb}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'listings' ? (
        <>
          <View style={styles.chips}>
            <FilterChip label={t('savedListings.chip.all', { n: listings.length })} active={filter === SAVED_ALL} onPress={() => setFilter(SAVED_ALL)} />
            {dropped > 0 ? <FilterChip label={t('savedListings.chip.dropped', { n: dropped })} active={filter === SAVED_DROPPED} onPress={() => setFilter(SAVED_DROPPED)} /> : null}
          </View>
          <FlatList
            data={shown} keyExtractor={(l) => l.id} style={{ marginTop: space[2] }}
            ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
            ListEmptyComponent={<EmptyState title={t('buyer.saved.empty.listings')} />}
            renderItem={({ item }) => {
              const drop = drops[item.id];
              return (
                <BuyerListingCard card={item} langCode={lang} saved
                  glyph={cropEmoji(item.title)}
                  priceOverrideMinor={live[item.id]}
                  dropLabel={drop ? t('savedListings.priceDrop', { amount: formatMoneyMinor(drop, item.currencyCode, lang) }) : null}
                  onPress={() => router.push({ pathname: '/(buyer)/listings/[id]', params: { id: item.id } })}
                  onToggleSave={() => unsaveListing(item)} saveLabel={t('buyer.unsave')} />
              );
            }}
          />
        </>
      ) : tab === 'searches' ? (
        <FlatList
          data={searches} keyExtractor={(s) => s.id} style={{ marginTop: space[3] }}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListHeaderComponent={<Text style={styles.section}>{t('savedSearches.activeAlerts')}</Text>}
          ListEmptyComponent={<EmptyState title={t('buyer.saved.empty.searches')} />}
          ListFooterComponent={recent.length > 0 ? (
            <View style={{ marginTop: space[4] }}>
              <Text style={styles.section}>{t('savedSearches.recent')}</Text>
              <Card>
                {recent.map((q, i) => (
                  <View key={q} style={[styles.recentRow, i < recent.length - 1 && styles.recentDivider]}>
                    <Text style={styles.recentText} numberOfLines={1}>🕒 {q}</Text>
                    <Pressable onPress={() => saveRecent(q)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('savedSearches.save')}>
                      <Text style={styles.saveLink}>{t('savedSearches.save')}</Text>
                    </Pressable>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
          renderItem={({ item }) => {
            const chips = criteriaChips(item);
            return (
              <Card onPress={() => applySearch(item)} accessibilityLabel={item.label}>
                <View style={styles.row}>
                  <Text style={styles.rowText} numberOfLines={1}>🔍 {item.label}</Text>
                  <Pressable onPress={() => dropSearch(item.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.cancel')}><Text style={styles.remove}>✕</Text></Pressable>
                </View>
                {chips.length > 0 ? (
                  <View style={styles.searchChips}>
                    {chips.map((c) => <View key={c.key + (c.value ?? '')} style={styles.searchChip}><Text style={styles.searchChipTxt}>{chipLabel(c)}</Text></View>)}
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
      ) : (
        <FlatList
          data={sellers} keyExtractor={(s) => s} style={{ marginTop: space[3] }}
          ListHeaderComponent={sellers.length > 0 ? <Text style={styles.subtitle}>{t('savedSellers.subtitle')}</Text> : null}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          ListEmptyComponent={<EmptyState title={t('buyer.saved.empty.sellers')} />}
          renderItem={({ item }) => {
            const p = sellerProfiles[item];
            const name = p?.displayName?.trim() || t('seller.genericName');
            const years = yearsOnKv(p?.memberSince);
            // §13: region name (regionId opaque), crop specialities and "N NEW" (new-since-saved) are NOT on the
            // SellerPublicProfile contract → omitted, never faked. listings + yrs + rating are real.
            const meta = [
              p ? t('savedSellers.listings', { n: p.listingsActive }) : null,
              years !== null ? t(years === 1 ? 'savedSellers.year' : 'savedSellers.years', { n: years }) : null,
            ].filter(Boolean).join(' · ');
            return (
              <Card onPress={() => router.push({ pathname: '/(buyer)/seller/[id]', params: { id: item } })} accessibilityLabel={name}>
                <View style={styles.sellerRow}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
                  <View style={styles.sellerBody}>
                    <Text style={styles.sellerName} numberOfLines={1}>
                      {name}{p && p.rating.count > 0 ? <Text style={styles.rating}>{`  ⭐ ${p.rating.avgStars.toFixed(1)}`}</Text> : null}
                    </Text>
                    {meta ? <Text style={styles.sellerMeta}>{meta}</Text> : null}
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

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: space[2] },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  tabOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  tabText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  tabTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  chips: { flexDirection: 'row', gap: space[2], marginTop: space[3], flexWrap: 'wrap' },
  chip: { minHeight: 36, paddingHorizontal: space[3], justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  chipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  chipTextOn: { color: color.primary800, fontWeight: font.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  rowText: { flex: 1, fontFamily: font.body, fontSize: font.size.md, color: color.ink800 },
  remove: { fontSize: 18, color: color.ink400 },
  subtitle: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: space[3] },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.primary700 },
  sellerBody: { flex: 1, gap: 2 },
  sellerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  rating: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.accent700 },
  sellerMeta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[3] },
  searchChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  searchChip: { paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.pill, backgroundColor: color.earth100 },
  searchChipTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink700 },
  recentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: space[2] },
  recentDivider: { borderBottomWidth: 1, borderBottomColor: color.ink100 },
  recentText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink800 },
  saveLink: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
});
