// apps/mobile/src/app/(buyer)/auctions/[id].tsx · auction detail + watch-live (screens 16/65/194) + outbid banner
// (193) + ended state (66). Thin screen (guide §3): loads the auction + bid history, POLLS every 4s while focused
// (live-ish; degrades to manual refresh). Current price / min-next / EMD / time-left / bidder counts all come from
// the PURE auction helpers (Law 2 bigint). "Place Bid" → the bid screen while biddable; "Watch" toggles follow.
// Behind `auctions`. Degrade-never-die: not-found/failure → EmptyState + retry.
// §13 gaps (no contract → rendered honestly, never faked):
//  • LIVE-AUCTION badge: derived from the real status (live/extended), not a hardcoded label.
//  • Quantity / Organic / FPO meta chips: quantity + organic come from the public listing read; the FPO/tenant
//    NAME is not on any read-model the buyer can see → that chip is omitted, never invented ("Anand FPO").
//  • "Total Bidders / Bids Placed": the read-model exposes no auction-wide aggregates → we show the counts derived
//    from the loaded (Top-N) history, labelled honestly; never the design's 7 / 23.
//  • EMD ₹500: shown from the REAL emd requirement (flat/pct) on the auction; the note is static i18n.
//  • Bidder names ("Sharma Masala Mart", masked "Vyapari T***"): the history carries only a user id → "You" for
//    the caller, a generic "Bidder" for others (initials avatar from the id); we never fabricate trader names.
//  • 👑 marks the leading (top visible) bid — real, from bidStats.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Auction, BidHistoryItem, ListingCard } from '@krishalaya/sdk-js';
import { Button, Card, EmptyState, MoneyText, StatusPill, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useAuth } from '../../../core/auth/auth.store';
import { getAuction, bidHistory, isWatchingAuction, watchAuction, unwatchAuction } from '../../../features/auctions/auctions.api';
import { getPublicListing } from '../../../features/buyer/browse.api';
import { auctionStatusTone, isBiddable, currentPriceMinor, minNextBidMinor, isOutbid, emdRequirement, timeLeft, bidStats } from '../../../features/auctions/auction-status';

const POLL_MS = 4000;

export default function AuctionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const myId = state.profile?.id ?? '';
  const enabled = useFlag('auctions');
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<BidHistoryItem[]>([]);
  const [listing, setListing] = useState<ListingCard | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const a = await getAuction(id);
    setAuction(a); setFailed(!a);
    if (a) { const h = await bidHistory(id); setBids(h.items); }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!enabled || !id) return;
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [enabled, id, refresh]);

  useEffect(() => { if (auction && listing === undefined) getPublicListing(auction.listingId).then((l) => setListing(l)); }, [auction, listing]);
  useEffect(() => { if (id && auction) isWatchingAuction(id).then(setWatching); }, [id, auction]);

  const toggleWatch = useCallback(async () => {
    if (!id || watchBusy) return;
    setWatchBusy(true);
    const next = !watching; setWatching(next);
    try { const r = next ? await watchAuction(id) : await unwatchAuction(id); setWatching(r.watching); }
    catch { setWatching(!next); }
    finally { setWatchBusy(false); }
  }, [id, watching, watchBusy]);

  if (!enabled) return <ScreenScaffold title={t('auction.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const current = auction ? currentPriceMinor(auction, bids) : '0';
  const minNext = auction ? minNextBidMinor(current, auction.minIncrementMinor) : '0';
  const biddable = !!auction && isBiddable(auction.status);
  const outbid = isOutbid(bids, myId);
  const stats = bidStats(bids);
  const left = auction ? timeLeft(auction.endsAt) : { ended: true, days: 0, hours: 0, minutes: 0, totalMs: 0 };
  const timeLeftLabel = left.ended ? t('auction.ended') : left.days > 0 ? t('auction.timeLeftD', { d: left.days, h: left.hours }) : t('auction.timeLeftHM', { h: left.hours, m: left.minutes });

  const footer = auction ? (
    <View style={styles.ctaBar}>
      <View style={{ flex: 1 }}><Button title={watching ? t('auction.watching') : t('auction.watch')} variant="outline" loading={watchBusy} onPress={toggleWatch} /></View>
      {biddable ? (
        <View style={{ flex: 1.5 }}><Button title={`${t('auction.placeBid')} →`} variant="accent" onPress={() => router.push({ pathname: '/(buyer)/auctions/bid', params: { id: id!, minNextMinor: minNext } })} /></View>
      ) : null}
    </View>
  ) : undefined;

  return (
    <ScreenScaffold title={listing?.title ?? t('auction.title')} scroll={false} footer={footer}>
      {loading ? <SkeletonCard lines={6} /> : !auction || failed ? (
        <EmptyState title={t('auction.unavailable')} actionLabel={t('common.retry')} onAction={refresh} />
      ) : (
        <FlatList
          data={bids}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ paddingBottom: space[6] }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Hero + LIVE badge */}
              <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no">
                <Text style={styles.heroGlyph}>🌶️</Text>
                {biddable ? <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveTxt}>{t('auction.live')}</Text></View> : null}
              </View>

              {/* Title + meta */}
              <Text style={styles.title}>{listing?.title ?? t('auction.title')}</Text>
              <View style={styles.meta}>
                {listing ? <StatusPill label={`${listing.quantityAvailable} ${listing.unitCode}`} tone="neutral" /> : null}
                {listing?.organicClaim ? <StatusPill label={t('listings.organic')} tone="success" /> : null}
                <StatusPill label={t(`auction.status.${auction.status}`)} tone={auctionStatusTone(auction.status)} />
              </View>

              {/* Bid box */}
              <View style={styles.bidBox}>
                <Text style={styles.bidLabel}>{t('auction.currentPrice')}</Text>
                <View style={styles.bidAmountRow}>
                  <MoneyText minor={current} langCode={lang} size="3xl" style={{ color: color.white }} />
                  <Text style={styles.perQtl}>{t('auction.perQtl')}</Text>
                </View>
                <View style={styles.bidStatRow}>
                  <View style={styles.bidStat}><Text style={styles.bidStatLabel}>{t('auction.timeLeft')}</Text><Text style={[styles.bidStatVal, styles.timer]}>{timeLeftLabel}</Text></View>
                  <View style={styles.bidStat}><Text style={styles.bidStatLabel}>{t('auction.totalBidders')}</Text><Text style={styles.bidStatVal}>{stats.bidders}</Text></View>
                  <View style={styles.bidStat}><Text style={styles.bidStatLabel}>{t('auction.bidsPlaced')}</Text><Text style={styles.bidStatVal}>{stats.bids}</Text></View>
                </View>
              </View>

              {/* Outbid banner */}
              {outbid && biddable ? <View style={styles.outbid}><Text style={styles.outbidText}>{t('auction.outbid')}</Text></View> : null}

              {/* EMD note */}
              <View style={styles.emd}>
                <Text style={styles.emdIcon}>🔒</Text>
                <Text style={styles.emdText}>
                  {(() => {
                    const emd = emdRequirement(auction);
                    if (emd.kind === 'flat') return <Text style={styles.emdStrong}><MoneyText minor={emd.minor} langCode={lang} size="sm" style={{ color: color.infoDark }} /> {t('auction.emdWord')}</Text>;
                    if (emd.kind === 'pct') return <Text style={styles.emdStrong}>{t('auction.emdPct', { pct: String(emd.pctBps / 100) })}</Text>;
                    return <Text style={styles.emdStrong}>{t('auction.emdWord')}</Text>;
                  })()}
                  {' '}{t('auction.emdNote')}
                </Text>
              </View>

              <Text style={styles.section}>{t('auction.historyTop')}</Text>
            </>
          }
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: color.ink100 }} />}
          ListEmptyComponent={<EmptyState title={t('auction.noBids')} />}
          renderItem={({ item }) => {
            const mine = item.bidderUserId === myId;
            const leading = stats.topBidderId === item.bidderUserId && item.amountMinor != null;
            return (
              <View style={styles.bidRow}>
                <View style={[styles.avatar, mine ? styles.avatarMine : styles.avatarOther]}><Text style={styles.avatarTxt}>{mine ? t('auction.youInitials') : '🧑'}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bidder}>
                    {mine ? t('auction.you') : t('auction.aBidder')}{leading ? '  👑' : ''}
                  </Text>
                  <Text style={styles.bidTime}>
                    {safeRel(item.createdAt, lang)}{leading && !mine && bidStats(bids).topBidderId !== myId && bids.some((b) => b.bidderUserId === myId) ? ` · ${t('auction.youreOutbid')}` : ''}
                  </Text>
                </View>
                {item.amountMinor ? <MoneyText minor={item.amountMinor} langCode={lang} size="md" style={{ color: leading ? color.accent700 : color.primary700 }} /> : <Text style={styles.sealed}>{t('auction.sealed')}</Text>}
              </View>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeRel(value: string | undefined, langCode: string): string { if (!value) return ''; try { return formatRelative(value, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { height: 180, borderRadius: radius.lg, backgroundColor: color.dangerLight, alignItems: 'center', justifyContent: 'center', marginBottom: space[3], position: 'relative' },
  heroGlyph: { fontSize: 80 },
  liveBadge: { position: 'absolute', top: space[3], right: space[3], flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: color.danger },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.white },
  liveTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  title: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.ink800 },
  meta: { flexDirection: 'row', gap: space[2], marginTop: space[2], flexWrap: 'wrap' },
  bidBox: { backgroundColor: color.primary700, borderRadius: radius.lg, padding: space[4], marginTop: space[3] },
  bidLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.white, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.5 },
  bidAmountRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[1], marginTop: space[1] },
  perQtl: { fontFamily: font.body, fontSize: font.size.md, color: color.white, opacity: 0.7, marginBottom: 4 },
  bidStatRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)' },
  bidStat: { alignItems: 'flex-start' },
  bidStatLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.white, opacity: 0.7 },
  bidStatVal: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.white, marginTop: 2 },
  timer: { color: color.accent300 },
  outbid: { backgroundColor: color.dangerLight, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  outbidText: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.semibold, color: color.dangerDark },
  emd: { flexDirection: 'row', gap: space[2], backgroundColor: color.infoLight, borderRadius: radius.md, padding: space[3], marginTop: space[3] },
  emdIcon: { fontSize: 16 },
  emdText: { flex: 1, fontFamily: font.body, fontSize: font.size.sm, color: color.infoDark, lineHeight: 20 },
  emdStrong: { fontWeight: font.weight.bold, color: color.infoDark },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginTop: space[4], marginBottom: space[2] },
  bidRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarMine: { backgroundColor: color.info },
  avatarOther: { backgroundColor: color.primary50 },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white },
  bidder: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink800 },
  bidTime: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400, marginTop: 2 },
  sealed: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
