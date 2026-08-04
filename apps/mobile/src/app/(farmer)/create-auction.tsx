// apps/mobile/src/app/(farmer)/create-auction.tsx · screen 64 "Create Auction". Thin screen (guide §3): the seller
// turns one of their EXISTING listings into a live english auction — a hero + "how it works" note, the crop
// (read from the listing), the auction settings (reserve + bid increment in ₹→paise via BigInt Law 2, and a
// 2h/6h/24h duration), a live summary, then Start Auction. Idempotent create (Law 3); the server authorises
// ownership + re-validates. Behind `auctions`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Crop name + quantity are READ from the listing (the auction is created over a listingId — the contract has no
//    standalone crop fields); they're shown read-only, never a free-typed fake.
//  • Grade (A/B): no grade field on the listing read-model or the auction contract → a coming-soon note, not a
//    decorative control that silently drops the value.
//  • Reserve "Suggested ₹2,750–2,900" + "Expected reach ~340 vyaparis" + "Expected best price" need a price-
//    intelligence/reach read-model that doesn't exist → omitted, never fabricated.
//  • "Save Draft": there is no draft-auction endpoint → shown as coming-soon, never a button that pretends to save.
//  • EMD "₹500" in the how-it-works copy is per-auction server policy → the copy describes the mechanism without a
//    hardcoded amount.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import type { ListingCard } from '@krishalaya/sdk-js';
import { Button, Card, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatDate } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { createAuction } from '../../features/auctions/auctions.api';
import { getPublicListing } from '../../features/buyer/browse.api';
import { buildCreateAuctionDraft, auctionEndsAt, AUCTION_DURATIONS, type AuctionDurationHours } from '../../features/auctions/auction-status';

export default function CreateAuction() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const [listing, setListing] = useState<ListingCard | null | undefined>(undefined);
  const [reserve, setReserve] = useState('');
  const [increment, setIncrement] = useState('');
  const [hours, setHours] = useState<AuctionDurationHours>(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => { if (listingId) setListing(await getPublicListing(listingId)); else setListing(null); }, [listingId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('createAuction.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = listing?.currencyCode ?? 'INR';
  let reserveMinor = '0';
  try { if (reserve.trim()) reserveMinor = (BigInt(reserve.trim()) * 100n).toString(); } catch { reserveMinor = '0'; }
  const endsAtIso = auctionEndsAt(Date.now(), hours);

  const onSubmit = async () => {
    const draft = buildCreateAuctionDraft({ listingId, reserveRupees: reserve, incrementRupees: increment, hours });
    if (!draft.ok || !draft.input) {
      setError(draft.reason === 'listing' ? t('createAuction.needListing') : draft.reason === 'reserve' ? t('createAuction.badReserve') : draft.reason === 'increment' ? t('createAuction.badIncrement') : t('createAuction.invalid'));
      return;
    }
    setBusy(true); setError(undefined);
    try {
      const a = await createAuction(draft.input);
      router.replace({ pathname: '/(buyer)/auctions/[id]', params: { id: a.auctionId, notice: t('createAuction.created') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isForbidden ? t('createAuction.notAllowed') : e instanceof SdkError && e.isConflict ? t('createAuction.exists') : t('createAuction.failed'));
    } finally { setBusy(false); }
  };

  const footer = (
    <View style={styles.ctaBar}>
      <View style={{ flex: 1 }}><Button title={t('createAuction.saveDraft')} variant="outline" onPress={() => Alert.alert(t('createAuction.title'), t('createAuction.draftSoon'))} /></View>
      <View style={{ flex: 1.5 }}><Button title={`${t('createAuction.start')} 🔨`} variant="accent" loading={busy} disabled={!reserve.trim()} onPress={onSubmit} /></View>
    </View>
  );

  return (
    <ScreenScaffold title={t('createAuction.title')} scroll={false} footer={footer}>
      {listing === undefined ? <View style={{ padding: space[4] }}><SkeletonCard lines={8} /></View> : !listingId || listing === null ? (
        <EmptyState title={t('createAuction.needListing')} message={t('createAuction.needListingMsg')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>{t('createAuction.heroTitle')}</Text>
            <Text style={styles.heroSub}>{t('createAuction.heroSub')}</Text>
            <Text style={styles.heroVern}>{t('createAuction.heroVern')}</Text>
          </View>

          <View style={styles.section}>
            {/* How it works */}
            <View style={styles.infoBox}>
              <Text style={styles.infoIcon}>ⓘ</Text>
              <Text style={styles.infoTxt}><Text style={styles.infoStrong}>{t('createAuction.howTitle')}</Text> {t('createAuction.howBody')}</Text>
            </View>

            {/* About your crop — read from the listing (§13) */}
            <Text style={styles.h3}>{t('createAuction.aboutCrop')}</Text>
            <Card style={styles.cropCard}>
              <Text style={styles.cropLabel}>{t('createAuction.cropName')}</Text>
              <Text style={styles.cropVal}>{listing.title}</Text>
              <View style={styles.cropRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cropLabel}>{t('createAuction.quantity')}</Text>
                  <Text style={styles.cropVal}>{listing.quantityAvailable} {listing.unitCode}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cropLabel}>{t('createAuction.grade')}</Text>
                  <Text style={styles.cropMuted}>{t('createAuction.gradeSoon')}</Text>
                </View>
              </View>
            </Card>

            {/* Auction settings */}
            <Text style={styles.h3}>{t('createAuction.settings')}</Text>
            <Input label={t('createAuction.reserve')} value={reserve} onChangeText={setReserve} keyboardType="number-pad" maxLength={9} placeholder="2800" />
            <Text style={styles.helper}>{t('createAuction.reserveHelper')}</Text>
            <View style={{ marginTop: space[3] }}><Input label={t('createAuction.increment')} value={increment} onChangeText={setIncrement} keyboardType="number-pad" maxLength={9} placeholder="50" error={error} /></View>

            <Text style={styles.fieldLabel}>{t('createAuction.duration')}</Text>
            <View style={styles.durGrid}>
              {AUCTION_DURATIONS.map((d) => {
                const on = hours === d.hours;
                return (
                  <Pressable key={d.hours} onPress={() => setHours(d.hours)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.durChip, on && styles.durChipOn]}>
                    <Text style={[styles.durHours, on && styles.durHoursOn]}>{t('createAuction.hours', { h: d.hours })}</Text>
                    <Text style={styles.durTag}>{t(`createAuction.durTag.${d.key}`)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Summary */}
            <View style={styles.summary}>
              <Text style={styles.summaryHead}>{t('createAuction.summary')}</Text>
              <Row label={t('createAuction.starts')} value={<Text style={styles.sv}>{t('createAuction.startsVal')}</Text>} />
              <Row label={t('createAuction.ends')} value={<Text style={styles.sv}>{formatDate(endsAtIso, lang, { dateStyle: 'medium', timeStyle: 'short' })}</Text>} />
              <Row label={t('createAuction.reserveMin')} value={reserveMinor !== '0' ? <View style={styles.row2}><MoneyText minor={reserveMinor} currencyCode={ccy} langCode={lang} size="sm" /><Text style={styles.sv}> {t('createAuction.perQtl')}</Text></View> : <Text style={styles.svMuted}>—</Text>} />
              {/* §13: reach + best-price prediction have no read-model */}
              <Row label={t('createAuction.reach')} value={<Text style={styles.svMuted}>{t('createAuction.soon')}</Text>} />
              <View style={styles.highlightRow}>
                <Text style={styles.highlightLabel}>{t('createAuction.bestPrice')}</Text>
                <Text style={styles.svMuted}>{t('createAuction.soon')}</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <View style={styles.sRow}><Text style={styles.sl}>{label}</Text>{value}</View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.accent100, padding: space[4] },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.accent900 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginTop: space[1], lineHeight: 20 },
  heroVern: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.accent800, marginTop: space[1] },
  section: { padding: space[4] },
  infoBox: { flexDirection: 'row', gap: space[2], backgroundColor: color.infoLight, borderWidth: 1, borderColor: color.info, borderRadius: radius.lg, padding: space[3], marginBottom: space[4] },
  infoIcon: { fontSize: 16, color: color.infoDark },
  infoTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, lineHeight: 20 },
  infoStrong: { fontWeight: font.weight.bold, color: color.ink800 },
  h3: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2], marginTop: space[2] },
  cropCard: { marginBottom: space[3] },
  cropRow: { flexDirection: 'row', gap: space[3], marginTop: space[3] },
  cropLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  cropVal: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800, marginTop: 2 },
  cropMuted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400, marginTop: 2 },
  helper: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  fieldLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink600, marginTop: space[3], marginBottom: space[2] },
  durGrid: { flexDirection: 'row', gap: space[2] },
  durChip: { flex: 1, alignItems: 'center', paddingVertical: space[3], borderWidth: 2, borderColor: color.ink100, borderRadius: radius.md, backgroundColor: color.card },
  durChipOn: { borderColor: color.primary600, backgroundColor: color.primary50 },
  durHours: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  durHoursOn: { color: color.primary700 },
  durTag: { fontFamily: font.body, fontSize: 11, color: color.ink500, marginTop: 2 },
  summary: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[4], marginTop: space[4] },
  summaryHead: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space[2] },
  sRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  sl: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  sv: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  svMuted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  row2: { flexDirection: 'row', alignItems: 'center' },
  highlightRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: color.ink100, paddingTop: space[3], marginTop: space[2] },
  highlightLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.accent700 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
