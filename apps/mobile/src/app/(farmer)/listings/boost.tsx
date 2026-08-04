// apps/mobile/src/app/(farmer)/listings/boost.tsx · screen 114 (Boost Listing) — built to the Phase-1 design
// (Krishalaya_Design_System/screens/114-farmer-boost-listing.html): gold hero ("Reach 5× More Buyers"),
// "Choose a boost package" with selectable tier cards (POPULAR badge on the recommended one), a money-back tip
// banner, a Payment summary, and a Maybe-Later + "Pay … · Boost Now" CTA bar. Thin screen over features/listings;
// degrade-never-die (Law 12); ≥48px targets; i18n(hi/en/gu).
//
// REAL data: tier id/name/price/days come from listings.boostTiers(); the listing title (hero subtitle) from
// GET /listings/:id; payment is a REAL wallet debit — payBoostFromWallet sends only the chosen tier id and the
// SERVER resolves the price + debits the wallet (fails closed on low balance). The Total shown is the tier's own
// server price (Law 2, paise) — what actually gets charged. Per-tier feature bullets + coverage area + the 5×/3.4×
// lines are presentation copy (same for everyone) → static i18n keyed by tier kind.
//
// FLAGGED GAP (§13, never faked): the design splits the price into "GST (18%)" + base. The boost-tier / pay
// contract exposes no tax breakdown, so we show the single server price as the Total with a "tax inclusive" note
// rather than inventing an 18% split that might not match the actual debit. Flag-gated by `listing_boost`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type BoostTier, type ListingCard } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { Button, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getListing, loadBoostTiers, payListingBoost } from '../../../features/listings/listings.api';
import { tierKind, sortByPrice, pickRecommendedTier, type TierKind } from '../../../features/listings/boost';
import { newId } from '../../../core/util/ids';

export default function BoostListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const boostOn = useFlag('listing_boost');

  const [listing, setListing] = useState<ListingCard | null>(null);
  const [tiers, setTiers] = useState<BoostTier[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Stable idempotency key per screen instance — a re-tap of "Pay" reuses it so a retry can never double-charge (Law 3).
  const idemKey = useRef<string>(newId());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [{ listing: l }, raw] = await Promise.all([getListing(id), loadBoostTiers()]);
    const ordered = sortByPrice(raw);
    setListing(l); setTiers(ordered);
    setSelectedId((prev) => prev ?? pickRecommendedTier(ordered)?.id ?? null);
    setFailed(!l);
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const recommendedId = useMemo(() => pickRecommendedTier(tiers)?.id ?? null, [tiers]);
  const selected = useMemo(() => tiers.find((x) => x.id === selectedId) ?? null, [tiers, selectedId]);
  const currency = listing?.currencyCode ?? 'INR';
  const heroArea = selected ? areaKey(tierKind(selected.code)) : null;

  const onPay = async () => {
    if (!id || !selected) return;
    setBusy(true); setError(undefined);
    try {
      await payListingBoost(id, selected.id, idemKey.current, currency); // server resolves price + debits wallet
      router.replace({ pathname: '/(farmer)/listings/[id]', params: { id, notice: t('boost.success') } });
    } catch (e) {
      const isBalance = e instanceof SdkError && (e.code.includes('INSUFFICIENT') || e.code.includes('BALANCE') || e.status === 402);
      setError(isBalance ? t('boost.insufficient') : e instanceof SdkError && e.isValidation ? t('addMoney.invalidAmount') : t('common.error.generic'));
    } finally { setBusy(false); }
  };

  // Flag OFF, or the catalogue is genuinely empty → honest unavailable state (never a fake tier).
  const unavailable = !boostOn || (!loading && tiers.length === 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('boost.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={2} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
      ) : failed || !listing ? (
        <View style={styles.body}><EmptyState title={t('listings.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : unavailable ? (
        <View style={styles.body}><EmptyState title={t('boost.unavailable')} actionLabel={t('common.back')} onAction={() => router.back()} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Gold hero */}
            <View style={styles.hero}>
              <Text style={styles.heroIcon}>🚀</Text>
              <Text style={styles.heroH}>{t('boost.hero.title')}</Text>
              <Text style={styles.heroSub}>
                {heroArea ? t('boost.hero.sub', { crop: listing.title, area: t(heroArea) }) : t('boost.hero.subGeneric', { crop: listing.title })}
              </Text>
            </View>

            {/* Tier cards */}
            <Text style={styles.choose}>{t('boost.choose')}</Text>
            {tiers.map((tier) => {
              const kind = tierKind(tier.code);
              const isSel = tier.id === selectedId;
              const isRec = tier.id === recommendedId;
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => setSelectedId(tier.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={`${tier.name}, ${formatMoneyMinor(tier.priceMinor, currency, lang)}`}
                  style={[styles.pack, isSel && styles.packSel]}
                >
                  {isRec ? <View style={styles.popular}><Text style={styles.popularTxt}>{t('boost.popular')}</Text></View> : null}
                  <View style={styles.packRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.packName}>{tier.name}</Text>
                      <Text style={styles.packDur}>{t('boost.dur', { days: tier.days, area: t(areaKey(kind)) })}</Text>
                    </View>
                    <MoneyText minor={tier.priceMinor} currencyCode={currency} langCode={lang} size="lg" tone="positive" />
                  </View>
                  <View style={styles.featList}>
                    {featLines(t, kind).map((line, i) => (
                      <Text key={i} style={styles.featTxt}>✓ {line}</Text>
                    ))}
                  </View>
                </Pressable>
              );
            })}

            {/* Money-back tip */}
            <View style={styles.tip}>
              <Text style={styles.tipEmoji}>💡</Text>
              <Text style={styles.tipTxt}>{t('boost.tip')}</Text>
            </View>

            {/* Payment summary — single server price (no fabricated GST split). */}
            {selected ? (
              <View style={styles.payCard}>
                <Text style={styles.payLabel}>{t('boost.payment')}</Text>
                <View style={styles.payRow}>
                  <Text style={styles.payRowLabel}>{t('boost.package')}</Text>
                  <MoneyText minor={selected.priceMinor} currencyCode={currency} langCode={lang} size="sm" />
                </View>
                <View style={[styles.payRow, styles.payTotalRow]}>
                  <Text style={styles.payTotalLabel}>{t('boost.total')}</Text>
                  <MoneyText minor={selected.priceMinor} currencyCode={currency} langCode={lang} size="md" tone="positive" />
                </View>
                <Text style={styles.taxNote}>{t('boost.taxNote')}</Text>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title={t('boost.maybeLater')} variant="outline" size="lg" onPress={() => router.back()} /></View>
            <View style={{ flex: 1.5 }}>
              <Button
                title={selected ? t('boost.payCta', { price: formatMoneyMinor(selected.priceMinor, currency, lang) }) : t('boost.choose')}
                variant="accent"
                size="lg"
                loading={busy}
                disabled={!selected}
                onPress={onPay}
              />
            </View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

type T = (k: string, p?: Record<string, unknown>) => string;
function areaKey(kind: TierKind): string { return `boost.area.${kind}`; }
/** The static per-kind feature bullets (presentation copy), split from a newline-joined i18n string. */
function featLines(t: T, kind: TierKind): string[] {
  return t(`boost.feat.${kind}`).split('\n').filter(Boolean);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  hero: { backgroundColor: color.accent500, borderRadius: radius.lg, paddingVertical: space[5], paddingHorizontal: space[4], alignItems: 'center', marginTop: space[2], marginBottom: space[4] },
  heroIcon: { fontSize: 46, marginBottom: 6 },
  heroH: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white, textAlign: 'center', letterSpacing: -0.3 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.95, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  choose: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[3] },
  pack: { backgroundColor: color.card, borderWidth: 2, borderColor: color.earth200, borderRadius: radius.lg, padding: space[4], marginBottom: space[3], position: 'relative' },
  packSel: { borderColor: color.accent500, backgroundColor: color.accent50 },
  popular: { position: 'absolute', top: -9, left: space[4], backgroundColor: color.accent500, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
  popularTxt: { fontFamily: font.body, fontSize: 9, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.8 },
  packRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  packName: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  packDur: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  featList: { marginTop: space[3], gap: 4 },
  featTxt: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 20 },

  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.successLight, marginBottom: space[4] },
  tipEmoji: { fontSize: 18 },
  tipTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.successDark, lineHeight: 20 },

  payCard: { backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200, borderRadius: radius.md, padding: space[3], ...shadow.card },
  payLabel: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.ink500, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: space[2] },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  payRowLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600 },
  payTotalRow: { borderTopWidth: 1, borderTopColor: color.earth200, borderStyle: 'dashed', marginTop: 6, paddingTop: 8 },
  payTotalLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  taxNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[2] },

  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },

  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
