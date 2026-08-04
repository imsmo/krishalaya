// apps/mobile/src/app/(buyer)/auctions/outbid.tsx · screen 193 "Outbid" (bidder). Thin screen (guide §3): after a
// competing bid tops the caller's, a red hero shows the new highest, how far short their bid fell, the auction
// details, a suggested re-bid, and an escrow-released note. Walk Away returns; Bid → the bid sheet pre-aimed at the
// recommended amount. Reads auction + bid history + listing; money is bigint-minor (Law 2). FLAG_SECURE (bid
// amounts on screen). Behind `auctions`. Degrade-never-die.
// §13 gaps (no contract → rendered honestly, never faked):
//  • Seller "Krishna Mehta · Nadiad": no public seller-profile read-model → a generic seller label; never an
//    invented name/place.
//  • "We recommend ₹2,985": a CLIENT nudge (min-next + one increment), not a server price prediction — labelled as
//    a suggestion; the server still validates the real bid.
//  • Current highest, my-bid, the shortfall, min-next, time-left, and bidder count are all REAL/computed; the
//    escrow-released note uses the caller's REAL held bid amount (the server is the authority on the actual hold).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Auction, BidHistoryItem, ListingCard } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useAuth } from '../../../core/auth/auth.store';
import { useSecureScreen } from '../../../core/security/screen-guard';
import { getAuction, bidHistory } from '../../../features/auctions/auctions.api';
import { getPublicListing } from '../../../features/buyer/browse.api';
import { currentPriceMinor, minNextBidMinor, timeLeft, bidStats, myHighestBidMinor, shortByMinor, recommendedBidMinor, isBiddable } from '../../../features/auctions/auction-status';

export default function Outbid() {
  useSecureScreen();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const myId = state.profile?.id ?? '';
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

  if (!enabled) return <ScreenScaffold title={t('outbid.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const ccy = listing?.currencyCode ?? 'INR';
  const current = auction ? currentPriceMinor(auction, bids) : '0';
  const myBid = myHighestBidMinor(bids, myId);
  const short = shortByMinor(current, myBid);
  const minNext = auction ? minNextBidMinor(current, auction.minIncrementMinor) : '0';
  const recommend = auction ? recommendedBidMinor(minNext, auction.minIncrementMinor) : minNext;
  const left = auction ? timeLeft(auction.endsAt) : { ended: true, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  const timeLabel = left.ended ? t('auction.ended') : left.days > 0 ? t('auction.timeLeftD', { d: left.days, h: left.hours }) : t('auction.timeLeftHM', { h: left.hours, m: left.minutes });
  const biddable = !!auction && isBiddable(auction.status);
  const stats = bidStats(bids);

  return (
    <ScreenScaffold
      title={t('outbid.title')} scroll={false}
      footer={auction ? (
        <View style={styles.ctaBar}>
          <View style={{ flex: 1 }}><Button title={t('outbid.walkAway')} variant="outline" onPress={() => router.back()} /></View>
          {biddable ? (
            <View style={{ flex: 1.5 }}>
              <Button title={`${t('outbid.bid')} ${formatMoneyMinor(recommend, ccy, lang)}`} variant="accent"
                onPress={() => router.replace({ pathname: '/(buyer)/auctions/bid', params: { id: id!, minNextMinor: minNext } })} />
            </View>
          ) : null}
        </View>
      ) : undefined}
    >
      {loading ? <View style={{ padding: space[4] }}><SkeletonCard lines={8} /></View> : !auction || failed ? (
        <EmptyState title={t('outbid.unavailable')} actionLabel={t('common.retry')} onAction={load} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space[6] }} showsVerticalScrollIndicator={false}>
          {/* Red hero */}
          <View style={styles.hero}>
            <Text style={styles.emoji}>😔</Text>
            <Text style={styles.heroTitle}>{t('outbid.heroTitle')}</Text>
            <Text style={styles.heroLabel}>{t('outbid.currentHighest')}</Text>
            <MoneyText minor={current} currencyCode={ccy} langCode={lang} size="3xl" style={styles.heroAmt} />
            {myBid ? (
              <Text style={styles.heroSub}>
                {t('outbid.yourBidWas', { bid: formatMoneyMinor(myBid, ccy, lang) })}
                {short && short !== '0' ? ` · ${t('outbid.short', { amount: formatMoneyMinor(short, ccy, lang) })}` : ''}
              </Text>
            ) : null}
          </View>

          <View style={styles.body}>
            {/* Auction details */}
            <Card>
              <Text style={styles.detailsHead}>{t('outbid.details')}</Text>
              <Row label={t('outbid.item')} value={listing ? `${listing.quantityAvailable} ${listing.unitCode} · ${listing.title}` : t('outbid.itemSoon')} />
              <Row label={t('outbid.seller')} value={t('outbid.sellerGeneric')} />
              <Row label={t('outbid.timeLeft')} value={`⏱ ${timeLabel}`} valueStyle={styles.warn} />
              <Row label={t('outbid.totalBidders')} value={String(stats.bidders)} />
            </Card>

            {/* Re-bid nudge — §13: client suggestion */}
            {biddable ? (
              <View style={styles.tip}>
                <Text style={styles.tipText}>
                  <Text style={styles.tipStrong}>💡 {t('outbid.placeNew')}</Text>{'\n'}
                  {t('outbid.needAtLeast', { min: formatMoneyMinor(minNext, ccy, lang) })} · {t('outbid.weRecommend', { rec: formatMoneyMinor(recommend, ccy, lang) })}
                </Text>
              </View>
            ) : null}

            {/* Escrow released */}
            {myBid ? (
              <View style={styles.escrow}>
                <Text style={styles.escrowText}>{t('outbid.escrowReleased', { amount: formatMoneyMinor(myBid, ccy, lang) })}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </ScreenScaffold>
  );
}

function Row({ label, value, valueStyle }: { label: string; value: string; valueStyle?: object }) {
  return <View style={styles.row}><Text style={styles.rl}>{label}</Text><Text style={[styles.rv, valueStyle]} numberOfLines={1}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: color.danger, alignItems: 'center', paddingVertical: space[6], paddingHorizontal: space[5] },
  emoji: { fontSize: 48 },
  heroTitle: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.white, marginTop: space[2] },
  heroLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.95, marginTop: space[2] },
  heroAmt: { color: color.white, fontWeight: font.weight.bold, marginTop: 4 },
  heroSub: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.85, marginTop: 4 },
  body: { padding: space[4] },
  detailsHead: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: font.weight.bold, marginBottom: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, gap: space[3] },
  rl: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink500 },
  rv: { flex: 1, textAlign: 'right', fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  warn: { color: color.warningDark ?? color.warning },
  tip: { marginTop: space[3], padding: space[3], backgroundColor: color.infoLight, borderRadius: radius.md },
  tipText: { fontFamily: font.body, fontSize: font.size.sm, color: color.infoDark, lineHeight: 20 },
  tipStrong: { fontWeight: font.weight.bold, color: color.infoDark },
  escrow: { marginTop: space[3], padding: space[3], backgroundColor: color.warningLight ?? color.accent50, borderRadius: radius.md },
  escrowText: { fontFamily: font.body, fontSize: font.size.xs, color: color.warningDark ?? color.ink600, lineHeight: 18 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
