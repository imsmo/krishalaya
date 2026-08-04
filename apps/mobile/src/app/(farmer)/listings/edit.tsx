// apps/mobile/src/app/(farmer)/listings/edit.tsx · screen 113 (Edit Listing) — rebuilt to the Phase-1 design
// (Krishalaya_Design_System/screens/113-farmer-edit-listing.html): Photos grid, Details (Crop / Quantity /
// Price + fair range / Grade / Moisture / Description) and Preferences (negotiation / delivery / min order), with
// Cancel + Save Changes. Thin screen over features/listings; degrade-never-die (Law 12); money via paise BigInt.
//
// HONEST EDIT SURFACE (never a fake save): the API exposes ONLY a price change (PATCH with optimistic version —
// the real, valuable seller edit). There is NO endpoint yet to change crop/quantity/grade/moisture/description,
// add/remove photos, or set preferences on an existing listing. So those fields render with the listing's CURRENT
// values but READ-ONLY, behind one flagged banner — and "Save Changes" persists the PRICE only. (§13 gap: a
// listing-update endpoint + media add/remove + preferences/grade/moisture fields on the read-model.)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type ListingCard, type GalleryItem } from '@krishalaya/sdk-js';
import { Button, Input, Toggle, EmptyState, SkeletonCard, MoneyText, Icon, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { getListing, changeListingPrice, listingMedia } from '../../../features/listings/listings.api';
import { getPulse } from '../../../features/market/market.api';
import { fairBand, type FairBand } from '../../../features/listings/fair-price';
import { rupeesToPaiseMinor } from '../../../core/payments/money';

export default function EditListing() {
  const { id, productId } = useLocalSearchParams<{ id: string; productId?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [photos, setPhotos] = useState<GalleryItem[]>([]);
  const [band, setBand] = useState<FairBand | null>(null);
  const [rupees, setRupees] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const [{ listing: l }, media] = await Promise.all([getListing(id), listingMedia(id)]);
    if (!l) { setFailed(true); setLoading(false); return; }
    setListing(l); setPhotos(media);
    try { setRupees((BigInt(l.priceMinor) / 100n).toString()); } catch { /* ignore */ }
    setVersion(typeof l.version === 'number' ? l.version : null);
    // Fair range — real market band when a productId is available (the listing read-model doesn't carry it; passed
    // through from the caller when known). Otherwise the chip hides — never a fabricated range.
    if (productId) {
      const pulse = await getPulse(productId, l.regionId ?? undefined);
      setBand(pulse?.band ? fairBand(l.priceMinor, pulse.band.p10Minor, pulse.band.p90Minor) : null);
    }
    setLoading(false);
  }, [id, productId]);
  useEffect(() => { load(); }, [load]);

  const onSave = async () => {
    const minor = rupeesToPaiseMinor(rupees);
    if (!id || !minor || version === null) { setError(t('addMoney.invalidAmount')); return; }
    setBusy(true); setError(undefined);
    try {
      await changeListingPrice(id, minor, version); // real PATCH (optimistic version) — Law 3
      router.replace({ pathname: '/(farmer)/listings', params: { notice: t('editPrice.saved') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isConflict ? t('editPrice.conflict') : t('common.error.generic'));
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.appbar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={8} style={styles.backBtn}>
          <Icon name="arrow-left" size={20} color={color.ink700} />
        </Pressable>
        <Text style={styles.appbarTitle}>{t('editListing.title')}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.body}><SkeletonCard lines={3} /><View style={{ height: space[3] }} /><SkeletonCard lines={4} /></View>
      ) : failed || !listing ? (
        <View style={styles.body}><EmptyState title={t('listings.unavailable')} actionLabel={t('common.retry')} onAction={load} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Honest banner: only price is editable today */}
            <View style={styles.banner}><Icon name="shield" size={18} color={color.infoDark} /><Text style={styles.bannerTxt}>{t('editListing.priceOnly')}</Text></View>

            {/* Photos (current; add/remove not yet supported — read-only, flagged) */}
            <Text style={styles.section}>{t('editListing.photos')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
              {photos.length === 0 ? <View style={styles.photoEmpty}><Text style={styles.photoEmojiBig}>🌾</Text></View> : null}
              {photos.map((p) => (
                <View key={p.mediaId} style={styles.photoTile}>
                  <Image source={{ uri: p.url }} style={styles.photoImg} />
                </View>
              ))}
            </ScrollView>

            {/* Details */}
            <Text style={styles.section}>{t('editListing.details')}</Text>

            <Text style={styles.label}>{t('editListing.crop')} <Text style={styles.req}>*</Text></Text>
            <Input value={listing.title} onChangeText={() => {}} editable={false} />

            <Text style={styles.label}>{t('editListing.quantity')} <Text style={styles.req}>*</Text></Text>
            <Input value={`${listing.quantityAvailable} ${listing.unitCode}`} onChangeText={() => {}} editable={false} />

            {/* PRICE — the one editable, savable field */}
            <Text style={styles.label}>{t('editListing.price')} <Text style={styles.req}>*</Text></Text>
            <Input value={rupees} onChangeText={(v) => setRupees(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={7} error={error} />
            {band ? (
              <Text style={styles.fairRange}>
                {t('editListing.fairRange')} <MoneyText minor={band.lowMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /> – <MoneyText minor={band.highMinor} currencyCode={listing.currencyCode} langCode={lang} size="sm" /> {band.status === 'inRange' ? '✓' : ''}
              </Text>
            ) : null}

            <Text style={styles.label}>{t('editListing.grade')}</Text>
            <Input value="—" onChangeText={() => {}} editable={false} />

            <Text style={styles.label}>{t('editListing.moisture')}</Text>
            <Input value="—" onChangeText={() => {}} editable={false} keyboardType="number-pad" />

            <Text style={styles.label}>{t('editListing.description')}</Text>
            <Input value="" onChangeText={() => {}} editable={false} multiline placeholder={t('editListing.descPlaceholder')} />

            {/* Preferences (current value where known; toggles not yet persistable — disabled, flagged) */}
            <Text style={styles.section}>{t('editListing.preferences')}</Text>
            <View style={styles.prefs}>
              <Toggle label={t('editListing.negotiable')} value={false} onValueChange={() => {}} disabled />
              <Toggle label={t('editListing.delivery')} value={false} onValueChange={() => {}} disabled />
              <Toggle label={t('editListing.organic')} value={listing.organicClaim} onValueChange={() => {}} disabled />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" size="lg" onPress={() => router.back()} /></View>
            <View style={{ flex: 1 }}><Button title={t('editListing.save')} size="lg" onPress={onSave} loading={busy} disabled={rupees.trim().length === 0} /></View>
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

  banner: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: color.infoLight, marginBottom: space[3] },
  bannerTxt: { flex: 1, fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark, lineHeight: 18 },

  section: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  photoRow: { gap: space[2], paddingBottom: space[2] },
  photoTile: { width: 80, height: 80, borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.earth100 },
  photoImg: { width: 80, height: 80 },
  photoEmpty: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  photoEmojiBig: { fontSize: 34 },

  label: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700, marginTop: space[3], marginBottom: space[1] },
  req: { color: color.danger },
  fairRange: { fontFamily: font.body, fontSize: font.size.xs, color: color.successDark, marginTop: space[1] },
  prefs: { gap: space[1] },

  footer: { flexDirection: 'row', gap: space[3], paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.ink100, backgroundColor: color.card },
});
