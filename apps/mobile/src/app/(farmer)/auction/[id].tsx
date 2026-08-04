// apps/mobile/src/app/(farmer)/auction/[id].tsx · screen 65 "Your Auction" (SELLER live view). Thin screen (guide
// §3): the seller watches their own live auction — a gold hero (current highest bid, % above reserve, bidder/bid
// counts), a HH:MM:SS countdown (ticks locally, data POLLS every 4s), a stats strip, and the Top Bids list. The
// seller may Share or Stop Early (cancel — idempotent on the server, which authorises ownership). Behind
// `auctions`. Degrade-never-die: not-found/failure → EmptyState + retry.
// §13 gaps (no contract → rendered honestly, never faked):
//  • "Viewers 340": there is no viewer-count read-model → shown as coming-soon, never a fabricated number.
//  • Bidder names + location ("Rajesh K. · Ahmedabad APMC"): the bid history carries only a user id → a generic
//    "Bidder" + initials avatar, the caller's own bids as "You"; no name/location is invented.
//  • % above reserve, bidder/bid counts, current price, reserve all come from the REAL auction + bid history.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, Alert, Share } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SdkError } from '@krishalaya/sdk-js';
import type { Auction, BidHistoryItem } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { formatRelative } from '@krishalaya/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { useAuth } from '../../../core/auth/auth.store';
import { getAuction, bidHistory, cancelAuction } from '../../../features/auctions/auctions.api';
import { currentPriceMinor, bidStats, timeLeft, formatClock, pctAboveReserve, isBiddable } from '../../../features/auctions/auction-status';

const POLL_MS = 4000;

export default function YourAuction() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useTranslation();
  const router = useRouter();
  const { state } = useAuth();
  const myId = state.profile?.id ?? '';
  const enabled = useFlag('auctions');
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<BidHistoryItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

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
    poll.current = setInterval(refresh, POLL_MS);
    tick.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (poll.current) clearInterval(poll.current); if (tick.current) clearInterval(tick.current); };
  }, [enabled, id, refresh]);

  if (!enabled) return <ScreenScaffold title={t('yourAuction.title')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const current = auction ? currentPriceMinor(auction, bids) : '0';
  const stats = bidStats(bids);
  const left = auction ? timeLeft(auction.endsAt, now) : { ended: true, totalMs: 0, days: 0, hours: 0, minutes: 0 };
  const pct = auction ? pctAboveReserve(current, auction.reservePriceMinor) : null;
  const live = !!auction && isBiddable(auction.status);

  const onShare = async () => { try { await Share.share({ message: t('yourAuction.shareMsg') }); } catch { /* user cancelled */ } };
  const onStop = () => {
    if (!id) return;
    Alert.alert(t('yourAuction.stopTitle'), t('yourAuction.stopBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('yourAuction.stopConfirm'), style: 'destructive', onPress: async () => {
        setStopping(true);
        try { await cancelAuction(id); await refresh(); }
        catch (e) { Alert.alert(t('yourAuction.title'), e instanceof SdkError && e.isForbidden ? t('yourAuction.stopNotAllowed') : t('yourAuction.stopFailed')); }
        finally { setStopping(false); }
      } },
    ]);
  };

  const footer = auction ? (
    <View style={styles.ctaBar}>
      <View style={{ flex: 1 }}><Button title={t('yourAuction.share')} variant="outline" onPress={onShare} /></View>
      {live ? <Button title={t('yourAuction.stopEarly')} variant="danger" loading={stopping} onPress={onStop} /> : null}
    </View>
  ) : undefined;

  return (
    <ScreenScaffold title={t('yourAuction.title')} scroll={false} footer={footer}>
      {loading ? <View style={{ padding: space[4] }}><SkeletonCard lines={8} /></View> : !auction || failed ? (
        <EmptyState title={t('yourAuction.unavailable')} actionLabel={t('common.retry')} onAction={refresh} />
      ) : (
        <FlatList
          data={bids.slice(0, 10)}
          keyExtractor={(b) => b.id}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {/* Gold hero */}
              <View style={styles.hero}>
                {live ? <View style={styles.statusPill}><View style={styles.dot} /><Text style={styles.statusTxt}>{t('yourAuction.liveNow')}</Text></View> : null}
                <MoneyText minor={current} langCode={lang} size="3xl" style={styles.priceBig} />
                <Text style={styles.priceLabel}>{t('yourAuction.currentHighest')}</Text>
                <View style={styles.metaRow}>
                  <View style={styles.meta}><Text style={styles.metaV}>{pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct}%`}</Text><Text style={styles.metaL}>{t('yourAuction.aboveReserve')}</Text></View>
                  <View style={styles.meta}><Text style={styles.metaV}>{stats.bidders}</Text><Text style={styles.metaL}>{t('yourAuction.bidders')}</Text></View>
                  <View style={styles.meta}><Text style={styles.metaV}>{stats.bids}</Text><Text style={styles.metaL}>{t('yourAuction.bidsPlaced')}</Text></View>
                </View>
              </View>

              {/* Timer band */}
              <View style={styles.timer}>
                <Text style={styles.timerLabel}>⏱ {t('yourAuction.endsIn')}</Text>
                <Text style={styles.timerValue}>{left.ended ? t('auction.ended') : formatClock(left.totalMs)}</Text>
              </View>

              {/* Stats strip */}
              <View style={styles.statsGrid}>
                <View style={styles.stat}><Text style={styles.statMuted}>{t('yourAuction.soon')}</Text><Text style={styles.statL}>{t('yourAuction.viewers')}</Text></View>
                <View style={styles.stat}><Text style={styles.statV}>{stats.bidders}</Text><Text style={styles.statL}>{t('yourAuction.bidding')}</Text></View>
                <View style={styles.stat}>{auction.reservePriceMinor ? <MoneyText minor={auction.reservePriceMinor} langCode={lang} size="lg" style={{ color: color.primary700 }} /> : <Text style={styles.statMuted}>—</Text>}<Text style={styles.statL}>{t('yourAuction.reserve')}</Text></View>
              </View>

              <Text style={styles.section}>{t('yourAuction.topBids')}</Text>
            </>
          }
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          contentContainerStyle={{ padding: space[4], paddingTop: 0 }}
          ListEmptyComponent={<EmptyState title={t('auction.noBids')} />}
          renderItem={({ item, index }) => {
            const top = index === 0 && item.amountMinor != null;
            const mine = item.bidderUserId === myId;
            return (
              <View style={[styles.bidItem, top && styles.bidItemTop]}>
                <View style={styles.bidder}>
                  <View style={[styles.avatar, mine ? styles.avatarMine : styles.avatarOther]}><Text style={styles.avatarTxt}>{mine ? t('auction.youInitials') : '🧑'}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bidName}>{mine ? t('auction.you') : t('auction.aBidder')}{top ? '  ' : ''}{top ? <Text style={styles.highest}>{t('yourAuction.highest')}</Text> : null}</Text>
                    <Text style={styles.bidTime}>{item.createdAt ? safeRel(item.createdAt, lang) : ''}</Text>
                  </View>
                </View>
                {item.amountMinor ? <MoneyText minor={item.amountMinor} langCode={lang} size={top ? 'lg' : 'md'} style={{ color: color.accent700 }} /> : <Text style={styles.sealed}>{t('auction.sealed')}</Text>}
              </View>
            );
          }}
        />
      )}
    </ScreenScaffold>
  );
}

function safeRel(value: string, langCode: string): string { try { return formatRelative(value, langCode); } catch { return ''; } }

const styles = StyleSheet.create({
  hero: { backgroundColor: color.accent500, padding: space[4], borderRadius: radius.lg, marginBottom: space[3] },
  statusPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 4, paddingHorizontal: space[2], borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: space[2] },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.white },
  statusTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  priceBig: { color: color.white, fontWeight: font.weight.bold },
  priceLabel: { fontFamily: font.body, fontSize: font.size.sm, color: color.white, opacity: 0.85, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  meta: { flex: 1 },
  metaV: { fontFamily: font.display, fontSize: font.size.lg, fontWeight: font.weight.bold, color: color.white },
  metaL: { fontFamily: font.body, fontSize: 11, color: color.white, opacity: 0.75, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  timer: { backgroundColor: color.dangerLight, borderRadius: radius.md, paddingVertical: space[3], alignItems: 'center', marginBottom: space[3] },
  timerLabel: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.dangerDark, textTransform: 'uppercase', letterSpacing: 0.5 },
  timerValue: { fontFamily: font.display, fontSize: font.size['3xl'], fontWeight: font.weight.bold, color: color.dangerDark, marginTop: 2 },
  statsGrid: { flexDirection: 'row', gap: space[2], marginBottom: space[3] },
  stat: { flex: 1, alignItems: 'center', backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md, paddingVertical: space[3] },
  statV: { fontFamily: font.display, fontSize: font.size.xl, fontWeight: font.weight.bold, color: color.primary700 },
  statMuted: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  statL: { fontFamily: font.body, fontSize: 10, color: color.ink500, fontWeight: font.weight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  section: { fontFamily: font.display, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.ink800, marginBottom: space[2] },
  bidItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[3], backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.md },
  bidItemTop: { borderWidth: 2, borderColor: color.accent500, backgroundColor: color.accent50 },
  bidder: { flexDirection: 'row', alignItems: 'center', gap: space[2], flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarMine: { backgroundColor: color.info },
  avatarOther: { backgroundColor: color.primary50 },
  avatarTxt: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.bold, color: color.white },
  bidName: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  highest: { fontFamily: font.body, fontSize: 10, color: color.accent700, fontWeight: font.weight.bold },
  bidTime: { fontFamily: font.body, fontSize: 11, color: color.ink500, marginTop: 1 },
  sealed: { fontFamily: font.body, fontSize: font.size.sm, color: color.ink400 },
  ctaBar: { flexDirection: 'row', gap: space[2] },
});
