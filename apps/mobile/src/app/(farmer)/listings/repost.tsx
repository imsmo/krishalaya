// apps/mobile/src/app/(farmer)/listings/repost.tsx · screen 116 (Repost Listing) — built to the Phase-1 design
// (Krishalaya_Design_System/screens/116-farmer-repost-listing.html): an "expired" hero, a preview of the lapsed
// listing with its last-7-day stats, an "Update before reposting" section (quantity + price + keep-photos/desc +
// boost toggles) and Discard / "Repost · Live in 5 min". Thin screen over features/listings; degrade-never-die
// (Law 12); money via paise BigInt (Law 2); i18n(hi/en/gu).
//
// REAL data: title / price / quantity / status (GET /listings/:id); last-7-day Views, Saved, Offers
// (GET /listings/:id/analytics, owner-only); photo count (GET /listings/:id/media); suggested price = the market
// prediction median p50 (GET market pulse) when a productId is known. Repost is a REAL mutation:
// POST /listings/:id/repost re-publishes for a fresh window (server resets expiry) and optionally updates the
// price in the same op — it keeps the same photos/description because it's the same listing.
//
// HONEST EDIT SURFACE (§13, never faked): the contract supports a price change on repost but NOT a quantity change
// (there is no quantity-update endpoint — only order flows move stock). So Quantity is shown READ-ONLY at its
// current value with a flagged note; the design's "adjust if some sold offline" can't be honored yet. "Same
// photos / Same description" are inherent to a repost (same aggregate) → shown ON + disabled. The "Market is up
// ₹40 vs last week" delta needs a week-over-week series we don't expose, so only the real "Suggested: ₹p50" shows.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type ListingCard, type ListingAnalytics, type BoostTier } from '@krishalaya/sdk-js';
import { Button, Input, Toggle, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getListing, listingAnalytics, listingMedia, loadBoostTiers, repostListing } from '../../../features/listings/listings.api';
import { getPulse } from '../../../features/market/market.api';
import { pickRecommendedTier } from '../../../features/listings/boost';
import { cropEmoji } from '../../../features/listings/my-listings';
import { rupeesToPaiseMinor } from '../../../core/payments/money';

export default function RepostListing() {
  const { id, productId } = useLocalSearchParams<{ id: string; productId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const boostOn = useFlag('listing_boost');

  const [listing, setListing] = useState<ListingCard | null>(null);
  const [analytics, setAnalytics] = useState<ListingAnalytics | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [suggestedMinor, setSuggestedMinor] = useState<string | null>(null);
  const [tier, setTier] = useState<BoostTier | null>(null);
  const [rupees, setRupees] = useState('');
  const [boost, setBoost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const idemKey = useRef<string>(`repost:${id ?? ''}`); // stable per screen instance (re-tap safe)

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [{ listing: l }, an, media, tiers] = await Promise.all([
      getListing(id), listingAnalytics(id), listingMedia(id), boostOn ? loadBoostTiers() : Promise.resolve([]),
    ]);
    if (!l) { setFailed(true); setLoading(false); return; }
    setListing(l); setAnalytics(an); setPhotoCount(media.length); setTier(pickRecommendedTier(tiers));
    try { setRupees((BigInt(l.priceMinor) / 100n).toString()); } catch { /* ignore */ }
    if (productId) {
      const pulse = await getPulse(productId, l.regionId ?? undefined);
      setSuggestedMinor(pulse?.band?.p50Minor ?? null);
    }
    setLoading(false);
  }, [id, productId, boostOn]);
  useEffect(() => { load(); }, [load]);

  const currency = listing?.currencyCode ?? 'INR';
  const num = (n: number) => String(n);
  const onRepost = async () => {
    if (!id || !listing) return;
    const minor = rupeesToPaiseMinor(rupees);
    if (!minor) { setError(t('addMoney.invalidAmount')); return; }
    setBusy(true); setError(undefined);
    try {
      const changed = (() => { try { return BigInt(minor) !== BigInt(listing.priceMinor); } catch { return true; } })();
      await repostListing(id, changed ? { newPriceMinor: minor } : {});
      if (boost && boostOn) { router.replace({ pathname: '/(farmer)/listings/boost', params: { id } }); return; }
      router.replace({ pathname: '/(farmer)/listings/[id]', params: { id, notice: t('repost.done') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isConflict ? t('repost.conflict') : e instanceof SdkError && e.isValidation ? t('addMoney.invalidAmount') : t('common.error.generic'));
    } finally { setBusy(false); }
  };

  const stats = useMemo(() => {
    if (!analytics) return null;
    return t('repost.statsLine', { views: num(analytics.views), saved: num(analytics.savedCount ?? 0), offers: num(analytics.offers) });
  }, [analytics, t]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('repost.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={2} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
      ) : failed || !listing ? (
        <View style={styles.body}><EmptyState title={t('listings.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Expired hero */}
            <View style={styles.hero}>
              <Text style={styles.heroIcon}>⏳</Text>
              <Text style={styles.heroH}>{t('repost.expiredTitle')}</Text>
              <Text style={styles.heroSub}>{t('repost.expiredSub', { crop: listing.title })}</Text>
            </View>

            {/* Preview of the lapsed listing */}
            <View style={styles.preview}>
              <View style={styles.thumb}><Text style={styles.thumbEmoji}>{cropEmoji(listing.title)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pvTitle}>{listing.title}</Text>
                <View style={styles.pvMeta}>
                  <Text style={styles.pvMetaTxt}>{listing.quantityAvailable} {listing.unitCode} · </Text>
                  <MoneyText minor={listing.priceMinor} currencyCode={currency} langCode={lang} size="sm" />
                  <Text style={styles.pvMetaTxt}>/{listing.unitCode}</Text>
                </View>
                {stats ? <View style={styles.statsBox}><Text style={styles.statsTxt}>{t('repost.last7')} <Text style={styles.statsStrong}>{stats}</Text></Text></View> : null}
              </View>
            </View>

            {/* Update before reposting */}
            <Text style={styles.section}>{t('repost.update')}</Text>

            <Text style={styles.label}>{t('repost.qtyLabel')}</Text>
            <Input value={`${listing.quantityAvailable} ${listing.unitCode}`} onChangeText={() => {}} editable={false} />
            <Text style={styles.helper}>{t('repost.qtyHelper')}</Text>

            <Text style={[styles.label, { marginTop: space[3] }]}>{t('repost.priceLabel')}</Text>
            <Input value={rupees} onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7} error={error} />
            {suggestedMinor ? (
              <Text style={styles.suggest}>{t('repost.suggested')} <MoneyText minor={suggestedMinor} currencyCode={currency} langCode={lang} size="sm" tone="positive" /></Text>
            ) : null}

            {/* Keep photos / description (inherent to a repost) + optional boost */}
            <View style={styles.toggles}>
              <Toggle label={t('repost.samePhotos', { n: photoCount })} value onValueChange={() => {}} disabled />
              <Toggle label={t('repost.sameDesc')} value onValueChange={() => {}} disabled />
              {boostOn ? (
                <Toggle
                  label={tier ? t('repost.boostWithPrice', { price: formatMoneyMinor(tier.priceMinor, currency, lang) }) : t('repost.boost')}
                  value={boost}
                  onValueChange={setBoost}
                />
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title={t('repost.discard')} variant="outline" size="lg" onPress={() => router.back()} /></View>
            <View style={{ flex: 1.5 }}><Button title={t('repost.cta')} size="lg" onPress={onRepost} loading={busy} disabled={rupees.trim().length === 0} /></View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  hero: { backgroundColor: color.accent600, borderRadius: radius.lg, padding: space[4], marginTop: space[2], marginBottom: space[4], alignItems: 'flex-start' },
  heroIcon: { fontSize: 30, marginBottom: 6 },
  heroH: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white, letterSpacing: -0.3 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.95, marginTop: 6, lineHeight: 20 },

  preview: { flexDirection: 'row', gap: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.lg, padding: space[3] },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: color.accent50, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 30 },
  pvTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  pvMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  pvMetaTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  statsBox: { backgroundColor: color.earth100, borderRadius: radius.md, paddingVertical: space[2], paddingHorizontal: space[2], marginTop: space[2] },
  statsTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600 },
  statsStrong: { fontWeight: font.weight.bold, color: color.ink800 },

  section: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  label: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginBottom: space[1] },
  helper: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  suggest: { fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, marginTop: space[1] },
  toggles: { gap: space[1], marginTop: space[4], backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3] },

  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
