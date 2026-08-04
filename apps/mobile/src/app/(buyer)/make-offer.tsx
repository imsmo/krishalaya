// apps/mobile/src/app/(buyer)/make-offer.tsx · screen 99 "Make an Offer". Thin screen (guide §3): a listing card,
// a big offer-per-unit display with the live total + %-vs-ask, an adjust stepper + quick-set chips (relative to
// the real list price), quantity, an optional message, and Send Offer. Money is bigint paise (Law 2) via
// MoneyText / offer helpers; the offer is idempotent (Law 3, offers.make). On success → the offer detail to
// negotiate; a typed message is delivered to the seller (real messaging path, best-effort). Behind `offers_chat`.
// Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Seller NAME ("Ramesh Patel") + crop emoji: listing read-model has sellerUserId (not a name) + no product →
//    a generic seller label + 📦 glyph; the LIST price/unit ARE real.
//  • "Fair market range ₹2,520–₹2,920 (Anand mandi)": no listing→mandi price-band contract → shown as a
//    coming-soon note (no fabricated band/slider). Prefilled demo message + "−230 (8%)" chip are seed data → the
//    box starts empty and quick chips are computed from the REAL ask.
//  • "Locks ₹530 for 24h": offers carry no EMD/wallet-hold contract → a generic escrow note (no fabricated amount
//    or duration). "Save" (draft) has no endpoint → coming-soon.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError, type ListingCard } from '@krishalaya/sdk-js';
import { Button, Input, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../core/i18n/useTranslation';
import { useFlag } from '../../core/flags/useFlag';
import { makeOffer } from '../../features/offers/offers.api';
import { getPublicListing } from '../../features/buyer/browse.api';
import { sendInquiry } from '../../features/messaging/messaging.api';
import { rupeesToOfferMinor, normalizeQuantity, offerTotalMinor, pctDiffVsAsk, listPriceRupees } from '../../features/offers/offer-status';

export default function MakeOffer() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('offers_chat');
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rupees, setRupees] = useState('');
  const [qty, setQty] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!listingId) { setFailed(true); setLoading(false); return; }
    setLoading(true); setFailed(false);
    const l = await getPublicListing(listingId);
    setListing(l); setFailed(!l); setLoading(false);
  }, [listingId]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('offer.makeTitle')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = listing?.currencyCode ?? 'INR';
  const unit = listing ? t(`units.${listing.unitCode}`) : '';
  const askRupees = listing ? Number(listPriceRupees(listing.priceMinor)) : 0;
  const offerMinor = rupeesToOfferMinor(rupees);
  const q = normalizeQuantity(qty);
  const totalMinor = offerMinor && q ? offerTotalMinor(offerMinor, q) : null;
  const pct = offerMinor && listing ? pctDiffVsAsk(offerMinor, listing.priceMinor) : null;

  const setRupeesNum = (n: number) => setRupees(String(Math.max(0, Math.round(n))));
  const step = (delta: number) => setRupeesNum((Number(rupees || '0') || 0) + delta);

  const onSubmit = async () => {
    if (!listing || !offerMinor || !q) { setError(t('offer.invalid')); return; }
    setBusy(true); setError(undefined);
    try {
      const offer = await makeOffer({ listingId: listing.id, quantity: q, offeredPriceMinor: offerMinor });
      if (message.trim()) { sendInquiry(listing.sellerUserId, listing.id, message).catch(() => { /* best-effort — offer already placed */ }); }
      router.replace({ pathname: '/(buyer)/offers/[id]', params: { id: offer.offerId, notice: t('offer.sent') } });
    } catch (e) {
      setError(e instanceof SdkError && e.isForbidden ? t('offer.notAllowed') : e instanceof SdkError && e.isConflict ? t('offer.exists') : t('offer.failed'));
    } finally { setBusy(false); }
  };

  const canSend = !!offerMinor && !!q && !busy;
  const footer = listing ? (
    <View style={styles.ctaBar}>
      <View style={{ flex: 1 }}><Button title={t('offer.saveDraft')} variant="outline" disabled onPress={() => {}} /></View>
      <View style={{ flex: 1.5 }}>
        <Button title={totalMinor ? t('offer.sendTotal', { total: formatMoneyMinor(totalMinor, ccy, lang) }) : t('offer.send')} onPress={onSubmit} loading={busy} disabled={!canSend} />
      </View>
    </View>
  ) : undefined;

  return (
    <ScreenScaffold title={t('offer.makeTitle')} scroll={false} footer={footer}>
      {loading ? <View style={{ padding: space[4] }}><SkeletonCard lines={7} /></View> : !listing || failed ? (
        <EmptyState title={t('offer.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Listing */}
          <View style={styles.listing}>
            <View style={styles.thumb} accessibilityElementsHidden importantForAccessibility="no"><Text style={styles.thumbGlyph}>📦</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.lTitle} numberOfLines={1}>{listing.title}</Text>
              <View style={styles.lSub}>
                <Text style={styles.lSubTxt}>{t('offer.sellerGeneric')} · {t('offer.listedAt')} </Text>
                <MoneyText minor={listing.priceMinor} currencyCode={ccy} langCode={lang} size="xs" />
                <Text style={styles.lSubTxt}>/{unit}</Text>
              </View>
            </View>
          </View>

          {/* Your offer — big display */}
          <View style={styles.section}>
            <Text style={styles.h}>{t('offer.yourOffer')}</Text>
            <View style={styles.priceCard}>
              <Text style={styles.priceLbl}>{t('offer.offerPerUnit', { unit })}</Text>
              {offerMinor ? <MoneyText minor={offerMinor} currencyCode={ccy} langCode={lang} size="3xl" style={styles.priceAmt} /> : <Text style={styles.priceAmtEmpty}>—</Text>}
              {totalMinor ? (
                <Text style={styles.priceSub}>
                  {t('offer.forQty', { n: q, unit })} = {formatMoneyMinor(totalMinor, ccy, lang)} {t('offer.total')}
                  {pct !== null && pct !== 0 ? ` · ${pct > 0 ? t('offer.belowAsk', { pct }) : t('offer.aboveAsk', { pct: -pct })}` : ''}
                </Text>
              ) : <Text style={styles.priceSub}>{t('offer.enterPriceQty')}</Text>}
            </View>
            {/* Fair market range — §13 coming soon */}
            <View style={styles.fair}><Text style={styles.fairTxt}>📊 {t('offer.fairRangeSoon')}</Text></View>
          </View>

          {/* Adjust */}
          <View style={styles.section}>
            <Text style={styles.h}>{t('offer.adjust')}</Text>
            <View style={styles.stepper}>
              <Pressable onPress={() => step(-10)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('offer.decrease')}><Text style={styles.stepGlyph}>−</Text></Pressable>
              <View style={{ flex: 1, alignItems: 'center' }}>
                {offerMinor ? <MoneyText minor={offerMinor} currencyCode={ccy} langCode={lang} size="xl" /> : <Text style={styles.stepEmpty}>—</Text>}
                <Text style={styles.perUnit}>{t('offer.perUnit', { unit })}</Text>
              </View>
              <Pressable onPress={() => step(10)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('offer.increase')}><Text style={styles.stepGlyph}>+</Text></Pressable>
            </View>
            <View style={styles.chips}>
              <Pressable onPress={() => setRupeesNum(askRupees - 100)} style={styles.chip} accessibilityRole="button"><Text style={styles.chipTxt}>−₹100</Text></Pressable>
              <Pressable onPress={() => setRupeesNum(askRupees * 0.95)} style={styles.chip} accessibilityRole="button"><Text style={styles.chipTxt}>{t('offer.minus5')}</Text></Pressable>
              <Pressable onPress={() => setRupeesNum(askRupees)} style={styles.chip} accessibilityRole="button"><Text style={styles.chipTxt}>{t('offer.listPrice')} {formatMoneyMinor(listing.priceMinor, ccy, lang)}</Text></Pressable>
            </View>
          </View>

          {/* Quantity */}
          <View style={styles.section}>
            <Text style={styles.h}>{t('offer.quantity')}</Text>
            <Input label={t('offer.howManyUnits', { unit })} value={qty} onChangeText={setQty} keyboardType="decimal-pad" maxLength={14} />
          </View>

          {/* Message (optional) */}
          <View style={styles.section}>
            <Text style={styles.h}>{t('offer.messageOptional')}</Text>
            <Input label="" value={message} onChangeText={setMessage} placeholder={t('offer.messagePlaceholder')} multiline maxLength={500} error={error} />
          </View>

          {/* Escrow note (§13 generic) */}
          <View style={styles.note}><Text style={styles.noteTxt}>⚠ {t('offer.escrowNote')}</Text></View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  listing: { flexDirection: 'row', alignItems: 'center', gap: space[3], margin: space[4], padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: color.accent50, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 26 },
  lTitle: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  lSub: { flexDirection: 'row', alignItems: 'center', marginTop: 2, flexWrap: 'wrap' },
  lSubTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  section: { paddingHorizontal: space[4], paddingVertical: space[2] },
  h: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  priceCard: { padding: space[4], backgroundColor: color.successLight, borderWidth: 1, borderColor: color.success, borderRadius: radius.lg, alignItems: 'center' },
  priceLbl: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.successDark, textTransform: 'uppercase', letterSpacing: 0.5 },
  priceAmt: { color: color.primary800, fontWeight: font.weight.bold, marginTop: 6 },
  priceAmtEmpty: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.ink300, marginTop: 6 },
  priceSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink600, marginTop: 4, textAlign: 'center' },
  fair: { marginTop: space[3], padding: space[3], backgroundColor: color.infoLight, borderRadius: radius.md },
  fairTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.infoDark },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], backgroundColor: color.card, borderWidth: 1.5, borderColor: color.primary300, borderRadius: radius.md },
  stepBtn: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.ink200, alignItems: 'center', justifyContent: 'center' },
  stepGlyph: { fontSize: 22, fontWeight: font.weight.bold, color: color.ink700 },
  stepEmpty: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink300 },
  perUnit: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: 2 },
  chips: { flexDirection: 'row', gap: space[2], marginTop: space[2], flexWrap: 'wrap' },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: color.ink200, backgroundColor: color.card },
  chipTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.ink700 },
  note: { margin: space[4], marginTop: space[3], padding: space[3], backgroundColor: color.warningLight, borderRadius: radius.md },
  noteTxt: { fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark, lineHeight: 18 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
