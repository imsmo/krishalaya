// apps/mobile/src/app/(buyer)/home.tsx · screen 13 "Buyer Home". Thin screen (guide §3): a location + cart header,
// a tap-through search bar (→ Search) with a voice affordance, a seasonal promo banner, a Shop-by-Category grid,
// and the "Trending Near You" fresh-produce feed via the shared BrowseList (real listings, keyset). Behind
// `buyer_app`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • "Anand, Gujarat" location: the buyer profile carries no saved delivery location → a neutral "Set location"
//    affordance (personalisation coming soon), never a fabricated place.
//  • Seasonal banner ("Mango Season…"): promo content is CMS-driven and has no buyer-banner read-model on mobile
//    yet → shown as static launch chrome (i18n), flagged; it does not claim live/dynamic campaign data.
//  • Category chips route to Search by term (there is no public top-level category-id map exposed to the buyer) —
//    a real text search, never a fake category filter.
//  • Card seller name / distance / rating come from the shared BuyerListingCard, which already degrades those
//    (no seller-profile/geo read-model) — never invented here.
import React, { useCallback, useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ScreenScaffold, EmptyState, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { buildListingQuery } from '../../features/buyer/search-query';
import { BrowseList } from '../../features/buyer/components/BrowseList';
import { getCart } from '../../features/cart/cart.api';
import { cartCount } from '../../features/cart/cart-math';

const CATEGORIES = [
  { key: 'grains', emoji: '🌾' }, { key: 'veggies', emoji: '🥬' }, { key: 'fruits', emoji: '🍎' }, { key: 'spices', emoji: '🌶️' },
  { key: 'pulses', emoji: '🥜' }, { key: 'oilseeds', emoji: '🌻' }, { key: 'herbs', emoji: '🌿' }, { key: 'dairy', emoji: '🐄' },
] as const;

export default function BuyerHome() {
  const { t } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const [cartN, setCartN] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    getCart().then((c) => setCartN(cartCount(c))).catch(() => {});
  }, [enabled]));

  if (!enabled) return <ScreenScaffold title={t('buyer.home.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const goSearch = (q?: string) => router.push({ pathname: '/(buyer)/search', params: q ? { q } : {} });

  const Header = (
    <View style={{ marginBottom: space[3] }}>
      {/* Location + cart */}
      <View style={styles.topRow}>
        <Pressable style={styles.loc} accessibilityRole="button" accessibilityLabel={t('buyer.home.setLocation')}>
          <Text style={styles.locPin}>📍</Text>
          <Text style={styles.locTxt}>{t('buyer.home.setLocation')}</Text>
        </Pressable>
        <Pressable style={styles.cart} accessibilityRole="button" accessibilityLabel={t('cart.title')} onPress={() => router.push('/(buyer)/cart')}>
          <Text style={styles.cartIcon}>🛒</Text>
          {cartN > 0 ? <View style={styles.cartDot}><Text style={styles.cartDotTxt}>{cartN}</Text></View> : null}
        </Pressable>
      </View>

      {/* Search + voice */}
      <View style={styles.searchRow}>
        <Pressable onPress={() => goSearch()} style={styles.search} accessibilityRole="search" accessibilityLabel={t('buyer.searchHint')}>
          <Text style={styles.searchGlyph}>🔍</Text>
          <Text style={styles.searchText}>{t('buyer.searchHint')}</Text>
        </Pressable>
        <Pressable onPress={() => goSearch()} style={styles.mic} accessibilityRole="button" accessibilityLabel={t('buyer.home.voice')}><Text style={styles.micIcon}>🎤</Text></Pressable>
      </View>

      {/* Seasonal banner (§13 static chrome) */}
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>🥭</Text>
        <View style={{ flex: 1 }}>
          <View style={styles.bannerTag}><Text style={styles.bannerTagTxt}>{t('buyer.home.seasonalTag')}</Text></View>
          <Text style={styles.bannerTitle}>{t('buyer.home.seasonalTitle')}</Text>
          <Text style={styles.bannerSub}>{t('buyer.home.seasonalSub')}</Text>
        </View>
      </View>

      {/* Shop by category */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('buyer.home.shopByCategory')}</Text>
        <Pressable onPress={() => goSearch()} accessibilityRole="button"><Text style={styles.viewAll}>{t('buyer.home.viewAll')}</Text></Pressable>
      </View>
      <View style={styles.cats}>
        {CATEGORIES.map((c) => (
          <Pressable key={c.key} onPress={() => goSearch(t(`buyer.home.cat.${c.key}`))} accessibilityRole="button" style={styles.cat}>
            <Text style={styles.catEmoji}>{c.emoji}</Text>
            <Text style={styles.catLabel}>{t(`buyer.home.cat.${c.key}`)}</Text>
          </Pressable>
        ))}
      </View>

      {/* Trending head */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{t('buyer.home.trending')}</Text>
        <Pressable onPress={() => goSearch()} accessibilityRole="button"><Text style={styles.viewAll}>{t('buyer.home.all')}</Text></Pressable>
      </View>
    </View>
  );

  return (
    <ScreenScaffold title={t('buyer.home.title')} scroll={false}>
      <BrowseList query={buildListingQuery({ sort: 'newest' })} ListHeader={Header}
        emptyTitle={t('buyer.empty.title')} emptyMessage={t('buyer.empty.message')} />
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locPin: { fontSize: 16 },
  locTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  cart: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.ink100, alignItems: 'center', justifyContent: 'center' },
  cartIcon: { fontSize: 18 },
  cartDot: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 2, borderColor: color.white },
  cartDotTxt: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.white },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 48, paddingHorizontal: space[3], borderRadius: radius.md, backgroundColor: color.primary50, borderWidth: 1, borderColor: color.ink100 },
  searchGlyph: { fontSize: 16 },
  searchText: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  mic: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  micIcon: { fontSize: 18 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.accent500, borderRadius: radius.lg, padding: space[4], marginTop: space[3] },
  bannerEmoji: { fontSize: 44 },
  bannerTag: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: space[2], borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.25)' },
  bannerTagTxt: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.white, textTransform: 'uppercase', letterSpacing: 0.5 },
  bannerTitle: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.white, marginTop: 4 },
  bannerSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.95, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[4], marginBottom: space[2] },
  sectionTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  viewAll: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  cat: { width: '23%', flexGrow: 1, alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md, paddingVertical: space[3] },
  catEmoji: { fontSize: 26 },
  catLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700, marginTop: 4 },
});
