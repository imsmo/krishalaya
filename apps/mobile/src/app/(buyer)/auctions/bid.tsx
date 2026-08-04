// apps/mobile/src/app/(buyer)/auctions/bid.tsx · screen 17 "Place Your Bid" (bottom-sheet style). Thin screen
// (guide §3): enter a per-qtl bid (₹→paise via BigInt, Law 2), nudge it with quick-add chips, and see a live
// summary — bid amount (qty × bid), EMD to be held, wallet balance + cover check, wallet hold — then confirm.
// Placing HOLDS the EMD server-side (the app never moves money — Law 11/Law 2); the server is the authority on
// whether the bid is legal (highest/increment/EMD/timing) — a 409/422 is shown friendly. FLAG_SECURE (money on
// screen). Behind `auctions`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Wallet balance comes from the wallet service; if `wallet` is off or the read fails we show "—" and let the
//    server enforce the hold — we never fabricate a balance or a green ✓.
//  • Lot quantity comes from the public listing read; if unavailable we fall back to a 1-unit bid total rather
//    than inventing "2 qtl".
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import type { Auction, BidHistoryItem, ListingCard } from '@krishalaya/sdk-js';
import { Button, Input, MoneyText, EmptyState, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { placeBid, getAuction, bidHistory } from '../../../features/auctions/auctions.api';
import { getPublicListing } from '../../../features/buyer/browse.api';
import { walletBalance } from '../../../features/wallet/wallet.api';
import {
  validateBidRupees, currentPriceMinor, minNextBidMinor, emdRequirement,
  bidAmountMinor, emdHoldMinor, walletCoversHold, BID_QUICK_ADD_RUPEES,
} from '../../../features/auctions/auction-status';

export default function PlaceBid() {
  useSecureScreen();
  const { id, minNextMinor } = useLocalSearchParams<{ id: string; minNextMinor?: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const walletOn = useFlag('wallet');
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<BidHistoryItem[]>([]);
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [available, setAvailable] = useState<string | null>(null);
  const [walletCcy, setWalletCcy] = useState('INR');
  const [rupees, setRupees] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const a = await getAuction(id);
    setAuction(a);
    if (a) {
      const [h, l] = await Promise.all([bidHistory(id), getPublicListing(a.listingId)]);
      setBids(h.items); setListing(l);
      // Seed the input with the minimum next bid (in whole rupees) so the farmer just confirms or nudges up.
      const seedMinor = minNextBidMinor(currentPriceMinor(a, h.items), a.minIncrementMinor);
      try { setRupees((BigInt(seedMinor) / 100n).toString()); } catch { /* leave blank */ }
    }
    if (walletOn) { const w = await walletBalance(); if (!w.failed && !w.isFrozen) { setAvailable(w.availableMinor); setWalletCcy(w.currencyCode); } }
    setLoading(false);
  }, [id, walletOn]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('auction.placeBid')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const current = auction ? currentPriceMinor(auction, bids) : (minNextMinor ?? '0');
  const minNext = auction ? minNextBidMinor(current, auction.minIncrementMinor) : (minNextMinor ?? '0');
  const qty = listing?.quantityAvailable && listing.quantityAvailable > 0 ? listing.quantityAvailable : 1;
  const unit = listing?.unitCode ?? 'qtl';
  const emd = auction ? emdRequirement(auction) : { kind: 'none' as const };

  // Live preview (all bigint). Bid per-unit in minor from the rupee input.
  let perUnitMinor = '0';
  try { if (rupees.trim()) perUnitMinor = (BigInt(rupees.trim()) * 100n).toString(); } catch { perUnitMinor = '0'; }
  const total = bidAmountMinor(perUnitMinor, qty);
  const hold = emdHoldMinor(emd, total);
  const covered = available != null ? walletCoversHold(available, hold) : null;

  const addRupees = (delta: number) => {
    let base = 0n;
    try { base = rupees.trim() ? BigInt(rupees.trim()) : BigInt(current) / 100n; } catch { base = 0n; }
    setRupees((base + BigInt(delta)).toString());
  };

  const onSubmit = async () => {
    const check = validateBidRupees(rupees, minNext);
    if (!id || !check.ok) { setError(check.ok ? t('auction.bidFailed') : check.reason === 'too_low' ? t('auction.bidTooLow') : t('addMoney.invalidAmount')); return; }
    setBusy(true); setError(undefined);
    try {
      await placeBid(id, perUnitMinor);
      router.replace({ pathname: '/(buyer)/auctions/[id]', params: { id, notice: t('auction.bidPlaced') } });
    } catch (e) {
      setError(e instanceof SdkError && (e.isConflict || e.isValidation) ? t('auction.bidRejected')
        : e instanceof SdkError && e.isForbidden ? t('auction.bidNotAllowed') : t('auction.bidFailed'));
    } finally { setBusy(false); }
  };

  const confirmLabel = perUnitMinor !== '0'
    ? `${t('auction.confirmBid')} · ${formatMoneyMinor(perUnitMinor, walletCcy, lang)}`
    : t('auction.confirmBid');

  return (
    <ScreenScaffold
      title={t('auction.placeBidTitle')}
      footer={
        <View style={styles.actions}>
          <View style={{ flex: 1 }}><Button title={t('common.cancel')} variant="outline" onPress={() => router.back()} /></View>
          <View style={{ flex: 2 }}><Button title={confirmLabel} variant="accent" onPress={onSubmit} loading={busy} disabled={rupees.trim().length === 0} /></View>
        </View>
      }
    >
      {loading ? <SkeletonCard lines={6} /> : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* Current highest + increment */}
          <Text style={styles.current}>
            {t('auction.currentHighest')} <Text style={styles.currentStrong}>{formatMoneyMinor(current, walletCcy, lang)} {t('auction.perQtl')}</Text>
            {auction ? ` · ${t('auction.minIncrement')} ${formatMoneyMinor(auction.minIncrementMinor, walletCcy, lang)}` : ''}
          </Text>

          {/* Bid input (₹ prefix + /qtl suffix around the field) */}
          <View style={styles.inputWrap}>
            <Text style={styles.prefix}>₹</Text>
            <View style={{ flex: 1 }}><Input label="" value={rupees} onChangeText={setRupees} keyboardType="number-pad" maxLength={13} error={error} /></View>
            <Text style={styles.suffix}>{t('auction.perQtl')}</Text>
          </View>

          {/* Quick-add chips */}
          <View style={styles.chips}>
            {BID_QUICK_ADD_RUPEES.map((d) => (
              <Pressable key={d} onPress={() => addRupees(d)} accessibilityRole="button" style={styles.chip}>
                <Text style={styles.chipTxt}>+{d}</Text>
              </Pressable>
            ))}
          </View>

          {/* Summary */}
          <View style={styles.summary}>
            <Row label={t('auction.bidAmount', { qty, unit, price: formatMoneyMinor(perUnitMinor, walletCcy, lang) })} value={<MoneyText minor={total} currencyCode={walletCcy} langCode={lang} size="sm" />} />
            <Row label={t('auction.emdToHold')} value={<MoneyText minor={hold} currencyCode={walletCcy} langCode={lang} size="sm" />} />
            <Row
              label={t('auction.walletBalance')}
              value={available != null
                ? <Text style={[styles.val, covered ? styles.ok : styles.bad]}>{formatMoneyMinor(available, walletCcy, lang)}{covered ? ' ✓' : ''}</Text>
                : <Text style={styles.valMuted}>—</Text>}
            />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('auction.walletHold')}</Text>
              <MoneyText minor={hold} currencyCode={walletCcy} langCode={lang} size="md" />
            </View>
          </View>

          {available != null && covered === false ? <Text style={styles.lowBalance}>{t('auction.lowBalance')}</Text> : null}
          <Text style={styles.emdNote}>{t('auction.emdNote')}</Text>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value}
    </View>
  );
}

const styles = StyleSheet.create({
  current: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginBottom: space[3] },
  currentStrong: { fontWeight: font.weight.bold, color: color.primary700 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  prefix: { fontFamily: font.body, fontSize: font.size.xl, color: color.ink500 },
  suffix: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  chips: { flexDirection: 'row', gap: space[2], marginTop: space[3], marginBottom: space[4] },
  chip: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: color.ink200, borderRadius: radius.md, backgroundColor: color.card },
  chipTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink700 },
  summary: { backgroundColor: color.primary50, borderRadius: radius.md, padding: space[3] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  val: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold },
  valMuted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  ok: { color: color.successDark },
  bad: { color: color.dangerDark },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: color.ink100, paddingTop: space[2], marginTop: space[1] },
  totalLabel: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  lowBalance: { fontFamily: font.body, fontSize: font.size.sm, color: color.dangerDark, marginTop: space[3] },
  emdNote: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: space[3] },
  actions: { flexDirection: 'row', gap: space[2] },
});
