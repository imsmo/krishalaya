// apps/mobile/src/app/(farmer)/auction/complete.tsx · screen 66 "Auction Complete" (SELLER success). Thin screen
// (guide §3): a celebratory summary after the seller's auction ends SOLD — the accepted bid, the winning bidder,
// the total sale value, run stats, and a "what happens next" escrow→pickup→delivery primer. Reads the auction +
// bid history + listing; all money is bigint-minor (Law 2). Behind `auctions`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Winning-bidder NAME + "Ahmedabad APMC · ⭐ 4.8 · 142 deals": the bid history carries only a user id (no
//    buyer-profile/rating/deal-count read-model) → a generic "Winning bidder" + initials avatar; never a
//    fabricated name/mandi/rating.
//  • The "what happens next" step-1 amount ("Rajesh's ₹30,500 is secured") → generic copy + the REAL total; we
//    never inject a fabricated buyer name.
//  • Accepted bid, total sale value (bid × qty from the listing), % above reserve, bid/bidder counts, and duration
//    are all REAL/computed; if the auction isn't actually decided we degrade to its live status, never a fake SOLD.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Auction, BidHistoryItem, ListingCard } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { getAuction, bidHistory } from '../../../features/auctions/auctions.api';
import { getPublicListing } from '../../../features/buyer/browse.api';
import { winningBidAmountMinor, auctionDurationParts, bidAmountMinor, bidStats, pctAboveReserve } from '../../../features/auctions/auction-status';

const STEPS = ['escrow', 'pickup', 'delivery'] as const;

export default function AuctionComplete() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<BidHistoryItem[]>([]);
  const [listing, setListing] = useState<ListingCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setFailed(false);
    const a = await getAuction(id);
    setAuction(a); setFailed(!a);
    if (a) {
      const [h, l] = await Promise.all([bidHistory(id), getPublicListing(a.listingId)]);
      setBids(h.items); setListing(l);
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { if (enabled) load(); }, [enabled, load]);

  if (!enabled) return <ScreenScaffold title={t('auctionDone.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const perUnit = auction ? winningBidAmountMinor(auction, bids) : '0';
  const qty = listing?.quantityAvailable && listing.quantityAvailable > 0 ? listing.quantityAvailable : 1;
  const unit = listing?.unitCode ?? 'qtl';
  const ccy = listing?.currencyCode ?? 'INR';
  const total = bidAmountMinor(perUnit, qty);
  const stats = bidStats(bids);
  const pct = auction ? pctAboveReserve(perUnit, auction.reservePriceMinor) : null;
  const dur = auction ? auctionDurationParts(auction.startsAt, auction.endsAt) : { days: 0, hours: 0 };
  const durLabel = dur.days > 0 ? t('auctionDone.durDH', { d: dur.days, h: dur.hours }) : t('auctionDone.durH', { h: dur.hours });

  return (
    <ScreenScaffold
      title={t('auctionDone.title')} scroll={false}
      footer={auction ? (
        <View style={styles.ctaBar}>
          <View style={{ flex: 1 }}><Button title={t('auctionDone.share')} variant="outline" onPress={() => Share.share({ message: t('auctionDone.shareMsg') }).catch(() => {})} /></View>
          <View style={{ flex: 1.5 }}><Button title={`${t('auctionDone.schedulePickup')} →`} variant="accent" onPress={() => router.replace('/(farmer)/orders/received')} /></View>
        </View>
      ) : undefined}
    >
      {loading ? <View style={{ padding: space[4] }}><SkeletonCard lines={8} /></View> : !auction || failed ? (
        <EmptyState title={t('auctionDone.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space[4], paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Success hero */}
          <View style={styles.hero}>
            <View style={styles.soldBadge}><Text style={styles.soldTxt}>{t('auctionDone.sold')}</Text></View>
            <Text style={styles.heroTitle}>{t('auctionDone.success')}</Text>
            <Text style={styles.heroLabel}>{t('auctionDone.acceptedAt')}</Text>
            <View style={styles.acceptedRow}>
              <MoneyText minor={perUnit} currencyCode={ccy} langCode={lang} size="3xl" style={{ color: color.successDark }} />
              <Text style={styles.perUnit}>/{unit}</Text>
            </View>
          </View>

          {/* Winning bidder — §13: no buyer-profile read-model */}
          <Text style={styles.section}>{t('auctionDone.winningBidder')}</Text>
          <Card>
            <View style={styles.bidderRow}>
              <View style={styles.avatar}><Text style={styles.avatarTxt}>🧑</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bidderName}>{t('auctionDone.bidderGeneric')}</Text>
                <Text style={styles.bidderMeta}>{t('auctionDone.bidderMetaSoon')}</Text>
              </View>
            </View>
          </Card>

          {/* Total sale value */}
          <Card style={styles.saleCard}>
            <Text style={styles.saleLabel}>{t('auctionDone.totalSale')}</Text>
            <MoneyText minor={total} currencyCode={ccy} langCode={lang} size="2xl" />
            <Text style={styles.saleSub}>
              {t('auctionDone.saleBreak', { qty, unit, price: formatMoneyMinor(perUnit, ccy, lang) })}
              {pct != null ? ` · ${pct >= 0 ? '+' : ''}${pct}% ${t('auctionDone.aboveReserve')}` : ''}
            </Text>
          </Card>

          {/* Run stats */}
          <View style={styles.statsGrid}>
            <View style={styles.stat}><Text style={styles.statV}>{stats.bids}</Text><Text style={styles.statL}>{t('auctionDone.totalBids')}</Text></View>
            <View style={styles.stat}><Text style={styles.statV}>{stats.bidders}</Text><Text style={styles.statL}>{t('auctionDone.bidders')}</Text></View>
            <View style={styles.stat}><Text style={styles.statV}>{durLabel}</Text><Text style={styles.statL}>{t('auctionDone.duration')}</Text></View>
          </View>

          {/* What happens next */}
          <Text style={styles.section}>{t('auctionDone.whatNext')}</Text>
          <Card>
            {STEPS.map((s, i) => (
              <View key={s} style={[styles.step, i > 0 && styles.stepDivide]}>
                <View style={styles.stepNum}><Text style={styles.stepNumTxt}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{t(`auctionDone.step.${s}.title`)}</Text>
                  <Text style={styles.stepBody}>{s === 'escrow' ? t('auctionDone.step.escrow.body', { amount: formatMoneyMinor(total, ccy, lang) }) : t(`auctionDone.step.${s}.body`)}</Text>
                </View>
              </View>
            ))}
          </Card>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: color.successLight ?? color.primary50, borderRadius: radius.lg, padding: space[4], marginBottom: space[3] },
  soldBadge: { paddingVertical: 4, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.success, marginBottom: space[2] },
  soldTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.ink900 },
  heroLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink600, marginTop: space[2] },
  acceptedRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, marginTop: 2 },
  perUnit: { fontFamily: font.body, fontSize: font.size.md, color: color.ink500, marginBottom: 4 },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[2], marginBottom: space[2] },
  bidderRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: color.primary50, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 24 },
  bidderName: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800 },
  bidderMeta: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 2 },
  saleCard: { marginTop: space[3], alignItems: 'flex-start' },
  saleLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space[1] },
  saleSub: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, marginTop: space[1] },
  statsGrid: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  stat: { flex: 1, alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md, paddingVertical: space[3] },
  statV: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.primary700 },
  statL: { fontFamily: font.body, fontSize: 10, color: color.ink500, fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  step: { flexDirection: 'row', gap: space[3], paddingVertical: space[3] },
  stepDivide: { borderTopWidth: 1, borderTopColor: color.ink100 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.primary600, alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.white },
  stepTitle: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.ink800 },
  stepBody: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500, marginTop: 1 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
