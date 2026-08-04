// apps/mobile/src/app/(buyer)/listings/[id].tsx · screen 14 "Listing Detail" (buyer). Thin screen (guide §3): load
// the public listing (anonymous, cached) → render a hero, badges, title, the seller's REAL rating summary, an
// In-Stock read-out, price (Law 2 MoneyText) + available qty, a Product Details grid, an About-Seller card, a
// quantity stepper (clamped to stock), and a sticky Add-to-Cart + Buy-Now (live line total). Behind `buyer_app`.
// Degrade-never-die: not-found/failure → EmptyState + retry.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Gallery: the public read-model carries no media URLs → a neutral 🌾 hero placeholder, never a fake photo.
//  • "Verified" / "⚡ AI Listed" badges: no verified/ai-listed field on the read-model → shown only from REAL
//    fields (organicClaim → organic, boosted → promoted); never a fabricated trust badge.
//  • Per-listing rating "4.8 (126 reviews)": there is no per-LISTING review aggregate → we show the SELLER's real
//    aggregate rating (reviews.summary) in the About-Seller card; the listing-level star line is omitted, not faked.
//  • Product Details (Variety / Grade / Moisture / Harvest): these are catalogue EAV attributes not on the public
//    read-model → the section degrades to a coming-soon note rather than inventing "Lokwan / A-Premium / ≤12%".
//  • Seller name ("Ramesh Patel") + "3 yrs · 42 listings": no public seller-profile endpoint → a generic seller
//    label + the real rating; the call button deep-links to the in-app chat (no raw phone is exposed).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ListingCard, ReviewSummary } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getPublicListing, sellerSummary } from '../../../features/buyer/browse.api';
import { getSavedListings, toggleSavedListing } from '../../../features/buyer/saved.api';
import { addToCart } from '../../../features/cart/cart.api';
import { openDirect } from '../../../features/messaging/messaging.api';
import { clampQuantity, lineTotalMinor, stockState } from '../../../features/cart/cart-math';
import { formatMoneyMinor } from '@krishalaya/i18n';

export default function BuyerListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('buyer_app');
  const canBuy = useFlag('buyer_checkout');
  const canOffer = useFlag('offers_chat');
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [seller, setSeller] = useState<ReviewSummary | null>(null);
  const [saved, setSaved] = useState(false);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const l = await getPublicListing(id);
    setListing(l); setFailed(!l);
    if (l) {
      setQty(l.quantityAvailable > 0 ? 1 : 0);
      setSaved((await getSavedListings()).some((x) => x.id === id));
      setSeller(await sellerSummary(l.sellerUserId));
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title=" "><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const onToggleSave = async () => {
    if (!listing) return;
    const next = await toggleSavedListing(listing);
    setSaved(next.some((x) => x.id === listing.id));
  };
  const step = (delta: number) => { if (listing) setQty((q) => clampQuantity(q, delta, listing.quantityAvailable)); };

  const onAddToCart = async () => {
    if (!listing) return;
    setAdding(true);
    try {
      const ok = await addToCart(listing.id, qty || 1);
      Alert.alert(t(ok ? 'cart.added' : 'cart.addFailed'));
    } finally { setAdding(false); }
  };
  const onBuyNow = async () => {
    if (!listing) return;
    setAdding(true);
    try {
      const ok = await addToCart(listing.id, qty || 1);
      if (ok) router.push('/(buyer)/checkout'); else Alert.alert(t('cart.addFailed'));
    } finally { setAdding(false); }
  };
  const onChat = async (sellerUserId: string) => {
    try {
      const convo = await openDirect(sellerUserId, listing?.id);
      router.push({ pathname: '/(buyer)/chat/[id]', params: { id: convo.id, peerId: sellerUserId } });
    } catch { Alert.alert(t('chat.openFailed')); }
  };

  const inStock = listing ? stockState(listing.quantityAvailable) === 'in_stock' : false;

  const footer = listing ? (
    <View style={styles.ctaBar}>
      {canBuy && inStock ? (
        <>
          <View style={{ flex: 1 }}><Button title={t('cart.addToCart')} variant="outline" onPress={onAddToCart} loading={adding} /></View>
          <View style={{ flex: 1.2 }}>
            <Button
              title={`${t('buyer.buyNow')} · ${formatMoneyMinor(lineTotalMinor(listing.priceMinor, qty), listing.currencyCode, lang)}`}
              variant="accent"
              loading={adding}
              onPress={onBuyNow}
            />
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }}><Button title={t(saved ? 'buyer.saved' : 'buyer.save')} variant="outline" onPress={onToggleSave} /></View>
      )}
    </View>
  ) : undefined;

  return (
    <ScreenScaffold title={listing?.title ?? ' '} footer={footer}>
      {loading ? <SkeletonCard lines={8} /> : !listing || failed ? (
        <EmptyState title={t('buyer.detail.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Hero (no media in read-model → placeholder, §13) */}
          <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no">
            <Text style={styles.heroGlyph}>🌾</Text>
            <Pressable onPress={onToggleSave} accessibilityRole="button" accessibilityLabel={t(saved ? 'buyer.saved' : 'buyer.save')} style={styles.fav}>
              <Text style={[styles.favGlyph, saved && styles.favOn]}>{saved ? '♥' : '♡'}</Text>
            </Pressable>
          </View>

          {/* Title + badges */}
          <View style={styles.badges}>
            <StatusPill label={t(`listings.saleType.${listing.saleType}`)} tone="info" />
            {listing.organicClaim ? <StatusPill label={t('listings.organic')} tone="success" /> : null}
            {listing.boosted ? <StatusPill label={t('buyer.promoted')} tone="accent" /> : null}
          </View>
          <Text style={styles.title}>{listing.title}</Text>
          <Text style={[styles.stockLine, !inStock && styles.stockOut]}>{t(inStock ? 'buyer.inStock' : 'buyer.outOfStock')}</Text>

          {/* Price row */}
          <View style={styles.priceRow}>
            <View style={styles.priceWrap}>
              <MoneyText minor={listing.priceMinor} currencyCode={listing.currencyCode} langCode={lang} size="2xl" />
              <Text style={styles.perUnit}>{t('buyer.perUnit', { unit: listing.unitCode })}</Text>
            </View>
            <Text style={styles.avail}><Text style={styles.availStrong}>{listing.quantityAvailable} {listing.unitCode}</Text> {t('buyer.available')}</Text>
          </View>

          {/* Product details — §13: catalogue attributes not on the public read-model */}
          <Text style={styles.section}>{t('buyer.detail.productDetails')}</Text>
          <Card><Text style={styles.muted}>{t('buyer.detail.attrsSoon')}</Text></Card>

          {/* About seller */}
          <Text style={styles.section}>{t('buyer.detail.aboutSeller')}</Text>
          <Card>
            <View style={styles.sellerRow}>
              <View style={styles.sellerAvatar}><Text style={styles.sellerAvatarTxt}>🧑‍🌾</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sellerName}>{t('buyer.detail.sellerGeneric')}</Text>
                <Text style={styles.sellerMeta}>
                  {seller && seller.count > 0
                    ? t('buyer.detail.sellerRating', { stars: seller.averageStars.toFixed(1), count: seller.count })
                    : t('buyer.detail.sellerNoRating')}
                </Text>
              </View>
              <Pressable onPress={() => onChat(listing.sellerUserId)} accessibilityRole="button" accessibilityLabel={t('chat.withSeller')} style={styles.callBtn}>
                <Text style={styles.callGlyph}>💬</Text>
              </Pressable>
            </View>
            <View style={{ marginTop: space[3] }}>
              <Button title={t('buyer.viewSeller')} variant="ghost" onPress={() => router.push({ pathname: '/(buyer)/seller/[id]', params: { id: listing.sellerUserId } })} />
            </View>
          </Card>

          {/* Negotiate (offers/chat) */}
          {canOffer ? (
            <View style={styles.negotiate}>
              <View style={{ flex: 1 }}><Button title={t('offer.make')} variant="outline" onPress={() => router.push({ pathname: '/(buyer)/make-offer', params: { listingId: listing.id } })} /></View>
              <View style={{ flex: 1 }}><Button title={t('chat.withSeller')} variant="outline" onPress={() => onChat(listing.sellerUserId)} /></View>
            </View>
          ) : null}

          {/* Quantity stepper + live total */}
          {canBuy && inStock ? (
            <View style={styles.qtyBox}>
              <Text style={styles.qtyLabel}>{t('buyer.quantity')}</Text>
              <View style={styles.stepper}>
                <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="−" style={styles.stepBtn}><Text style={styles.stepTxt}>−</Text></Pressable>
                <Text style={styles.qtyVal}>{qty} {listing.unitCode}</Text>
                <Pressable onPress={() => step(+1)} accessibilityRole="button" accessibilityLabel="+" style={styles.stepBtn}><Text style={styles.stepTxt}>+</Text></Pressable>
              </View>
              <View style={styles.totalWrap}>
                <Text style={styles.totalLabel}>{t('buyer.total')}</Text>
                <MoneyText minor={lineTotalMinor(listing.priceMinor, qty)} currencyCode={listing.currencyCode} langCode={lang} size="lg" />
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200, borderRadius: radius.lg, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center', marginBottom: space[3], position: 'relative' },
  heroGlyph: { fontSize: 96 },
  fav: { position: 'absolute', top: space[3], right: space[3], width: 40, height: 40, borderRadius: 20, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  favGlyph: { fontSize: 20, color: color.ink400 },
  favOn: { color: color.danger },
  badges: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap', marginBottom: space[1] },
  title: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[1] },
  stockLine: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.success, marginTop: space[1] },
  stockOut: { color: color.danger },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingVertical: space[3], borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.ink100, marginTop: space[3] },
  priceWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: space[1] },
  perUnit: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: 2 },
  avail: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  availStrong: { fontWeight: font.weight.bold, color: color.ink800 },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  muted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  sellerAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  sellerAvatarTxt: { fontSize: 24 },
  sellerName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  sellerMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  callBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  callGlyph: { fontSize: 18 },
  negotiate: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  qtyBox: { marginTop: space[4], padding: space[3], backgroundColor: color.primary50, borderRadius: radius.md },
  qtyLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space[2], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink200, borderRadius: radius.md, padding: 4, marginTop: space[2] },
  stepBtn: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700 },
  qtyVal: { minWidth: 56, textAlign: 'center', fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  totalWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[3] },
  totalLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
