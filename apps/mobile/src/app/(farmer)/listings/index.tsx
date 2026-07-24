// apps/mobile/src/app/(farmer)/listings/index.tsx · screen 12 (My Listings) — rebuilt to the Phase-1 design
// (Krishi_Verse_Design_System/screens/12-my-listings.html): the "My Listings" header, three stat cards
// (Active · Sold · Earnings), filter chips (All / Active / Sold / Draft with live counts), and rich listing
// cards (crop emoji, title, status badge LIVE/AUCTION+countdown/SOLD/DRAFT, qty, organic, ₹/qtl). A floating +
// opens the create flow. Thin screen over features/listings + features/wallet; degrade-never-die (Law 12);
// money via MoneyText (paise); keyset-paginated FlatList (no work in renderItem beyond presentational).
//
// Real data: listings (owner box) + Earnings (wallet.earnings.totalMinor). Counts/filter are client-side over
// the owner box. Per-card engagement (👁 views · inq · bids) + sold final price live in the per-listing
// ListingAnalytics read (one call PER card = N+1, forbidden on a list) — shown on the DETAIL screen, omitted
// here and FLAGGED (§13): the owner list read-model should return lightweight view/offer counts inline.
//
// DEV-20 (APPLY-9/Q49, honest-minimum): on a tablet-eligible viewport (`useSplitLayout` — ≥768px + coarse
// pointer), this screen renders the SAME list capped to `listColumnWidth` alongside a second pane. Tapping a row
// sets `selectedId` (never navigates away) so the pane can show a real preview built ONLY from fields already on
// the loaded `ListingCard` (title/badge/qty/price) — no per-row API call (would be the exact N+1 the comment
// above already flags as forbidden). A "View full details →" button in the pane does the real navigation this
// screen always did. On a phone-width viewport this is byte-behavior-identical to pre-DEV-20 (single column,
// tap-to-navigate). The full "make each row's real detail live in the second pane" behavior is DEV-28's own
// scoped follow-up (per `00_DEV_PENDING_MASTER.md` row 266) — this batch ships the mechanism, not a duplicate
// detail screen.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import type { ListingCard } from '@krishi-verse/sdk-js';
import { EmptyState, MoneyText, SkeletonCard, Button, color, font, space, radius, shadow } from '@krishi-verse/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { myListings } from '../../../features/listings/listings.api';
import { walletEarnings } from '../../../features/wallet/wallet.api';
import { useSplitLayout } from '../../../core/mechanisms/useSplitLayout';
import { LISTING_FILTERS, badgeFor, countByStatus, filterListings, auctionCountdown, cropEmoji, type ListingFilter, type BadgeKind } from '../../../features/listings/my-listings';

// Badge palette per status — design tones, mapped to the theme ramps (kept here so the card stays presentational).
const BADGE_STYLE: Record<BadgeKind, { bg: string; fg: string }> = {
  live: { bg: color.successLight, fg: color.successDark },
  auction: { bg: color.accent50, fg: color.accent700 },
  sold: { bg: color.infoLight, fg: color.infoDark },
  draft: { bg: color.earth100, fg: color.ink600 },
  paused: { bg: color.accent50, fg: color.accent700 },
  expired: { bg: color.dangerLight, fg: color.dangerDark },
};

export default function MyListings() {
  const router = useRouter();
  const { t, lang } = useTranslation();
  const { isSplit, listColumnWidth, maxWidth } = useSplitLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<ListingCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  // R2-01 (founder screenshot review): walletEarnings() is degrade-never-die (it self-catches to an EMPTY_INSIGHTS
  // '0' total on failure, never a rejected promise/null) — so this figure is ALWAYS a real number once load()
  // resolves, honest zero included. Seeding it as '0' (not null) removes a bare "—" that could otherwise render
  // before the first load — a literal dash placeholder that conflated "not loaded yet" with "failed to load".
  const [earningsMinor, setEarningsMinor] = useState('0');
  const [filter, setFilter] = useState<ListingFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (reset: boolean) => {
    const [page, earn] = await Promise.all([
      myListings(reset ? undefined : cursor ?? undefined, 30),
      reset ? walletEarnings() : Promise.resolve(null),
    ]);
    setItems((prev) => (reset ? page.items : [...prev, ...page.items]));
    setCursor(page.nextCursor);
    if (earn) setEarningsMinor(earn.totalMinor);
    setLoading(false);
  }, [cursor]);

  useFocusEffect(useCallback(() => { setLoading(true); load(true); }, [])); // refresh on tab focus
  const onRefresh = useCallback(async () => { setRefreshing(true); try { await load(true); } finally { setRefreshing(false); } }, [load]);

  const counts = countByStatus(items);
  const visible = filterListings(items, filter);

  const openListing = (l: ListingCard) => {
    if (badgeFor(l) === 'draft') router.push({ pathname: '/(farmer)/listings/preview', params: { id: l.id } });
    else router.push(`/(farmer)/listings/${l.id}`);
  };
  // DEV-20 (APPLY-9/Q49): on a split-eligible viewport, a tap selects (shows the inline preview pane) instead of
  // navigating away, so the list stays visible next to the detail — the two-pane point of the mechanism. On a
  // phone viewport this is unreachable (isSplit is false) so behavior is unchanged from pre-DEV-20.
  const onCardPress = (l: ListingCard) => { if (isSplit) setSelectedId(l.id); else openListing(l); };
  const selectedItem = isSplit ? items.find((i) => i.id === selectedId) ?? null : null;

  const Header = (
    <View>
      {/* Stat cards */}
      <View style={styles.stats}>
        <Stat value={String(counts.active)} label={t('listings.stat.active')} tone={color.primary600} />
        <Stat value={String(counts.sold)} label={t('listings.stat.sold')} tone={color.info} />
        <View style={styles.stat}>
          <MoneyText minor={earningsMinor} langCode={lang} size="lg" />
          <Text style={styles.statLabel}>{t('listings.stat.earnings')}</Text>
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.chips}>
        {LISTING_FILTERS.map((f) => {
          const on = f === filter;
          const n = f === 'all' ? counts.all : counts[f];
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{t(`listings.filter.${f}`)} ({n})</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.appbar}><Text style={styles.appbarTitle}>{t('listings.title')}</Text></View>

      {/* DEV-20: split-eligible viewport wraps the list in a fixed-width left column + a preview pane; a phone
          viewport renders the plain single-column body unchanged (isSplit false → styles resolve to no-ops). */}
      <View style={[styles.body, isSplit && { maxWidth, alignSelf: 'center', width: '100%' }]}>
      <View style={isSplit ? { width: listColumnWidth } : styles.flex1}>
      {loading ? (
        <View style={{ paddingHorizontal: space[5], gap: space[3], paddingTop: space[2] }}><SkeletonCard /><SkeletonCard /><SkeletonCard /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={Header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.primary600} />}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (cursor) load(false); }}
          ListEmptyComponent={
            <EmptyState
              title={t('listings.empty.title')}
              message={t('listings.empty.message')}
              actionLabel={t('listings.create')}
              onAction={() => router.push('/(farmer)/listings/new')}
            />
          }
          renderItem={({ item }) => {
            const kind = badgeFor(item);
            const isDraft = kind === 'draft';
            const countdown = kind === 'auction' ? auctionCountdown(item.auctionEndsAt) : null;
            const bs = BADGE_STYLE[kind];
            return (
              <Pressable style={styles.card} onPress={() => onCardPress(item)} accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ selected: isSplit && selectedId === item.id }}>
                <View style={[styles.emoji, isDraft && styles.emojiDraft]}><Text style={styles.emojiTxt}>{isDraft ? '📝' : cropEmoji(item.title)}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={[styles.badge, { backgroundColor: bs.bg }]}>
                      <Text style={[styles.badgeTxt, { color: bs.fg }]}>{t(`listings.badge.${kind}`)}{countdown ? ` ${countdown}` : ''}</Text>
                    </View>
                  </View>
                  {isDraft ? (
                    <Text style={styles.draftHint}>{t('listings.draftContinue')} →</Text>
                  ) : (
                    <>
                      <View style={styles.metaRow}>
                        <Text style={styles.meta}>{item.quantityAvailable} {item.unitCode}</Text>
                        {item.organicClaim ? <Text style={styles.organic}>· {t('listings.organic')}</Text> : null}
                        {item.boosted ? <Text style={styles.boosted}>· ⚡{t('listings.boostedTag')}</Text> : null}
                      </View>
                      <View style={styles.priceRow}>
                        <MoneyText minor={item.priceMinor} currencyCode={item.currencyCode} langCode={lang} size="lg" />
                        <Text style={styles.perUnit}>/{item.unitCode}</Text>
                      </View>
                    </>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
      </View>

      {isSplit ? (
        <View style={styles.splitDetail}>
          {selectedItem ? (
            <View>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{selectedItem.title}</Text>
                <View style={[styles.badge, { backgroundColor: BADGE_STYLE[badgeFor(selectedItem)].bg }]}>
                  <Text style={[styles.badgeTxt, { color: BADGE_STYLE[badgeFor(selectedItem)].fg }]}>{t(`listings.badge.${badgeFor(selectedItem)}`)}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{selectedItem.quantityAvailable} {selectedItem.unitCode}</Text>
              <View style={styles.priceRow}>
                <MoneyText minor={selectedItem.priceMinor} currencyCode={selectedItem.currencyCode} langCode={lang} size="lg" />
                <Text style={styles.perUnit}>/{selectedItem.unitCode}</Text>
              </View>
              <View style={{ marginTop: space[4] }}>
                <Button title={t('listings.viewFullDetails')} onPress={() => openListing(selectedItem)} fullWidth={false} />
              </View>
            </View>
          ) : (
            <EmptyState title={t('listings.splitSelectPrompt')} />
          )}
        </View>
      ) : null}
      </View>

      <Pressable style={styles.fab} onPress={() => router.push('/(farmer)/listings/new')} accessibilityRole="button" accessibilityLabel={t('listings.create')}>
        <Text style={styles.fabPlus}>＋</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[2] },
  appbarTitle: { fontFamily: font.display, fontSize: font.size['2xl'], fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  // DEV-20 (APPLY-9/Q49): `body` is a no-op single-column flex container on phone; on a split-eligible viewport
  // it becomes a row (list column + preview pane) via the inline maxWidth/alignSelf override applied at the call
  // site — kept as two separate style objects (not merged here) so the phone-path style object is unchanged from
  // pre-DEV-20 (regression-safe).
  body: { flex: 1, flexDirection: 'row' },
  flex1: { flex: 1 },
  splitDetail: { flex: 1, borderLeftWidth: 1, borderLeftColor: color.earth200, padding: space[5] },
  list: { paddingHorizontal: space[5], paddingBottom: 96 },

  stats: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  stat: { flex: 1, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3], alignItems: 'center', ...shadow.card },
  statVal: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, letterSpacing: -0.3 },
  statLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2, textAlign: 'center' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  chipOn: { backgroundColor: color.primary600, borderColor: color.primary600 },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600 },
  chipTxtOn: { color: color.white },

  card: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, padding: space[3], ...shadow.card },
  emoji: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  emojiDraft: { backgroundColor: color.earth100 },
  emojiTxt: { fontSize: 26 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  cardTitle: { flex: 1, fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  badge: { borderRadius: radius.sm, paddingVertical: 2, paddingHorizontal: 8 },
  badgeTxt: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, letterSpacing: 0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  meta: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  organic: { fontFamily: font.body, fontSize: font.size.sm, color: color.successDark },
  boosted: { fontFamily: font.body, fontSize: font.size.sm, color: color.accent700, fontWeight: font.weight.semibold },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: 4 },
  perUnit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
  draftHint: { fontFamily: font.body, fontSize: font.size.sm, color: color.primary700, fontWeight: font.weight.semibold, marginTop: 4 },

  fab: { position: 'absolute', right: space[5], bottom: space[5], width: 60, height: 60, borderRadius: radius.pill, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center', ...shadow.floating },
  fabPlus: { color: color.white, fontSize: 32, lineHeight: 36, fontWeight: '700' },
});
