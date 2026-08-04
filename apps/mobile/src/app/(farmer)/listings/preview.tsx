// apps/mobile/src/app/(farmer)/listings/preview.tsx · screen 11 (Preview & Publish) — rebuilt to the Phase-1
// design (Krishalaya_Design_System/screens/11-listing-preview.html): a crop hero, the title + "Edit All",
// status/AI chips, the detail rows (Crop·Variety / Quantity / Price·qtl / Grade·Moisture) each with a "Change"
// link, a "📊 Fair Price Check" card (Low · You · High band), and Save Draft / Publish Listing → .
// Thin screen over features/listings + features/market; degrade-never-die (Law 12). Money via MoneyText (paise).
//
// Real data: title, price, quantity, status, region come from GET /listings/:id. The Fair-Price band is the REAL
// market prediction (P10..P90) for the crop — fetched via the productId passed from create (screen 10), since the
// public listing read-model doesn't expose productId. Where the read-model lacks a field (grade/moisture, region
// name), we show "—" / hide the chip and FLAG it — never fabricate (§13 gaps: listing read-model productId +
// grade + regionName).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ListingCard, MandiPulse } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, SkeletonCard, Icon, color, font, space, radius, shadow } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getListing, publishListing } from '../../../features/listings/listings.api';
import { getPulse } from '../../../features/market/market.api';
import { fairBand, type FairBand } from '../../../features/listings/fair-price';

export default function ListingPreview() {
  const { id, productId } = useLocalSearchParams<{ id: string; productId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [band, setBand] = useState<FairBand | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const res = await getListing(id);
    setListing(res.listing); setFailed(!res.listing);
    // Fair-price band — real market prediction for this crop+region. Needs productId (passed from create); the
    // public listing read-model doesn't carry it. No productId / no band → the Fair-Price card simply hides.
    if (res.listing && productId) {
      const pulse: MandiPulse | null = await getPulse(productId, res.listing.regionId ?? undefined);
      const b = pulse?.band ? fairBand(res.listing.priceMinor, pulse.band.p10Minor, pulse.band.p90Minor) : null;
      setBand(b);
    } else setBand(null);
    setLoading(false);
  }, [id, productId]);
  useEffect(() => { load(); }, [load]);

  const editAll = () => router.push({ pathname: '/(farmer)/listings/edit', params: { id: id! } });
  const onSaveDraft = () => router.replace({ pathname: '/(farmer)/listings', params: { notice: t('preview.draftSaved') } });
  const onPublish = async () => {
    if (!id) return;
    setPublishing(true); setError(undefined);
    try {
      await publishListing(id);
      router.replace({ pathname: '/(farmer)/listings', params: { notice: t('preview.published') } });
    } catch { setError(t('preview.publishFailed')); }
    finally { setPublishing(false); }
  };

  const isQtl = listing?.unitCode === 'qtl';
  const qtyLabel = listing ? `${listing.quantityAvailable} ${listing.unitCode}${isQtl ? ` (${listing.quantityAvailable * 100} kg)` : ''}` : '—';
  const statusKey = listing?.status === 'draft' ? 'preview.status.draft' : 'preview.status.verified';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('preview.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={5} /></View>
      ) : !listing || failed ? (
        <View style={styles.body}><EmptyState title={t('preview.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Crop hero */}
            <View style={styles.hero}><Text style={styles.heroEmoji}>🌾</Text></View>

            {/* Title + Edit All */}
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2}>{listing.title}</Text>
              <Pressable onPress={editAll} hitSlop={8} accessibilityRole="button"><Text style={styles.editAll}>{t('preview.editAll')}</Text></Pressable>
            </View>

            {/* Chips */}
            <View style={styles.chips}>
              <View style={[styles.chip, styles.chipVerified]}><Text style={styles.chipVerifiedTxt}>{t(statusKey)}</Text></View>
              <View style={[styles.chip, styles.chipAi]}><Text style={styles.chipAiTxt}>⚡ {t('preview.aiListed')}</Text></View>
            </View>

            {/* Detail rows */}
            <View style={styles.rows}>
              <Row label={t('preview.cropVariety')} value={listing.title} ai onChange={editAll} changeLabel={t('preview.change')} />
              <Row label={t('preview.quantity')} value={qtyLabel} onChange={editAll} changeLabel={t('preview.change')} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{t('preview.pricePerQtl')} <Text style={styles.aiTag}>{t('preview.ai')}</Text></Text>
                  <MoneyText minor={listing.priceMinor} currencyCode={listing.currencyCode} langCode={lang} size="lg" />
                </View>
                <Pressable onPress={editAll} hitSlop={8} accessibilityRole="button"><Text style={styles.change}>{t('preview.change')}</Text></Pressable>
              </View>
              {/* Grade · Moisture — not exposed by the listing read-model yet (§13 gap). Shown as "—", never faked. */}
              <Row label={t('preview.gradeMoisture')} value="—" onChange={editAll} changeLabel={t('preview.change')} />
            </View>

            {/* Fair Price Check — only when the real market band is available (else hidden, never faked). */}
            {band ? (
              <View style={styles.fair}>
                <Text style={styles.fairHead}>📊 {t('preview.fairCheck')} — {t(`preview.fair.${band.status}`)}</Text>
                <Text style={styles.fairSentence}>
                  {t('preview.fairYour')} <MoneyText minor={band.youMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /> {t('preview.fairIsFair')}
                </Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barMarker, { left: `${Math.round(band.position * 100)}%` }]} />
                </View>
                <View style={styles.barLabels}>
                  <Text style={styles.barLow}>{t('preview.low')} <MoneyText minor={band.lowMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /></Text>
                  <Text style={styles.barYou}>{t('preview.you')} <MoneyText minor={band.youMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /></Text>
                  <Text style={styles.barHigh}>{t('preview.high')} <MoneyText minor={band.highMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /></Text>
                </View>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title={t('preview.saveDraft')} variant="outline" size="lg" onPress={onSaveDraft} /></View>
            <View style={{ flex: 1 }}><Button title={t('preview.publish')} size="lg" onPress={onPublish} loading={publishing} /></View>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value, ai, onChange, changeLabel }: { label: string; value: string; ai?: boolean; onChange: () => void; changeLabel: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}{ai ? <Text style={styles.aiTag}> {t('preview.ai')}</Text> : null}</Text>
        <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
      </View>
      <Pressable onPress={onChange} hitSlop={8} accessibilityRole="button" accessibilityLabel={changeLabel}><Text style={styles.change}>{changeLabel}</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.page },
  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[2] },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.earth200 },
  appbarTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800 },
  body: { flex: 1, padding: space[5] },
  scroll: { paddingHorizontal: space[5], paddingBottom: space[6] },

  hero: { height: 160, borderRadius: radius.lg, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.earth200 },
  heroEmoji: { fontSize: 64 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space[3], marginTop: space[4] },
  title: { flex: 1, fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800, letterSpacing: -0.3 },
  editAll: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  chip: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  chipVerified: { backgroundColor: color.successLight },
  chipVerifiedTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.successDark },
  chipAi: { backgroundColor: color.accent50 },
  chipAiTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.accent700 },

  rows: { marginTop: space[4], backgroundColor: color.card, borderRadius: radius.lg, borderWidth: 1, borderColor: color.earth200, paddingHorizontal: space[4], ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], paddingVertical: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  rowLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  rowValue: { fontFamily: font.body, fontSize: font.size.lg, fontWeight: font.weight.semibold, color: color.ink800, marginTop: 2 },
  aiTag: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.accent700 },
  change: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.primary700 },

  fair: { marginTop: space[4], padding: space[4], borderRadius: radius.lg, backgroundColor: color.infoLight, borderWidth: 1, borderColor: color.info },
  fairHead: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.infoDark },
  fairSentence: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink700, marginTop: space[1], lineHeight: 20 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: color.info, marginTop: space[3], opacity: 0.35 },
  barMarker: { position: 'absolute', top: -4, width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: color.primary600, borderWidth: 2, borderColor: color.white },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] },
  barLow: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  barYou: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.primary700 },
  barHigh: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },

  error: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3], textAlign: 'center' },
  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
