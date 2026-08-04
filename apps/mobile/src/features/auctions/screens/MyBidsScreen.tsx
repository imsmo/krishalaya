// apps/mobile/src/features/auctions/screens/MyBidsScreen.tsx · design screen 18 "My Bids" (cross-auction).
// Thin screen (guide §3): the caller's OWN bids across ALL auctions via features/auctions (keyset load-more),
// split into Active / Won / Lost tabs (with counts), each card showing the lot title, the time left, the bid
// amount, and a winning/outbid indicator. Tap → the auction detail. Behind `auctions`. FLAG_SECURE (money on
// screen). Degrade-never-die: a failed read → empty.
// §13 gaps (no contract → rendered honestly, never faked):
//  • "Current High ₹14,800/₹2,890": the MyBid read-model carries NO current-high amount → we never invent one. We
//    show My Bid (real) + a winning ✓ / outbid ▲ indicator from the authoritative `isWinning` flag. When winning,
//    the current high IS the caller's bid (✓); when outbid we show ▲ without a fabricated number.
//  • Lot title + crop emoji ("Red Chilli — Teja Premium" 🌶️): not on MyBid → fetched best-effort from the public
//    listing read; degrades to a neutral label + a generic auction glyph, never a guessed crop.
//  • Tab counts reflect the LOADED bids (keyset) — the server is the authority on totals.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import type { MyBid } from '@krishalaya/sdk-js';
import { Button, EmptyState, MoneyText, ScreenScaffold, SkeletonCard, color, font, space, radius } from '@krishalaya/ui-native';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { useFlag } from '../../../core/flags/useFlag';
import { listMyBids } from '../auctions.api';
import { getPublicListing } from '../../buyer/browse.api';
import { myBidBucket, myBidCounts, matchesMyBidTab, timeLeft, type MyBidTab } from '../auction-status';
import { useSecureScreen } from '../../../core/security';

const TABS: MyBidTab[] = ['active', 'won', 'lost'];

export function MyBidsScreen() {
  useSecureScreen(); // bid amounts + EMD on screen — FLAG_SECURE (§4)
  const { t, lang } = useTranslation();
  const router = useRouter();
  const enabled = useFlag('auctions');
  const [rows, setRows] = useState<MyBid[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MyBidTab>('active');

  const load = useCallback(async (next?: string) => {
    setLoading(true);
    const page = await listMyBids(next);
    setRows((prev) => (next ? [...prev, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setLoading(false);
    // Best-effort: resolve lot titles for the new rows (public read, cached). Degrade silently.
    for (const b of page.items) {
      if (titles[b.listingId] === undefined) {
        getPublicListing(b.listingId).then((l) => { if (l?.title) setTitles((m) => ({ ...m, [b.listingId]: l.title })); }).catch(() => {});
      }
    }
  }, [titles]);
  useEffect(() => { if (enabled) load(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return <ScreenScaffold title={t('auction.myBids')}><EmptyState title={t('common.unavailable')} /></ScreenScaffold>;

  const counts = myBidCounts(rows);
  const visible = rows.filter((b) => matchesMyBidTab(b, tab));

  return (
    <ScreenScaffold title={t('auction.myBids')} scroll={false}>
      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tk) => {
          const on = tab === tk;
          return (
            <Pressable key={tk} onPress={() => setTab(tk)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
              <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{t(`auction.myBidsTab.${tk}`)}</Text>
              <View style={[styles.tabCount, on && styles.tabCountOn]}><Text style={[styles.tabCountTxt, on && styles.tabCountTxtOn]}>{counts[tk]}</Text></View>
            </Pressable>
          );
        })}
      </View>

      {loading && rows.length === 0 ? <View style={{ padding: space[4] }}><SkeletonCard lines={5} /></View> : (
        <FlatList
          data={visible}
          keyExtractor={(b) => b.bidId}
          contentContainerStyle={{ padding: space[4], gap: space[3] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState title={t('auction.myBidsEmpty.title')} message={t('auction.myBidsEmpty.message')} />}
          renderItem={({ item }) => {
            const bucket = myBidBucket(item);
            const left = timeLeft(item.endsAt);
            const timeLabel = left.ended ? t('auction.ended') : left.days > 0 ? t('auction.timeLeftD', { d: left.days, h: left.hours }) : t('auction.timeLeftHM', { h: left.hours, m: left.minutes });
            return (
              <Pressable onPress={() => router.push({ pathname: '/(buyer)/auctions/[id]', params: { id: item.auctionId } })} accessibilityRole="button" style={[styles.card, item.isWinning && bucket !== 'lost' && styles.cardWinning]}>
                {item.isWinning && bucket !== 'lost' ? <View style={styles.ribbon}><Text style={styles.ribbonTxt}>{t('auction.winningRibbon')}</Text></View> : null}
                <View style={styles.cardRow}>
                  <View style={styles.thumb}><Text style={styles.thumbGlyph}>🔨</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{titles[item.listingId] ?? t('auction.lotFallback')}</Text>
                    {bucket === 'active' ? <Text style={styles.time}>⏱ {t('auction.endsInLabel', { time: timeLabel })}</Text> : null}
                  </View>
                </View>
                <View style={styles.bids}>
                  <View style={styles.bidCell}>
                    <Text style={styles.bidLabel}>{t('auction.myBidLabel')}</Text>
                    <MoneyText minor={item.amountMinor} langCode={lang} size="md" style={{ color: color.infoDark }} />
                  </View>
                  <View style={styles.bidCell}>
                    <Text style={styles.bidLabel}>{t('auction.currentHigh')}</Text>
                    {item.isWinning
                      ? <View style={styles.highRow}><MoneyText minor={item.amountMinor} langCode={lang} size="md" style={{ color: color.successDark }} /><Text style={styles.tick}> ✓</Text></View>
                      : <Text style={styles.outbid}>{t('auction.outbidShort')} ▲</Text>}
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={cursor ? <View style={{ marginTop: space[3] }}><Button title={t('common.loadMore')} variant="outline" loading={loading} onPress={() => load(cursor)} /></View> : null}
        />
      )}
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: color.ink100 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1], paddingVertical: space[3], borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: color.primary600 },
  tabTxt: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.semibold, color: color.ink500 },
  tabTxtOn: { color: color.primary700 },
  tabCount: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: color.ink100 },
  tabCountOn: { backgroundColor: color.primary50 },
  tabCountTxt: { fontFamily: font.body, fontSize: 11, fontWeight: font.weight.bold, color: color.ink600, textAlign: 'center' },
  tabCountTxtOn: { color: color.primary700 },
  card: { backgroundColor: color.card, borderWidth: 1, borderColor: color.ink100, borderRadius: radius.lg, padding: space[3], overflow: 'hidden' },
  cardWinning: { borderColor: color.success },
  ribbon: { position: 'absolute', top: 0, right: 0, paddingVertical: 4, paddingHorizontal: space[3], backgroundColor: color.success, borderBottomLeftRadius: radius.lg },
  ribbonTxt: { fontFamily: font.body, fontSize: 10, fontWeight: font.weight.bold, color: color.white, letterSpacing: 0.5 },
  cardRow: { flexDirection: 'row', gap: space[3] },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: color.dangerLight, alignItems: 'center', justifyContent: 'center' },
  thumbGlyph: { fontSize: 28 },
  title: { fontFamily: font.body, fontSize: font.size.sm, fontWeight: font.weight.bold, color: color.ink800 },
  time: { fontFamily: font.body, fontSize: font.size.xs, fontWeight: font.weight.semibold, color: color.danger, marginTop: 2 },
  bids: { flexDirection: 'row', gap: space[2], marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.ink100 },
  bidCell: { flex: 1 },
  bidLabel: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink500 },
  highRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  tick: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.successDark },
  outbid: { fontFamily: font.body, fontSize: font.size.md, fontWeight: font.weight.bold, color: color.danger, marginTop: 2 },
});
